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
  GET  /{run_id}/rows.csv — the whole run as ONE downloadable CSV
                        (FCA #S2: the take-away spreadsheet used to be
                        assembled by hand from per-row quote calls) —
                        the caller's own source columns lead each row,
                        so PolicyNbr survives to the deliverable

Runs are append-only and NOT draft-gated: running a frozen/published
plan is the point. Mirrors `plan_policy_tail_route.py` conventions.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Query, Request, Response
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
from openrater.rates.runs.compare import RunCompare, compare_runs
from openrater.rates.runs.service import collect_run_rows

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


@router.get(
    "/plans/{rating_plan_id}/runs/{run_id}/compare",
    response_model=RunCompare,
    tags=["plan-runs"],
)
def get_plan_run_compare(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
    run_id: str = FPath(..., min_length=1),
    with_run: str = Query(..., min_length=1),
    with_plan: str | None = Query(default=None, min_length=1),
) -> RunCompare:
    """FCA #28 (finding 78) — the two-run compare: per-row deltas
    joined on the caller's own identifier column, totals, movers,
    refusal changes. `with_plan` reaches across plans (the same book
    through two plans — the rate-committee question); it defaults to
    this plan (before/after on one plan)."""
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)
    other_plan = with_plan or rating_plan_id
    if other_plan != rating_plan_id:
        _require_plan_exists(db, other_plan)
    return compare_runs(
        db=db,
        rating_plan_id=rating_plan_id,
        run_id=run_id,
        with_plan_id=other_plan,
        with_run_id=with_run,
    )


@router.get(
    "/plans/{rating_plan_id}/runs/{run_id}/rows.csv",
    tags=["plan-runs"],
)
def get_plan_run_rows_csv(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
    run_id: str = FPath(..., min_length=1),
) -> Response:
    """FCA fca-2026-07-25 (#S2 — no export anywhere): the whole run as
    one CSV. Column order: `row`, the caller's own SOURCE columns
    (verbatim from the submitted book, so PolicyNbr-style identifiers
    survive to the deliverable), the projected rating inputs that
    aren't already source columns, then premium / tier / row_status /
    first_issue. Pages the whole run from the scoring result store."""
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)
    rows = collect_run_rows(db=db, rating_plan_id=rating_plan_id, run_id=run_id)

    def keys_of(field: str) -> list[str]:
        seen: dict[str, None] = {}
        for r in rows:
            bag = r.get(field)
            if isinstance(bag, dict):
                for k in bag:
                    seen.setdefault(str(k), None)
        return list(seen)

    source_keys = keys_of("source")
    input_keys = keys_of("inputs")
    # A projected input that duplicates a source column adds nothing —
    # the source cell IS the value the caller knows it by.
    source_set = {k.lower() for k in source_keys}
    input_cols = [k for k in input_keys if k.lower() not in source_set]

    import csv as _csv
    import io

    buf = io.StringIO()
    writer = _csv.writer(buf)
    writer.writerow(
        ["row", *source_keys, *input_cols, "premium", "tier", "row_status", "first_issue"]
    )
    for i, r in enumerate(rows):
        source = r.get("source") if isinstance(r.get("source"), dict) else {}
        inputs = r.get("inputs") if isinstance(r.get("inputs"), dict) else {}
        views = r.get("views") if isinstance(r.get("views"), dict) else {}
        issues = r.get("rowIssues") if isinstance(r.get("rowIssues"), list) else []
        first_issue = next(
            (
                str(x.get("message"))
                for x in issues
                if isinstance(x, dict) and x.get("severity") == "error"
            ),
            "",
        )
        writer.writerow(
            [
                i + 1,
                *[source.get(k, "") for k in source_keys],
                *[inputs.get(k, "") for k in input_cols],
                views.get("premium", ""),
                views.get("tier", ""),
                r.get("row_status", ""),
                first_issue,
            ]
        )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{rating_plan_id}-{run_id}-rows.csv"'
            )
        },
    )
