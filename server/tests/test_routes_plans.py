# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""End-to-end tests for the plan endpoints — list / get / create.

Each test boots a fresh FastAPI app against a temporary SQLite DB
(via the `client` fixture in conftest.py) and exercises the routes
through TestClient. Coverage targets:

  · GET /api/v1/plans (filtering by lob / jurisdiction / status)
  · GET /api/v1/plans/{id}
  · POST /api/v1/plans (create from blank template)
  · Error envelopes — every failure path produces the documented
    `{"error": {"code", "message", "hint", ...}}` shape.

For state-machine tests (fork → patch → promote → discard /
rollback) see `test_routes_lifecycle.py`.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests._helpers import create_plan, make_plan_body

# ---------------------------------------------------------------------------
# GET /api/v1/plans — list
# ---------------------------------------------------------------------------


class TestListPlans:
    def test_empty_list(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans")
        assert response.status_code == 200
        assert response.json() == []

    def test_lists_created_plan(self, client: TestClient) -> None:
        created = create_plan(client, display_name="My Plan")
        response = client.get("/api/v1/plans?status=all")
        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["rating_plan_id"] == created["rating_plan_id"]
        assert body[0]["display_name"] == "My Plan"
        assert body[0]["line_of_business"] == "bop"
        assert body[0]["jurisdiction"] == "WI"

    def test_filters_by_lob(self, client: TestClient) -> None:
        create_plan(client, display_name="BOP plan", line_of_business="bop")
        create_plan(client, display_name="CGL plan", line_of_business="cgl")

        bop_response = client.get("/api/v1/plans?status=all&lob=bop")
        assert bop_response.status_code == 200
        names = [p["display_name"] for p in bop_response.json()]
        assert "BOP plan" in names
        assert "CGL plan" not in names

    def test_filters_by_jurisdiction(self, client: TestClient) -> None:
        create_plan(client, display_name="WI plan", jurisdiction="WI")
        create_plan(client, display_name="IL plan", jurisdiction="IL")

        response = client.get("/api/v1/plans?status=all&jurisdiction=WI")
        assert response.status_code == 200
        names = [p["display_name"] for p in response.json()]
        assert "WI plan" in names
        assert "IL plan" not in names

    def test_default_status_filter_is_active(self, client: TestClient) -> None:
        """Plans default to DRAFT status; default list filter is ACTIVE."""
        create_plan(client, display_name="My draft")
        response = client.get("/api/v1/plans")  # no status param
        assert response.status_code == 200
        # Draft is NOT included by default
        assert response.json() == []

    def test_all_status_returns_drafts(self, client: TestClient) -> None:
        created = create_plan(client, display_name="My draft")
        response = client.get("/api/v1/plans?status=all")
        assert response.status_code == 200
        ids = [p["rating_plan_id"] for p in response.json()]
        assert created["rating_plan_id"] in ids

    def test_unknown_lob_returns_400_envelope(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans?lob=spaceship")
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "unknown_line_of_business"
        assert body["error"]["param"] == "lob"

    def test_unknown_status_returns_400_envelope(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans?status=zombie")
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "unknown_plan_status"
        assert body["error"]["param"] == "status"


# ---------------------------------------------------------------------------
# GET /api/v1/plans/{id}
# ---------------------------------------------------------------------------


class TestGetPlan:
    def test_get_returns_plan_detail(self, client: TestClient) -> None:
        created = create_plan(client, display_name="Detail Test")
        response = client.get(f"/api/v1/plans/{created['rating_plan_id']}")
        assert response.status_code == 200
        body = response.json()
        assert body["rating_plan_id"] == created["rating_plan_id"]
        assert body["display_name"] == "Detail Test"
        assert "stages" in body
        assert body["stages"] == []  # blank template

    def test_get_unknown_plan_returns_404_envelope(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans/does-not-exist")
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"
        assert body["error"]["param"] == "rating_plan_id"
        assert "does-not-exist" in body["error"]["message"]


# ---------------------------------------------------------------------------
# The creation note round-trips (Brief 91 follow-up)
# ---------------------------------------------------------------------------


class TestDescriptionRoundTrip:
    """`description` was write-only: POST persisted it but neither GET
    shape serialized it, so the note behind '+ Add a note' vanished
    after create. Both reads carry it now."""

    NOTE = "Nebraska BOP rate revision for H2 2026."

    def test_note_rides_list_and_detail(self, client: TestClient) -> None:
        created = create_plan(
            client, display_name="Plan with note", description=self.NOTE
        )
        listed = client.get("/api/v1/plans?status=all").json()
        assert [p["description"] for p in listed] == [self.NOTE]
        detail = client.get(f"/api/v1/plans/{created['rating_plan_id']}").json()
        assert detail["description"] == self.NOTE

    def test_no_note_serializes_null(self, client: TestClient) -> None:
        created = create_plan(client, display_name="No note")
        detail = client.get(f"/api/v1/plans/{created['rating_plan_id']}").json()
        assert detail["description"] is None


# ---------------------------------------------------------------------------
# POST /api/v1/plans
# ---------------------------------------------------------------------------


class TestCreatePlan:
    def test_bad_effective_date_is_422_not_500_or_silent_accept(
        self, client: TestClient
    ) -> None:
        """audit A-2026-07-12 P1-16/P1-09: an impossible calendar date
        (`2025-13-99`) was silently accepted (201) and a malformed one
        (`not-a-date`) escaped the domain model as a bare 500. Both are now
        a typed 422; a real date still creates."""
        for bad in ("2025-13-99", "not-a-date", "2025-02-30"):
            body = make_plan_body(display_name="Bad date")
            body["effective_date"] = bad
            resp = client.post("/api/v1/plans", json=body)
            assert resp.status_code == 422, (bad, resp.text)
            assert resp.json()["error"]["code"] == "validation_error"
        ok = make_plan_body(display_name="Good date")
        ok["effective_date"] = "2025-10-01"
        assert client.post("/api/v1/plans", json=ok).status_code == 201

    def test_create_returns_201_with_plan_id(self, client: TestClient) -> None:
        body = make_plan_body(display_name="Create Test")
        response = client.post("/api/v1/plans", json=body)
        assert response.status_code == 201
        result = response.json()
        assert "rating_plan_id" in result
        assert result["display_name"] == "Create Test"
        assert result["line_of_business"] == "bop"
        assert result["status"] == "draft"
        assert result["stage_count"] == 0

    def test_create_normalizes_lob_to_lowercase(self, client: TestClient) -> None:
        body = make_plan_body(line_of_business="BOP")  # uppercase
        response = client.post("/api/v1/plans", json=body)
        assert response.status_code == 201
        assert response.json()["line_of_business"] == "bop"

    def test_create_persists_to_db(self, client: TestClient) -> None:
        created = create_plan(client, display_name="Persistence Test")
        # The plan should be readable via GET
        get_response = client.get(f"/api/v1/plans/{created['rating_plan_id']}")
        assert get_response.status_code == 200
        assert get_response.json()["display_name"] == "Persistence Test"

    def test_create_with_no_jurisdiction(self, client: TestClient) -> None:
        body = make_plan_body(jurisdiction=None)
        response = client.post("/api/v1/plans", json=body)
        assert response.status_code == 201
        # jurisdiction omitted; should be None in the response
        assert response.json()["jurisdiction"] is None

    def test_create_with_missing_required_fields_returns_422_envelope(
        self,
        client: TestClient,
    ) -> None:
        # Missing display_name — the one remaining pydantic-required field
        # (Brief 91 made effective_date optional; product-or-lob is enforced
        # by the route as a 400, covered below).
        response = client.post("/api/v1/plans", json={})
        assert response.status_code == 422
        body = response.json()
        assert body["error"]["code"] == "validation_error"
        assert "errors" in body["error"]["details"]
        # The legacy {"detail": [...]} shape MUST NOT appear
        assert "detail" not in body

    def test_create_with_no_product_returns_400_envelope(
        self,
        client: TestClient,
    ) -> None:
        response = client.post("/api/v1/plans", json={"display_name": "X"})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "missing_product"

    def test_create_without_effective_date_defaults_to_today(
        self,
        client: TestClient,
    ) -> None:
        """Brief 91 — the create form no longer sends a date; the boundary
        defaults it to the creation date. The domain column stays NOT NULL."""
        from datetime import date

        body = make_plan_body(display_name="No date")
        body.pop("effective_date", None)
        response = client.post("/api/v1/plans", json=body)
        assert response.status_code == 201
        plan_id = response.json()["rating_plan_id"]
        fetched = client.get(f"/api/v1/plans/{plan_id}").json()
        assert fetched["effective_date"] == date.today().isoformat()

    def test_create_with_unknown_lob_returns_400_envelope(
        self,
        client: TestClient,
    ) -> None:
        body = make_plan_body(line_of_business="zorgon")
        response = client.post("/api/v1/plans", json=body)
        assert response.status_code == 400
        result = response.json()
        assert result["error"]["code"] == "unknown_line_of_business"

    def test_create_with_unknown_template_returns_422_envelope(
        self,
        client: TestClient,
    ) -> None:
        body = make_plan_body(template="not_a_registered_template")
        response = client.post("/api/v1/plans", json=body)
        assert response.status_code == 422
        result = response.json()
        assert result["error"]["code"] == "unknown_template"

    def test_create_with_empty_display_name_returns_422(
        self,
        client: TestClient,
    ) -> None:
        """Pydantic min_length=1 validation kicks in before route handler."""
        body = make_plan_body(display_name="")
        response = client.post("/api/v1/plans", json=body)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    def test_create_response_includes_x_request_id(self, client: TestClient) -> None:
        """Every response should carry the correlation header."""
        body = make_plan_body()
        response = client.post("/api/v1/plans", json=body)
        assert response.status_code == 201
        assert response.headers.get("x-request-id") is not None

    def test_create_returns_unique_plan_ids(self, client: TestClient) -> None:
        a = create_plan(client, display_name="A")
        b = create_plan(client, display_name="B")
        assert a["rating_plan_id"] != b["rating_plan_id"]
