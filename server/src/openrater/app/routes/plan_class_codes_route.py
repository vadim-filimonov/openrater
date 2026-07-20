# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-scoped class-code registry REST endpoints — Brief 51.

Five endpoints mounted under `/api/v1/plans/{rating_plan_id}/class-codes`:

  GET    /                          — list every class for the plan
  POST   /                          — create one class (returns full record)
  PUT    /{class_code}              — upsert (idempotent on class_code)
  DELETE /{class_code}              — remove (returns 204)
  POST   /bulk                      — import a class table (merge | replace)

Mirrors the route-layer conventions in `plan_dimensions_route.py`:
  · Dependency-injected `Database` via `_resolve_db(request)`
  · Service-raised `RaterError`s flow through the global handler
  · Pydantic request/response models, no manual JSON munging
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Request, Response
from fastapi import Path as FPath

from openrater.errors import BadRequestError, NotFoundError
from openrater.persistence import Database
from openrater.rates.class_codes import (
    BulkImportClassCodesRequest,
    BulkImportClassCodesResponse,
    ListClassCodesResponse,
    PlanClassCode,
    UpsertClassCodeRequest,
    bulk_import_class_codes,
    delete_class_code,
    list_class_codes,
    upsert_class_code,
)
from openrater.rates.plans.models import RatingPlan
from openrater.rates.plans.repo import get_plan
from openrater.rates.plans.state_machine import assert_plan_writable

router = APIRouter()


# ---------------------------------------------------------------
# Helpers (standalone copies — keep this module independent of
# plan_author_route.py / plan_dimensions_route.py)
# ---------------------------------------------------------------


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


def _require_plan_exists(db: Database, rating_plan_id: str) -> RatingPlan:
    """404 if the plan doesn't exist. Class endpoints rely on FK cascade
    for cleanup, but we surface a clean 404 on writes rather than letting
    SQLite's FK violation bubble up as a 500. Reads use this directly."""
    plan = get_plan(db=db, rating_plan_id=rating_plan_id)
    if plan is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )
    return plan


def _require_writable_plan(db: Database, rating_plan_id: str) -> RatingPlan:
    """404 if absent, 409 if the plan isn't in a writable (DRAFT) state.
    A plan's class registry is part of its rating definition and is
    immutable once it leaves DRAFT — the four sibling child-resource
    families (dimensions/factor-tables/inputs-mapping/policy-tail) already
    enforce this, but class-codes did NOT, so a bulk `mode=replace` wiped
    the entire registry of an archived plan (audit A-2026-07-12 P1-05).
    Reads stay on `_require_plan_exists`."""
    return assert_plan_writable(
        _require_plan_exists(db, rating_plan_id), resource="class-codes"
    )


# ---------------------------------------------------------------
# GET — list
# ---------------------------------------------------------------


@router.get(
    "/plans/{rating_plan_id}/class-codes",
    response_model=ListClassCodesResponse,
)
async def list_class_codes_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan whose class registry to list.")
    ],
) -> ListClassCodesResponse:
    """List every class scoped to the plan, ordered by class_code.

    Returns an empty `class_codes` array for plans with no classes yet —
    NOT a 404. The plan itself must exist; an unknown plan returns 404
    `plan_not_found`.
    """
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)  # reads work on any state
    classes = list_class_codes(db=db, rating_plan_id=rating_plan_id)
    return ListClassCodesResponse(
        rating_plan_id=rating_plan_id,
        class_codes=classes,
    )


# ---------------------------------------------------------------
# POST — create one class
# ---------------------------------------------------------------


@router.post(
    "/plans/{rating_plan_id}/class-codes",
    response_model=PlanClassCode,
    status_code=201,
)
async def create_class_code_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan to add the class to.")
    ],
    payload: Annotated[UpsertClassCodeRequest, Body()],
) -> PlanClassCode:
    """Insert a new class. Idempotent — a POST with an existing class_code
    replaces the row (same semantics as PUT). The distinct verb signals
    intent + maps cleanly to a 201."""
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id)
    return upsert_class_code(db=db, rating_plan_id=rating_plan_id, req=payload)


# ---------------------------------------------------------------
# POST /bulk — import a class table
#
# Declared before the `/{class_code}` routes so "bulk" can never be
# mistaken for a class_code path param.
# ---------------------------------------------------------------


@router.post(
    "/plans/{rating_plan_id}/class-codes/bulk",
    response_model=BulkImportClassCodesResponse,
)
async def bulk_import_class_codes_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan to import classes into.")
    ],
    payload: Annotated[BulkImportClassCodesRequest, Body()],
) -> BulkImportClassCodesResponse:
    """Import a class table. `mode='merge'` (default) upserts each provided
    class, preserving others; `mode='replace'` clears the plan's classes
    first. The whole batch is one transaction.

    This is the acceptance path for loading a real filing's class table
    (Brief 51 §−1 Q3) — the frontend parses a header-keyed CSV into
    `classes[]` and posts it here.
    """
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id)
    classes = bulk_import_class_codes(
        db=db,
        rating_plan_id=rating_plan_id,
        reqs=payload.classes,
        mode=payload.mode,
    )
    return BulkImportClassCodesResponse(
        rating_plan_id=rating_plan_id,
        imported=len(payload.classes),
        mode=payload.mode,
        class_codes=classes,
    )


# ---------------------------------------------------------------
# PUT — upsert
# ---------------------------------------------------------------


@router.put(
    "/plans/{rating_plan_id}/class-codes/{class_code}",
    response_model=PlanClassCode,
)
async def upsert_class_code_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan that owns the class.")
    ],
    class_code: Annotated[str, FPath(description="The class code.")],
    payload: Annotated[UpsertClassCodeRequest, Body()],
) -> PlanClassCode:
    """Replace a class by code. The body's `class_code` MUST match the URL
    path — mismatches return 400 `class_code_mismatch`."""
    db = _resolve_db(request)
    if payload.class_code != class_code:
        raise BadRequestError(
            f"Body class_code {payload.class_code!r} does not match URL "
            f"{class_code!r}.",
            code="class_code_mismatch",
            hint="Set body.class_code to the same value as the URL path.",
            param="class_code",
        )
    _require_writable_plan(db, rating_plan_id)
    return upsert_class_code(db=db, rating_plan_id=rating_plan_id, req=payload)


# ---------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------


@router.delete(
    "/plans/{rating_plan_id}/class-codes/{class_code}",
    status_code=204,
)
async def delete_class_code_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan that owns the class.")
    ],
    class_code: Annotated[str, FPath(description="The class code.")],
) -> Response:
    """Remove one class. Returns 204 on success, 404 if the class wasn't
    found. The plan-existence check fires first so unknown-plan returns a
    clean `plan_not_found` rather than `class_code_not_found`."""
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id)
    deleted = delete_class_code(
        db=db, rating_plan_id=rating_plan_id, class_code=class_code
    )
    if not deleted:
        raise NotFoundError(
            f"Class {class_code!r} not found in plan {rating_plan_id!r}.",
            code="class_code_not_found",
            param="class_code",
        )
    return Response(status_code=204)
