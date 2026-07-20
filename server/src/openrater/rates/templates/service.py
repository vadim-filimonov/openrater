# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The /from-template materialization service.

Walks a template's recipe and writes every substrate via the existing
bulk endpoints — dimensions, factor tables (with cells), input
mapping, chain stages — so the new plan is fully populated before the
client even fetches it.

Each substrate write is delegated to its module's repo (no SQL here);
the service is pure orchestration. If a substrate-level error fires
mid-materialization the partial state is left in place — by design,
since substrates are independent and a half-built plan is recoverable
through the regular per-substrate edit endpoints. A future hardening
pass can wrap the whole materialization in a single transaction once
SQLite + the in-process bulk endpoints sync up.
"""

from __future__ import annotations

from typing import Any

from openrater.persistence.db import Database
from openrater.rates.dimensions import (
    UpsertDimensionRequest,
    bulk_upsert_dimensions,
)
from openrater.rates.factor_tables import (
    UpsertFactorTableRequest,
    bulk_upsert_factor_tables,
)
from openrater.rates.inputs_mapping import upsert_input_mapping
from openrater.rates.plans.author import add_stage_to_draft
from openrater.rates.plans.models import StageInput, StageKind, StageOutput
from openrater.rates.templates.models import MaterializedCounts


def materialize_from_template(
    *,
    db: Database,
    rating_plan_id: str,
    recipe: dict[str, Any],
) -> MaterializedCounts:
    """Apply every substrate in `recipe` to the plan. Returns the
    counts envelope the route surfaces in the response.

    Recipe keys:
      · dimensions    — list of UpsertDimensionRequest dicts
      · factor_tables — list of UpsertFactorTableRequest dicts
                        (cells inline per FT)
      · input_mapping — full PlanInputMapping envelope or null
      · chain_stages  — reserved for future enrichment (no-op today;
                        chains are still authored client-side after
                        materialization)
    """
    counts = {
        "dimensions": 0,
        "factor_tables": 0,
        "chain_stages": 0,
        "has_input_mapping": False,
    }

    # --- dimensions ---------------------------------------------------
    dims_raw = recipe.get("dimensions") or []
    if dims_raw:
        dim_reqs = [UpsertDimensionRequest.model_validate(d) for d in dims_raw]
        bulk_upsert_dimensions(
            db=db, rating_plan_id=rating_plan_id, reqs=dim_reqs
        )
        counts["dimensions"] = len(dim_reqs)

    # --- factor tables (+ inline cells) -------------------------------
    fts_raw = recipe.get("factor_tables") or []
    if fts_raw:
        ft_reqs = [
            UpsertFactorTableRequest.model_validate(t) for t in fts_raw
        ]
        bulk_upsert_factor_tables(
            db=db, rating_plan_id=rating_plan_id, reqs=ft_reqs
        )
        counts["factor_tables"] = len(ft_reqs)

    # --- input mapping ------------------------------------------------
    mapping = recipe.get("input_mapping")
    if mapping is not None:
        upsert_input_mapping(
            db=db, rating_plan_id=rating_plan_id, mapping=mapping
        )
        counts["has_input_mapping"] = True

    # --- chain stages -------------------------------------------------
    # Walks the recipe's `chain_stages` and POSTs each via the existing
    # `add_stage_to_draft` repo function (same path the /drafts/.../
    # stages REST endpoint uses). Stages append in recipe order with
    # `insert_after_stage_id="$last"` so the cascade sequence reflects
    # the recipe's intent.
    #
    # Each entry validates via `parse_stage_config` inside
    # `add_stage_to_draft` — a malformed stage raises a PlanValidationError
    # that bubbles up to the route + becomes a structured 422. A failure
    # mid-list leaves the previously-added stages in place; consistent
    # with the per-substrate independence the docstring spells out.
    chain_stages = recipe.get("chain_stages") or []
    if chain_stages:
        for entry in chain_stages:
            if not isinstance(entry, dict):
                continue
            stage_id = str(entry.get("stage_id", "")).strip()
            stage_kind_raw = str(entry.get("stage_kind", "")).strip()
            display_name = str(entry.get("display_name", "")).strip()
            if not stage_id or not stage_kind_raw or not display_name:
                # Recipe authoring error — log + skip rather than 500.
                # Templates are dev-curated; a missing field surfaces
                # at boot via the seeder's pydantic validation today.
                continue
            stage_kind = StageKind(stage_kind_raw)
            config_json = entry.get("config_json") or {}
            inputs_raw = entry.get("inputs") or []
            outputs_raw = entry.get("outputs") or []
            inputs = [StageInput.model_validate(i) for i in inputs_raw]
            outputs = [StageOutput.model_validate(o) for o in outputs_raw]
            add_stage_to_draft(
                db=db,
                draft_plan_id=rating_plan_id,
                stage_id=stage_id,
                stage_kind=stage_kind,
                display_name=display_name,
                config_json=config_json,
                insert_after_stage_id="$last",
                citation_rule=entry.get("citation_rule"),
                citation_page=entry.get("citation_page"),
                inputs=inputs,
                outputs=outputs,
            )
        counts["chain_stages"] = len(chain_stages)

    return MaterializedCounts(**counts)
