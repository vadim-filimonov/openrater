# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Brief 84 D-D + D-E — the plan-side Connect view + archive-turns-API-off.

GET /plans/{id}/integrations feeds the Ship tab's Connect card: every
integration exposing the plan with the Hub's journey ladder, plus the
platform pairing facts (`any_integration` / `any_paired`) the empty
states key off.

D-E: discarding (archiving) a plan clears its published pointer in the
same transaction — /quote 404s and the index reads unpublished.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import create_plan


def _go_live(client: TestClient, plan_id: str) -> dict[str, Any]:
    r = client.post(f"/api/v1/plans/{plan_id}/publish", json={})
    assert r.status_code == 201, r.text
    return r.json()


def _connections(client: TestClient, plan_id: str) -> dict[str, Any]:
    r = client.get(f"/api/v1/plans/{plan_id}/integrations")
    assert r.status_code == 200, r.text
    return r.json()


def _create_integration(client: TestClient, name: str) -> str:
    r = client.post("/api/v1/integrations", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["integration_id"]


class TestPlanConnections:
    def test_no_integrations_platform_wide(self, client: TestClient) -> None:
        """The don't-nag gate: an API-only shop reads any_integration
        False — the card teaches pairing, Home never nags."""
        plan_id = create_plan(client)["rating_plan_id"]
        body = _connections(client, plan_id)
        assert body == {
            "any_integration": False,
            "any_paired": False,
            "connections": [],
        }

    def test_integration_exists_but_plan_not_exposed(
        self, client: TestClient
    ) -> None:
        plan_id = create_plan(client)["rating_plan_id"]
        _create_integration(client, "Meridian Front")
        body = _connections(client, plan_id)
        assert body["any_integration"] is True
        assert body["any_paired"] is False  # created ≠ paired
        assert body["connections"] == []

    def test_exposed_plan_carries_the_hub_ladder(
        self, client: TestClient
    ) -> None:
        plan_id = create_plan(client)["rating_plan_id"]
        _go_live(client, plan_id)  # expose is publish-gated (Brief 77 §5)
        integration_id = _create_integration(client, "Meridian Front")
        r = client.post(
            f"/api/v1/integrations/{integration_id}/plans",
            json={"rating_plan_id": plan_id, "carrier_label": "Carrier A"},
        )
        assert r.status_code == 201, r.text

        body = _connections(client, plan_id)
        assert len(body["connections"]) == 1
        row = body["connections"][0]
        assert row["integration_id"] == integration_id
        assert row["integration_name"] == "Meridian Front"
        assert row["paired"] is False
        exposed = row["exposed"]
        # The Hub's OWN read model rides the row — same ladder, same
        # counts, the two surfaces can't disagree.
        assert exposed["carrier_label"] == "Carrier A"
        assert exposed["status"] == "unmapped"
        assert exposed["live"] is False
        assert exposed["published"] is True

    def test_unknown_plan_is_a_first_class_empty(
        self, client: TestClient
    ) -> None:
        """Read-only view — an unknown/unexposed id is an empty list,
        not a 404 (mirrors GET /plans/{id}/snapshots semantics)."""
        body = _connections(client, "nope_00000000")
        assert body["connections"] == []


class TestArchiveTurnsApiOff:
    def test_discard_clears_the_published_pointer(
        self, client: TestClient
    ) -> None:
        plan_id = create_plan(client)["rating_plan_id"]
        _go_live(client, plan_id)

        # Live: /quote resolves (422/200 territory, never no-version 404)
        # and the index says published.
        r = client.get("/api/v1/plans", params={"status": "all"})
        row = next(p for p in r.json() if p["rating_plan_id"] == plan_id)
        assert row["published_version"] is not None

        r = client.delete(f"/api/v1/drafts/{plan_id}")
        assert r.status_code in (200, 204), r.text

        # D-E — archived means the API is OFF, in the same transaction.
        r = client.get(f"/api/v1/plans/{plan_id}/publish-status")
        assert r.json()["published"] is False
        # audit A-2026-07-12 P1-04: an archived plan refuses by NAME
        # (plan_archived), on every quote door — not just the default path
        # (which used to 404 no_published_version because the pointer was
        # cleared, while ?draft/?snapshot_id still priced it).
        r = client.post(f"/api/v1/plans/{plan_id}/quote", json={"inputs": {}})
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "plan_archived"
        # the draft + snapshot doors refuse too (were the leak)
        r = client.post(
            f"/api/v1/plans/{plan_id}/quote?draft=true", json={"inputs": {}}
        )
        assert r.status_code == 409 and r.json()["error"]["code"] == "plan_archived"
        r = client.get("/api/v1/plans", params={"status": "all"})
        row = next(p for p in r.json() if p["rating_plan_id"] == plan_id)
        assert row["status"] == "archived"
        assert row["published_version"] is None
