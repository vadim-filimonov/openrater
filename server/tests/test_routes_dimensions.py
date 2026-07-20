# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""End-to-end tests for the plan-scoped dimensions endpoints.

Five endpoints under `/api/v1/plans/{rating_plan_id}/dimensions`:

  · GET    /                — list every dim for the plan
  · POST   /                — create a single dim
  · PUT    /{dim_id}        — upsert one dim by id (body.dim_id must match URL)
  · DELETE /{dim_id}        — remove one dim (204 on success)
  · POST   /bulk            — atomic replace-all (localStorage migration path)

Tests follow the conventions in test_routes_plans.py — fresh DB per test
via the `client` fixture, error envelopes verified by `code` not raw text,
and the structured `{"error": {...}}` shape is asserted (no legacy `detail`).
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import create_plan, promote

# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------


def make_categorical_dim(
    *,
    dim_id: str = "ntee_major",
    display_name: str = "NTEE Major",
    slug: str | None = None,
    role: str = "rating-input",
    data_type: str = "string",
    levels: list[dict[str, Any]] | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    """A categorical dim with 3 levels by default."""
    body: dict[str, Any] = {
        "dim_id": dim_id,
        "display_name": display_name,
        "slug": slug or dim_id,
        "data_type": data_type,
        "role": role,
        "shape": "categorical",
        "levels": levels
        if levels is not None
        else [
            {"kind": "categorical", "id": "A", "label": "Arts"},
            {"kind": "categorical", "id": "B", "label": "Education"},
            {"kind": "categorical", "id": "C", "label": "Environment"},
        ],
    }
    body.update(overrides)
    return body


def make_banded_dim(
    *,
    dim_id: str = "revenue_band",
    display_name: str = "Revenue Band",
    slug: str | None = None,
    levels: list[dict[str, Any]] | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    """A banded dim with 3 numeric bands by default. lo/hi are half-open."""
    body: dict[str, Any] = {
        "dim_id": dim_id,
        "display_name": display_name,
        "slug": slug or dim_id,
        "data_type": "number",
        "role": "rating-input",
        "shape": "banded",
        "levels": levels
        if levels is not None
        else [
            {"kind": "banded", "id": "low", "label": "< $250k", "lo": 0, "hi": 250000},
            {"kind": "banded", "id": "mid", "label": "$250k-$1M", "lo": 250000, "hi": 1000000},
            {"kind": "banded", "id": "high", "label": ">= $1M", "lo": 1000000, "hi": None},
        ],
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# GET — list
# ---------------------------------------------------------------------------


class TestListDimensions:
    def test_empty_list_for_new_plan(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Empty Plan")
        response = client.get(f"/api/v1/plans/{plan['rating_plan_id']}/dimensions")
        assert response.status_code == 200
        body = response.json()
        assert body["rating_plan_id"] == plan["rating_plan_id"]
        assert body["dimensions"] == []

    def test_unknown_plan_returns_404_envelope(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans/does-not-exist/dimensions")
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"
        assert body["error"]["param"] == "rating_plan_id"

    def test_list_returns_dimensions_ordered_by_slug(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Sorted Plan")
        pid = plan["rating_plan_id"]
        # Insert in non-alphabetic order
        for slug in ("zeta", "alpha", "mu"):
            client.post(
                f"/api/v1/plans/{pid}/dimensions",
                json=make_categorical_dim(dim_id=slug, display_name=slug.title()),
            )
        response = client.get(f"/api/v1/plans/{pid}/dimensions")
        assert response.status_code == 200
        slugs = [d["slug"] for d in response.json()["dimensions"]]
        assert slugs == ["alpha", "mu", "zeta"]


# ---------------------------------------------------------------------------
# POST — create one
# ---------------------------------------------------------------------------


class TestCreateDimension:
    def test_create_returns_201_with_materialized_dim(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Create Test")
        pid = plan["rating_plan_id"]
        body = make_categorical_dim()
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 201
        result = response.json()
        assert result["rating_plan_id"] == pid
        assert result["dim_id"] == "ntee_major"
        assert result["display_name"] == "NTEE Major"
        assert result["slug"] == "ntee_major"
        assert result["data_type"] == "string"
        assert result["shape"] == "categorical"
        assert len(result["levels"]) == 3
        assert result["created_at"]
        assert result["updated_at"]
        assert result["content_hash"]
        assert len(result["content_hash"]) == 16

    def test_create_persists_to_db(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Persist Test")
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/dimensions",
            json=make_categorical_dim(dim_id="ntee", display_name="NTEE"),
        )
        list_response = client.get(f"/api/v1/plans/{pid}/dimensions")
        assert list_response.status_code == 200
        dims = list_response.json()["dimensions"]
        assert len(dims) == 1
        assert dims[0]["dim_id"] == "ntee"

    def test_create_for_unknown_plan_returns_404(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/plans/missing-plan/dimensions",
            json=make_categorical_dim(),
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"

    def test_create_banded_dim_round_trips_lo_hi(self, client: TestClient) -> None:
        """Banded levels with lo/hi (half-open) must round-trip verbatim."""
        plan = create_plan(client, display_name="Banded Test")
        pid = plan["rating_plan_id"]
        body = make_banded_dim()
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 201
        result = response.json()
        assert result["shape"] == "banded"
        levels = result["levels"]
        assert len(levels) == 3
        assert levels[0]["kind"] == "banded"
        assert levels[0]["lo"] == 0
        assert levels[0]["hi"] == 250000
        assert levels[-1]["hi"] is None  # open upper bound

    def test_classification_mapping_and_options_round_trip(
        self, client: TestClient
    ) -> None:
        """Brief 66 §3.2 / migration 025 — the last two dropped fields.

        classification_mapping (proprietary → canonical class rules) and
        options (enum dims' valid values) must round-trip verbatim through
        create + read-back; they were silently discarded before.
        """
        plan = create_plan(client, display_name="Mapping Test")
        pid = plan["rating_plan_id"]
        mapping = [
            {
                "input_pattern": "REST*",
                "canonical_class_code": "09331",
                "notes": "restaurants roll to 09331",
            },
            {"input_pattern": "OFF*", "canonical_class_code": "63631"},
        ]
        body = make_categorical_dim(
            dim_id="class_code",
            display_name="Class code",
            dimension_type="classification",
            class_library_id="sample_bop_2026",
            classification_mapping=mapping,
            options=["frame", "masonry", "fire_resistive"],
        )
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 201, response.text
        created = response.json()
        # notes is optional — the no-notes rule echoes without the key.
        assert created["classification_mapping"][0] == mapping[0]
        assert (
            created["classification_mapping"][1]["canonical_class_code"]
            == "63631"
        )
        assert created["options"] == ["frame", "masonry", "fire_resistive"]

        # The GET list reads the same values back from storage.
        listed = client.get(f"/api/v1/plans/{pid}/dimensions").json()
        dim = next(
            d for d in listed["dimensions"] if d["dim_id"] == "class_code"
        )
        assert dim["classification_mapping"][0]["input_pattern"] == "REST*"
        assert dim["options"] == ["frame", "masonry", "fire_resistive"]

    def test_create_composite_dim_with_axes(self, client: TestClient) -> None:
        """Composite dims (ADR-0025) carry an axes array of source slugs."""
        plan = create_plan(client, display_name="Composite Test")
        pid = plan["rating_plan_id"]
        body = make_categorical_dim(
            dim_id="ntee_x_state",
            display_name="NTEE x State",
            shape="composite",
            axes=["ntee_major", "state"],
            levels=[],
        )
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 201
        result = response.json()
        assert result["shape"] == "composite"
        assert result["axes"] == ["ntee_major", "state"]

    def test_create_with_missing_required_fields_returns_422_envelope(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.post(
            f"/api/v1/plans/{pid}/dimensions",
            json={"dim_id": "x"},  # missing display_name + slug + data_type + role
        )
        assert response.status_code == 422
        body = response.json()
        assert body["error"]["code"] == "validation_error"
        assert "detail" not in body  # legacy shape MUST NOT appear

    def test_create_with_invalid_data_type_returns_422(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        body = make_categorical_dim(data_type="quaternion")  # not in enum
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 422

    def test_create_with_extra_field_returns_422(self, client: TestClient) -> None:
        """ConfigDict(extra='forbid') rejects unknown keys."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        body = make_categorical_dim()
        body["nonsense_field"] = "boom"
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# PUT — upsert
# ---------------------------------------------------------------------------


class TestUpsertDimension:
    def test_put_creates_then_updates(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        # First PUT acts as create
        body = make_categorical_dim(display_name="Initial")
        first = client.put(
            f"/api/v1/plans/{pid}/dimensions/ntee_major",
            json=body,
        )
        assert first.status_code == 200
        assert first.json()["display_name"] == "Initial"
        first_created_at = first.json()["created_at"]

        # Second PUT updates in place; created_at preserved
        body["display_name"] = "Updated"
        second = client.put(
            f"/api/v1/plans/{pid}/dimensions/ntee_major",
            json=body,
        )
        assert second.status_code == 200
        assert second.json()["display_name"] == "Updated"
        assert second.json()["created_at"] == first_created_at
        # updated_at should advance (or at least not regress)
        assert second.json()["updated_at"] >= first_created_at

    def test_put_with_mismatched_dim_id_returns_400(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        body = make_categorical_dim(dim_id="ntee_major")
        response = client.put(
            f"/api/v1/plans/{pid}/dimensions/different_id",
            json=body,
        )
        assert response.status_code == 400
        result = response.json()
        assert result["error"]["code"] == "dim_id_mismatch"
        assert result["error"]["param"] == "dim_id"

    def test_put_on_unknown_plan_returns_404(self, client: TestClient) -> None:
        response = client.put(
            "/api/v1/plans/missing-plan/dimensions/x",
            json=make_categorical_dim(dim_id="x"),
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


class TestDeleteDimension:
    def test_delete_returns_204_and_removes_dim(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/dimensions",
            json=make_categorical_dim(dim_id="ntee"),
        )
        response = client.delete(f"/api/v1/plans/{pid}/dimensions/ntee")
        assert response.status_code == 204

        list_response = client.get(f"/api/v1/plans/{pid}/dimensions")
        assert list_response.json()["dimensions"] == []

    def test_delete_unknown_dim_returns_404(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.delete(f"/api/v1/plans/{pid}/dimensions/ghost")
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "dimension_not_found"
        assert body["error"]["param"] == "dim_id"

    def test_delete_on_unknown_plan_returns_404_plan_not_found(
        self,
        client: TestClient,
    ) -> None:
        """plan-existence check fires first, so unknown plan never gets a
        'dimension_not_found' (which would be misleading)."""
        response = client.delete("/api/v1/plans/no-such-plan/dimensions/x")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------------------
# POST /bulk — atomic replace-all
# ---------------------------------------------------------------------------


class TestBulkUpsert:
    def test_bulk_into_empty_plan(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        payload = {
            "dimensions": [
                make_categorical_dim(dim_id="ntee", display_name="NTEE"),
                make_banded_dim(dim_id="rev_band", display_name="Revenue"),
            ],
        }
        response = client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json=payload,
        )
        assert response.status_code == 200
        result = response.json()
        assert len(result["dimensions"]) == 2
        slugs = [d["slug"] for d in result["dimensions"]]
        # Bulk endpoint returns ordered-by-slug like the list endpoint
        assert slugs == sorted(slugs)

    def test_bulk_replaces_existing_dims_atomically(self, client: TestClient) -> None:
        """The migration path: POST /bulk replaces ALL existing dims with
        the supplied set. Pre-existing dims not in the payload are dropped."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        # Seed two dims
        client.post(
            f"/api/v1/plans/{pid}/dimensions",
            json=make_categorical_dim(dim_id="old_dim_a"),
        )
        client.post(
            f"/api/v1/plans/{pid}/dimensions",
            json=make_categorical_dim(dim_id="old_dim_b"),
        )
        # Bulk replace with a single different dim
        response = client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json={"dimensions": [make_categorical_dim(dim_id="new_dim")]},
        )
        assert response.status_code == 200
        result = response.json()
        assert len(result["dimensions"]) == 1
        assert result["dimensions"][0]["dim_id"] == "new_dim"
        # Confirm via GET
        list_response = client.get(f"/api/v1/plans/{pid}/dimensions")
        dims = list_response.json()["dimensions"]
        assert [d["dim_id"] for d in dims] == ["new_dim"]

    def test_bulk_with_empty_list_clears_dims(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/dimensions",
            json=make_categorical_dim(dim_id="x"),
        )
        response = client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json={"dimensions": []},
        )
        assert response.status_code == 200
        assert response.json()["dimensions"] == []

    def test_bulk_on_unknown_plan_returns_404(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/plans/ghost-plan/dimensions/bulk",
            json={"dimensions": []},
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------------------
# Cross-cutting — FK cascade, isolation between plans
# ---------------------------------------------------------------------------


class TestDimensionIsolation:
    def test_dims_are_scoped_per_plan(self, client: TestClient) -> None:
        """Same dim_id in two plans is two distinct rows; reads of one
        plan never leak the other."""
        plan_a = create_plan(client, display_name="Plan A")
        plan_b = create_plan(client, display_name="Plan B")
        pa = plan_a["rating_plan_id"]
        pb = plan_b["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pa}/dimensions",
            json=make_categorical_dim(dim_id="ntee", display_name="A version"),
        )
        client.post(
            f"/api/v1/plans/{pb}/dimensions",
            json=make_categorical_dim(dim_id="ntee", display_name="B version"),
        )
        a_dims = client.get(f"/api/v1/plans/{pa}/dimensions").json()["dimensions"]
        b_dims = client.get(f"/api/v1/plans/{pb}/dimensions").json()["dimensions"]
        assert len(a_dims) == 1 and len(b_dims) == 1
        assert a_dims[0]["display_name"] == "A version"
        assert b_dims[0]["display_name"] == "B version"

    def test_create_includes_x_request_id(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.post(
            f"/api/v1/plans/{pid}/dimensions",
            json=make_categorical_dim(),
        )
        assert response.headers.get("x-request-id") is not None


# ---------------------------------------------------------------------------
# Brief 44 — Geographic dim substrate (PR 44.1)
# ---------------------------------------------------------------------------


def make_geographic_dim(
    *,
    dim_id: str = "county_wi",
    display_name: str = "County (WI)",
    slug: str | None = None,
    geo_granularity: str = "county",
    geo_scope: dict[str, Any] | None = None,
    geo_territories: list[dict[str, Any]] | None = None,
    levels: list[dict[str, Any]] | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    """A geographic dim, scoped to WI counties by default (Brief 44
    cold-test CT-2). Levels left empty to keep the fixture small; the
    backend stores any shape verbatim."""
    body: dict[str, Any] = {
        "dim_id": dim_id,
        "display_name": display_name,
        "slug": slug or dim_id,
        "data_type": "string",
        "role": "rating-input",
        "dimension_type": "geographic",
        "geo_granularity": geo_granularity,
        "geo_scope": geo_scope
        if geo_scope is not None
        else {"kind": "subset", "states": ["WI"]},
        "geo_territories": geo_territories if geo_territories is not None else [],
        "levels": levels if levels is not None else [],
    }
    body.update(overrides)
    return body


class TestGeographicDimensions:
    """Brief 44 PR 44.1 — geo_granularity / geo_scope / geo_territories
    columns + the CHECK coupling them to dimension_type='geographic'."""

    def test_create_state_national_scope(self, client: TestClient) -> None:
        """National state-granularity dim (whole-country plan)."""
        plan = create_plan(client, display_name="National")
        pid = plan["rating_plan_id"]
        body = make_geographic_dim(
            dim_id="state",
            display_name="State",
            geo_granularity="state",
            geo_scope={"kind": "national"},
        )
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 201
        result = response.json()
        assert result["dimension_type"] == "geographic"
        assert result["geo_granularity"] == "state"
        assert result["geo_scope"] == {"kind": "national"}
        assert result["geo_territories"] == []

    def test_create_county_subset_scope_round_trips(
        self,
        client: TestClient,
    ) -> None:
        """Brief 44 CT-2: county-granularity dim scoped to {WI}."""
        plan = create_plan(client, display_name="WI BOP")
        pid = plan["rating_plan_id"]
        body = make_geographic_dim()
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 201
        result = response.json()
        assert result["geo_granularity"] == "county"
        assert result["geo_scope"] == {"kind": "subset", "states": ["WI"]}

        # Round-trip via list to confirm the columns persist intact.
        list_response = client.get(f"/api/v1/plans/{pid}/dimensions")
        assert list_response.status_code == 200
        dims = list_response.json()["dimensions"]
        assert len(dims) == 1
        fetched = dims[0]
        assert fetched["geo_granularity"] == "county"
        assert fetched["geo_scope"]["kind"] == "subset"
        assert fetched["geo_scope"]["states"] == ["WI"]

    def test_create_with_territory_grouping(self, client: TestClient) -> None:
        """Brief 44 CT-3: county dim with two named territory buckets."""
        plan = create_plan(client, display_name="WI Territories")
        pid = plan["rating_plan_id"]
        body = make_geographic_dim(
            geo_territories=[
                {
                    "id": "mke_metro",
                    "label": "Milwaukee metro",
                    "members": ["55079", "55133", "55089"],
                },
                {
                    "id": "rest_of_state",
                    "label": "Rest of state",
                    "members": ["55025", "55009"],
                },
            ],
        )
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 201
        result = response.json()
        assert len(result["geo_territories"]) == 2
        assert result["geo_territories"][0]["id"] == "mke_metro"
        assert result["geo_territories"][0]["members"] == ["55079", "55133", "55089"]

    def test_geographic_dim_without_granularity_returns_422(
        self,
        client: TestClient,
    ) -> None:
        """A 'geographic' dim with NULL geo_granularity is rejected at
        the Pydantic layer (Brief 44 §3.1 lock 2). The DB CHECK in
        011_*.sql is a belt-and-suspenders backstop for direct writes."""
        plan = create_plan(client, display_name="Bad Geo")
        pid = plan["rating_plan_id"]
        body = make_geographic_dim()
        body.pop("geo_granularity")
        body.pop("geo_scope")
        body.pop("geo_territories")
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    def test_non_geographic_dim_with_granularity_returns_422(
        self,
        client: TestClient,
    ) -> None:
        """A categorical dim with geo_granularity='state' is rejected at
        the Pydantic layer — granularity is set IFF dimension_type='geographic'."""
        plan = create_plan(client, display_name="Bad Cat")
        pid = plan["rating_plan_id"]
        body = make_categorical_dim()
        body["geo_granularity"] = "state"
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    def test_invalid_granularity_rejected(self, client: TestClient) -> None:
        """geo_granularity must be 'state' | 'county' | 'zip'."""
        plan = create_plan(client, display_name="Bad Granularity")
        pid = plan["rating_plan_id"]
        body = make_geographic_dim(geo_granularity="block")  # not in enum
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    def test_invalid_scope_kind_rejected(self, client: TestClient) -> None:
        """geo_scope.kind must be 'national' | 'subset'."""
        plan = create_plan(client, display_name="Bad Scope")
        pid = plan["rating_plan_id"]
        body = make_geographic_dim()
        body["geo_scope"] = {"kind": "regional", "states": ["WI"]}
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 422

    def test_subset_scope_requires_non_empty_states(
        self,
        client: TestClient,
    ) -> None:
        """subset scope must list at least one state — empty list is a
        plan-authoring error."""
        plan = create_plan(client, display_name="Empty Subset")
        pid = plan["rating_plan_id"]
        body = make_geographic_dim(geo_scope={"kind": "subset", "states": []})
        response = client.post(f"/api/v1/plans/{pid}/dimensions", json=body)
        assert response.status_code == 422

    def test_categorical_dim_returns_null_geo_fields(
        self,
        client: TestClient,
    ) -> None:
        """Pre-existing categorical dims continue to round-trip with
        geo_* fields as None."""
        plan = create_plan(client, display_name="Categorical")
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/dimensions",
            json=make_categorical_dim(),
        )
        result = client.get(f"/api/v1/plans/{pid}/dimensions").json()
        dim = result["dimensions"][0]
        assert dim["geo_granularity"] is None
        assert dim["geo_scope"] is None
        assert dim["geo_territories"] is None


# ---------------------------------------------------------------------------
# Writability gate — a non-draft plan's dimensions are immutable
# ---------------------------------------------------------------------------


class TestWritabilityGate:
    """Defense in depth behind the rate-lab on-mount sync gate: once a plan
    leaves DRAFT, its dimensions can't be written (409). Reads stay allowed
    so a second browser still SEES a frozen plan."""

    @staticmethod
    def _frozen_plan(client: TestClient) -> str:
        """Create a plan + promote it to ACTIVE (read-only)."""
        pid = create_plan(client, display_name="Frozen")["rating_plan_id"]
        promote(client, pid)
        return pid

    def test_bulk_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json={"dimensions": [make_categorical_dim(dim_id="ntee")]},
        )
        assert response.status_code == 409
        err = response.json()["error"]
        assert err["code"] == "illegal_state_transition"
        assert err["param"] == "status"
        assert err["details"]["attempted_resource"] == "dimensions"
        assert err["details"]["current_status"] == "active"

    def test_create_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.post(
            f"/api/v1/plans/{pid}/dimensions",
            json=make_categorical_dim(dim_id="ntee"),
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "illegal_state_transition"

    def test_put_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.put(
            f"/api/v1/plans/{pid}/dimensions/ntee",
            json=make_categorical_dim(dim_id="ntee"),
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "illegal_state_transition"

    def test_delete_on_non_draft_returns_409(self, client: TestClient) -> None:
        """The writability gate fires before the dim-existence check, so a
        frozen plan returns 409 (not 404) even for a non-existent dim."""
        pid = self._frozen_plan(client)
        response = client.delete(f"/api/v1/plans/{pid}/dimensions/ntee")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "illegal_state_transition"

    def test_list_on_non_draft_still_succeeds(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.get(f"/api/v1/plans/{pid}/dimensions")
        assert response.status_code == 200

    def test_bulk_on_draft_still_succeeds(self, client: TestClient) -> None:
        """The writable path is unchanged — a DRAFT plan still syncs."""
        pid = create_plan(client, display_name="Still Draft")["rating_plan_id"]
        response = client.post(
            f"/api/v1/plans/{pid}/dimensions/bulk",
            json={"dimensions": [make_categorical_dim(dim_id="ntee")]},
        )
        assert response.status_code == 200
