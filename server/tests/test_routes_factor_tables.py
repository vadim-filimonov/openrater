# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""End-to-end tests for the plan-scoped factor tables endpoints.

Six endpoints under `/api/v1/plans/{rating_plan_id}/factor-tables`:

  · GET    /                       — list every FT (with cells inlined)
  · POST   /                       — create a single FT
  · PUT    /{table_id}             — upsert (body.table_id must match URL)
  · DELETE /{table_id}             — remove (204; cells cascade)
  · PUT    /{table_id}/cells       — replace-all cells without touching meta
  · POST   /bulk                   — atomic replace-all (migration path)

Tests follow the conventions in test_routes_dimensions.py — fresh DB
per test via the `client` fixture, error envelopes verified by `code`
not raw text, and the structured `{"error": {...}}` shape is asserted.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import create_plan, promote

# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------


def make_factor_table(
    *,
    table_id: str = "class_factor",
    display_name: str = "Class factor table",
    slug: str | None = None,
    description: str | None = "ISO BOP class-code → factor",
    key_dimensions: list[str] | None = None,
    cells: dict[str, float] | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    """A simple 1-D factor table with optional cells."""
    body: dict[str, Any] = {
        "table_id": table_id,
        "display_name": display_name,
        "slug": slug or table_id,
        "key_dimensions": key_dimensions if key_dimensions is not None else ["class_code"],
    }
    if description is not None:
        body["description"] = description
    if cells is not None:
        body["cells"] = cells
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# GET — list
# ---------------------------------------------------------------------------


class TestListFactorTables:
    def test_empty_list_for_new_plan(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Empty Plan")
        response = client.get(
            f"/api/v1/plans/{plan['rating_plan_id']}/factor-tables"
        )
        assert response.status_code == 200
        body = response.json()
        assert body["rating_plan_id"] == plan["rating_plan_id"]
        assert body["factor_tables"] == []

    def test_unknown_plan_returns_404_envelope(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans/does-not-exist/factor-tables")
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "plan_not_found"
        assert body["error"]["param"] == "rating_plan_id"

    def test_list_returns_tables_ordered_by_slug(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Sorted Plan")
        pid = plan["rating_plan_id"]
        for slug in ("zeta", "alpha", "mu"):
            client.post(
                f"/api/v1/plans/{pid}/factor-tables",
                json=make_factor_table(table_id=slug, display_name=slug.title()),
            )
        response = client.get(f"/api/v1/plans/{pid}/factor-tables")
        slugs = [t["slug"] for t in response.json()["factor_tables"]]
        assert slugs == ["alpha", "mu", "zeta"]


# ---------------------------------------------------------------------------
# POST — create one FT
# ---------------------------------------------------------------------------


class TestCreateFactorTable:
    def test_create_returns_201_with_materialized_ft(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client, display_name="Create Test")
        pid = plan["rating_plan_id"]
        body = make_factor_table(cells={"class_1": 1.0, "class_2": 1.5})
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables", json=body
        )
        assert response.status_code == 201
        result = response.json()
        assert result["rating_plan_id"] == pid
        assert result["table_id"] == "class_factor"
        assert result["display_name"] == "Class factor table"
        assert result["key_dimensions"] == ["class_code"]
        assert result["cells"] == {"class_1": 1.0, "class_2": 1.5}
        assert result["created_at"]
        assert result["updated_at"]
        assert result["content_hash"]
        assert len(result["content_hash"]) == 16

    def test_create_without_cells_defaults_to_empty_map(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        body = make_factor_table()  # cells absent
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables", json=body
        )
        assert response.status_code == 201
        assert response.json()["cells"] == {}

    def test_create_persists_to_db(self, client: TestClient) -> None:
        plan = create_plan(client, display_name="Persist Test")
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(table_id="ft1", cells={"a": 1.0, "b": 2.0}),
        )
        list_response = client.get(f"/api/v1/plans/{pid}/factor-tables")
        tables = list_response.json()["factor_tables"]
        assert len(tables) == 1
        assert tables[0]["cells"] == {"a": 1.0, "b": 2.0}

    def test_create_for_unknown_plan_returns_404(
        self,
        client: TestClient,
    ) -> None:
        response = client.post(
            "/api/v1/plans/missing-plan/factor-tables",
            json=make_factor_table(),
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"

    def test_create_2d_table_round_trips_key_dimensions(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client, display_name="2D Test")
        pid = plan["rating_plan_id"]
        body = make_factor_table(
            table_id="building_age_x_class",
            display_name="Building Age × Class",
            key_dimensions=["building_age", "class_code"],
            cells={
                "building_age=band_0_5|class_code=class_1": 0.9,
                "building_age=band_5_15|class_code=class_1": 1.0,
            },
        )
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables", json=body
        )
        assert response.status_code == 201
        result = response.json()
        assert result["key_dimensions"] == ["building_age", "class_code"]
        assert len(result["cells"]) == 2

    def test_create_with_extra_field_returns_422(
        self,
        client: TestClient,
    ) -> None:
        """ConfigDict(extra='forbid') rejects unknown keys."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        body = make_factor_table()
        body["nonsense_field"] = "boom"
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables", json=body
        )
        assert response.status_code == 422

    def test_create_with_invalid_draft_status_returns_422(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        body = make_factor_table(draft_status="bogus")
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables", json=body
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# PUT — upsert
# ---------------------------------------------------------------------------


class TestUpsertFactorTable:
    def test_put_creates_then_updates_metadata(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        body = make_factor_table(display_name="Initial")
        first = client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor", json=body
        )
        assert first.status_code == 200
        first_created_at = first.json()["created_at"]

        body["display_name"] = "Updated"
        second = client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor", json=body
        )
        assert second.status_code == 200
        assert second.json()["display_name"] == "Updated"
        assert second.json()["created_at"] == first_created_at

    def test_non_finite_cell_values_are_rejected_422(
        self,
        client: TestClient,
    ) -> None:
        """audit A-2026-07-12 P1-03/P1-07: a cell value of ±Infinity was
        accepted with 200 and served as a corrupt `null` factor; NaN 500'd.
        Both must now refuse with a typed 422 (allow_inf_nan=False), and
        the 422 must SERIALIZE (the error handler used to 500 echoing the
        non-finite input)."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor",
            json=make_factor_table(),
        )
        # `Infinity`/`NaN` are non-standard JSON tokens the server's parser
        # accepts (Python extension); send raw `content` because httpx
        # refuses to encode them via `json=`.
        for token in ("Infinity", "-Infinity", "NaN"):
            resp = client.put(
                f"/api/v1/plans/{pid}/factor-tables/class_factor/cells",
                content=f'{{"cells": {{"a": {token}, "b": 2.5}}}}',
                headers={"content-type": "application/json"},
            )
            assert resp.status_code == 422, (token, resp.text)
            assert resp.json()["error"]["code"] == "validation_error"
        # a finite value still saves
        ok = client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor/cells",
            json={"cells": {"a": 2.5}},
        )
        assert ok.status_code == 200

    def test_put_without_cells_preserves_existing_cells(
        self,
        client: TestClient,
    ) -> None:
        """The contract: cells == None on PUT means 'leave cells alone'.
        Only explicit cells == {} replaces them with the empty map."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        # Seed cells via POST.
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(cells={"a": 1.0, "b": 2.0}),
        )
        # PUT metadata only.
        client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor",
            json=make_factor_table(display_name="Renamed"),
        )
        # Cells should survive.
        get_response = client.get(
            f"/api/v1/plans/{pid}/factor-tables"
        )
        result = get_response.json()["factor_tables"][0]
        assert result["display_name"] == "Renamed"
        assert result["cells"] == {"a": 1.0, "b": 2.0}

    def test_put_with_explicit_cells_replaces_them(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(cells={"a": 1.0, "b": 2.0}),
        )
        client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor",
            json=make_factor_table(cells={"x": 9.0}),
        )
        result = client.get(
            f"/api/v1/plans/{pid}/factor-tables"
        ).json()["factor_tables"][0]
        assert result["cells"] == {"x": 9.0}

    def test_put_with_mismatched_table_id_returns_400(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        body = make_factor_table(table_id="class_factor")
        response = client.put(
            f"/api/v1/plans/{pid}/factor-tables/different_id", json=body
        )
        assert response.status_code == 400
        result = response.json()
        assert result["error"]["code"] == "table_id_mismatch"
        assert result["error"]["param"] == "table_id"


# ---------------------------------------------------------------------------
# PUT /cells — replace cells only
# ---------------------------------------------------------------------------


class TestUpsertFactorTableCells:
    def test_put_cells_replaces_map_without_touching_metadata(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(
                display_name="Original name",
                cells={"a": 1.0, "b": 2.0},
            ),
        )
        response = client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor/cells",
            json={"cells": {"x": 9.0, "y": 8.0}},
        )
        assert response.status_code == 200
        result = response.json()
        assert result["display_name"] == "Original name"  # untouched
        assert result["cells"] == {"x": 9.0, "y": 8.0}

    def test_put_cells_on_unknown_table_returns_404(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.put(
            f"/api/v1/plans/{pid}/factor-tables/ghost/cells",
            json={"cells": {}},
        )
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "factor_table_not_found"

    def test_put_empty_cells_clears_the_map(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(cells={"a": 1.0}),
        )
        response = client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor/cells",
            json={"cells": {}},
        )
        assert response.status_code == 200
        assert response.json()["cells"] == {}


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


class TestDeleteFactorTable:
    def test_delete_returns_204_and_removes_ft_and_cells(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(cells={"a": 1.0}),
        )
        response = client.delete(
            f"/api/v1/plans/{pid}/factor-tables/class_factor"
        )
        assert response.status_code == 204
        list_response = client.get(
            f"/api/v1/plans/{pid}/factor-tables"
        )
        assert list_response.json()["factor_tables"] == []

    def test_delete_unknown_ft_returns_404(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        response = client.delete(
            f"/api/v1/plans/{pid}/factor-tables/ghost"
        )
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "factor_table_not_found"

    def test_delete_on_unknown_plan_returns_plan_not_found(
        self,
        client: TestClient,
    ) -> None:
        """plan-existence check fires first."""
        response = client.delete(
            "/api/v1/plans/no-such-plan/factor-tables/x"
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------------------
# POST /bulk — atomic replace-all
# ---------------------------------------------------------------------------


class TestBulkUpsert:
    def test_bulk_into_empty_plan_with_cells(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        payload = {
            "factor_tables": [
                make_factor_table(
                    table_id="ft1", cells={"a": 1.0, "b": 2.0}
                ),
                make_factor_table(
                    table_id="ft2", cells={"x": 9.0}
                ),
            ],
        }
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk", json=payload
        )
        assert response.status_code == 200
        result = response.json()
        assert len(result["factor_tables"]) == 2
        # Both tables come back with their cells.
        by_id = {t["table_id"]: t for t in result["factor_tables"]}
        assert by_id["ft1"]["cells"] == {"a": 1.0, "b": 2.0}
        assert by_id["ft2"]["cells"] == {"x": 9.0}

    def test_bulk_replaces_existing_fts_atomically(
        self,
        client: TestClient,
    ) -> None:
        """The migration path: POST /bulk replaces ALL existing FTs
        + their cells. Pre-existing FTs not in the payload are dropped
        (via cascade)."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(
                table_id="old_a", cells={"old_cell": 5.0}
            ),
        )
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(table_id="old_b"),
        )
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk",
            json={
                "factor_tables": [
                    make_factor_table(
                        table_id="new", cells={"new_cell": 7.0}
                    )
                ],
            },
        )
        assert response.status_code == 200
        result = response.json()
        assert len(result["factor_tables"]) == 1
        assert result["factor_tables"][0]["table_id"] == "new"
        assert result["factor_tables"][0]["cells"] == {"new_cell": 7.0}

    def test_bulk_with_empty_list_clears_fts(self, client: TestClient) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(table_id="x"),
        )
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk",
            json={"factor_tables": []},
        )
        assert response.status_code == 200
        assert response.json()["factor_tables"] == []

    def test_bulk_on_unknown_plan_returns_404(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/plans/ghost-plan/factor-tables/bulk",
            json={"factor_tables": []},
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------------------
# Cross-cutting — isolation between plans, FK cascade behavior
# ---------------------------------------------------------------------------


class TestFactorTableIsolation:
    def test_fts_are_scoped_per_plan(self, client: TestClient) -> None:
        """Same table_id in two plans is two distinct rows; reads of
        one plan never leak the other."""
        plan_a = create_plan(client, display_name="Plan A")
        plan_b = create_plan(client, display_name="Plan B")
        pa = plan_a["rating_plan_id"]
        pb = plan_b["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pa}/factor-tables",
            json=make_factor_table(display_name="A version"),
        )
        client.post(
            f"/api/v1/plans/{pb}/factor-tables",
            json=make_factor_table(display_name="B version"),
        )
        a_tables = client.get(
            f"/api/v1/plans/{pa}/factor-tables"
        ).json()["factor_tables"]
        b_tables = client.get(
            f"/api/v1/plans/{pb}/factor-tables"
        ).json()["factor_tables"]
        assert len(a_tables) == 1 and len(b_tables) == 1
        assert a_tables[0]["display_name"] == "A version"
        assert b_tables[0]["display_name"] == "B version"

    def test_delete_ft_cascades_cells(self, client: TestClient) -> None:
        """Deleting an FT removes its cells from
        plan_factor_table_cells via the FK cascade."""
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(cells={"a": 1.0, "b": 2.0}),
        )
        client.delete(
            f"/api/v1/plans/{pid}/factor-tables/class_factor"
        )
        # Recreate the FT — should have 0 cells (the previous ones
        # were cascade-deleted, not orphaned).
        client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(),
        )
        result = client.get(
            f"/api/v1/plans/{pid}/factor-tables"
        ).json()["factor_tables"][0]
        assert result["cells"] == {}


# ---------------------------------------------------------------------------
# Writability gate — a non-draft plan's factor tables (+ cells) are immutable
# ---------------------------------------------------------------------------


class TestWritabilityGate:
    """Defense in depth behind the rate-lab on-mount sync gate: once a plan
    leaves DRAFT, its factor tables and their cells can't be written (409).
    Reads stay allowed."""

    @staticmethod
    def _frozen_plan(client: TestClient) -> str:
        pid = create_plan(client, display_name="Frozen")["rating_plan_id"]
        promote(client, pid)
        return pid

    def test_bulk_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk",
            json={"factor_tables": [make_factor_table()]},
        )
        assert response.status_code == 409
        err = response.json()["error"]
        assert err["code"] == "illegal_state_transition"
        assert err["details"]["attempted_resource"] == "factor_tables"
        assert err["details"]["current_status"] == "active"

    def test_create_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(),
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "illegal_state_transition"

    def test_put_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor",
            json=make_factor_table(),
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "illegal_state_transition"

    def test_put_cells_on_non_draft_returns_409(self, client: TestClient) -> None:
        """Editing cell values is a write — gated like the rest."""
        pid = self._frozen_plan(client)
        response = client.put(
            f"/api/v1/plans/{pid}/factor-tables/class_factor/cells",
            json={"cells": {"x": 9.0}},
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "illegal_state_transition"

    def test_delete_on_non_draft_returns_409(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.delete(
            f"/api/v1/plans/{pid}/factor-tables/class_factor"
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "illegal_state_transition"

    def test_list_on_non_draft_still_succeeds(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        response = client.get(f"/api/v1/plans/{pid}/factor-tables")
        assert response.status_code == 200

    def test_bulk_on_draft_still_succeeds(self, client: TestClient) -> None:
        pid = create_plan(client, display_name="Still Draft")["rating_plan_id"]
        response = client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk",
            json={"factor_tables": [make_factor_table()]},
        )
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# ADR-0063 — linear-interpolation flag persistence
# ---------------------------------------------------------------------------

_INTERP = {"mode": "linear", "axis": "building_limit"}


class TestFactorTableInterpolation:
    """The `interpolation` flag (ADR-0063) round-trips through the store so a
    LIVE plan carries it to the scoring service's projector. Full-replace on
    upsert (like key_dimensions, NOT the cells tri-state): the FE always
    re-sends the loaded flag, so a metadata edit preserves it."""

    def test_create_with_interpolation_round_trips(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client)["rating_plan_id"]
        body = make_factor_table(
            table_id="building_limit_of_insurance_factors",
            key_dimensions=["building_limit", "building_limit_group"],
            interpolation=_INTERP,
        )
        created = client.post(f"/api/v1/plans/{pid}/factor-tables", json=body)
        assert created.status_code == 201
        assert created.json()["interpolation"] == _INTERP
        # …and it survives a fresh GET (decoded from interpolation_json).
        listed = client.get(f"/api/v1/plans/{pid}/factor-tables").json()
        assert listed["factor_tables"][0]["interpolation"] == _INTERP

    def test_create_without_interpolation_defaults_null(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client)["rating_plan_id"]
        created = client.post(
            f"/api/v1/plans/{pid}/factor-tables", json=make_factor_table()
        )
        assert created.status_code == 201
        assert created.json()["interpolation"] is None

    def test_metadata_edit_preserves_flag_when_resent(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client)["rating_plan_id"]
        tid = "building_limit_of_insurance_factors"
        body = make_factor_table(table_id=tid, interpolation=_INTERP)
        client.put(f"/api/v1/plans/{pid}/factor-tables/{tid}", json=body)
        # A metadata-only edit that re-sends the loaded flag (the FE path).
        body["display_name"] = "Renamed"
        updated = client.put(
            f"/api/v1/plans/{pid}/factor-tables/{tid}", json=body
        )
        assert updated.json()["display_name"] == "Renamed"
        assert updated.json()["interpolation"] == _INTERP

    def test_upsert_without_flag_clears_it(self, client: TestClient) -> None:
        """Documents the full-replace semantics: an upsert with no
        `interpolation` writes NULL (back to stepping)."""
        pid = create_plan(client)["rating_plan_id"]
        tid = "building_limit_of_insurance_factors"
        client.put(
            f"/api/v1/plans/{pid}/factor-tables/{tid}",
            json=make_factor_table(table_id=tid, interpolation=_INTERP),
        )
        cleared = client.put(
            f"/api/v1/plans/{pid}/factor-tables/{tid}",
            json=make_factor_table(table_id=tid),  # no interpolation key
        )
        assert cleared.json()["interpolation"] is None

    def test_bulk_carries_interpolation(self, client: TestClient) -> None:
        pid = create_plan(client)["rating_plan_id"]
        flagged = make_factor_table(
            table_id="building_limit_of_insurance_factors",
            interpolation=_INTERP,
        )
        plain = make_factor_table(table_id="class_factor")
        resp = client.post(
            f"/api/v1/plans/{pid}/factor-tables/bulk",
            json={"factor_tables": [flagged, plain]},
        )
        assert resp.status_code == 200
        by_id = {t["table_id"]: t for t in resp.json()["factor_tables"]}
        assert by_id["building_limit_of_insurance_factors"]["interpolation"] == _INTERP
        assert by_id["class_factor"]["interpolation"] is None

    def test_flag_participates_in_content_hash(self, client: TestClient) -> None:
        """The hash covers the flag, so a bulk If-Match precondition (G14)
        reflects an interpolation change."""
        pid = create_plan(client)["rating_plan_id"]
        stepped = client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(table_id="t_step"),
        ).json()["content_hash"]
        interpolated = client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(table_id="t_interp", interpolation=_INTERP),
        ).json()["content_hash"]
        assert stepped != interpolated

    def test_invalid_interpolation_mode_returns_422(
        self, client: TestClient
    ) -> None:
        pid = create_plan(client)["rating_plan_id"]
        resp = client.post(
            f"/api/v1/plans/{pid}/factor-tables",
            json=make_factor_table(
                interpolation={"mode": "spline", "axis": "building_limit"}
            ),
        )
        assert resp.status_code == 422
