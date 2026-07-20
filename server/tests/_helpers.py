# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Shared test helpers — payload builders + API call wrappers.

Imported by per-route test files. Keeps individual tests focused on
assertions rather than payload boilerplate.

(The `client` fixture lives in `conftest.py` so pytest auto-injects
it; helpers here are pure functions called inside tests.)
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def make_plan_body(
    *,
    display_name: str = "Test BOP Plan",
    line_of_business: str = "bop",
    product: str | None = None,
    jurisdiction: str | None = "WI",
    effective_date: str = "2026-07-01",
    template: str = "blank",
    description: str | None = None,
) -> dict[str, Any]:
    """Build a CreatePlanRequest body with sensible BOP defaults.

    Pass `product` (the ADR-0033 axis) to exercise products beyond the
    5-value LOB enum — the legacy `line_of_business` key is omitted so
    the server derives its shim (sending both risks a coherence 422)."""
    body: dict[str, Any] = {
        "display_name": display_name,
        "effective_date": effective_date,
        "template": template,
    }
    if product is not None:
        body["product"] = product
    else:
        body["line_of_business"] = line_of_business
    if jurisdiction is not None:
        body["jurisdiction"] = jurisdiction
    if description is not None:
        body["description"] = description
    return body


def create_plan(client: TestClient, **overrides: Any) -> dict[str, Any]:
    """Helper: POST a plan + return the parsed response body.

    Raises AssertionError if the response isn't 201 — fail-fast for
    setup steps that have to succeed.
    """
    body = make_plan_body(**overrides)
    response = client.post("/api/v1/plans", json=body)
    assert response.status_code == 201, (
        f"Plan creation failed: {response.status_code} {response.text}"
    )
    return response.json()


def add_stage(
    client: TestClient,
    rating_plan_id: str,
    *,
    stage_id: str = "test_stage",
    stage_kind: str = "formula",
    display_name: str = "Test stage",
    config_json: dict[str, Any] | None = None,
    insert_after_stage_id: str | None = "$last",
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Helper: POST a stage to a draft + return the response body."""
    # Build a kind-appropriate default config_json. Tests can override
    # via the `config_json=` kwarg.
    default_configs: dict[str, dict[str, Any]] = {
        "formula": {"name": "test", "expression": "1.0"},
        "flat_factor": {"factor": 1.0, "reason": "test"},
        "deferred_zero": {"reason": "test stub"},
    }
    body: dict[str, Any] = {
        "stage_id": stage_id,
        "stage_kind": stage_kind,
        "display_name": display_name,
        "config_json": config_json or default_configs.get(stage_kind, {}),
        "insert_after_stage_id": insert_after_stage_id,
        "inputs": inputs or [],
        "outputs": outputs
        or [{"output_name": "value", "data_type": "number", "description": None}],
    }
    response = client.post(
        f"/api/v1/drafts/{rating_plan_id}/stages",
        json=body,
    )
    assert response.status_code == 201, (
        f"Stage add failed: {response.status_code} {response.text}"
    )
    return response.json()


def create_plan_with_inputs(
    client: TestClient,
    inputs: list[dict[str, Any]],
    *,
    display_name: str = "Routes Test Plan",
    line_of_business: str = "bop",
) -> str:
    """Create a draft plan and add one INPUT_NODE stage per input; return its
    rating_plan_id. Each input: {name, data_type?, source_path?, required?}.

    This is how a plan declares the input variables Routes read — used wherever a
    test needs a real, plan-agnostic input schema (not a hard-coded one)."""
    plan = create_plan(client, display_name=display_name, line_of_business=line_of_business)
    plan_id: str = plan["rating_plan_id"]
    for idx, inp in enumerate(inputs):
        dt = inp.get("data_type", "string")
        out_dt = dt if dt in ("number", "string", "boolean") else "string"
        add_stage(
            client,
            plan_id,
            stage_id=f"in_{idx}",
            stage_kind="input_node",
            display_name=inp.get("label", inp["name"]),
            config_json={
                "name": inp["name"],
                "data_type": dt,
                "source": "form_input",
                "source_path": inp.get("source_path", inp["name"]),
                "required": inp.get("required", True),
            },
            outputs=[{"output_name": "value", "data_type": out_dt, "description": None}],
        )
    return plan_id


def promote(client: TestClient, draft_id: str) -> dict[str, Any]:
    """Helper: promote a draft to active."""
    response = client.post(
        f"/api/v1/drafts/{draft_id}/promote",
        json={"note": "Test promote"},
    )
    assert response.status_code == 200, (
        f"Promote failed: {response.status_code} {response.text}"
    )
    return response.json()
