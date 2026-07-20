# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Per-plan API-key endpoints — Brief 76 (v4 P4.2, the quote gate).

  POST   /api/v1/plans/{id}/api-keys           → mint (secret shown ONCE)
  GET    /api/v1/plans/{id}/api-keys           → metadata (never the secret)
  DELETE /api/v1/plans/{id}/api-keys/{key_id}  → revoke (soft delete)

The keys gate `POST /plans/{id}/quote` when `RATER_QUOTE_REQUIRE_KEY`
is set; OpenRater ships open (OSS/dev), so minting is always available but
gating is opt-in (D-D).
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Request
from fastapi import Path as FPath

from openrater.auth import current_operator
from openrater.errors import NotFoundError
from openrater.persistence import Database
from openrater.rates.api_keys import (
    ApiKeyCreated,
    ApiKeyList,
    CreateApiKeyRequest,
    list_keys,
    mint_api_key,
    revoke_key,
)
from openrater.rates.plans.repo import get_plan

router = APIRouter()


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


def _require_plan(db: Database, rating_plan_id: str) -> None:
    if get_plan(db=db, rating_plan_id=rating_plan_id) is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )


@router.post(
    "/plans/{rating_plan_id}/api-keys",
    response_model=ApiKeyCreated,
    status_code=201,
    tags=["api-keys"],
)
def create_api_key(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
    body: CreateApiKeyRequest = Body(default_factory=CreateApiKeyRequest),
) -> ApiKeyCreated:
    db = _resolve_db(request)
    _require_plan(db, rating_plan_id)
    return mint_api_key(
        db=db,
        rating_plan_id=rating_plan_id,
        label=body.label,
        created_by=current_operator(),
    )


@router.get(
    "/plans/{rating_plan_id}/api-keys",
    response_model=ApiKeyList,
    tags=["api-keys"],
)
def list_api_keys_endpoint(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
) -> ApiKeyList:
    db = _resolve_db(request)
    _require_plan(db, rating_plan_id)
    return ApiKeyList(keys=list_keys(db=db, rating_plan_id=rating_plan_id))


@router.delete(
    "/plans/{rating_plan_id}/api-keys/{key_id}",
    status_code=204,
    tags=["api-keys"],
)
def revoke_api_key_endpoint(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
    key_id: str = FPath(..., min_length=1),
) -> None:
    db = _resolve_db(request)
    _require_plan(db, rating_plan_id)
    if not revoke_key(db=db, rating_plan_id=rating_plan_id, key_id=key_id):
        raise NotFoundError(
            f"API key {key_id!r} not found (or already revoked) on plan "
            f"{rating_plan_id!r}.",
            code="api_key_not_found",
            param="key_id",
        )
