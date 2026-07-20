# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Brief 84 D-F — the derived-status substrate on the plans index.

GET /plans and GET /plans/{id} carry `published_version`, `diverged`,
and `live_integration_count` so every surface (header chip, list, Home)
derives ONE headline status — Draft / Live / Archived — from ONE batch
query, never an N+1 fan-out.

Semantics under test:
  · unpublished plan  → published_version null, diverged false, count 0
  · freeze alone      → still null (freeze is a checkpoint, not a release)
  · publish           → published_version filled on list AND detail
  · edit after publish→ diverged flips true (Brief 76 P4.4 hash grammar)
  · re-publish        → diverged returns to false
  · live exposure     → live_integration_count counts live=1 rows only
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import add_stage, create_plan


def _freeze(client: TestClient, plan_id: str, name: str) -> dict[str, Any]:
    r = client.post(
        f"/api/v1/plans/{plan_id}/snapshots", json={"display_name": name}
    )
    assert r.status_code == 201, r.text
    return r.json()


def _publish(client: TestClient, plan_id: str, snapshot_id: str) -> None:
    r = client.patch(f"/api/v1/plans/{plan_id}/snapshots/{snapshot_id}/publish")
    assert r.status_code == 200, r.text


def _list_row(client: TestClient, plan_id: str) -> dict[str, Any]:
    r = client.get("/api/v1/plans", params={"status": "all"})
    assert r.status_code == 200, r.text
    rows = [p for p in r.json() if p["rating_plan_id"] == plan_id]
    assert rows, f"plan {plan_id} missing from the index"
    return rows[0]


def _detail(client: TestClient, plan_id: str) -> dict[str, Any]:
    r = client.get(f"/api/v1/plans/{plan_id}")
    assert r.status_code == 200, r.text
    return r.json()


class TestPublishOverviewFields:
    def test_unpublished_plan_reads_as_draft(self, client: TestClient) -> None:
        plan_id = create_plan(client)["rating_plan_id"]
        for row in (_list_row(client, plan_id), _detail(client, plan_id)):
            assert row["published_version"] is None
            assert row["diverged"] is False
            assert row["live_integration_count"] == 0

    def test_freeze_alone_does_not_read_as_live(
        self, client: TestClient
    ) -> None:
        """A frozen version is a checkpoint (\"Save a version…\"), not a
        release — only PUBLISH makes the plan live."""
        plan_id = create_plan(client)["rating_plan_id"]
        _freeze(client, plan_id, "checkpoint")
        assert _list_row(client, plan_id)["published_version"] is None

    def test_publish_fills_published_version_on_list_and_detail(
        self, client: TestClient
    ) -> None:
        plan_id = create_plan(client)["rating_plan_id"]
        snap = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, snap["snapshot_id"])

        for row in (_list_row(client, plan_id), _detail(client, plan_id)):
            pv = row["published_version"]
            assert pv is not None
            assert pv["snapshot_id"] == snap["snapshot_id"]
            assert pv["display_name"] == "v1"
            assert pv["published_at"]  # ISO timestamp
            assert row["diverged"] is False

    def test_edit_after_publish_flips_diverged(
        self, client: TestClient
    ) -> None:
        """The Brief 76 P4.4 grammar, surfaced on the index: the draft's
        content hash moving off the published capture = diverged."""
        plan_id = create_plan(client)["rating_plan_id"]
        snap = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, snap["snapshot_id"])
        assert _list_row(client, plan_id)["diverged"] is False

        add_stage(client, plan_id)  # any substrate edit recomputes the hash

        assert _list_row(client, plan_id)["diverged"] is True
        assert _detail(client, plan_id)["diverged"] is True

        # Re-publishing a fresh freeze reconciles the drift.
        snap2 = _freeze(client, plan_id, "v2")
        _publish(client, plan_id, snap2["snapshot_id"])
        row = _list_row(client, plan_id)
        assert row["diverged"] is False
        assert row["published_version"]["display_name"] == "v2"

    def test_live_integration_count_counts_live_rows_only(
        self, client: TestClient
    ) -> None:
        """Direct-row setup (the full pair→expose→test→live choreography is
        test_routes_integrations' job) — the index just COUNTs live=1."""
        plan_id = create_plan(client)["rating_plan_id"]
        snap = _freeze(client, plan_id, "v1")
        _publish(client, plan_id, snap["snapshot_id"])

        db = client.app.state.db  # type: ignore[attr-defined]
        with db.connection() as conn:
            # Two integrations — (integration_id, rating_plan_id) is UNIQUE,
            # so live + paused exposures need separate pairings.
            for int_id, int_name in (
                ("int_live", "Meridian Front"),
                ("int_paused", "Legacy Portal"),
            ):
                conn.execute(
                    """
                    INSERT INTO integrations (integration_id, name, created_at)
                    VALUES (?, ?, '2026-07-11T00:00:00Z')
                    """,
                    (int_id, int_name),
                )
            conn.execute(
                """
                INSERT INTO integration_exposed_plans
                    (exposed_id, integration_id, rating_plan_id, plan_ref,
                     carrier_label, live, created_at)
                VALUES ('exp_live', 'int_live', ?, 'ref_a', 'Carrier A', 1,
                        '2026-07-11T00:00:00Z')
                """,
                (plan_id,),
            )
            conn.execute(
                """
                INSERT INTO integration_exposed_plans
                    (exposed_id, integration_id, rating_plan_id, plan_ref,
                     carrier_label, live, created_at)
                VALUES ('exp_paused', 'int_paused', ?, 'ref_b', 'Carrier B', 0,
                        '2026-07-11T00:00:00Z')
                """,
                (plan_id,),
            )
            conn.commit()

        row = _list_row(client, plan_id)
        assert row["live_integration_count"] == 1  # live=1 only, not paused
