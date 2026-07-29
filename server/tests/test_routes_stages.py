# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""End-to-end tests for the stage CRUD endpoints.

Covers:
  · POST /api/v1/drafts/{id}/stages — add
  · DELETE /api/v1/drafts/{id}/stages/{stage_id} — remove
  · PATCH /api/v1/drafts/{id}/stages/{stage_id}/sequence — reorder
  · GET /api/v1/plans/{id}/stages/{stage_id}/config — read config
  · GET /api/v1/plans/{id}/stages/{stage_id}/io — read IO
  · PATCH /api/v1/drafts/{id} — batch patch
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import add_stage, create_plan

# ---------------------------------------------------------------------------
# Add stage
# ---------------------------------------------------------------------------


class TestAddStage:
    def test_add_first_stage_returns_201(self, client: TestClient) -> None:
        plan = create_plan(client)
        result = add_stage(client, plan["rating_plan_id"], stage_id="s1")
        assert result["added_stage"]["stage_id"] == "s1"
        assert result["added_stage"]["sequence"] == 1

    def test_add_appends_to_end_by_default(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(client, plan_id, stage_id="s1")
        add_stage(client, plan_id, stage_id="s2")
        result = add_stage(client, plan_id, stage_id="s3")
        assert result["added_stage"]["sequence"] == 3

    def test_add_duplicate_stage_id_returns_409(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(client, plan_id, stage_id="dup")
        response = client.post(
            f"/api/v1/drafts/{plan_id}/stages",
            json={
                "stage_id": "dup",
                "stage_kind": "formula",
                "display_name": "Dup",
                "config_json": {"name": "dup", "expression": "1"},
                "insert_after_stage_id": "$last",
                "inputs": [],
                "outputs": [],
            },
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "duplicate_stage_id"

    def test_add_unknown_stage_kind_returns_422(self, client: TestClient) -> None:
        plan = create_plan(client)
        response = client.post(
            f"/api/v1/drafts/{plan['rating_plan_id']}/stages",
            json={
                "stage_id": "x",
                "stage_kind": "not_a_real_kind",
                "display_name": "X",
                "config_json": {},
                "inputs": [],
                "outputs": [],
            },
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "unknown_stage_kind"

    def test_add_with_bad_config_returns_422_with_report(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        response = client.post(
            f"/api/v1/drafts/{plan['rating_plan_id']}/stages",
            json={
                "stage_id": "bad",
                "stage_kind": "formula",
                "display_name": "Bad",
                "config_json": {"wrong_field": "x"},  # missing name + expression
                "inputs": [],
                "outputs": [],
            },
        )
        assert response.status_code == 422
        body = response.json()
        assert body["error"]["code"] == "plan_validation_failed"
        assert "report" in body["error"]["details"]

    def test_add_persists_to_plan_detail(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(client, plan_id, stage_id="persistent")

        detail = client.get(f"/api/v1/plans/{plan_id}").json()
        stage_ids = [s["stage_id"] for s in detail["stages"]]
        assert "persistent" in stage_ids


# ---------------------------------------------------------------------------
# Remove stage
# ---------------------------------------------------------------------------


class TestRemoveStage:
    def test_remove_returns_200(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(client, plan_id, stage_id="to_remove")

        response = client.delete(f"/api/v1/drafts/{plan_id}/stages/to_remove")
        assert response.status_code == 200
        body = response.json()
        assert body["removed_stage_id"] == "to_remove"

    def test_remove_drops_stage_from_detail(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(client, plan_id, stage_id="to_remove")
        client.delete(f"/api/v1/drafts/{plan_id}/stages/to_remove")

        detail = client.get(f"/api/v1/plans/{plan_id}").json()
        stage_ids = [s["stage_id"] for s in detail["stages"]]
        assert "to_remove" not in stage_ids

    def test_remove_nonexistent_stage_returns_404(self, client: TestClient) -> None:
        plan = create_plan(client)
        response = client.delete(
            f"/api/v1/drafts/{plan['rating_plan_id']}/stages/nonexistent"
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "stage_not_found"

    def test_remove_shifts_downstream_sequences(self, client: TestClient) -> None:
        """Removing stage with sequence=1 shifts the rest down."""
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(client, plan_id, stage_id="a")  # seq 1
        add_stage(client, plan_id, stage_id="b")  # seq 2
        add_stage(client, plan_id, stage_id="c")  # seq 3

        client.delete(f"/api/v1/drafts/{plan_id}/stages/a")
        detail = client.get(f"/api/v1/plans/{plan_id}").json()
        # After removing 'a', 'b' should be seq 1 + 'c' seq 2
        seq_map = {s["stage_id"]: s["sequence"] for s in detail["stages"]}
        assert seq_map == {"b": 1, "c": 2}


# ---------------------------------------------------------------------------
# Reorder stage
# ---------------------------------------------------------------------------


class TestReorderStage:
    def test_reorder_returns_200(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(client, plan_id, stage_id="a")
        add_stage(client, plan_id, stage_id="b")
        add_stage(client, plan_id, stage_id="c")

        response = client.patch(
            f"/api/v1/drafts/{plan_id}/stages/c/sequence",
            json={"to_sequence": 1},
        )
        assert response.status_code == 200

    def test_reorder_swaps_positions(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(client, plan_id, stage_id="a")  # seq 1
        add_stage(client, plan_id, stage_id="b")  # seq 2
        add_stage(client, plan_id, stage_id="c")  # seq 3

        client.patch(
            f"/api/v1/drafts/{plan_id}/stages/c/sequence",
            json={"to_sequence": 1},
        )
        detail = client.get(f"/api/v1/plans/{plan_id}").json()
        seq_map = {s["stage_id"]: s["sequence"] for s in detail["stages"]}
        assert seq_map == {"c": 1, "a": 2, "b": 3}

    def test_reorder_to_invalid_sequence_returns_422(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(client, plan_id, stage_id="a")

        response = client.patch(
            f"/api/v1/drafts/{plan_id}/stages/a/sequence",
            json={"to_sequence": 99},  # out of range
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_sequence"

    def test_reorder_nonexistent_stage_returns_404(self, client: TestClient) -> None:
        plan = create_plan(client)
        response = client.patch(
            f"/api/v1/drafts/{plan['rating_plan_id']}/stages/nope/sequence",
            json={"to_sequence": 1},
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "stage_not_found"


# ---------------------------------------------------------------------------
# Get stage config + IO
# ---------------------------------------------------------------------------


class TestGetStageReadEndpoints:
    def test_get_stage_config_returns_config_json(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(
            client,
            plan_id,
            stage_id="read",
            config_json={"name": "n", "expression": "1+1"},
        )

        response = client.get(f"/api/v1/plans/{plan_id}/stages/read/config")
        assert response.status_code == 200
        body = response.json()
        assert body["stage_kind"] == "formula"
        assert body["config_json"] == {"name": "n", "expression": "1+1"}

    def test_get_stage_config_unknown_stage_returns_404(
        self,
        client: TestClient,
    ) -> None:
        plan = create_plan(client)
        response = client.get(
            f"/api/v1/plans/{plan['rating_plan_id']}/stages/nope/config"
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "stage_not_found"

    def test_get_stage_io_returns_inputs_outputs(self, client: TestClient) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        add_stage(
            client,
            plan_id,
            stage_id="iostage",
            outputs=[
                {"output_name": "result", "data_type": "number", "description": "x"}
            ],
        )

        response = client.get(f"/api/v1/plans/{plan_id}/stages/iostage/io")
        assert response.status_code == 200
        body = response.json()
        assert any(o["output_name"] == "result" for o in body["outputs"])


# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Brief 52 — input_node dictionary config (declared typed inputs)
# ---------------------------------------------------------------------------


class TestInputNodeDictionaryConfig:
    """An `input_node` stage carrying the Brief 52 dictionary schema
    (required / allowed-values / unit / category / derived) persists and
    round-trips through the existing stage endpoints — no new table."""

    def _read_config(
        self, client: TestClient, plan_id: str, stage_id: str
    ) -> dict[str, Any]:
        response = client.get(
            f"/api/v1/plans/{plan_id}/stages/{stage_id}/config"
        )
        assert response.status_code == 200, response.text
        return response.json()["config_json"]

    def test_full_dictionary_config_persists_and_roundtrips(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        config = {
            "name": "annual_gross_sales",
            "data_type": "money",
            "source": "form",
            "required": False,
            "unit": "USD",
            "category": "E. Liability exposure",
            "citation": "Sample BOP Rule 23",
            "description": "Liability exposure for SALES-based classes (per $1,000).",
            "output_field": "value",
        }
        add_stage(
            client,
            plan_id,
            stage_id="in_annual_gross_sales",
            stage_kind="input_node",
            display_name="Annual gross sales ($)",
            config_json=config,
        )
        stored = self._read_config(client, plan_id, "in_annual_gross_sales")
        assert stored["data_type"] == "money"
        assert stored["source"] == "form"
        assert stored["unit"] == "USD"
        assert stored["category"] == "E. Liability exposure"
        assert stored["citation"] == "Sample BOP Rule 23"
        assert stored["description"].startswith("Liability exposure")

    def test_required_floor_area_with_range_validation(
        self, client: TestClient
    ) -> None:
        # The acceptance field: total_floor_area_sqft, required, int.
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        config = {
            "name": "total_floor_area_sqft",
            "data_type": "int",
            "source": "form",
            "required": True,
            "unit": "sqft",
            "category": "G. Eligibility & policy facts",
            "validation": {"max": 35000.0},
        }
        add_stage(
            client,
            plan_id,
            stage_id="in_floor",
            stage_kind="input_node",
            display_name="Total floor area (sq ft)",
            config_json=config,
        )
        stored = self._read_config(client, plan_id, "in_floor")
        assert stored["required"] is True
        assert stored["data_type"] == "int"
        assert stored["validation"]["max"] == 35000.0

    def test_derived_source_with_allowed_values_roundtrips(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        config = {
            "name": "territory",
            "data_type": "string",
            "source": "derived",
            "derived_from": "zip",
            "derived_rule": "ZIP -> KS rating territory (701/702)",
            "required": True,
            "validation": {"enum": ["701", "702"]},
        }
        add_stage(
            client,
            plan_id,
            stage_id="in_territory",
            stage_kind="input_node",
            display_name="KS rating territory",
            config_json=config,
        )
        stored = self._read_config(client, plan_id, "in_territory")
        assert stored["source"] == "derived"
        assert stored["derived_from"] == "zip"
        assert stored["validation"]["enum"] == ["701", "702"]

    def test_legacy_vocab_input_node_still_validates(
        self, client: TestClient
    ) -> None:
        # Pre-Brief-51 configs (data_type=number, source=form_input) must
        # keep parsing — the widened Literals are additive, not a rename.
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        config = {
            "name": "legacy_field",
            "data_type": "number",
            "source": "form_input",
            "source_path": "classification.legacy",
        }
        add_stage(
            client,
            plan_id,
            stage_id="in_legacy",
            stage_kind="input_node",
            display_name="Legacy field",
            config_json=config,
        )
        stored = self._read_config(client, plan_id, "in_legacy")
        assert stored["data_type"] == "number"
        assert stored["source"] == "form_input"

    def test_unknown_dictionary_field_is_rejected_422(
        self, client: TestClient
    ) -> None:
        # extra='forbid' is preserved — a typo'd field is a 422, not a
        # silently-dropped value.
        plan = create_plan(client)
        plan_id = plan["rating_plan_id"]
        response = client.post(
            f"/api/v1/drafts/{plan_id}/stages",
            json={
                "stage_id": "in_bad",
                "stage_kind": "input_node",
                "display_name": "Bad",
                "config_json": {
                    "name": "x",
                    "data_type": "money",
                    "source": "form",
                    "allowed_values": ["a"],  # not a field — use validation.enum
                },
                "insert_after_stage_id": "$last",
                "inputs": [],
                "outputs": [
                    {
                        "output_name": "value",
                        "data_type": "number",
                        "description": None,
                    }
                ],
            },
        )
        assert response.status_code == 422, response.text


class TestPatchDraftDisplayNameCap:
    """audit A-2026-07-12 P1-02: a stage display_name of 121–200 chars
    passed the route (cap was 200) then persisted past Stage's 120 cap via
    an unvalidated model_copy, so every later read 500'd — bricking the
    draft (only recovery was discarding it). The route cap now equals the
    model's (120): a too-long name is refused with a clean 422 and the
    plan stays readable."""

    def test_overlong_stage_display_name_is_422_not_a_brick(
        self, client: TestClient
    ) -> None:
        plan = create_plan(client)
        pid = plan["rating_plan_id"]
        add_stage(client, pid, stage_id="s1", stage_kind="formula")

        resp = client.patch(
            f"/api/v1/drafts/{pid}",
            json={
                "stage_patches": [
                    {
                        "stage_id": "s1",
                        "config_json": {"name": "test", "expression": "1.0"},
                        "display_name": "X" * 121,
                    }
                ]
            },
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["code"] == "validation_error"
        # NOT bricked — the plan is still readable and editable.
        assert client.get(f"/api/v1/plans/{pid}").status_code == 200
        # a name at the cap still succeeds.
        ok = client.patch(
            f"/api/v1/drafts/{pid}",
            json={
                "stage_patches": [
                    {
                        "stage_id": "s1",
                        "config_json": {"name": "test", "expression": "1.0"},
                        "display_name": "X" * 120,
                    }
                ]
            },
        )
        assert ok.status_code == 200, ok.text
