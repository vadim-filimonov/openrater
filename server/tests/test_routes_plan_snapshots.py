# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""End-to-end tests for the plan snapshots endpoints — Brief 43 §4 / PR 43.1.

Three endpoints:

  · POST  /api/v1/plans/{plan_id}/snapshots                — freeze
  · GET   /api/v1/plans/{plan_id}/snapshots                — list summaries
  · GET   /api/v1/plans/{plan_id}/snapshots/{snapshot_id}  — fetch one + body

Snapshots are append-only — these tests cover the happy paths + the
two failure modes (PlanNotFoundError → 404, name collision → 409).
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from tests._helpers import create_plan


class TestFreezeSnapshot:
    def test_freezes_current_plan_and_returns_body(
        self, client: TestClient
    ) -> None:
        """Happy path: create a plan, freeze it, assert the response
        carries the full self-contained body."""
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]

        response = client.post(
            f"/api/v1/plans/{plan_id}/snapshots",
            json={
                "display_name": "filed_2026_q3",
                "notes": "Q3 filing baseline.",
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()

        # Snapshot identity
        assert body["snapshot_id"].startswith("ps_")
        assert body["plan_id"] == plan_id
        assert body["display_name"] == "filed_2026_q3"
        assert body["notes"] == "Q3 filing baseline."
        assert body["created_by"]  # auth shim provides a value
        assert body["created_at"]  # ISO 8601 string

        # Self-contained body
        assert "plan" in body["body"]
        assert "stages" in body["body"]
        assert "dimensions" in body["body"]
        assert "factor_tables" in body["body"]
        assert "input_mapping" in body["body"]
        assert "policy_tail" in body["body"]
        assert "class_codes" in body["body"]
        # Plan identity round-trips
        assert body["body"]["plan"]["rating_plan_id"] == plan_id

    def test_body_captures_the_class_registry(
        self, client: TestClient
    ) -> None:
        """ADR-0055 open question, resolved: a classification dim resolves
        class codes → attributes → derived dims at score time, so a frozen
        version must carry its registry (same reproducibility class as the
        tail)."""
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        r = client.post(
            f"/api/v1/plans/{plan_id}/class-codes",
            json={
                "class_code": "09015",
                "display_name": "Bagelry",
                "family": "restaurant",
            },
        )
        assert r.status_code in (200, 201), r.text
        response = client.post(
            f"/api/v1/plans/{plan_id}/snapshots",
            json={"display_name": "with-classes"},
        )
        assert response.status_code == 201, response.text
        codes = response.json()["body"]["class_codes"]
        assert [c["class_code"] for c in codes] == ["09015"]

    def test_freeze_allows_null_notes(self, client: TestClient) -> None:
        """Notes is optional — omitting should land None."""
        plan = create_plan(client)
        response = client.post(
            f"/api/v1/plans/{plan['rating_plan_id']}/snapshots",
            json={"display_name": "v1"},
        )
        assert response.status_code == 201, response.text
        assert response.json()["notes"] is None

    def test_freeze_404_on_unknown_plan(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/plans/nonexistent_plan_id/snapshots",
            json={"display_name": "filed"},
        )
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"

    def test_freeze_409_on_name_collision(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]

        first = client.post(
            f"/api/v1/plans/{plan_id}/snapshots",
            json={"display_name": "duplicate_name"},
        )
        assert first.status_code == 201

        second = client.post(
            f"/api/v1/plans/{plan_id}/snapshots",
            json={"display_name": "duplicate_name"},
        )
        assert second.status_code == 409
        body = second.json()
        assert body["error"]["code"] == "snapshot_name_collision"

    def test_same_name_across_different_plans_allowed(
        self, client: TestClient
    ) -> None:
        """UNIQUE is scoped to (plan_id, display_name) — the same label
        on a different plan should succeed."""
        plan_a = create_plan(client, display_name="Plan A")
        plan_b = create_plan(client, display_name="Plan B")

        for plan in (plan_a, plan_b):
            response = client.post(
                f"/api/v1/plans/{plan['rating_plan_id']}/snapshots",
                json={"display_name": "filed_2026_q3"},
            )
            assert response.status_code == 201, response.text

    def test_validation_rejects_empty_display_name(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client)
        response = client.post(
            f"/api/v1/plans/{plan['rating_plan_id']}/snapshots",
            json={"display_name": ""},
        )
        # Pydantic min_length=1 → 422
        assert response.status_code == 422


class TestListSnapshots:
    def test_returns_empty_list_when_none_frozen(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client)
        response = client.get(
            f"/api/v1/plans/{plan['rating_plan_id']}/snapshots"
        )
        assert response.status_code == 200
        assert response.json() == {"snapshots": []}

    def test_returns_newest_first(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]

        for name in ("v1", "v2", "v3"):
            client.post(
                f"/api/v1/plans/{plan_id}/snapshots",
                json={"display_name": name},
            )

        response = client.get(f"/api/v1/plans/{plan_id}/snapshots")
        assert response.status_code == 200
        snapshots = response.json()["snapshots"]
        assert len(snapshots) == 3
        # Newest-first ordering — v3 created last, so it lands first.
        # (created_at strings sort lexicographically by ISO 8601.)
        names = [s["display_name"] for s in snapshots]
        assert names == ["v3", "v2", "v1"]

    def test_list_summaries_omit_body(self, client: TestClient) -> None:
        """List endpoint returns light summaries only — no body blob
        (the picker doesn't need it)."""
        plan = create_plan(client)
        client.post(
            f"/api/v1/plans/{plan['rating_plan_id']}/snapshots",
            json={"display_name": "v1", "notes": "first"},
        )
        response = client.get(
            f"/api/v1/plans/{plan['rating_plan_id']}/snapshots"
        )
        summary = response.json()["snapshots"][0]
        assert "body" not in summary
        assert summary["display_name"] == "v1"
        assert summary["notes"] == "first"

    def test_list_scoped_to_plan(self, client: TestClient) -> None:
        """One plan's list can't surface another plan's snapshots."""
        plan_a = create_plan(client, display_name="A")
        plan_b = create_plan(client, display_name="B")

        client.post(
            f"/api/v1/plans/{plan_a['rating_plan_id']}/snapshots",
            json={"display_name": "filed"},
        )

        response = client.get(
            f"/api/v1/plans/{plan_b['rating_plan_id']}/snapshots"
        )
        assert response.json() == {"snapshots": []}


class TestGetSnapshot:
    def test_returns_full_body(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        created = client.post(
            f"/api/v1/plans/{plan_id}/snapshots",
            json={"display_name": "v1", "notes": "test"},
        ).json()
        snapshot_id = created["snapshot_id"]

        response = client.get(
            f"/api/v1/plans/{plan_id}/snapshots/{snapshot_id}"
        )
        assert response.status_code == 200
        body = response.json()
        assert body["snapshot_id"] == snapshot_id
        assert body["display_name"] == "v1"
        # Full body present
        assert "plan" in body["body"]
        assert body["body"]["plan"]["rating_plan_id"] == plan_id

    def test_404_on_unknown_snapshot(self, client: TestClient) -> None:
        plan = create_plan(client)
        response = client.get(
            f"/api/v1/plans/{plan['rating_plan_id']}/snapshots/ps_nonexistent"
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "snapshot_not_found"

    def test_404_when_snapshot_belongs_to_different_plan(
        self, client: TestClient
    ) -> None:
        """Cross-plan lookup must NOT surface another plan's snapshot."""
        plan_a = create_plan(client, display_name="A")
        plan_b = create_plan(client, display_name="B")

        # Freeze on plan A
        created = client.post(
            f"/api/v1/plans/{plan_a['rating_plan_id']}/snapshots",
            json={"display_name": "filed"},
        ).json()
        snapshot_id = created["snapshot_id"]

        # Try to fetch it via plan B's namespace
        response = client.get(
            f"/api/v1/plans/{plan_b['rating_plan_id']}/snapshots/{snapshot_id}"
        )
        assert response.status_code == 404


class TestPublishSnapshot:
    def test_publish_marks_current_and_clears_prior(
        self, client: TestClient
    ) -> None:
        """Publishing a version makes it Current; publishing another demotes
        the first — exactly one Current per plan (Brief 64 §4)."""
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        s1 = client.post(
            f"/api/v1/plans/{plan_id}/snapshots", json={"display_name": "v1"}
        ).json()
        s2 = client.post(
            f"/api/v1/plans/{plan_id}/snapshots", json={"display_name": "v2"}
        ).json()

        r1 = client.patch(
            f"/api/v1/plans/{plan_id}/snapshots/{s1['snapshot_id']}/publish"
        )
        assert r1.status_code == 200, r1.text
        assert r1.json()["published_at"]
        assert r1.json()["published_by"]

        snaps = {
            s["snapshot_id"]: s
            for s in client.get(f"/api/v1/plans/{plan_id}/snapshots").json()[
                "snapshots"
            ]
        }
        assert snaps[s1["snapshot_id"]]["published_at"] is not None
        assert snaps[s2["snapshot_id"]]["published_at"] is None

        r2 = client.patch(
            f"/api/v1/plans/{plan_id}/snapshots/{s2['snapshot_id']}/publish"
        )
        assert r2.status_code == 200, r2.text
        snaps2 = {
            s["snapshot_id"]: s
            for s in client.get(f"/api/v1/plans/{plan_id}/snapshots").json()[
                "snapshots"
            ]
        }
        assert snaps2[s2["snapshot_id"]]["published_at"] is not None
        assert snaps2[s1["snapshot_id"]]["published_at"] is None

    def test_publish_404_on_unknown_snapshot(self, client: TestClient) -> None:
        plan = create_plan(client)
        response = client.patch(
            f"/api/v1/plans/{plan['rating_plan_id']}/snapshots/ps_nope/publish"
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "snapshot_not_found"

    def test_publish_scoped_to_plan(self, client: TestClient) -> None:
        """Publishing via the wrong plan's namespace must 404 — no cross-plan
        publish."""
        plan_a = create_plan(client, display_name="A")
        plan_b = create_plan(client, display_name="B")
        created = client.post(
            f"/api/v1/plans/{plan_a['rating_plan_id']}/snapshots",
            json={"display_name": "filed"},
        ).json()
        response = client.patch(
            f"/api/v1/plans/{plan_b['rating_plan_id']}/snapshots/"
            f"{created['snapshot_id']}/publish"
        )
        assert response.status_code == 404


class TestPublishStatus:
    """Brief 76 P4.4 (D-C) — the divergence signal: has the working draft
    drifted from the published version? Publishing does NOT lock the draft;
    it makes drift VISIBLE."""

    def test_unpublished_plan_is_a_first_class_state(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        res = client.get(f"/api/v1/plans/{pid}/publish-status")
        assert res.status_code == 200, res.text
        st = res.json()
        assert st["published"] is False
        assert st["diverged"] is False
        assert st["published_snapshot_id"] is None
        # The draft's own hash is still reported (a real content hash).
        assert isinstance(st["draft_content_hash"], str) and st["draft_content_hash"]

    def test_published_with_no_edits_has_not_diverged(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client)["rating_plan_id"]
        snap = client.post(
            f"/api/v1/plans/{pid}/snapshots", json={"display_name": "v1"}
        ).json()
        client.patch(
            f"/api/v1/plans/{pid}/snapshots/{snap['snapshot_id']}/publish"
        )
        st = client.get(f"/api/v1/plans/{pid}/publish-status").json()
        assert st["published"] is True
        assert st["published_snapshot_id"] == snap["snapshot_id"]
        assert st["diverged"] is False
        assert st["published_content_hash"] == st["draft_content_hash"]

    def test_editing_the_draft_after_publish_diverges(
        self, client: TestClient
    ) -> None:
        from tests._helpers import add_stage

        pid = create_plan(client)["rating_plan_id"]
        snap = client.post(
            f"/api/v1/plans/{pid}/snapshots", json={"display_name": "v1"}
        ).json()
        client.patch(
            f"/api/v1/plans/{pid}/snapshots/{snap['snapshot_id']}/publish"
        )
        before = client.get(f"/api/v1/plans/{pid}/publish-status").json()
        assert before["diverged"] is False

        # Edit the still-editable draft — its content hash moves.
        add_stage(client, pid, stage_id="drift_stage")

        after = client.get(f"/api/v1/plans/{pid}/publish-status").json()
        assert after["diverged"] is True
        assert after["draft_content_hash"] != after["published_content_hash"]
        # The published version is unchanged — only the draft drifted.
        assert after["published_content_hash"] == before["published_content_hash"]


# ---------------------------------------------------------------------------
# Publish atomicity (audit item 2)
# ---------------------------------------------------------------------------


class _FailOnPromoteConn:
    """Wraps a sqlite3 connection, raising when the PROMOTE update runs
    (`published_at = ?`). Demote (`published_at = NULL`) and the surrounding
    BEGIN/rollback pass through — so the test proves demote is rolled back
    with the failed promote rather than left committed on its own."""

    def __init__(self, real: sqlite3.Connection) -> None:
        object.__setattr__(self, "_real", real)

    def execute(self, sql: str, *args: object, **kwargs: object):
        if "published_at = ?" in sql:
            raise sqlite3.OperationalError("injected mid-publish failure")
        return self._real.execute(sql, *args, **kwargs)

    def __enter__(self):
        self._real.__enter__()
        return self

    def __exit__(self, *exc: object):
        return self._real.__exit__(*exc)

    def __getattr__(self, name: str):
        return getattr(self._real, name)

    def __setattr__(self, name: str, value: object) -> None:
        setattr(self._real, name, value)


class _PromoteFailingDatabase:
    """A `Database` facade whose connections fail on the promote UPDATE."""

    def __init__(self, real: object) -> None:
        self._real = real

    def connection(self) -> _FailOnPromoteConn:
        return _FailOnPromoteConn(self._real.connection())

    def __getattr__(self, name: str):
        return getattr(self._real, name)


class TestPublishAtomicity:
    """Demote-then-promote is ONE transaction. A crash (or lock timeout)
    between the two UPDATEs must not strand the plan with every version
    demoted and none promoted — the 'no published version → every default-
    version quote 404s no_published_version' regression."""

    def test_promote_failure_rolls_back_the_demote(self, client: TestClient) -> None:
        from openrater.rates.snapshots.repo import (
            get_published_snapshot,
            publish_snapshot,
        )

        plan_id = create_plan(client)["rating_plan_id"]
        s1 = client.post(
            f"/api/v1/plans/{plan_id}/snapshots",
            json={"display_name": "v1", "notes": "first"},
        ).json()
        s2 = client.post(
            f"/api/v1/plans/{plan_id}/snapshots",
            json={"display_name": "v2", "notes": "second"},
        ).json()
        # v1 is the live published version.
        assert (
            client.patch(
                f"/api/v1/plans/{plan_id}/snapshots/{s1['snapshot_id']}/publish"
            ).status_code
            == 200
        )

        db = client.app.state.db
        # Publishing v2 fails at the promote step (demote of v1 has already run
        # inside the transaction). The write must roll back as a unit.
        with pytest.raises(sqlite3.OperationalError):
            publish_snapshot(
                db=_PromoteFailingDatabase(db),
                plan_id=plan_id,
                snapshot_id=s2["snapshot_id"],
                published_by="tester",
            )

        # v1 is STILL published (its demote was rolled back); v2 is not.
        published = get_published_snapshot(db=db, plan_id=plan_id)
        assert published is not None, (
            "publish must be atomic — a failed promote must not leave the plan "
            "with NO published version"
        )
        assert published.snapshot_id == s1["snapshot_id"]
