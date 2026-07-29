# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""GET /plans/{id}/input-schema + the capability-registry asset (Brief 2 P1).

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
    """MVP-012 — the schema resolves the human name the way every UI
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


def test_input_schema_exposes_structure_consumed_fields(
    client: TestClient,
) -> None:
    """FCA fca-2026-07-25 #13 — book preflights called load-bearing
    columns 'ignored'. The schema now names every field the rating
    STRUCTURE reads beyond the declared dictionary — schedule
    application hooks, gate variables, predicate fields — so both
    doors can label such columns truthfully."""
    plan = create_plan(client, display_name="Consumed Fields Plan")
    plan_id: str = plan["rating_plan_id"]
    _declare(client, plan_id, 0, {
        "name": "class_code",
        "data_type": "string",
        "source": "form",
        "source_path": "class_code",
        "required": True,
    })
    add_stage(
        client,
        plan_id,
        stage_id="rating_chains",
        stage_kind="multiplicative_chain",
        display_name="Rating",
        config_json={
            "chains": [
                {
                    "name": "prem",
                    "base_input": "form_input.base_rate",
                    "exposure_input": "form_input.payroll",
                    "exposure_unit_divisor": 100,
                    "factor_lookups": [
                        {
                            "name": "Good driver",
                            "factor_kind": "gd",
                            "lookup_method": "direct",
                            "dimensions": {
                                "class_code": {
                                    "source": "form_input",
                                    "path": "form_input.class_code",
                                }
                            },
                            "description_template": "gd: x{value}",
                            "predicate": {
                                "path": "form_input.gd_basis",
                                "equals": "yes",
                            },
                        }
                    ],
                    "lcm": {"value": 1.0},
                    "output_field": "prem_premium",
                }
            ],
            "output_total_field": "premium",
        },
        outputs=[{
            "output_name": "total_premium",
            "data_type": "number",
            "description": None,
        }],
    )
    add_stage(
        client,
        plan_id,
        stage_id="eligibility_gate",
        stage_kind="eligibility.gate",
        display_name="Eligibility",
        config_json={
            "rules": [
                {
                    "rule_id": "delivery",
                    "variable": "vehicle_use",
                    "op": "in",
                    "value": ["delivery"],
                    "tier": "decline",
                    "reasoning": "Rule 3.B",
                }
            ],
            "default_tier": "standard",
            "default_reasoning": "Rule 3.C",
            "scope": "row",
        },
    )
    add_stage(
        client,
        plan_id,
        stage_id="psm_schedule",
        stage_kind="modifier.schedule",
        display_name="Schedule",
        config_json={
            "schedule": {
                "schedule_id": "psm_schedule",
                "display_name": "Schedule rating",
                "scope": "package",
                "total_cap_pct": 25,
                "categories": [
                    {
                        "category_id": "mgmt",
                        "name": "Management",
                        "range_pct": 10,
                    }
                ],
            },
        },
    )

    res = client.get(f"/api/v1/plans/{plan_id}/input-schema")
    assert res.status_code == 200
    body = res.json()
    # Declared stays declared; everything the structure reads beyond it
    # is named (gd_basis — the audited predicate field — included).
    # The schedule application is BETTER than consumed: it graduated to
    # a documented schema entry (FCA #12), so it is no longer listed
    # here.
    assert body["consumed_fields"] == [
        "base_rate",
        "gd_basis",
        "payroll",
        "vehicle_use",
    ]
    assert "class_code" not in body["consumed_fields"]

    # FCA #12 — the schedule-rating door, documented: an optional JSON
    # entry with the exact envelope, the categories + ranges, and the
    # filed cap.
    by_name = {e["name"]: e for e in body["inputs"]}
    sched = by_name["schedule_app_psm_schedule"]
    assert sched["required"] is False
    assert sched["data_type"] == "json"
    assert sched["source"] == "schedule"
    assert '"schedule_id": "psm_schedule"' in sched["description"]
    assert "value_pct" in sched["description"]
    assert "mgmt" in sched["description"]
    assert "±10" in sched["description"]
    assert "±25" in sched["description"]
    import json as _json

    example = _json.loads(sched["example_value"])
    assert example["schedule_id"] == "psm_schedule"
    assert "mgmt" in example["values"]


def test_closed_vocabularies_enumerate_from_dimension_levels(
    client: TestClient,
) -> None:
    """FCA fca-2026-07-25 #29 (finding 14) — 'is there a code for
    that?' was unanswerable from chat: class codes and deductible
    tokens are closed lists the plan KNOWS (dimension levels), but the
    schema served allowed_values null. An input feeding a categorical
    dimension now enumerates that dimension's level ids."""
    plan = create_plan(client, display_name="Enumerating Plan")
    plan_id: str = plan["rating_plan_id"]
    _declare(client, plan_id, 0, {
        "name": "deductible",
        "data_type": "string",
        "source": "form",
        "source_path": "deductible",
        "required": True,
    })
    # The dimension the input feeds, with its closed level vocabulary.
    res = client.put(
        f"/api/v1/plans/{plan_id}/dimensions/deductible",
        json={
            "dim_id": "deductible",
            "slug": "deductible",
            "display_name": "Deductible",
            "data_type": "string",
            "role": "rating-input",
            "shape": "categorical",
            "levels": [
                {"kind": "categorical", "id": "none", "label": "None"},
                {"kind": "categorical", "id": "ded_500", "label": "$500"},
                {"kind": "categorical", "id": "ded_1000", "label": "$1,000"},
                {"kind": "categorical", "id": "ded_2500", "label": "$2,500"},
            ],
        },
    )
    assert res.status_code in (200, 201), res.text
    # A chain lookup binds the input field to the dimension.
    add_stage(
        client,
        plan_id,
        stage_id="chain_1",
        stage_kind="multiplicative_chain",
        display_name="Chain",
        config_json={
            "chains": [
                {
                    "name": "premium",
                    "base_input": "literal.base_value",
                    "base_value": 100.0,
                    "factor_lookups": [
                        {
                            "name": "Deductible factor",
                            "factor_kind": "ded_factor",
                            "lookup_method": "direct",
                            "description_template": "\u00d7{value}",
                            "dimensions": {
                                "deductible": {
                                    "source": "form_input",
                                    "path": "form_input.deductible",
                                },
                            },
                        }
                    ],
                    "lcm": {
                        "value": 1.0,
                        "input_path": None,
                        "citation_rule": "(carrier-set)",
                        "citation_page": "(carrier-set)",
                    },
                    "exposure_input": "literal:1",
                    "exposure_unit_divisor": 1.0,
                    "apply_exposure": False,
                    "output_field": "premium",
                }
            ],
            "output_total_field": "premium",
        },
        outputs=[{"output_name": "premium", "data_type": "number", "description": None}],
    )
    schema = client.get(f"/api/v1/plans/{plan_id}/input-schema").json()
    ded = next(e for e in schema["inputs"] if e["name"] == "deductible")
    assert ded["allowed_values"] == ["none", "ded_500", "ded_1000", "ded_2500"]
    # Uncapped → total stays None (the list IS complete).
    assert ded["allowed_values_total"] is None
