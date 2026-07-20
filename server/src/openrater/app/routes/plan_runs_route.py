# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-run REST endpoints — Brief 75 (v4 P3, the Run zone).

Mounted under `/api/v1/plans/{rating_plan_id}/runs`:

  POST /            — execute + persist a run (sample sync; book and
                      probe async — Brief 89 §3.2 B3 adds `kind:probe`,
                      the plan sweeping its own variable space)
  GET  /            — newest-first run summaries (?limit=&kind=&status=)
  GET  /{run_id}    — full run detail (lazily finalizes book/probe runs)
  GET  /{run_id}/rows — a DONE book/probe run's per-row results page
                        (?offset=&limit= — projected inputs + outputs +
                        verdict, relayed from the scoring result store)

Runs are append-only and NOT draft-gated: running a frozen/published
plan is the point. Mirrors `plan_policy_tail_route.py` conventions.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Query, Request
from fastapi import Path as FPath

from openrater.errors import NotFoundError
from openrater.persistence import Database
from openrater.rates.plans.repo import get_plan
from openrater.rates.runs import (
    CreateRunRequest,
    PlanRun,
    PlanRunList,
    create_run,
    get_run_rows,
    list_runs,
    refresh_run,
)

router = APIRouter()


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


def _require_plan_exists(db: Database, rating_plan_id: str) -> None:
    if get_plan(db=db, rating_plan_id=rating_plan_id) is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )


@router.post(
    "/plans/{rating_plan_id}/runs",
    response_model=PlanRun,
    status_code=201,
    tags=["plan-runs"],
)
def create_plan_run(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
    body: CreateRunRequest = Body(...),
) -> PlanRun:
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)
    return create_run(db=db, rating_plan_id=rating_plan_id, request=body)


@router.get(
    "/plans/{rating_plan_id}/runs",
    response_model=PlanRunList,
    tags=["plan-runs"],
)
def list_plan_runs(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    kind: str | None = Query(default=None, pattern="^(sample|book|probe)$"),
    status: str | None = Query(default=None, pattern="^(running|done|error)$"),
) -> PlanRunList:
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)
    return PlanRunList(
        runs=list_runs(
            db=db,
            rating_plan_id=rating_plan_id,
            limit=limit,
            kind=kind,
            status=status,
        )
    )


@router.get(
    "/plans/{rating_plan_id}/runs/{run_id}",
    response_model=PlanRun,
    tags=["plan-runs"],
)
def get_plan_run(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
    run_id: str = FPath(..., min_length=1),
) -> PlanRun:
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)
    # Brief 75 D-E — a running book run lazily finalizes from its
    # scoring job on read.
    run = refresh_run(db=db, rating_plan_id=rating_plan_id, run_id=run_id)
    if run is None:
        raise NotFoundError(
            f"Run {run_id!r} not found on plan {rating_plan_id!r}.",
            code="run_not_found",
            param="run_id",
        )
    return run


@router.get(
    "/plans/{rating_plan_id}/runs/{run_id}/rows",
    tags=["plan-runs"],
)
def get_plan_run_rows(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
    run_id: str = FPath(..., min_length=1),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
) -> dict:
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)
    return get_run_rows(
        db=db,
        rating_plan_id=rating_plan_id,
        run_id=run_id,
        offset=offset,
        limit=limit,
    )
