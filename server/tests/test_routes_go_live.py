# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Brief 84 D-B — POST /plans/{id}/publish: the ONE deploy verb.

Freeze the current draft AND publish it in one call. Semantics under
test:
  · default name = first free v{N}; walks past user-named collisions
  · explicit name honored; explicit collision → 409
  · response = {snapshot, publish_status} with diverged False
  · going live again (the update path) switches the served version
  · the derived-status substrate (published_version on the index)
    reflects the new version immediately
  · 404 on an unknown plan
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import add_stage, create_plan


def _go_live(
    client: TestClient, plan_id: str, body: dict[str, Any] | None = None
) -> dict[str, Any]:
    r = client.post(f"/api/v1/plans/{plan_id}/publish", json=body or {})
    assert r.status_code == 201, r.text
    return r.json()


def _list_row(client: TestClient, plan_id: str) -> dict[str, Any]:
    r = client.get("/api/v1/plans", params={"status": "all"})
    assert r.status_code == 200, r.text
    return next(p for p in r.json() if p["rating_plan_id"] == plan_id)


class TestGoLive:
    def test_first_go_live_auto_names_v1(self, client: TestClient) -> None:
        plan_id = create_plan(client)["rating_plan_id"]
        body = _go_live(client, plan_id)

        assert body["snapshot"]["display_name"] == "v1"
        assert body["snapshot"]["published_at"]  # published, not just frozen
        status = body["publish_status"]
        assert status["published"] is True
        assert status["published_snapshot_id"] == body["snapshot"]["snapshot_id"]
        assert status["diverged"] is False  # the version IS the draft's bytes

        # The derived-status substrate flips on the index in the same call.
        row = _list_row(client, plan_id)
        assert row["published_version"]["display_name"] == "v1"
        assert row["diverged"] is False

    def test_update_path_switches_the_served_version(
        self, client: TestClient
    ) -> None:
        plan_id = create_plan(client)["rating_plan_id"]
        first = _go_live(client, plan_id)
        add_stage(client, plan_id)  # draft moves → diverged
        assert _list_row(client, plan_id)["diverged"] is True

        second = _go_live(client, plan_id)
        assert second["snapshot"]["display_name"] == "v2"
        assert second["publish_status"]["diverged"] is False
        assert (
            second["publish_status"]["published_snapshot_id"]
            != first["snapshot"]["snapshot_id"]
        )
        # v1 stays in the timeline, demoted (exactly one published).
        r = client.get(f"/api/v1/plans/{plan_id}/snapshots")
        snaps = {s["display_name"]: s for s in r.json()["snapshots"]}
        assert snaps["v1"]["published_at"] is None
        assert snaps["v2"]["published_at"] is not None

    def test_auto_name_walks_past_user_named_collisions(
        self, client: TestClient
    ) -> None:
        """One saved checkpoint hand-named 'v2' must not make the auto-namer
        409: count says v2, taken → v3."""
        plan_id = create_plan(client)["rating_plan_id"]
        r = client.post(
            f"/api/v1/plans/{plan_id}/snapshots", json={"display_name": "v2"}
        )
        assert r.status_code == 201, r.text
        body = _go_live(client, plan_id)
        assert body["snapshot"]["display_name"] == "v3"

    def test_explicit_name_honored_and_collision_409s(
        self, client: TestClient
    ) -> None:
        plan_id = create_plan(client)["rating_plan_id"]
        body = _go_live(client, plan_id, {"version_name": "filed_2026_q3"})
        assert body["snapshot"]["display_name"] == "filed_2026_q3"

        r = client.post(
            f"/api/v1/plans/{plan_id}/publish",
            json={"version_name": "filed_2026_q3"},
        )
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "snapshot_name_collision"

    def test_unknown_plan_404s(self, client: TestClient) -> None:
        r = client.post("/api/v1/plans/nope_00000000/publish", json={})
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "plan_not_found"
