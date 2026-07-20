# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-scoped dimensions REST endpoints — D6.2 / ADR-0027.

Five endpoints mounted under `/api/v1/plans/{rating_plan_id}/dimensions`:

  GET    /                          — list every dim for the plan
  POST   /                          — create one dim (returns full record)
  PUT    /{dim_id}                  — upsert (idempotent on dim_id)
  DELETE /{dim_id}                  — remove (returns 204)
  POST   /bulk                      — atomic replace-all (migration path)

Mirrors the route-layer conventions in `plan_author_route.py`:
  · Dependency-injected `Database` via `_resolve_db(request)`
  · Service-raised `RaterError`s flow through the global handler
  · Pydantic request/response models, no manual JSON munging
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Header, Request, Response
from fastapi import Path as FPath

from openrater.errors import NotFoundError, StaleWriteError
from openrater.persistence import Database
from openrater.rates.dimensions import (
    ListDimensionsResponse,
    PlanDimension,
    UpsertDimensionRequest,
    bulk_upsert_dimensions,
    delete_dimension,
    dimensions_collection_hash,
    list_dimensions,
    upsert_dimension,
)
from openrater.rates.dimensions.models import BulkUpsertDimensionsRequest
from openrater.rates.plans.models import RatingPlan
from openrater.rates.plans.repo import get_plan
from openrater.rates.plans.state_machine import assert_plan_writable

router = APIRouter()


# ---------------------------------------------------------------
# Helpers (copies of plan_author_route.py utilities — keep this
# module standalone rather than reaching across routes)
# ---------------------------------------------------------------


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


def _require_plan_exists(db: Database, rating_plan_id: str) -> RatingPlan:
    """404 if the plan doesn't exist. Dim endpoints rely on FK
    cascade for cleanup, but we surface a clean 404 on writes rather
    than letting SQLite's FK violation bubble up as a 500.

    Returns the plan so callers that also gate on writability
    (`_require_writable_plan`) don't re-fetch."""
    plan = get_plan(db=db, rating_plan_id=rating_plan_id)
    if plan is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )
    return plan


def _require_writable_plan(
    db: Database, rating_plan_id: str, *, resource: str
) -> RatingPlan:
    """404 if the plan is absent, 409 if it isn't in a writable (DRAFT)
    state. A non-draft plan's rating definition — dims included — is
    immutable (defense in depth behind the rate-lab on-mount sync gate).
    Reads stay on `_require_plan_exists`."""
    return assert_plan_writable(
        _require_plan_exists(db, rating_plan_id), resource=resource
    )


# ---------------------------------------------------------------
# GET — list
# ---------------------------------------------------------------


@router.get(
    "/plans/{rating_plan_id}/dimensions",
    response_model=ListDimensionsResponse,
)
async def list_dimensions_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan whose dimensions to list.")
    ],
) -> ListDimensionsResponse:
    """List every dimension scoped to the plan, ordered by slug.

    Returns an empty `dimensions` array for plans that have no dims
    yet — NOT a 404. The plan itself must exist; an unknown plan
    returns 404 `plan_not_found`.
    """
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)
    dims = list_dimensions(db=db, rating_plan_id=rating_plan_id)
    return ListDimensionsResponse(
        rating_plan_id=rating_plan_id,
        dimensions=dims,
        collection_hash=dimensions_collection_hash(
            db=db, rating_plan_id=rating_plan_id
        ),
    )


# ---------------------------------------------------------------
# POST — create one dim
# ---------------------------------------------------------------


@router.post(
    "/plans/{rating_plan_id}/dimensions",
    response_model=PlanDimension,
    status_code=201,
)
async def create_dimension_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan to add the dimension to.")
    ],
    payload: Annotated[UpsertDimensionRequest, Body()],
) -> PlanDimension:
    """Insert a new dim. The route is idempotent — a POST with an
    existing dim_id replaces the row (same semantics as PUT). The
    distinct verb just signals intent + maps cleanly to a 201."""
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id, resource="dimensions")
    return upsert_dimension(
        db=db, rating_plan_id=rating_plan_id, req=payload
    )


# ---------------------------------------------------------------
# PUT — upsert
# ---------------------------------------------------------------


@router.put(
    "/plans/{rating_plan_id}/dimensions/{dim_id}",
    response_model=PlanDimension,
)
async def upsert_dimension_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan that owns the dimension.")
    ],
    dim_id: Annotated[str, FPath(description="The dimension id.")],
    payload: Annotated[UpsertDimensionRequest, Body()],
) -> PlanDimension:
    """Replace a dim by id. The body's `dim_id` MUST match the URL
    path — mismatches return 400 `dim_id_mismatch`."""
    db = _resolve_db(request)
    if payload.dim_id != dim_id:
        from openrater.errors import BadRequestError

        raise BadRequestError(
            f"Body dim_id {payload.dim_id!r} does not match URL {dim_id!r}.",
            code="dim_id_mismatch",
            hint="Set body.dim_id to the same value as the URL path.",
            param="dim_id",
        )
    _require_writable_plan(db, rating_plan_id, resource="dimensions")
    return upsert_dimension(
        db=db, rating_plan_id=rating_plan_id, req=payload
    )


# ---------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------


@router.delete(
    "/plans/{rating_plan_id}/dimensions/{dim_id}",
    status_code=204,
)
async def delete_dimension_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan that owns the dimension.")
    ],
    dim_id: Annotated[str, FPath(description="The dimension id.")],
) -> Response:
    """Remove one dim. Returns 204 on success, 404 if the dim wasn't
    found. The plan-existence check fires first so unknown-plan returns
    a clean `plan_not_found` rather than `dimension_not_found`."""
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id, resource="dimensions")
    deleted = delete_dimension(
        db=db, rating_plan_id=rating_plan_id, dim_id=dim_id
    )
    if not deleted:
        raise NotFoundError(
            f"Dimension {dim_id!r} not found in plan {rating_plan_id!r}.",
            code="dimension_not_found",
            param="dim_id",
        )
    return Response(status_code=204)


# ---------------------------------------------------------------
# POST /bulk — atomic replace-all
# ---------------------------------------------------------------


@router.post(
    "/plans/{rating_plan_id}/dimensions/bulk",
    response_model=ListDimensionsResponse,
)
async def bulk_upsert_dimensions_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan to bulk-replace dimensions for.")
    ],
    payload: Annotated[BulkUpsertDimensionsRequest, Body()],
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> ListDimensionsResponse:
    """Replace ALL dims for the plan with the supplied set, atomically.

    Used by the localStorage → API one-shot migration on first plan
    open (ADR-0027 §3). Also the seeding path for `/from-template`
    once D6.4 lands.

    v4 G14 — when `If-Match` is supplied it must equal the CURRENT
    `collection_hash`; a mismatch is 412 `stale_write` and nothing is
    written, so a second tab's replace-all can no longer silently
    destroy this one's work. Omitting the header keeps the
    unconditional behavior (scripts / seeds).

    Returns the new dim list (same shape as `GET /dimensions`).
    """
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id, resource="dimensions")
    if if_match is not None:
        current = dimensions_collection_hash(
            db=db, rating_plan_id=rating_plan_id
        )
        if if_match != current:
            raise StaleWriteError(
                "The plan's dimensions changed since you last loaded them "
                "(another tab or caller wrote in between). Nothing was "
                "saved — reload to continue from the latest state.",
                details={"current_hash": current, "supplied_hash": if_match},
            )
    dims = bulk_upsert_dimensions(
        db=db,
        rating_plan_id=rating_plan_id,
        reqs=payload.dimensions,
    )
    return ListDimensionsResponse(
        rating_plan_id=rating_plan_id,
        dimensions=dims,
        collection_hash=dimensions_collection_hash(
            db=db, rating_plan_id=rating_plan_id
        ),
    )
