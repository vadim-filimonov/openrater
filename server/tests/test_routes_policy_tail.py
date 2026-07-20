# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""End-to-end tests for the plan-scoped policy-tail endpoints (ADR-0055).

Three endpoints under `/api/v1/plans/{rating_plan_id}/policy-tail`:

  · GET    /     — fetch the current tail (404 if not yet authored)
  · PUT    /     — upsert the full ordered tail (idempotent)
  · DELETE /     — clear the tail (204; idempotent on missing rows)

Plus the load-bearing v4.0 assertion: a frozen snapshot's body CARRIES the
tail (ADR-0055 closes G15 — a frozen version must re-score to the filed
premium). Follows the conventions in test_routes_inputs_mapping.py.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import create_plan, promote


def make_tail() -> list[dict[str, Any]]:
    """A canonical policy tail: a GLM schedule-rating IRPM, a package
    factor, and a minimum-premium floor — the Sample BOP shape."""
    return [
        {
            "kind": "schedule_rating",
            "id": "irpm",
            "display_name": "Schedule rating (GLM)",
            "cap_pct": 25,
            "source": {"from": "model", "model_id": "sunsafe-irpm-glm"},
        },
        {
            "kind": "package_factor",
            "id": "first_term_credit",
            "display_name": "First-term credit",
            "factor": 0.9,
            "when": {"field": "is_first_term", "op": "eq", "value": True},
        },
        {"kind": "minimum_premium", "id": "min", "floor": 500},
    ]


class TestGetPolicyTail:
    def test_get_when_not_authored_returns_404(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Fresh")
        response = client.get(
            f"/api/v1/plans/{plan['rating_plan_id']}/policy-tail"
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "policy_tail_not_found"

    def test_get_unknown_plan_returns_plan_not_found(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/v1/plans/does-not-exist/policy-tail")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"


class TestUpsertPolicyTail:
    def test_put_creates_then_returns_envelope(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": make_tail()}
        )
        assert response.status_code == 200
        result = response.json()
        assert result["rating_plan_id"] == pid
        assert len(result["tail"]) == 3
        assert result["tail"][0]["kind"] == "schedule_rating"
        assert result["tail"][-1]["kind"] == "minimum_premium"
        assert result["created_at"]
        assert result["updated_at"]
        assert len(result["content_hash"]) == 16

    def test_put_preserves_order(self, client: TestClient) -> None:
        """The tail is ORDERED — composition applies items in sequence, so
        the array order MUST round-trip exactly."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        result = client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": make_tail()}
        ).json()
        assert [item["id"] for item in result["tail"]] == [
            "irpm",
            "first_term_credit",
            "min",
        ]

    def test_put_persists_to_db(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": make_tail()}
        )
        get_response = client.get(f"/api/v1/plans/{pid}/policy-tail")
        assert get_response.status_code == 200
        assert len(get_response.json()["tail"]) == 3

    def test_put_replaces_existing_atomically(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        first = client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": make_tail()}
        )
        first_created_at = first.json()["created_at"]
        first_hash = first.json()["content_hash"]
        second = client.put(
            f"/api/v1/plans/{pid}/policy-tail",
            json={"tail": [{"kind": "minimum_premium", "id": "m", "floor": 250}]},
        )
        assert second.status_code == 200
        assert second.json()["created_at"] == first_created_at  # preserved
        assert len(second.json()["tail"]) == 1
        assert second.json()["content_hash"] != first_hash

    def test_put_empty_tail_is_valid(self, client: TestClient) -> None:
        """An empty list is a real tail (explicitly no adjustments) —
        distinct from 'never authored' (404). It stores + reads back."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": []}
        )
        assert response.status_code == 200
        assert response.json()["tail"] == []
        assert client.get(f"/api/v1/plans/{pid}/policy-tail").json()["tail"] == []

    def test_put_round_trips_arbitrary_item_fields(
        self, client: TestClient
    ) -> None:
        """Items are opaque to the backend — future adjustment kinds /
        fields MUST round-trip verbatim (no schema bump here)."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        tail = [{"kind": "future_kind", "novel_field": {"nested": [1, 2]}}]
        result = client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": tail}
        ).json()
        assert result["tail"][0]["novel_field"] == {"nested": [1, 2]}

    def test_put_on_unknown_plan_returns_404(self, client: TestClient) -> None:
        response = client.put(
            "/api/v1/plans/missing-plan/policy-tail",
            json={"tail": make_tail()},
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"

    def test_put_with_missing_tail_field_returns_422(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"not_tail": []}
        )
        assert response.status_code == 422

    def test_put_with_extra_top_level_field_returns_422(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.put(
            f"/api/v1/plans/{pid}/policy-tail",
            json={"tail": make_tail(), "stray": "boom"},
        )
        assert response.status_code == 422


class TestDeletePolicyTail:
    def test_delete_returns_204_and_removes_tail(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": make_tail()}
        )
        response = client.delete(f"/api/v1/plans/{pid}/policy-tail")
        assert response.status_code == 204
        get_response = client.get(f"/api/v1/plans/{pid}/policy-tail")
        assert get_response.status_code == 404
        assert get_response.json()["error"]["code"] == "policy_tail_not_found"

    def test_delete_when_no_tail_returns_204(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.delete(f"/api/v1/plans/{pid}/policy-tail")
        assert response.status_code == 204


class TestPolicyTailIsolation:
    def test_tails_are_scoped_per_plan(self, client: TestClient) -> None:
        pa = create_plan(client, display_name="Plan A")["rating_plan_id"]
        pb = create_plan(client, display_name="Plan B")["rating_plan_id"]
        client.put(f"/api/v1/plans/{pa}/policy-tail", json={"tail": make_tail()})
        client.put(
            f"/api/v1/plans/{pb}/policy-tail",
            json={"tail": [{"kind": "minimum_premium", "id": "m", "floor": 100}]},
        )
        assert len(client.get(f"/api/v1/plans/{pa}/policy-tail").json()["tail"]) == 3
        assert len(client.get(f"/api/v1/plans/{pb}/policy-tail").json()["tail"]) == 1


class TestWritabilityGate:
    """Once a plan leaves DRAFT, its tail is immutable (409). Reads stay
    allowed. Mirrors the input-mapping gate."""

    @staticmethod
    def _frozen_plan(client: TestClient) -> str:
        pid = create_plan(client, display_name="Frozen")["rating_plan_id"]
        promote(client, pid)
        return pid

    def test_put_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": make_tail()}
        )
        assert response.status_code == 409
        err = response.json()["error"]
        assert err["code"] == "illegal_state_transition"
        assert err["details"]["attempted_resource"] == "policy_tail"

    def test_delete_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.delete(f"/api/v1/plans/{pid}/policy-tail")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "illegal_state_transition"

    def test_get_on_non_draft_still_succeeds(self, client: TestClient) -> None:
        pid = create_plan(client, display_name="Authored then frozen")[
            "rating_plan_id"
        ]
        client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": make_tail()}
        )
        promote(client, pid)
        response = client.get(f"/api/v1/plans/{pid}/policy-tail")
        assert response.status_code == 200
        assert len(response.json()["tail"]) == 3


class TestSnapshotCapturesTail:
    """ADR-0055 / G15 — a frozen snapshot's body MUST carry the tail so a
    frozen version re-scores to the filed premium. Without this the API +
    snapshot re-rate score the PRE-tail premium."""

    @staticmethod
    def _freeze(client: TestClient, pid: str, name: str) -> dict[str, Any]:
        resp = client.post(
            f"/api/v1/plans/{pid}/snapshots",
            json={"display_name": name, "notes": None},
        )
        assert resp.status_code in (200, 201), resp.text
        return resp.json()

    def test_frozen_body_includes_authored_tail(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client, display_name="Tailed")["rating_plan_id"]
        client.put(
            f"/api/v1/plans/{pid}/policy-tail", json={"tail": make_tail()}
        )
        snap = self._freeze(client, pid, "v1")
        body = client.get(
            f"/api/v1/plans/{pid}/snapshots/{snap['snapshot_id']}"
        ).json()["body"]
        assert "policy_tail" in body
        assert body["policy_tail"] is not None
        assert len(body["policy_tail"]["tail"]) == 3
        assert body["policy_tail"]["tail"][0]["kind"] == "schedule_rating"

    def test_frozen_body_tail_is_null_when_unauthored(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client, display_name="No tail")["rating_plan_id"]
        snap = self._freeze(client, pid, "v1")
        body = client.get(
            f"/api/v1/plans/{pid}/snapshots/{snap['snapshot_id']}"
        ).json()["body"]
        assert body["policy_tail"] is None
