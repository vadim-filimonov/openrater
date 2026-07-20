# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""GET /plans/{id}/input-schema + the capability-registry asset.

The agent-facing courtesy schema: declared `input_node` stages as a
typed listing, with `expected_from_caller` marking what a quote caller
actually sends (derived inputs are the plan's own work).
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import add_stage, create_plan


def _declare(
    client: TestClient, plan_id: str, idx: int, config: dict[str, Any]
) -> None:
    add_stage(
        client,
        plan_id,
        stage_id=f"in_{idx}",
        stage_kind="input_node",
        display_name=str(config["name"]),
        config_json=config,
        outputs=[{"output_name": "value", "data_type": "string", "description": None}],
    )


def test_input_schema_lists_declared_inputs(client: TestClient) -> None:
    plan = create_plan(client, display_name="Input Schema Plan")
    plan_id: str = plan["rating_plan_id"]
    _declare(client, plan_id, 0, {
        "name": "tiv",
        "data_type": "money",
        "source": "form",
        "source_path": "tiv",
        "required": True,
        "unit": "USD",
        "category": "B. Exposure",
        "validation": {"min": 0},
    })
    _declare(client, plan_id, 1, {
        "name": "construction_class",
        "data_type": "string",
        "source": "form",
        "source_path": "construction_class",
        "required": True,
        "validation": {"enum": ["frame", "masonry", "fire_resistive"]},
    })
    _declare(client, plan_id, 2, {
        "name": "rate_tier",
        "data_type": "string",
        "source": "derived",
        "source_path": "rate_tier",
        "required": False,
        "derived_from": "class_code",
        "derived_rule": "class table attribute",
    })

    res = client.get(f"/api/v1/plans/{plan_id}/input-schema")
    assert res.status_code == 200
    body = res.json()
    assert body["rating_plan_id"] == plan_id
    assert body["count"] == 3
    by_name = {e["name"]: e for e in body["inputs"]}

    tiv = by_name["tiv"]
    assert tiv["data_type"] == "money"
    assert tiv["required"] is True
    assert tiv["expected_from_caller"] is True
    assert tiv["unit"] == "USD"
    assert tiv["min"] == 0

    cc = by_name["construction_class"]
    assert cc["allowed_values"] == ["frame", "masonry", "fire_resistive"]

    derived = by_name["rate_tier"]
    assert derived["source"] == "derived"
    assert derived["expected_from_caller"] is False
    assert derived["derived_from"] == "class_code"


def test_input_schema_serves_display_names_from_both_writers(
    client: TestClient,
) -> None:
    """ — the schema resolves the human name the way every UI
    surface does: an authored config name that differs from the field
    key wins; the workbook path's stage-level label wins next; a plan
    with neither serves null (never the slug re-dressed)."""
    plan = create_plan(client, display_name="Display Name Plan")
    plan_id: str = plan["rating_plan_id"]
    # Workbook shape: config.name = slug; the label rides the stage.
    add_stage(
        client,
        plan_id,
        stage_id="in_wb",
        stage_kind="input_node",
        display_name="Annual gross sales",
        config_json={
            "name": "annual_gross_sales",
            "data_type": "money",
            "source": "form",
            "source_path": "annual_gross_sales",
            "required": True,
        },
        outputs=[
            {"output_name": "value", "data_type": "number", "description": None}
        ],
    )
    # Editor shape: config.name IS the display name.
    _declare(client, plan_id, 1, {
        "name": "Total insured value",
        "data_type": "money",
        "source": "form",
        "source_path": "tiv",
        "required": True,
    })
    # Neither: name == key everywhere.
    _declare(client, plan_id, 2, {
        "name": "sq_ft",
        "data_type": "float",
        "source": "form",
        "source_path": "sq_ft",
        "required": False,
    })

    res = client.get(f"/api/v1/plans/{plan_id}/input-schema")
    assert res.status_code == 200
    by_name = {e["name"]: e for e in res.json()["inputs"]}
    assert by_name["annual_gross_sales"]["display_name"] == "Annual gross sales"
    assert by_name["Total insured value"]["display_name"] == "Total insured value"
    assert by_name["sq_ft"]["display_name"] is None


def test_input_schema_unknown_plan_404s(client: TestClient) -> None:
    res = client.get("/api/v1/plans/nope/input-schema")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "plan_not_found"


def test_capability_registry_endpoint_serves_the_packaged_registry(
    client: TestClient,
) -> None:
    res = client.get("/api/v1/plans/ingest/capability-registry")
    assert res.status_code == 200
    body = res.json()
    assert "constructs" in body
    assert isinstance(body["constructs"], list) and len(body["constructs"]) > 0
    # Every construct entry carries the enforcement essentials.
    sample = body["constructs"][0]
    assert "id" in sample and "status" in sample
