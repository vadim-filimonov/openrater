# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Quote REST endpoint — Brief 76 (v4 P4, the Ship zone's API path).

  POST /api/v1/plans/{plan_id}/quote   → un-persisted single-risk quote

By default the quote is scored against the plan's PUBLISHED snapshot (the
version of record, D-B); `?snapshot_id=` targets a specific frozen version
and `?draft=true` previews the working draft. The response is the composed
FILED premium + the ADR-0056 tri-facet + which version answered.

The COMPUTE path writes nothing (D-A stands — same bytes in, same bytes out).
A passive forensic ledger row IS recorded post-response (ADR-0058), off the
response path and best-effort — it can neither slow nor fail the quote, and
the quote path never reads it back.

Auth is OPTIONAL (D-D): open by default (OSS/dev), gated by a per-plan
API key when `RATER_QUOTE_REQUIRE_KEY` is set — an external caller
then sends the key as `X-API-Key`, while the in-app try-it passes on its
authenticated operator session.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Body, Header, Query, Request
from fastapi import Path as FPath

from openrater.auth import is_operator_authenticated
from openrater.errors import NotFoundError
from openrater.persistence import Database
from openrater.rates.api_keys import authorize_quote
from openrater.rates.plans.repo import get_plan
from openrater.rates.quotes import QuoteRequest, QuoteResponse, quote_plan
from openrater.rates.quotes.ledger import record_owner_quote

router = APIRouter()


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


@router.post(
    "/plans/{rating_plan_id}/quote",
    response_model=QuoteResponse,
    tags=["quotes"],
)
def create_quote(
    request: Request,
    background_tasks: BackgroundTasks,
    rating_plan_id: str = FPath(..., min_length=1),
    body: QuoteRequest = Body(...),
    snapshot_id: str | None = Query(default=None),
    draft: bool = Query(default=False),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> QuoteResponse:
    db = _resolve_db(request)
    if get_plan(db=db, rating_plan_id=rating_plan_id) is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )
    # The optional gate (D-D). No-op unless RATER_QUOTE_REQUIRE_KEY;
    # then a valid key or an authenticated session is mandatory.
    authorize_quote(
        db=db,
        rating_plan_id=rating_plan_id,
        presented_key=x_api_key,
        operator_authenticated=is_operator_authenticated(),
    )
    response = quote_plan(
        db=db,
        rating_plan_id=rating_plan_id,
        request=body,
        snapshot_id=snapshot_id,
        draft=draft,
    )
    # ADR-0058 — the passive quote ledger. Scheduled post-response: it never
    # slows the quote, its failure never fails the quote, and `quote_plan`
    # above still writes nothing (D-A stands for the compute path).
    record_owner_quote(
        db=db,
        background_tasks=background_tasks,
        rating_plan_id=rating_plan_id,
        request=body,
        response=response,
    )
    return response
