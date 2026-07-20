# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan templates REST endpoints — D6.4 / ADR-0027.

Three endpoints:

  GET    /api/v1/plan-templates                — list (gallery card data)
  GET    /api/v1/plan-templates/{template_id}  — full recipe (preview/debug)
  POST   /api/v1/plans/from-template           — materialize a new plan

The CRUD endpoints are read-only — templates are server-owned and
seeded from bundled JSON files (see `rates/templates/seed.py`). The
/from-template endpoint is where the action happens: walks the recipe
and writes every substrate via the existing bulk endpoints.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Request
from fastapi import Path as FPath

from openrater.auth import current_operator
from openrater.errors import NotFoundError
from openrater.persistence import Database
from openrater.rates.plans.author import (
    CreatePlanTemplate,
    create_plan,
)
from openrater.rates.plans.models import LineOfBusiness
from openrater.rates.templates import (
    FromTemplateRequest,
    FromTemplateResponse,
    ListTemplatesResponse,
    PlanTemplate,
    get_template,
    list_templates,
    materialize_from_template,
)

router = APIRouter()


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


# ---------------------------------------------------------------
# GET /plan-templates — list
# ---------------------------------------------------------------


@router.get(
    "/plan-templates",
    response_model=ListTemplatesResponse,
)
async def list_templates_endpoint(
    request: Request,
) -> ListTemplatesResponse:
    """List every available template (gallery card data — no recipe
    blob). Empty list if nothing seeded yet."""
    db = _resolve_db(request)
    return ListTemplatesResponse(templates=list_templates(db=db))


# ---------------------------------------------------------------
# GET /plan-templates/{template_id} — full recipe
# ---------------------------------------------------------------


@router.get(
    "/plan-templates/{template_id}",
    response_model=PlanTemplate,
)
async def get_template_endpoint(
    request: Request,
    template_id: Annotated[
        str, FPath(description="The template id (e.g. 'nonprofit_990').")
    ],
) -> PlanTemplate:
    """Fetch one template with the full recipe — useful for client-side
    preview ("here's what this will create") and tests. The
    /from-template materializer reads server-side so the client
    doesn't strictly need this endpoint."""
    db = _resolve_db(request)
    template = get_template(db=db, template_id=template_id)
    if template is None:
        raise NotFoundError(
            f"Template {template_id!r} not found.",
            code="template_not_found",
            param="template_id",
        )
    return template


# ---------------------------------------------------------------
# POST /plans/from-template — materialize
# ---------------------------------------------------------------


@router.post(
    "/plans/from-template",
    response_model=FromTemplateResponse,
    status_code=201,
)
async def create_plan_from_template_endpoint(
    request: Request,
    payload: Annotated[FromTemplateRequest, Body()],
) -> FromTemplateResponse:
    """Create a new plan + populate its dims, factor tables, input
    mapping (and eventually chain stages) from a template recipe in
    one round trip.

    Two-step under the hood:
      1. Resolve the template → 404 `template_not_found` if missing.
      2. `create_plan(template="blank")` to mint the plan row, then
         walk the recipe via `materialize_from_template`.

    Templates are LOB-tagged (the recipe's primary `line_of_business`)
    so the client doesn't have to redundantly pass it — we use the
    template's LOB as the source of truth.
    """
    db = _resolve_db(request)

    # Resolve the template up front so a typo'd id returns 404 BEFORE
    # we mint a plan row that would otherwise become orphaned.
    template = get_template(db=db, template_id=payload.template_id)
    if template is None:
        raise NotFoundError(
            f"Template {payload.template_id!r} not found.",
            code="template_not_found",
            param="template_id",
        )

    # Mint the plan with template=BLANK — the recipe materialization
    # below handles all substrate population.
    #
    # Stamp the template id + the recipe's coverages list on the
    # plan row via the override params (closes D6 loose-end #5: plans
    # know which template they came from; loose-end #3: multi-LOB
    # coverages are now API-persisted, no more localStorage-only tag).
    lob = LineOfBusiness(template.line_of_business)
    new_plan = create_plan(
        db=db,
        display_name=payload.display_name,
        line_of_business=lob,
        jurisdiction=payload.jurisdiction,
        effective_date=payload.effective_date,
        template=CreatePlanTemplate.BLANK,
        description=payload.description,
        operator_id=current_operator(),
        template_id_override=template.template_id,
        coverages_override=(
            tuple(template.coverages) if template.coverages else None
        ),
    )

    # Walk the recipe → bulk-write each substrate.
    counts = materialize_from_template(
        db=db,
        rating_plan_id=new_plan.rating_plan_id,
        recipe=template.recipe,
    )

    return FromTemplateResponse(
        rating_plan_id=new_plan.rating_plan_id,
        template_id=payload.template_id,
        materialized=counts,
    )
