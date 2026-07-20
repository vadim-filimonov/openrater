# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""End-to-end tests for the plan-scoped input mapping endpoints.

Three endpoints under `/api/v1/plans/{rating_plan_id}/inputs-mapping`:

  · GET    /     — fetch the current mapping (404 if not yet authored)
  · PUT    /     — upsert the full envelope (idempotent)
  · DELETE /     — clear the mapping (204; idempotent on missing rows)

Tests follow the conventions in test_routes_dimensions.py.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import create_plan, promote


def make_csv_mapping(**overrides: Any) -> dict[str, Any]:
    """A canonical CSV-source mapping envelope."""
    body: dict[str, Any] = {
        "source": {
            "kind": "csv",
            "columns": ["ein", "state", "revenue"],
            "sample_rows": [
                {"ein": "12-3456789", "state": "CA", "revenue": "250000"},
            ],
        },
        "column_map": {
            "ein": "ein",
            "state": "state",
            "revenue_band": "revenue",
        },
    }
    body.update(overrides)
    return body


def make_webhook_mapping() -> dict[str, Any]:
    """A canonical webhook-source mapping envelope."""
    return {
        "source": {
            "kind": "webhook",
            "url": "https://example.com/scoring",
            "method": "POST",
            "headers": {},
            "payload_schema": {"fields": []},
        },
        "column_map": {},
    }


class TestGetInputMapping:
    def test_get_when_not_authored_returns_404(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Fresh")
        response = client.get(
            f"/api/v1/plans/{plan['rating_plan_id']}/inputs-mapping"
        )
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "inputs_mapping_not_found"

    def test_get_unknown_plan_returns_plan_not_found(
        self,
        client: TestClient,
    ) -> None:
        response = client.get("/api/v1/plans/does-not-exist/inputs-mapping")
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"


class TestUpsertInputMapping:
    def test_put_creates_then_returns_envelope(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        body = {"mapping": make_csv_mapping()}
        response = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping", json=body
        )
        assert response.status_code == 200
        result = response.json()
        assert result["rating_plan_id"] == pid
        assert result["mapping"]["source"]["kind"] == "csv"
        assert result["mapping"]["column_map"]["ein"] == "ein"
        assert result["created_at"]
        assert result["updated_at"]
        assert result["content_hash"]
        assert len(result["content_hash"]) == 16

    def test_put_persists_to_db(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": make_csv_mapping()},
        )
        get_response = client.get(f"/api/v1/plans/{pid}/inputs-mapping")
        assert get_response.status_code == 200
        assert get_response.json()["mapping"]["source"]["kind"] == "csv"

    def test_put_replaces_existing_atomically(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        # Seed with CSV.
        first = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": make_csv_mapping()},
        )
        first_created_at = first.json()["created_at"]
        first_hash = first.json()["content_hash"]
        # Overwrite with webhook.
        second = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": make_webhook_mapping()},
        )
        assert second.status_code == 200
        # created_at preserved across the replace.
        assert second.json()["created_at"] == first_created_at
        assert second.json()["mapping"]["source"]["kind"] == "webhook"
        # content_hash should differ.
        assert second.json()["content_hash"] != first_hash

    def test_put_on_unknown_plan_returns_404(self, client: TestClient) -> None:
        response = client.put(
            "/api/v1/plans/missing-plan/inputs-mapping",
            json={"mapping": make_csv_mapping()},
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"

    def test_put_round_trips_arbitrary_extra_fields(
        self,
        client: TestClient,
    ) -> None:
        """The mapping envelope is opaque to the backend — fields not
        in the canonical shape (e.g. `alias_overrides`, `product_mode`,
        or future additions) MUST round-trip verbatim."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        mapping = make_csv_mapping()
        mapping["alias_overrides"] = {"some_dim": {"CA": ["California"]}}
        mapping["future_field"] = ["whatever"]
        response = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": mapping},
        )
        result = response.json()
        assert result["mapping"]["alias_overrides"]["some_dim"] == {
            "CA": ["California"]
        }
        assert result["mapping"]["future_field"] == ["whatever"]

    def test_put_with_missing_mapping_field_returns_422(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"not_mapping": {}},  # missing required 'mapping'
        )
        assert response.status_code == 422

    def test_put_with_extra_top_level_field_returns_422(
        self,
        client: TestClient,
    ) -> None:
        """ConfigDict(extra='forbid') on the request envelope (NOT
        on the inner `mapping` blob — that's intentionally opaque)."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": make_csv_mapping(), "stray": "boom"},
        )
        assert response.status_code == 422


class TestDeleteInputMapping:
    def test_delete_returns_204_and_removes_mapping(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": make_csv_mapping()},
        )
        response = client.delete(f"/api/v1/plans/{pid}/inputs-mapping")
        assert response.status_code == 204

        get_response = client.get(f"/api/v1/plans/{pid}/inputs-mapping")
        assert get_response.status_code == 404
        assert get_response.json()["error"]["code"] == "inputs_mapping_not_found"

    def test_delete_when_no_mapping_returns_204(
        self,
        client: TestClient,
    ) -> None:
        """DELETE is idempotent — no-op on a missing row returns 204
        so callers don't need a special path for 'I want this gone
        regardless'."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.delete(f"/api/v1/plans/{pid}/inputs-mapping")
        assert response.status_code == 204

    def test_delete_on_unknown_plan_returns_plan_not_found(
        self,
        client: TestClient,
    ) -> None:
        response = client.delete("/api/v1/plans/no-such-plan/inputs-mapping")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"


class TestMappingIsolation:
    def test_mappings_are_scoped_per_plan(self, client: TestClient) -> None:
        plan_a = create_plan(client, display_name="Plan A")
        plan_b = create_plan(client, display_name="Plan B")
        pa = plan_a["rating_plan_id"]
        pb = plan_b["rating_plan_id"]
        client.put(
            f"/api/v1/plans/{pa}/inputs-mapping",
            json={"mapping": make_csv_mapping()},
        )
        client.put(
            f"/api/v1/plans/{pb}/inputs-mapping",
            json={"mapping": make_webhook_mapping()},
        )
        a_resp = client.get(f"/api/v1/plans/{pa}/inputs-mapping").json()
        b_resp = client.get(f"/api/v1/plans/{pb}/inputs-mapping").json()
        assert a_resp["mapping"]["source"]["kind"] == "csv"
        assert b_resp["mapping"]["source"]["kind"] == "webhook"


# ---------------------------------------------------------------------------
# Writability gate — a non-draft plan's input mapping is immutable
# ---------------------------------------------------------------------------


class TestWritabilityGate:
    """Defense in depth behind the rate-lab on-mount sync gate: once a plan
    leaves DRAFT, its input mapping can't be upserted or cleared (409).
    Reads stay allowed."""

    @staticmethod
    def _frozen_plan(client: TestClient) -> str:
        pid = create_plan(client, display_name="Frozen")["rating_plan_id"]
        promote(client, pid)
        return pid

    def test_put_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": make_csv_mapping()},
        )
        assert response.status_code == 409
        err = response.json()["error"]
        assert err["code"] == "illegal_state_transition"
        assert err["details"]["attempted_resource"] == "input_mapping"
        assert err["details"]["current_status"] == "active"

    def test_delete_on_non_draft_returns_409(self, client: TestClient) -> None:
        """DELETE is normally idempotent (204 on a missing row), but a
        frozen plan rejects the clear outright so a stale local 'cleared'
        state can't wipe the persisted mapping."""
        pid = self._frozen_plan(client)
        response = client.delete(f"/api/v1/plans/{pid}/inputs-mapping")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "illegal_state_transition"

    def test_get_on_non_draft_still_succeeds(self, client: TestClient) -> None:
        """Reads are always allowed. The mapping was authored while the
        plan was still a draft, then the plan was promoted."""
        pid = create_plan(client, display_name="Authored then frozen")[
            "rating_plan_id"
        ]
        client.put(
            f"/api/v1/plans/{pid}/inputs-mapping",
            json={"mapping": make_csv_mapping()},
        )
        promote(client, pid)
        response = client.get(f"/api/v1/plans/{pid}/inputs-mapping")
        assert response.status_code == 200
        assert response.json()["mapping"]["source"]["kind"] == "csv"
