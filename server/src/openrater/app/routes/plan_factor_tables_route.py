# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-scoped factor tables + cells REST endpoints — D6.3 / ADR-0027.

Six endpoints mounted under `/api/v1/plans/{rating_plan_id}/factor-tables`:

  GET    /                          — list every FT (with cells inlined)
  POST   /                          — create one FT (returns full record)
  PUT    /{table_id}                — upsert (idempotent on table_id)
  DELETE /{table_id}                — remove (returns 204; cells cascade)
  PUT    /{table_id}/cells          — replace-all cells without touching meta
  POST   /bulk                      — atomic replace-all (migration path)

Mirrors the route-layer conventions in `plan_dimensions_route.py`:
  · Dependency-injected `Database` via `_resolve_db(request)`
  · Service-raised `RaterError`s flow through the global handler
  · Pydantic request/response models, no manual JSON munging
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Header, Request, Response
from fastapi import Path as FPath

from openrater.errors import BadRequestError, NotFoundError, StaleWriteError
from openrater.persistence import Database
from openrater.rates.factor_tables import (
    ListFactorTablesResponse,
    PlanFactorTable,
    UpsertFactorTableCellsRequest,
    UpsertFactorTableRequest,
    bulk_upsert_factor_tables,
    delete_factor_table,
    factor_tables_collection_hash,
    list_factor_tables,
    upsert_factor_table,
    upsert_factor_table_cells,
)
from openrater.rates.factor_tables.models import BulkUpsertFactorTablesRequest
from openrater.rates.plans.models import RatingPlan
from openrater.rates.plans.repo import get_plan
from openrater.rates.plans.state_machine import assert_plan_writable

router = APIRouter()


# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


def _require_plan_exists(db: Database, rating_plan_id: str) -> RatingPlan:
    """404 if the plan doesn't exist. Mirrors the dimension route
    convention — clean 404 before SQLite's FK violation can bubble.

    Returns the plan so `_require_writable_plan` doesn't re-fetch."""
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
    state. A non-draft plan's factor tables (and their cells) are immutable
    — defense in depth behind the rate-lab on-mount sync gate. Reads stay
    on `_require_plan_exists`."""
    return assert_plan_writable(
        _require_plan_exists(db, rating_plan_id), resource=resource
    )


# ---------------------------------------------------------------
# GET — list
# ---------------------------------------------------------------


@router.get(
    "/plans/{rating_plan_id}/factor-tables",
    response_model=ListFactorTablesResponse,
)
async def list_factor_tables_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan whose factor tables to list.")
    ],
) -> ListFactorTablesResponse:
    """List every factor table (with cells inlined) for the plan,
    ordered by slug. Returns an empty `factor_tables` array for plans
    that have no FTs yet — NOT a 404. The plan itself must exist; an
    unknown plan returns 404 `plan_not_found`.
    """
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)
    tables = list_factor_tables(db=db, rating_plan_id=rating_plan_id)
    return ListFactorTablesResponse(
        rating_plan_id=rating_plan_id,
        factor_tables=tables,
        collection_hash=factor_tables_collection_hash(
            db=db, rating_plan_id=rating_plan_id
        ),
    )


# ---------------------------------------------------------------
# POST — create one FT
# ---------------------------------------------------------------


@router.post(
    "/plans/{rating_plan_id}/factor-tables",
    response_model=PlanFactorTable,
    status_code=201,
)
async def create_factor_table_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan to add the factor table to.")
    ],
    payload: Annotated[UpsertFactorTableRequest, Body()],
) -> PlanFactorTable:
    """Insert a new FT. Like the dim route, idempotent on table_id —
    a POST with an existing table_id replaces metadata + (if cells
    present) cells. The verb distinction maps cleanly to a 201."""
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id, resource="factor_tables")
    return upsert_factor_table(
        db=db, rating_plan_id=rating_plan_id, req=payload
    )


# ---------------------------------------------------------------
# PUT — upsert
# ---------------------------------------------------------------


@router.put(
    "/plans/{rating_plan_id}/factor-tables/{table_id}",
    response_model=PlanFactorTable,
)
async def upsert_factor_table_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan that owns the factor table.")
    ],
    table_id: Annotated[str, FPath(description="The factor table id.")],
    payload: Annotated[UpsertFactorTableRequest, Body()],
) -> PlanFactorTable:
    """Replace a factor table by id. The body's `table_id` MUST match
    the URL path — mismatches return 400 `table_id_mismatch`."""
    db = _resolve_db(request)
    if payload.table_id != table_id:
        raise BadRequestError(
            f"Body table_id {payload.table_id!r} does not match URL {table_id!r}.",
            code="table_id_mismatch",
            hint="Set body.table_id to the same value as the URL path.",
            param="table_id",
        )
    _require_writable_plan(db, rating_plan_id, resource="factor_tables")
    return upsert_factor_table(
        db=db, rating_plan_id=rating_plan_id, req=payload
    )


def _require_lawful_factors(cells: dict) -> None:
    """R-107 at the edit seam: every factor finite and positive."""
    import math

    from openrater.errors import ValidationError

    for key, value in cells.items():
        bad = (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(float(value))
            or float(value) <= 0
        )
        if bad:
            raise ValidationError(
                f"Factor {value!r} for cell '{key}' isn't a lawful factor "
                "— factors are finite and positive (R-107), exactly as "
                "the workbook check enforces.",
                code="factor_out_of_range",
                param=str(key),
            )


# ---------------------------------------------------------------
# PUT /cells — replace-all cells only
# ---------------------------------------------------------------


@router.put(
    "/plans/{rating_plan_id}/factor-tables/{table_id}/cells",
    response_model=PlanFactorTable,
)
async def upsert_factor_table_cells_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan that owns the factor table.")
    ],
    table_id: Annotated[str, FPath(description="The factor table id.")],
    payload: Annotated[UpsertFactorTableCellsRequest, Body()],
) -> PlanFactorTable:
    """Replace the cell map for one factor table, atomically. Metadata
    is untouched. Returns 404 `factor_table_not_found` if the FT
    doesn't exist."""
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id, resource="factor_tables")
    # Drift tracking: the edit path shares the workbook's cell
    # law (R-107 — factors finite and positive). The workbook check
    # would refuse these; the editor must not be the door around it.
    _require_lawful_factors(payload.cells)
    try:
        return upsert_factor_table_cells(
            db=db,
            rating_plan_id=rating_plan_id,
            table_id=table_id,
            cells=payload.cells,
        )
    except LookupError as err:
        raise NotFoundError(
            str(err),
            code="factor_table_not_found",
            param="table_id",
        ) from err


# ---------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------


@router.delete(
    "/plans/{rating_plan_id}/factor-tables/{table_id}",
    status_code=204,
)
async def delete_factor_table_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan that owns the factor table.")
    ],
    table_id: Annotated[str, FPath(description="The factor table id.")],
) -> Response:
    """Remove one factor table (cells cascade). Returns 204 on success,
    404 if the FT wasn't found. The plan-existence check fires first
    so unknown-plan returns `plan_not_found` rather than
    `factor_table_not_found`."""
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id, resource="factor_tables")
    deleted = delete_factor_table(
        db=db, rating_plan_id=rating_plan_id, table_id=table_id
    )
    if not deleted:
        raise NotFoundError(
            f"Factor table {table_id!r} not found in plan {rating_plan_id!r}.",
            code="factor_table_not_found",
            param="table_id",
        )
    return Response(status_code=204)


# ---------------------------------------------------------------
# POST /bulk — atomic replace-all
# ---------------------------------------------------------------


@router.post(
    "/plans/{rating_plan_id}/factor-tables/bulk",
    response_model=ListFactorTablesResponse,
)
async def bulk_upsert_factor_tables_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str,
        FPath(description="The plan to bulk-replace factor tables for."),
    ],
    payload: Annotated[BulkUpsertFactorTablesRequest, Body()],
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> ListFactorTablesResponse:
    """Replace ALL FTs (and their cells) for the plan with the supplied
    set, atomically. Used by the localStorage → API one-shot migration
    on first plan open (ADR-0027 §3) and the future `/from-template`
    endpoint (D6.4). Returns the new FT list (same shape as
    `GET /factor-tables`).

    v4 G14 — when `If-Match` is supplied it must equal the CURRENT
    `collection_hash`; a mismatch is 412 `stale_write` and nothing is
    written. Omitting the header keeps the unconditional behavior
    (scripts / seeds).
    """
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id, resource="factor_tables")
    if if_match is not None:
        current = factor_tables_collection_hash(
            db=db, rating_plan_id=rating_plan_id
        )
        if if_match != current:
            raise StaleWriteError(
                "The plan's factor tables changed since you last loaded "
                "them (another tab or caller wrote in between). Nothing "
                "was saved — reload to continue from the latest state.",
                details={"current_hash": current, "supplied_hash": if_match},
            )
    tables = bulk_upsert_factor_tables(
        db=db,
        rating_plan_id=rating_plan_id,
        reqs=payload.factor_tables,
    )
    return ListFactorTablesResponse(
        rating_plan_id=rating_plan_id,
        factor_tables=tables,
        collection_hash=factor_tables_collection_hash(
            db=db, rating_plan_id=rating_plan_id
        ),
    )
