# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for plan templates + the /from-template endpoint.

The `recipe` is the full materialization payload — each top-level key
maps 1:1 to an existing bulk-write endpoint:

  recipe = {
    "dimensions":    [<UpsertDimensionRequest>...],
    "factor_tables": [<UpsertFactorTableRequest>...],  // cells inlined
    "input_mapping": <PlanInputMapping or null>,
    "chain_stages":  [<AddStageRequest>...]              // optional
  }

We type the recipe as a flexible `dict` so the per-substrate Pydantic
models (which already live in their own modules) own the validation
at the materialization site, not here. This keeps templates a thin
orchestration layer + lets dim/FT/mapping shape evolution flow into
templates for free.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------
# Template row shapes
# ---------------------------------------------------------------


class PlanTemplateSummary(BaseModel):
    """Light shape for the gallery listing — metadata + counts; no
    recipe blob. Drives the cards on `/plans/new`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    template_id: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    line_of_business: str = Field(..., min_length=1, max_length=40)
    coverages: list[str] = Field(default_factory=list)
    """Additional LOBs the template materializes alongside the primary.
    Empty for single-LOB templates."""

    # Derived counts so the gallery card can show "7 dims · 11 FTs · 2 chains"
    # without pulling the full recipe.
    dim_count: int = Field(default=0, ge=0)
    factor_table_count: int = Field(default=0, ge=0)
    chain_stage_count: int = Field(default=0, ge=0)
    has_input_mapping: bool = False

    created_at: str = Field(..., min_length=1)
    updated_at: str = Field(..., min_length=1)


class PlanTemplate(PlanTemplateSummary):
    """Full template — summary fields plus the recipe blob. Returned
    by `GET /api/v1/plan-templates/{template_id}` for preview / debug.
    The /from-template endpoint reads this server-side; the gallery
    UI doesn't need to fetch the recipe to render cards."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    recipe: dict[str, Any]


class UpsertTemplateRequest(BaseModel):
    """Body for the seeder + (future) admin upsert. Not exposed via
    a public REST endpoint today — templates are bundled JSON files
    that the lifespan upserts at boot. The model lives here so the
    seeder + a future admin route share validation."""

    model_config = ConfigDict(extra="forbid")

    template_id: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    line_of_business: str = Field(..., min_length=1, max_length=40)
    coverages: list[str] = Field(default_factory=list)
    recipe: dict[str, Any]


# ---------------------------------------------------------------
# /from-template request + response
# ---------------------------------------------------------------


class FromTemplateRequest(BaseModel):
    """Body for `POST /api/v1/plans/from-template`."""

    model_config = ConfigDict(extra="forbid")

    template_id: str = Field(..., min_length=1, max_length=80)
    display_name: str = Field(..., min_length=1, max_length=200)
    jurisdiction: str | None = Field(default=None, max_length=4)
    effective_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    description: str | None = Field(default=None, max_length=2000)


class MaterializedCounts(BaseModel):
    """How many entities the /from-template call wrote, per substrate.
    Useful for client-side toasts ("Materialized 7 dims, 11 factor
    tables, 2 chains") + smoke-test assertions."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    dimensions: int = 0
    factor_tables: int = 0
    chain_stages: int = 0
    has_input_mapping: bool = False


class FromTemplateResponse(BaseModel):
    """Response for `POST /api/v1/plans/from-template`.

    Returns the new plan id (the client navigates to it) + a
    materialized-counts envelope (the toast). Returning the full
    PlanDetail would double the response size; the client fetches
    it on navigation anyway.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rating_plan_id: str
    template_id: str
    materialized: MaterializedCounts


# ---------------------------------------------------------------
# Listing response
# ---------------------------------------------------------------


class ListTemplatesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    templates: list[PlanTemplateSummary]
