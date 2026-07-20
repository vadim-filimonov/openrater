# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan-scoped policy-tail REST endpoints — ADR-0055 (v4.0 P1).

Three endpoints mounted under `/api/v1/plans/{rating_plan_id}/policy-tail`:

  GET    /                          — fetch the current tail (or 404)
  PUT    /                          — upsert the full ordered tail
  DELETE /                          — clear the tail (204)

No /bulk endpoint — the tail is a singleton per plan, so the PUT
replaces-all on its own. Mirrors `plan_input_mapping_route.py`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Header, Request, Response
from fastapi import Path as FPath

from openrater.errors import NotFoundError, StaleWriteError
from openrater.persistence import Database
from openrater.rates.plans.models import RatingPlan
from openrater.rates.plans.repo import get_plan
from openrater.rates.plans.state_machine import assert_plan_writable
from openrater.rates.policy_tail import (
    PolicyTailEnvelope,
    UpsertPolicyTailRequest,
    delete_policy_tail,
    get_policy_tail,
    upsert_policy_tail,
)

router = APIRouter()


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


def _require_plan_exists(db: Database, rating_plan_id: str) -> RatingPlan:
    """404 if the plan doesn't exist. Returns the plan so
    `_require_writable_plan` doesn't re-fetch."""
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
    state. A non-draft plan's tail is immutable — defense in depth behind
    the rate-lab on-mount sync gate. GETs stay on `_require_plan_exists`
    (reads are always allowed)."""
    return assert_plan_writable(
        _require_plan_exists(db, rating_plan_id), resource=resource
    )


# ---------------------------------------------------------------
# GET — fetch
# ---------------------------------------------------------------


@router.get(
    "/plans/{rating_plan_id}/policy-tail",
    response_model=PolicyTailEnvelope,
)
async def get_policy_tail_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan whose tail to fetch.")
    ],
) -> PolicyTailEnvelope:
    """Fetch the plan's policy tail. Returns 404
    `policy_tail_not_found` if no tail has been authored yet (the "first
    open" state — the UI renders the empty Final-adjustments editor when
    it sees this code)."""
    db = _resolve_db(request)
    _require_plan_exists(db, rating_plan_id)
    envelope = get_policy_tail(db=db, rating_plan_id=rating_plan_id)
    if envelope is None:
        raise NotFoundError(
            f"No policy tail authored yet for plan {rating_plan_id!r}.",
            code="policy_tail_not_found",
            param="rating_plan_id",
        )
    return envelope


# ---------------------------------------------------------------
# PUT — upsert
# ---------------------------------------------------------------


@router.put(
    "/plans/{rating_plan_id}/policy-tail",
    response_model=PolicyTailEnvelope,
)
async def upsert_policy_tail_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan to set the tail on.")
    ],
    payload: Annotated[UpsertPolicyTailRequest, Body()],
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> PolicyTailEnvelope:
    """Replace the plan's policy tail with the supplied ordered list.
    Idempotent — repeated calls with the same body are no-ops (modulo
    `updated_at` + `content_hash`)."""
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id, resource="policy_tail")
    # v4 G14 — If-Match must equal the stored envelope's CURRENT
    # content_hash (None while no record exists); a mismatch is 412
    # stale_write and nothing is written. Omit the header for the
    # first write or for unconditional script writes.
    if if_match is not None:
        existing = get_policy_tail(db=db, rating_plan_id=rating_plan_id)
        current = existing.content_hash if existing is not None else None
        if current != if_match:
            raise StaleWriteError(
                "This record changed since you last loaded it (another "
                "tab or caller wrote in between). Nothing was saved — "
                "reload to continue from the latest state.",
                details={
                    "current_hash": current,
                    "supplied_hash": if_match,
                },
            )
    return upsert_policy_tail(
        db=db, rating_plan_id=rating_plan_id, tail=payload.tail
    )


# ---------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------


@router.delete(
    "/plans/{rating_plan_id}/policy-tail",
    status_code=204,
)
async def delete_policy_tail_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str, FPath(description="The plan whose tail to clear.")
    ],
) -> Response:
    """Clear the plan's policy tail. Returns 204 even when no tail
    exists — DELETE is idempotent + a 404 here would force callers to
    swallow it. The plan-existence check still fires so a wrong plan id
    returns 404 `plan_not_found`."""
    db = _resolve_db(request)
    _require_writable_plan(db, rating_plan_id, resource="policy_tail")
    delete_policy_tail(db=db, rating_plan_id=rating_plan_id)
    return Response(status_code=204)
