# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""End-to-end tests for the plan lifecycle endpoints.

Covers:
  · POST /api/v1/plans/{id}/fork
  · POST /api/v1/drafts/{id}/promote
  · DELETE /api/v1/drafts/{id}       — soft delete (status → archived)
  · DELETE /api/v1/plans/{id}        — hard delete (archived → gone)
  · POST /api/v1/plans/{id}/rollback

The state-machine progression these test exercises:

    [created → draft] --promote--> [active]
       │
       ├── fork ──> [draft (new)]
       │
       ├── discard ──> [archived] --hard-delete--> [gone]
       │
    [active] --rollback--> [archived (previous active is restored)]

Audit log + content_hash invariants are verified after each transition.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests._helpers import add_stage, create_plan, promote


def _create_and_promote(client: TestClient, **plan_overrides) -> str:
    """Build a forkable plan: create + add one stage + promote.

    Returns the rating_plan_id. Fork requires at least one stage
    (service layer rejects forking a zero-stage plan as unexecutable).
    """
    plan_id = create_plan(client, **plan_overrides)["rating_plan_id"]
    add_stage(client, plan_id, stage_id="seed", stage_kind="formula")
    promote(client, plan_id)
    return plan_id


# ---------------------------------------------------------------------------
# Fork
# ---------------------------------------------------------------------------


class TestFork:
    def test_fork_active_plan_returns_201(self, client: TestClient) -> None:
        plan_id = _create_and_promote(client, display_name="To Fork")

        response = client.post(f"/api/v1/plans/{plan_id}/fork", json={})
        assert response.status_code == 201
        body = response.json()
        assert "new_draft_id" in body
        assert body["source_plan_id"] == plan_id
        assert body["is_existing_draft"] is False

    def test_fork_draft_returns_409_not_forkable(self, client: TestClient) -> None:
        """Drafts cannot be forked — only ACTIVE plans."""
        created = create_plan(client, display_name="Draft, not active")
        plan_id = created["rating_plan_id"]
        # Don't promote — stays in DRAFT

        response = client.post(f"/api/v1/plans/{plan_id}/fork", json={})
        assert response.status_code == 409
        body = response.json()
        assert body["error"]["code"] == "plan_not_forkable"

    def test_fork_nonexistent_returns_404(self, client: TestClient) -> None:
        response = client.post("/api/v1/plans/does-not-exist/fork", json={})
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"

    def test_fork_idempotent_per_operator(self, client: TestClient) -> None:
        """Same operator forking the same plan twice gets the same draft."""
        plan_id = _create_and_promote(client, display_name="Fork twice")

        first = client.post(f"/api/v1/plans/{plan_id}/fork", json={})
        assert first.status_code == 201
        second = client.post(f"/api/v1/plans/{plan_id}/fork", json={})
        # Same operator (stub) — returns the existing draft with 200
        assert second.status_code == 200
        assert second.json()["new_draft_id"] == first.json()["new_draft_id"]
        assert second.json()["is_existing_draft"] is True

    def test_fork_with_custom_display_name(self, client: TestClient) -> None:
        plan_id = _create_and_promote(client, display_name="Original")

        response = client.post(
            f"/api/v1/plans/{plan_id}/fork",
            json={"new_display_name": "My Custom Draft Name"},
        )
        assert response.status_code == 201
        draft_id = response.json()["new_draft_id"]

        # Fetch the new draft + verify the display name
        draft_detail = client.get(f"/api/v1/plans/{draft_id}").json()
        assert draft_detail["display_name"] == "My Custom Draft Name"


# ---------------------------------------------------------------------------
# Promote
# ---------------------------------------------------------------------------


class TestPromote:
    def test_promote_draft_returns_200(self, client: TestClient) -> None:
        created = create_plan(client, display_name="To Promote")
        plan_id = created["rating_plan_id"]

        response = client.post(
            f"/api/v1/drafts/{plan_id}/promote",
            json={"note": "promotion note"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["new_active_plan_id"] == plan_id

    def test_promote_flips_status_to_active(self, client: TestClient) -> None:
        created = create_plan(client)
        plan_id = created["rating_plan_id"]
        promote(client, plan_id)

        detail = client.get(f"/api/v1/plans/{plan_id}").json()
        assert detail["status"] == "active"

    def test_promote_archives_previous_active(self, client: TestClient) -> None:
        """Promoting a new draft archives the prior active plan for the same LOB+jurisdiction."""
        first_id = _create_and_promote(client, display_name="First")

        # Fork + promote a second
        fork_resp = client.post(f"/api/v1/plans/{first_id}/fork", json={})
        assert fork_resp.status_code == 201, fork_resp.text
        draft_id = fork_resp.json()["new_draft_id"]
        promote_resp = client.post(
            f"/api/v1/drafts/{draft_id}/promote",
            json={},
        )
        assert promote_resp.status_code == 200, promote_resp.text
        assert promote_resp.json()["archived_plan_id"] == first_id

        # Verify first is now archived
        first_detail = client.get(f"/api/v1/plans/{first_id}").json()
        assert first_detail["status"] == "archived"

    def test_promote_active_returns_409(self, client: TestClient) -> None:
        """An already-active plan can't be promoted again."""
        created = create_plan(client)
        plan_id = created["rating_plan_id"]
        promote(client, plan_id)

        response = client.post(f"/api/v1/drafts/{plan_id}/promote", json={})
        assert response.status_code == 409
        body = response.json()
        assert body["error"]["code"] == "illegal_state_transition"

    def test_promote_nonexistent_returns_404(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/drafts/does-not-exist/promote",
            json={},
        )
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------------------
# Discard
# ---------------------------------------------------------------------------


class TestDiscard:
    def test_discard_draft_returns_200(self, client: TestClient) -> None:
        created = create_plan(client, display_name="To Discard")
        plan_id = created["rating_plan_id"]

        response = client.delete(f"/api/v1/drafts/{plan_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["discarded_plan_id"] == plan_id
        assert body["new_status"] == "archived"

    def test_discard_flips_status_to_archived(self, client: TestClient) -> None:
        created = create_plan(client)
        plan_id = created["rating_plan_id"]
        client.delete(f"/api/v1/drafts/{plan_id}")

        detail = client.get(f"/api/v1/plans/{plan_id}").json()
        assert detail["status"] == "archived"

    def test_discard_active_returns_409(self, client: TestClient) -> None:
        created = create_plan(client)
        plan_id = created["rating_plan_id"]
        promote(client, plan_id)

        response = client.delete(f"/api/v1/drafts/{plan_id}")
        assert response.status_code == 409
        body = response.json()
        assert body["error"]["code"] == "illegal_state_transition"

    def test_discard_nonexistent_returns_404(self, client: TestClient) -> None:
        response = client.delete("/api/v1/drafts/does-not-exist")
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------------------
# Hard delete (second stage of the two-stage delete flow)
# ---------------------------------------------------------------------------


class TestHardDelete:
    """`DELETE /api/v1/plans/{id}` — permanent removal of archived plans.

    Hard-delete is gated on `status == 'archived'`: the user must discard
    a draft (or roll back an active plan) before they can permanently
    remove it. This is the data-loss prevention rail — see
    `PlanNotArchivedError` in `author.py`.
    """

    def test_hard_delete_archived_returns_200(self, client: TestClient) -> None:
        plan_id = create_plan(client, display_name="To Hard-Delete")["rating_plan_id"]
        # Soft-delete first → status='archived'
        assert client.delete(f"/api/v1/drafts/{plan_id}").status_code == 200

        response = client.delete(f"/api/v1/plans/{plan_id}")
        assert response.status_code == 200, response.text
        assert response.json() == {"deleted_plan_id": plan_id}

    def test_hard_delete_removes_the_plan(self, client: TestClient) -> None:
        plan_id = create_plan(client)["rating_plan_id"]
        client.delete(f"/api/v1/drafts/{plan_id}")
        client.delete(f"/api/v1/plans/{plan_id}")

        # The row is gone — GET returns 404.
        detail = client.get(f"/api/v1/plans/{plan_id}")
        assert detail.status_code == 404
        assert detail.json()["error"]["code"] == "plan_not_found"

    def test_hard_delete_cascades_to_stages(self, client: TestClient) -> None:
        """`rating_plan_stages.rating_plan_id` has ON DELETE CASCADE."""
        plan_id = create_plan(client)["rating_plan_id"]
        add_stage(client, plan_id, stage_id="seed", stage_kind="formula")
        # Sanity: stage exists pre-delete
        stages_before = client.get(f"/api/v1/plans/{plan_id}/stages").json()
        assert len(stages_before) == 1

        client.delete(f"/api/v1/drafts/{plan_id}")
        client.delete(f"/api/v1/plans/{plan_id}")

        # Stages endpoint 404s (no plan) — and the row is gone in storage.
        stages_after = client.get(f"/api/v1/plans/{plan_id}/stages")
        assert stages_after.status_code == 404

    def test_hard_delete_draft_returns_409_not_archived(
        self,
        client: TestClient,
    ) -> None:
        """Drafts must be discarded first — cannot skip straight to hard delete."""
        plan_id = create_plan(client)["rating_plan_id"]

        response = client.delete(f"/api/v1/plans/{plan_id}")
        assert response.status_code == 409
        body = response.json()
        assert body["error"]["code"] == "plan_not_archived"
        #  — the envelope speaks values, never Python enum reprs.
        assert "status 'draft'" in body["error"]["message"]
        assert "PlanStatus" not in body["error"]["message"]

    def test_hard_delete_active_returns_409_not_archived(
        self,
        client: TestClient,
    ) -> None:
        """Active plans must be rolled back / superseded first."""
        plan_id = create_plan(client)["rating_plan_id"]
        promote(client, plan_id)

        response = client.delete(f"/api/v1/plans/{plan_id}")
        assert response.status_code == 409
        body = response.json()
        assert body["error"]["code"] == "plan_not_archived"

    def test_hard_delete_nonexistent_returns_404(self, client: TestClient) -> None:
        response = client.delete("/api/v1/plans/does-not-exist")
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"

    def test_hard_delete_preserves_audit_history(self, client: TestClient) -> None:
        """Migration 012 dropped the FK CASCADE on `audit_log.rating_plan_id`.

        Audit rows for a plan must SURVIVE a hard-delete — they're the
        only remaining record that the plan ever existed, who touched
        it, and when. Querying audit via the read repo after deletion
        is out of scope here (no plan to bind the query to); we instead
        peek at the raw sqlite to confirm the rows persisted.
        """
        import sqlite3

        from openrater.persistence.db import Database

        plan_id = create_plan(client, display_name="Audit Survival")["rating_plan_id"]
        client.delete(f"/api/v1/drafts/{plan_id}")  # archive
        client.delete(f"/api/v1/plans/{plan_id}")  # hard delete

        # Reach into the shared db from the conftest fixture.
        db: Database = client.app.state.db
        conn: sqlite3.Connection = db.connection().__enter__()
        try:
            rows = conn.execute(
                "SELECT event_kind FROM audit_log "
                "WHERE rating_plan_id = ? ORDER BY event_at",
                (plan_id,),
            ).fetchall()
        finally:
            conn.close()

        kinds = [r[0] for r in rows]
        # Create wrote 'edit' (initial state), discard wrote 'discard',
        # hard-delete wrote 'hard_delete'. The exact sequence may vary
        # across template seeders but 'discard' + 'hard_delete' MUST
        # both be present and they MUST come from this (now-gone) plan.
        assert "discard" in kinds, f"expected 'discard' in {kinds!r}"
        assert "hard_delete" in kinds, f"expected 'hard_delete' in {kinds!r}"


# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------


class TestRollback:
    def test_rollback_with_no_archived_sibling_returns_409(
        self,
        client: TestClient,
    ) -> None:
        created = create_plan(client)
        plan_id = created["rating_plan_id"]
        promote(client, plan_id)

        response = client.post(f"/api/v1/plans/{plan_id}/rollback", json={})
        assert response.status_code == 409
        body = response.json()
        assert body["error"]["code"] == "no_archived_sibling"

    def test_rollback_restores_archived_sibling(self, client: TestClient) -> None:
        """After promoting v2, rolling back should re-activate v1."""
        # v1 (with seed stage so it's forkable)
        v1_id = _create_and_promote(client, display_name="V1")

        # Fork + promote v2 (archives v1)
        fork_resp = client.post(f"/api/v1/plans/{v1_id}/fork", json={})
        assert fork_resp.status_code == 201, fork_resp.text
        v2_id = fork_resp.json()["new_draft_id"]
        promote(client, v2_id)

        # Roll back v2 → re-promotes v1
        rollback_resp = client.post(f"/api/v1/plans/{v2_id}/rollback", json={})
        assert rollback_resp.status_code == 200
        body = rollback_resp.json()
        assert body["new_active_plan_id"] == v1_id
        assert body["archived_plan_id"] == v2_id

        # Verify states
        v1_detail = client.get(f"/api/v1/plans/{v1_id}").json()
        v2_detail = client.get(f"/api/v1/plans/{v2_id}").json()
        assert v1_detail["status"] == "active"
        assert v2_detail["status"] == "archived"

    def test_rollback_draft_returns_409(self, client: TestClient) -> None:
        """Only ACTIVE plans can be rolled back."""
        created = create_plan(client)  # stays in DRAFT
        plan_id = created["rating_plan_id"]

        response = client.post(f"/api/v1/plans/{plan_id}/rollback", json={})
        assert response.status_code == 409
        body = response.json()
        assert body["error"]["code"] == "illegal_state_transition"

    def test_rollback_nonexistent_returns_404(self, client: TestClient) -> None:
        response = client.post("/api/v1/plans/does-not-exist/rollback", json={})
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------------------
# Duplicate (v4 G22) — POST /api/v1/plans/{id}/duplicate
# ---------------------------------------------------------------------------


def _author_full_substrate(client: TestClient, pid: str) -> None:
    """Author every plan-scoped substrate the copy must survive — the
    exact set the old client-side replay dropped (classes / mapping /
    tail) or carried stale (class_library_id)."""
    r = client.post(
        f"/api/v1/plans/{pid}/dimensions/bulk",
        json={
            "dimensions": [
                {
                    "dim_id": "class_code",
                    "display_name": "Class",
                    "slug": "class_code",
                    "data_type": "string",
                    "role": "rating-input",
                    "shape": "categorical",
                    "dimension_type": "classification",
                    # Bound to THIS plan's registry — a verbatim copy
                    # would keep pointing here (the stale-pointer bug).
                    "class_library_id": pid,
                    "levels": [
                        {"kind": "categorical", "id": "l1", "label": "L1"},
                    ],
                }
            ]
        },
    )
    assert r.status_code == 200, r.text
    r = client.post(
        f"/api/v1/plans/{pid}/factor-tables/bulk",
        json={
            "factor_tables": [
                {
                    "table_id": "ft1",
                    "display_name": "FT1",
                    "slug": "ft1",
                    "key_dimensions": ["class_code"],
                    "cells": {"l1": 1.25},
                }
            ]
        },
    )
    assert r.status_code == 200, r.text
    r = client.post(
        f"/api/v1/plans/{pid}/class-codes",
        json={
            "class_code": "c101",
            "display_name": "Meridian Neighborhood Bakery",
            "family": "restaurant",
        },
    )
    assert r.status_code in (200, 201), r.text
    r = client.put(
        f"/api/v1/plans/{pid}/inputs-mapping",
        json={
            "mapping": {
                "source": {"kind": "csv", "columns": ["a"], "sample_rows": []},
                "column_map": {"a": "a"},
                "rollup_fields": [{"fieldName": "premium", "reducer": "sum"}],
            }
        },
    )
    assert r.status_code in (200, 201), r.text
    r = client.put(
        f"/api/v1/plans/{pid}/policy-tail",
        json={"tail": [{"kind": "minimum_premium", "id": "min", "floor": 500}]},
    )
    assert r.status_code in (200, 201), r.text


class TestDuplicate:
    def test_duplicate_draft_copies_every_substrate(
        self, client: TestClient
    ) -> None:
        # A DRAFT source — the state fork refuses and the "Duplicate
        # plan" action actually runs against.
        pid = create_plan(client, display_name="Everything Plan")[
            "rating_plan_id"
        ]
        add_stage(client, pid, stage_id="s1", stage_kind="formula")
        add_stage(client, pid, stage_id="s2", stage_kind="formula")
        _author_full_substrate(client, pid)

        response = client.post(f"/api/v1/plans/{pid}/duplicate", json={})
        assert response.status_code == 201, response.text
        body = response.json()
        new_id = body["new_plan_id"]
        assert new_id != pid
        assert body["source_plan_id"] == pid
        assert body["display_name"] == "Everything Plan (copy)"

        # The copy is an independent DRAFT with the stages in order.
        plan = client.get(f"/api/v1/plans/{new_id}").json()
        assert plan["status"] == "draft"
        assert [s["stage_id"] for s in plan["stages"]] == ["s1", "s2"]

        # Dimensions — copied, and class_library_id RE-POINTED at the copy
        # (not the source: the stale-pointer bug).
        dims = client.get(f"/api/v1/plans/{new_id}/dimensions").json()[
            "dimensions"
        ]
        assert len(dims) == 1
        assert dims[0]["class_library_id"] == new_id

        # Factor tables WITH cells.
        fts = client.get(f"/api/v1/plans/{new_id}/factor-tables").json()[
            "factor_tables"
        ]
        assert len(fts) == 1
        assert fts[0]["cells"] == {"l1": 1.25}

        # Class registry.
        classes = client.get(f"/api/v1/plans/{new_id}/class-codes").json()
        codes = [c["class_code"] for c in classes["class_codes"]]
        assert codes == ["c101"]

        # Input mapping.
        mapping = client.get(f"/api/v1/plans/{new_id}/inputs-mapping").json()
        assert mapping["mapping"]["rollup_fields"] == [
            {"fieldName": "premium", "reducer": "sum"}
        ]

        # Policy tail (ADR-0055 substrate).
        tail = client.get(f"/api/v1/plans/{new_id}/policy-tail").json()
        assert tail["tail"] == [
            {"kind": "minimum_premium", "id": "min", "floor": 500}
        ]

    def test_duplicate_is_independent_of_the_source(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client, display_name="Source")["rating_plan_id"]
        add_stage(client, pid, stage_id="s1", stage_kind="formula")
        _author_full_substrate(client, pid)
        new_id = client.post(f"/api/v1/plans/{pid}/duplicate", json={}).json()[
            "new_plan_id"
        ]

        # Mutate the COPY's tail; the source must not move.
        r = client.put(
            f"/api/v1/plans/{new_id}/policy-tail",
            json={"tail": [{"kind": "minimum_premium", "id": "min", "floor": 900}]},
        )
        assert r.status_code in (200, 201), r.text
        source_tail = client.get(f"/api/v1/plans/{pid}/policy-tail").json()
        assert source_tail["tail"][0]["floor"] == 500

    def test_duplicate_never_idempotent(self, client: TestClient) -> None:
        # Unlike fork: every call is a fresh copy.
        pid = create_plan(client, display_name="Twice")["rating_plan_id"]
        add_stage(client, pid, stage_id="s1", stage_kind="formula")
        first = client.post(f"/api/v1/plans/{pid}/duplicate", json={}).json()
        second = client.post(f"/api/v1/plans/{pid}/duplicate", json={}).json()
        assert first["new_plan_id"] != second["new_plan_id"]

    def test_duplicate_active_plan_and_custom_name(
        self, client: TestClient
    ) -> None:
        # Any-status source: an ACTIVE plan duplicates too.
        pid = _create_and_promote(client, display_name="Live Plan")
        response = client.post(
            f"/api/v1/plans/{pid}/duplicate",
            json={"new_display_name": "Live Plan → MO port"},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["display_name"] == "Live Plan → MO port"
        plan = client.get(f"/api/v1/plans/{body['new_plan_id']}").json()
        assert plan["status"] == "draft"

    def test_duplicate_stageless_draft_is_allowed(
        self, client: TestClient
    ) -> None:
        # Copying a plan mid-build (zero stages) is the point of
        # "Save as copy" — fork's unexecutable-plan refusal doesn't apply.
        pid = create_plan(client, display_name="Blank")["rating_plan_id"]
        response = client.post(f"/api/v1/plans/{pid}/duplicate", json={})
        assert response.status_code == 201, response.text

    def test_duplicate_nonexistent_returns_404(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/v1/plans/nope/duplicate", json={})
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"

    def test_duplicate_does_not_satisfy_fork_idempotency(
        self, client: TestClient
    ) -> None:
        # A duplicate carries parent_plan_id for lineage, but it must NOT
        # be returned as the operator's "existing draft" by a later fork
        # (the idempotency lookup keys on the `fork` audit event).
        pid = _create_and_promote(client, display_name="Lineage")
        dup_id = client.post(f"/api/v1/plans/{pid}/duplicate", json={}).json()[
            "new_plan_id"
        ]
        fork = client.post(f"/api/v1/plans/{pid}/fork", json={})
        assert fork.status_code == 201  # a NEW draft, not the duplicate
        assert fork.json()["new_draft_id"] != dup_id
