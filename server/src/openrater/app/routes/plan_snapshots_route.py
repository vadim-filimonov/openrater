# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan snapshot REST endpoints — Brief 43 §4 / PR 43.1 + Brief 84.

  POST  /api/v1/plans/{plan_id}/publish                  — go live (Brief 84
        D-B: freeze + publish, ONE verb; auto-names v{N})
  POST  /api/v1/plans/{plan_id}/snapshots                — freeze current draft
        (the "Save a version…" checkpoint — does NOT change what callers get)
  GET   /api/v1/plans/{plan_id}/snapshots                — list summaries
  GET   /api/v1/plans/{plan_id}/publish-status           — publish + divergence
  GET   /api/v1/plans/{plan_id}/snapshots/{snapshot_id}  — fetch one + body
  PATCH /api/v1/plans/{plan_id}/snapshots/{sid}/publish  — publish an EXISTING
        version (the timeline's per-row verb)

Snapshots are append-only in v1 — no PUT, no DELETE. The body is the
self-contained re-rate payload the Analytics workspace uses for
side-by-side comparison.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Request
from fastapi import Path as FPath

from openrater.auth import current_operator
from openrater.errors import ConflictError, NotFoundError
from openrater.persistence import Database
from openrater.rates.snapshots import (
    FreezeSnapshotRequest,
    GoLiveRequest,
    GoLiveResponse,
    ListSnapshotsResponse,
    PlanNotFoundError,
    PlanSnapshot,
    PlanSnapshotSummary,
    PublishStatus,
    SnapshotNameCollisionError,
    SnapshotNotFoundError,
    freeze_current_draft,
    get_snapshot_with_body,
    go_live,
    list_snapshots_for_plan,
    publish_snapshot_for_plan,
    publish_status,
)

router = APIRouter()


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


# ---------------------------------------------------------------
# POST — freeze current draft into a named snapshot
# ---------------------------------------------------------------


@router.post(
    "/plans/{plan_id}/snapshots",
    response_model=PlanSnapshot,
    status_code=201,
)
async def freeze_snapshot_endpoint(
    request: Request,
    plan_id: Annotated[
        str, FPath(description="The rating plan to freeze.")
    ],
    payload: Annotated[FreezeSnapshotRequest, Body(...)],
) -> PlanSnapshot:
    """Read every substrate for the plan + persist an immutable
    snapshot. Body fields:
      · display_name — must be unique within the plan
      · notes        — optional changelog string
    """
    db = _resolve_db(request)
    try:
        return freeze_current_draft(
            db=db,
            plan_id=plan_id,
            display_name=payload.display_name,
            notes=payload.notes,
            created_by=current_operator(),
        )
    except PlanNotFoundError as exc:
        raise NotFoundError(
            f"Plan {plan_id!r} not found.",
            code="plan_not_found",
            param="plan_id",
        ) from exc
    except SnapshotNameCollisionError as exc:
        raise ConflictError(
            f"A snapshot named {payload.display_name!r} already exists "
            f"for this plan.",
            code="snapshot_name_collision",
            param="display_name",
        ) from exc


# ---------------------------------------------------------------
# POST — go live: freeze + publish in ONE verb (Brief 84 D-B)
# ---------------------------------------------------------------


@router.post(
    "/plans/{plan_id}/publish",
    response_model=GoLiveResponse,
    status_code=201,
)
async def go_live_endpoint(
    request: Request,
    plan_id: Annotated[
        str, FPath(description="The rating plan to take live.")
    ],
    # Optional body — POST with no payload (or `{}`) auto-names v{N}.
    payload: GoLiveRequest = GoLiveRequest(),  # noqa: B008 — frozen model
) -> GoLiveResponse:
    """The ONE deploy verb (Brief 84 D-B): freeze the current draft as an
    immutable version AND publish it as what callers get — one call, one
    dialog. `version_name` defaults to the first free `v{N}`; an explicit
    name that collides 409s. The draft stays editable throughout (Brief
    76 D-C) — drift from the new live version becomes visible, never
    blocking."""
    db = _resolve_db(request)
    try:
        snapshot, status = go_live(
            db=db,
            plan_id=plan_id,
            version_name=payload.version_name,
            notes=payload.notes,
            operator=current_operator(),
        )
    except PlanNotFoundError as exc:
        raise NotFoundError(
            f"Plan {plan_id!r} not found.",
            code="plan_not_found",
            param="plan_id",
        ) from exc
    except SnapshotNameCollisionError as exc:
        raise ConflictError(
            f"A version named {payload.version_name!r} already exists "
            f"for this plan.",
            code="snapshot_name_collision",
            param="version_name",
        ) from exc
    return GoLiveResponse(snapshot=snapshot, publish_status=status)


# ---------------------------------------------------------------
# GET — list snapshots (summaries only, no body)
# ---------------------------------------------------------------


@router.get(
    "/plans/{plan_id}/snapshots",
    response_model=ListSnapshotsResponse,
)
async def list_snapshots_endpoint(
    request: Request,
    plan_id: Annotated[
        str, FPath(description="The rating plan to list snapshots for.")
    ],
) -> ListSnapshotsResponse:
    """List every snapshot for a plan, newest first. Returns an empty
    list if the plan exists but has no snapshots — does NOT 404 on
    the plan_id since the picker treats "no snapshots" as a first-
    class empty state."""
    db = _resolve_db(request)
    snapshots = list_snapshots_for_plan(db=db, plan_id=plan_id)
    return ListSnapshotsResponse(snapshots=snapshots)


# ---------------------------------------------------------------
# GET — publish + divergence state (Brief 76 P4.4, D-C)
# ---------------------------------------------------------------


@router.get(
    "/plans/{plan_id}/publish-status",
    response_model=PublishStatus,
)
async def publish_status_endpoint(
    request: Request,
    plan_id: Annotated[
        str, FPath(description="The rating plan to report publish state for.")
    ],
) -> PublishStatus:
    """Is a version published, and has the working draft drifted from it?
    The honest 'which bytes are live' signal (Brief 76). Not plan-404-gated
    — an unpublished plan is a first-class {published: false} state the
    Ship tab renders."""
    db = _resolve_db(request)
    return publish_status(db=db, plan_id=plan_id)


# ---------------------------------------------------------------
# GET — fetch one snapshot with the body
# ---------------------------------------------------------------


@router.get(
    "/plans/{plan_id}/snapshots/{snapshot_id}",
    response_model=PlanSnapshot,
)
async def get_snapshot_endpoint(
    request: Request,
    plan_id: Annotated[
        str, FPath(description="The rating plan the snapshot belongs to.")
    ],
    snapshot_id: Annotated[
        str, FPath(description="The snapshot to fetch.")
    ],
) -> PlanSnapshot:
    """Fetch one snapshot including the self-contained body. The body
    shape is documented in `rates/snapshots/__init__.py`."""
    db = _resolve_db(request)
    snapshot = get_snapshot_with_body(
        db=db, plan_id=plan_id, snapshot_id=snapshot_id
    )
    if snapshot is None:
        raise NotFoundError(
            f"Snapshot {snapshot_id!r} not found on plan {plan_id!r}.",
            code="snapshot_not_found",
            param="snapshot_id",
        )
    return snapshot


# ---------------------------------------------------------------
# PATCH — publish a snapshot as the plan's Current version (Brief 64 §4)
# ---------------------------------------------------------------


@router.patch(
    "/plans/{plan_id}/snapshots/{snapshot_id}/publish",
    response_model=PlanSnapshotSummary,
)
async def publish_snapshot_endpoint(
    request: Request,
    plan_id: Annotated[
        str, FPath(description="The rating plan the snapshot belongs to.")
    ],
    snapshot_id: Annotated[
        str, FPath(description="The snapshot to publish as Current.")
    ],
) -> PlanSnapshotSummary:
    """Publish a frozen version as the plan's Current version of record
    (the Versions + Publish model). Clears the prior current — exactly one
    is current per plan. The plan stays editable; publishing only points at
    a version. 404 if the snapshot doesn't exist on the plan."""
    db = _resolve_db(request)
    try:
        return publish_snapshot_for_plan(
            db=db,
            plan_id=plan_id,
            snapshot_id=snapshot_id,
            published_by=current_operator(),
        )
    except SnapshotNotFoundError as exc:
        raise NotFoundError(
            f"Snapshot {snapshot_id!r} not found on plan {plan_id!r}.",
            code="snapshot_not_found",
            param="snapshot_id",
        ) from exc
