# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Endpoint tests for the per-plan class-code registry — Brief 51.

Covers CRUD + bulk import round-trips (incl. the derived `attributes`
map), plus the classification-dimension fields the backend used to drop
(`class_library_id`, `derived_from`).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests._helpers import create_plan, promote

# Intentionally invented Meridian reference rows. These identifiers and
# values are synthetic and are not copied from any carrier or bureau filing.
_MERIDIAN_GENERAL_MERCHANDISE = {
    "class_code": "c102",
    "display_name": "Meridian General Merchandise",
    "family": "Meridian demo retail",
    "naics_code": "DEMO-NAICS-101",
    "sic_code": "DEMO-SIC-01",
    "eligible_for": ["bop"],
    "exposure_bases": [{"code": "sales", "coverage_tags": ["liability"]}],
    "attributes": {
        "prop_rate_number": "11",
        "liab_class_group": "mg_01",
        "liab_exposure_base": "sales",
    },
    "source": "custom",
    "citation_rule": "Meridian Filing Rule C.1",
    "citation_page": "p.8",
}

_MERIDIAN_NEIGHBORHOOD_BAKERY = {
    "class_code": "c101",
    "display_name": "Meridian Neighborhood Bakery",
    "family": "Meridian demo food",
    "eligible_for": ["bop"],
    "attributes": {"prop_rate_number": "07", "liab_class_group": "mg_02"},
    "source": "custom",
}


def test_list_empty_for_new_plan(client: TestClient) -> None:
    plan = create_plan(client)
    pid = plan["rating_plan_id"]
    r = client.get(f"/api/v1/plans/{pid}/class-codes")
    assert r.status_code == 200
    assert r.json() == {"rating_plan_id": pid, "class_codes": []}


def test_list_unknown_plan_404(client: TestClient) -> None:
    r = client.get("/api/v1/plans/does_not_exist/class-codes")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "plan_not_found"


def test_create_and_get_roundtrip(client: TestClient) -> None:
    pid = create_plan(client)["rating_plan_id"]
    r = client.post(
        f"/api/v1/plans/{pid}/class-codes", json=_MERIDIAN_GENERAL_MERCHANDISE
    )
    assert r.status_code == 201, r.text
    body = r.json()
    # Every field round-trips, including the opaque derived attributes.
    assert body["class_code"] == "c102"
    assert body["display_name"] == "Meridian General Merchandise"
    assert body["attributes"]["prop_rate_number"] == "11"
    assert body["attributes"]["liab_exposure_base"] == "sales"
    assert body["eligible_for"] == ["bop"]
    assert body["exposure_bases"] == [
        {"code": "sales", "coverage_tags": ["liability"]}
    ]
    assert body["source"] == "custom"
    assert body["content_hash"]  # computed
    # And the list endpoint returns it.
    listed = client.get(f"/api/v1/plans/{pid}/class-codes").json()
    assert [c["class_code"] for c in listed["class_codes"]] == ["c102"]


def test_put_upsert_preserves_created_at(client: TestClient) -> None:
    pid = create_plan(client)["rating_plan_id"]
    client.put(
        f"/api/v1/plans/{pid}/class-codes/c102",
        json=_MERIDIAN_GENERAL_MERCHANDISE,
    )
    first = client.get(f"/api/v1/plans/{pid}/class-codes").json()["class_codes"][0]
    created = first["created_at"]
    # Edit the display name + an attribute.
    edited = {
        **_MERIDIAN_GENERAL_MERCHANDISE,
        "display_name": "Meridian General Merchandise (edited)",
    }
    r = client.put(f"/api/v1/plans/{pid}/class-codes/c102", json=edited)
    assert r.status_code == 200
    body = r.json()
    assert body["display_name"] == "Meridian General Merchandise (edited)"
    assert body["created_at"] == created  # preserved across the update


def test_put_class_code_mismatch_400(client: TestClient) -> None:
    pid = create_plan(client)["rating_plan_id"]
    r = client.put(
        f"/api/v1/plans/{pid}/class-codes/99999",
        json=_MERIDIAN_GENERAL_MERCHANDISE,
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "class_code_mismatch"


def test_delete(client: TestClient) -> None:
    pid = create_plan(client)["rating_plan_id"]
    client.post(
        f"/api/v1/plans/{pid}/class-codes", json=_MERIDIAN_GENERAL_MERCHANDISE
    )
    r = client.delete(f"/api/v1/plans/{pid}/class-codes/c102")
    assert r.status_code == 204
    # Gone now → 404 on a second delete.
    r2 = client.delete(f"/api/v1/plans/{pid}/class-codes/c102")
    assert r2.status_code == 404
    assert r2.json()["error"]["code"] == "class_code_not_found"


def test_bulk_import_merge(client: TestClient) -> None:
    pid = create_plan(client)["rating_plan_id"]
    # Seed one class, then merge-import two more (one overlapping).
    client.post(
        f"/api/v1/plans/{pid}/class-codes", json=_MERIDIAN_GENERAL_MERCHANDISE
    )
    r = client.post(
        f"/api/v1/plans/{pid}/class-codes/bulk",
        json={
            "classes": [
                _MERIDIAN_NEIGHBORHOOD_BAKERY,
                {
                    **_MERIDIAN_GENERAL_MERCHANDISE,
                    "display_name": "Meridian General Merchandise v2",
                },
            ]
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 2
    assert body["mode"] == "merge"
    codes = {c["class_code"]: c for c in body["class_codes"]}
    # Merge kept both, and updated the overlapping one.
    assert set(codes) == {"c102", "c101"}
    assert codes["c102"]["display_name"] == "Meridian General Merchandise v2"
    assert codes["c101"]["attributes"]["prop_rate_number"] == "07"


def test_bulk_import_replace(client: TestClient) -> None:
    pid = create_plan(client)["rating_plan_id"]
    client.post(
        f"/api/v1/plans/{pid}/class-codes", json=_MERIDIAN_GENERAL_MERCHANDISE
    )
    r = client.post(
        f"/api/v1/plans/{pid}/class-codes/bulk",
        json={"classes": [_MERIDIAN_NEIGHBORHOOD_BAKERY], "mode": "replace"},
    )
    assert r.status_code == 200
    codes = [c["class_code"] for c in r.json()["class_codes"]]
    assert codes == ["c101"]  # the seeded Meridian class was cleared


def test_invalid_source_rejected(client: TestClient) -> None:
    pid = create_plan(client)["rating_plan_id"]
    bad = {**_MERIDIAN_GENERAL_MERCHANDISE, "source": "made_up"}
    r = client.post(f"/api/v1/plans/{pid}/class-codes", json=bad)
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Dimension classification-field round-trip (the dropped-fields fix).
# A classification dim's `class_library_id` and a structural dim's
# `derived_from` must now persist (migration 020 + UpsertDimensionRequest).
# ---------------------------------------------------------------------------


def test_classification_dimension_fields_roundtrip(client: TestClient) -> None:
    pid = create_plan(client)["rating_plan_id"]

    class_dim = {
        "dim_id": "class_code",
        "display_name": "Meridian fictional class code",
        "slug": "class_code",
        "data_type": "string",
        "role": "rating-input",
        "dimension_type": "classification",
        "shape": "categorical",
        "class_library_id": pid,
        "levels": [
            {
                "kind": "categorical",
                "id": "c102",
                "label": "Meridian General Merchandise",
                "aliases": [],
            }
        ],
    }
    r = client.put(f"/api/v1/plans/{pid}/dimensions/class_code", json=class_dim)
    assert r.status_code == 200, r.text
    assert r.json()["class_library_id"] == pid

    derived_dim = {
        "dim_id": "prop_rate_number",
        "display_name": "Property rate number",
        "slug": "prop_rate_number",
        "data_type": "string",
        "role": "structural",
        "dimension_type": "standard",
        "shape": "categorical",
        "derived_from": {"source_dim": "class_code", "attribute": "prop_rate_number"},
        "levels": [{"kind": "categorical", "id": "11", "label": "11", "aliases": []}],
    }
    r2 = client.put(f"/api/v1/plans/{pid}/dimensions/prop_rate_number", json=derived_dim)
    assert r2.status_code == 200, r2.text
    assert r2.json()["derived_from"] == {
        "source_dim": "class_code",
        "attribute": "prop_rate_number",
        # Brief 83 — the optional declared-override field is additive-nullable.
        "override_field": None,
    }

    # Both survive a fresh GET (persisted, not just echoed).
    listed = client.get(f"/api/v1/plans/{pid}/dimensions").json()["dimensions"]
    by_id = {d["dim_id"]: d for d in listed}
    assert by_id["class_code"]["class_library_id"] == pid
    assert by_id["prop_rate_number"]["derived_from"]["attribute"] == "prop_rate_number"

    # Brief 83 / TV-19 — the declared-override field round-trips: an
    # occupant-class insured may elect a different exposure basis, and the
    # projector wires this field onto the derive node's `override` port.
    derived_dim["derived_from"]["override_field"] = "rate_number_override"
    r3 = client.put(f"/api/v1/plans/{pid}/dimensions/prop_rate_number", json=derived_dim)
    assert r3.status_code == 200, r3.text
    assert r3.json()["derived_from"]["override_field"] == "rate_number_override"
    refreshed = client.get(f"/api/v1/plans/{pid}/dimensions").json()["dimensions"]
    again = {d["dim_id"]: d for d in refreshed}["prop_rate_number"]
    assert again["derived_from"]["override_field"] == "rate_number_override"


class TestWritabilityGate:
    """audit A-2026-07-12 P1-05: class-codes was the ONE child-resource
    family that skipped the writable gate, so a bulk `mode=replace` on a
    non-draft plan silently WIPED the entire registry (458 rows). It now
    refuses like its four siblings; reads stay allowed."""

    @staticmethod
    def _frozen_plan(client: TestClient) -> str:
        pid = create_plan(client, display_name="Frozen")["rating_plan_id"]
        promote(client, pid)
        return pid

    def test_bulk_replace_on_non_draft_refuses_not_wipes(
        self, client: TestClient
    ) -> None:
        pid = self._frozen_plan(client)
        resp = client.post(
            f"/api/v1/plans/{pid}/class-codes/bulk",
            json={"classes": [], "mode": "replace"},
        )
        assert resp.status_code == 409, resp.text
        err = resp.json()["error"]
        assert err["code"] == "illegal_state_transition"
        assert err["details"]["attempted_resource"] == "class-codes"

    def test_create_and_delete_on_non_draft_return_409(
        self, client: TestClient
    ) -> None:
        pid = self._frozen_plan(client)
        # a VALID body, so the writable gate (not body validation) is what
        # refuses.
        create = client.post(
            f"/api/v1/plans/{pid}/class-codes",
            json=_MERIDIAN_GENERAL_MERCHANDISE,
        )
        assert create.status_code == 409, create.text
        assert create.json()["error"]["code"] == "illegal_state_transition"
        delete = client.delete(
            f"/api/v1/plans/{pid}/class-codes/"
            f"{_MERIDIAN_GENERAL_MERCHANDISE['class_code']}"
        )
        assert delete.status_code == 409, delete.text

    def test_reads_still_work_on_non_draft(self, client: TestClient) -> None:
        pid = self._frozen_plan(client)
        assert client.get(f"/api/v1/plans/{pid}/class-codes").status_code == 200
