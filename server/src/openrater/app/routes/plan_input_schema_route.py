# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""GET /plans/{id}/input-schema — the plan's declared inputs, as a
machine-readable schema.

The agent-facing companion to the quote endpoint: before calling
`quote_risk`, an agent (or any API consumer) asks the plan what it
declares — names, types, required-ness, allowed values, units — instead
of guessing from the spec. DECLARED inputs only (the plan's
`input_node` stages, the Brief 52 dictionary): consumption-derived
requirements stay the client walkers' concern, and the quote path's G5
preflight still names anything missing at rating time, so this schema
is a courtesy, not a gate.

`expected_from_caller` marks which fields a caller actually sends: a
`derived` input (computed expression / class-table attribute) is
produced by the plan, not the caller.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Path, Request
from pydantic import BaseModel, ConfigDict

from openrater.errors import NotFoundError
from openrater.persistence import Database
from openrater.rates.plans.configs import InputNodeConfig
from openrater.rates.plans.repo import get_plan, get_stages

router = APIRouter(tags=["plans"])


def _resolve_db(request: Request) -> Database:
    return request.app.state.db  # type: ignore[no-any-return]


class InputSchemaEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    #: The human name (). `name` stays the machine field on this
    #: wire; the display name resolves like every UI surface: an
    #: authored config name that differs from the field key wins, else
    #: the stage-level display_name (the workbook `label`), else None.
    display_name: str | None = None
    data_type: str
    source: str
    required: bool
    #: False for `derived` inputs — the plan computes them; a caller
    #: sending them is harmless but unnecessary.
    expected_from_caller: bool
    source_path: str | None = None
    unit: str | None = None
    category: str | None = None
    allowed_values: list[str] | None = None
    min: float | None = None
    max: float | None = None
    default_value: bool | int | float | str | None = None
    example_value: bool | int | float | str | None = None
    derived_from: str | None = None
    derived_rule: str | None = None
    citation: str | None = None


class InputSchemaResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    count: int
    inputs: list[InputSchemaEntry]


def _display_name(
    parsed: InputNodeConfig, stage_display_name: str | None
) -> str | None:
    """The human name, resolved by the shared  rule: a config
    `name` that differs from the field key was authored by a person;
    the workbook builder writes the slug there and puts the spec's
    `label` on the stage. Mirrors `resolveInputDisplayName` in the UI."""
    field_key = (parsed.source_path or parsed.name).strip()
    cfg_name = parsed.name.strip()
    if cfg_name and cfg_name != field_key:
        return cfg_name
    stage_name = (stage_display_name or "").strip()
    if stage_name and stage_name != field_key:
        return stage_name
    return None


def _entry_from_config(
    config: dict[str, Any], stage_display_name: str | None = None
) -> InputSchemaEntry | None:
    """One schema entry from an `input_node` config_json. A config this
    module can't parse yields None (skipped, never a 500 — the schema
    is a courtesy read over persisted data of many vintages)."""
    try:
        parsed = InputNodeConfig.model_validate(config)
    except Exception:
        return None
    validation = parsed.validation
    enum = list(validation.enum) if validation and validation.enum else None
    return InputSchemaEntry(
        name=parsed.name,
        display_name=_display_name(parsed, stage_display_name),
        data_type=parsed.data_type,
        source=parsed.source,
        required=parsed.required,
        expected_from_caller=not (
            parsed.source == "derived" or parsed.derived_expr is not None
        ),
        source_path=parsed.source_path or None,
        unit=parsed.unit,
        category=parsed.category,
        allowed_values=enum,
        min=getattr(validation, "min", None) if validation else None,
        max=getattr(validation, "max", None) if validation else None,
        default_value=parsed.default_value,
        example_value=parsed.example_value,
        derived_from=parsed.derived_from,
        derived_rule=parsed.derived_rule,
        citation=parsed.citation,
    )


@router.get(
    "/plans/{rating_plan_id}/input-schema",
    response_model=InputSchemaResponse,
)
async def get_plan_input_schema(
    request: Request,
    rating_plan_id: str = Path(..., min_length=1),
) -> InputSchemaResponse:
    """The plan's declared inputs (its `input_node` dictionary), ordered
    as authored."""
    db = _resolve_db(request)
    if get_plan(db=db, rating_plan_id=rating_plan_id) is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )
    entries: list[InputSchemaEntry] = []
    for stage in get_stages(db=db, rating_plan_id=rating_plan_id):
        if str(getattr(stage, "stage_kind", "")) not in {
            "input_node",
            "StageKind.INPUT_NODE",
        }:
            continue
        config = getattr(stage, "config_json", None)
        if not isinstance(config, dict):
            continue
        entry = _entry_from_config(
            config, getattr(stage, "display_name", None)
        )
        if entry is not None:
            entries.append(entry)
    return InputSchemaResponse(
        rating_plan_id=rating_plan_id,
        count=len(entries),
        inputs=entries,
    )
