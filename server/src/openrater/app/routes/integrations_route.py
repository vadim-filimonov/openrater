# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Integration seam REST endpoints — ADR-0057 (contract §§2–3, L1–L3).

 consumer audit (2026-07-19, against
docs/specs/integration-contract.md): every endpoint below names who
calls it. "UI" = the Integrations pages + Ship's Connect card
(frontend/src/api/integrations.ts); "integrator" = the paired peer
over the keyed wire, per the contract. Nothing here is caller-less.

  · POST  /integrations                        — UI create (Integrations page)
  · GET   /integrations                        — UI list (Integrations + Home)
  · GET   /integrations/{id}                   — UI detail page
  · GET   /plans/{id}/integrations             — UI Ship Connect card
  · POST  /integrations/{id}/pairing-codes     — UI mint (detail's Pair step)
  · POST  /integrations/pair                   — integrator (contract §2 exchange)
  · GET   /integrations/{id}/descriptor        — integrator (keyed descriptor)
  · PUT   /integrations/{id}/catalog           — integrator (catalog refresh)
  · GET   /integrations/{id}/catalog           — UI Match-fields step
  · GET   /integrations/{id}/plans             — UI exposed-plans list
  · POST  /integrations/{id}/plans             — UI expose a plan
  · PATCH /integrations/{id}/plans/{exposed}   — UI mapping/live edits
  · DELETE /integrations/{id}/plans/{exposed}  — UI remove exposure
  · GET   …/plans/{exposed}/inputs             — UI consumed-inputs read
  · POST  …/plans/{exposed}/test-quote         — UI Test step
  · GET   /integrations/{id}/pulse             — UI detail pulse strip
  · POST  /integrations/{id}/quote-set         — integrator (contract L2)
  · POST  /integrations/{id}/events            — integrator (contract L3)
  · GET   /integrations/{id}/events            — UI event ledger read

Operator authoring follows the auth-shim philosophy (open by default,
integrators bring identity); the integrator endpoints ALWAYS require
the key — descriptor content is relationship data, not public data.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Body, Header, Query, Request
from fastapi import Path as FPath

from openrater.auth import current_operator
from openrater.errors import NotFoundError, ValidationError
from openrater.integrations.events import (
    EventsListResponse,
    EventsRequest,
    EventsResponse,
    apply_events,
    list_events,
)
from openrater.integrations.ledger import record_seam_quote_set
from openrater.integrations.models import (
    CatalogField,
    ConsumedInput,
    CreateIntegrationRequest,
    Descriptor,
    ExposedPlanOut,
    ExposePlanRequest,
    IntegrationOut,
    IntegrationPulse,
    PairingCodeCreated,
    PairRequest,
    PairResponse,
    PatchExposedPlanRequest,
    PlanConnectionsOut,
    QuoteSetMember,
    QuoteSetRequest,
    QuoteSetResponse,
    TestQuoteRequest,
)
from openrater.integrations.quote_set import compose_quote_set, test_quote_member
from openrater.integrations.repo import (
    delete_exposed_plan,
    get_integration,
    list_exposed_plans,
    stamp_test_receipt,
    update_exposed_plan,
)
from openrater.integrations.service import (
    build_descriptor,
    consumed_inputs_with_coverage,
    create_integration,
    current_version_is_tested,
    exchange_pairing_code,
    expose_plan,
    exposed_plan_out,
    get_exposed_plan_or_404,
    integration_out,
    integration_pulse,
    list_integrations_out,
    mint_pairing_code,
    plan_connections,
    refresh_catalog,
    require_integrator,
)
from openrater.persistence.db import Database

router = APIRouter()

_KEY_HEADER = "X-OpenRater-Integration-Key"


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db


@router.post(
    "/integrations",
    response_model=IntegrationOut,
    status_code=201,
    tags=["integrations"],
)
def create_integration_endpoint(
    request: Request,
    body: CreateIntegrationRequest = Body(...),
) -> IntegrationOut:
    return create_integration(
        db=_resolve_db(request), name=body.name, created_by=current_operator()
    )


@router.get(
    "/integrations",
    response_model=list[IntegrationOut],
    tags=["integrations"],
)
def list_integrations_endpoint(request: Request) -> list[IntegrationOut]:
    return list_integrations_out(db=_resolve_db(request))


@router.get(
    "/integrations/{integration_id}",
    response_model=IntegrationOut,
    tags=["integrations"],
)
def get_integration_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
) -> IntegrationOut:
    return integration_out(db=_resolve_db(request), integration_id=integration_id)


@router.get(
    "/plans/{rating_plan_id}/integrations",
    response_model=PlanConnectionsOut,
    tags=["integrations"],
)
def plan_connections_endpoint(
    request: Request,
    rating_plan_id: str = FPath(..., min_length=1),
) -> PlanConnectionsOut:
    """Brief 84 D-D — the plan-side Connect view the Ship tab renders:
    every integration exposing this plan with its journey ladder, plus
    the platform pairing facts the empty states need. Operator read;
    never 404s on an unexposed plan (empty connections is first-class)."""
    return plan_connections(db=_resolve_db(request), rating_plan_id=rating_plan_id)


@router.post(
    "/integrations/{integration_id}/pairing-codes",
    response_model=PairingCodeCreated,
    status_code=201,
    tags=["integrations"],
)
def create_pairing_code_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
) -> PairingCodeCreated:
    return mint_pairing_code(
        db=_resolve_db(request),
        integration_id=integration_id,
        created_by=current_operator(),
    )


@router.get(
    "/integrations/{integration_id}/plans",
    response_model=list[ExposedPlanOut],
    tags=["integrations"],
)
def list_exposed_plans_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
) -> list[ExposedPlanOut]:
    """Brief 77 step 2 — the exposed plans with their journey chips."""
    db = _resolve_db(request)
    return [
        exposed_plan_out(db=db, exposed=e)
        for e in list_exposed_plans(db=db, integration_id=integration_id)
    ]


@router.post(
    "/integrations/{integration_id}/plans",
    response_model=ExposedPlanOut,
    status_code=201,
    tags=["integrations"],
)
def expose_plan_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
    body: ExposePlanRequest = Body(...),
) -> ExposedPlanOut:
    return expose_plan(
        db=_resolve_db(request),
        integration_id=integration_id,
        rating_plan_id=body.rating_plan_id,
        carrier_label=body.carrier_label,
        trace_policy=body.trace_policy,
        validity_days=body.validity_days,
    )


@router.patch(
    "/integrations/{integration_id}/plans/{exposed_id}",
    response_model=ExposedPlanOut,
    tags=["integrations"],
)
def patch_exposed_plan_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
    exposed_id: str = FPath(..., min_length=1),
    body: PatchExposedPlanRequest = Body(...),
) -> ExposedPlanOut:
    """Label · policies · the live switch · (L5) the mapping."""
    db = _resolve_db(request)
    current = get_exposed_plan_or_404(
        db=db, integration_id=integration_id, exposed_id=exposed_id
    )
    # Brief 77 step 5's gate, tightened for republish drift (audit 2026-07-11
    # gap #3): a plan can't reach Live unless the CURRENTLY-published version
    # is the one that passed its Hub test — not merely "tested at some point".
    if body.live is True and not current_version_is_tested(
        db=db,
        rating_plan_id=current.rating_plan_id,
        tested_snapshot_id=current.last_test_snapshot_id,
    ):
        reason = (
            "hasn't had a green test yet"
            if current.last_test_at is None
            else "has been republished since its last green test"
        )
        raise ValidationError(
            f"This plan {reason} — run one in the Hub's Test step (or "
            "POST …/test-quote) against the current version before switching "
            "it live.",
            code="test_required",
            param="live",
        )
    # …and not while the published version consumes required inputs the
    # mapping doesn't cover — every quote would refuse (2026-07-11 audit,
    # the republish tripwire's flip-side: don't LET a gap go live either).
    if body.live is True:
        consumed = consumed_inputs_with_coverage(db=db, exposed=current)
        gaps = sorted(c.key for c in consumed if c.required and not c.mapped_from)
        if gaps:
            shown = ", ".join(gaps[:6]) + ("…" if len(gaps) > 6 else "")
            raise ValidationError(
                "The published version consumes required inputs the mapping "
                f"doesn't cover yet ({shown}) — finish the Map step before "
                "switching live.",
                code="mapping_gaps",
                param="live",
            )
    update_exposed_plan(
        db=db,
        integration_id=integration_id,
        exposed_id=exposed_id,
        carrier_label=body.carrier_label,
        mapping=body.mapping,
        trace_policy=body.trace_policy,
        validity_days=body.validity_days,
        live=body.live,
    )
    exposed = get_exposed_plan_or_404(
        db=db, integration_id=integration_id, exposed_id=exposed_id
    )
    return exposed_plan_out(db=db, exposed=exposed)


@router.delete(
    "/integrations/{integration_id}/plans/{exposed_id}",
    status_code=204,
    tags=["integrations"],
)
def delete_exposed_plan_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
    exposed_id: str = FPath(..., min_length=1),
) -> None:
    db = _resolve_db(request)
    get_exposed_plan_or_404(db=db, integration_id=integration_id, exposed_id=exposed_id)
    delete_exposed_plan(db=db, integration_id=integration_id, exposed_id=exposed_id)


@router.get(
    "/integrations/{integration_id}/catalog",
    response_model=list[CatalogField],
    tags=["integrations"],
)
def get_catalog_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
) -> list[CatalogField]:
    """The peer catalog as uploaded at pairing — the mapper's RIGHT
    column speaks the peer's own labels (operator read)."""
    import json as _json

    db = _resolve_db(request)
    row = get_integration(db=db, integration_id=integration_id)
    if row is None:
        from openrater.errors import NotFoundError

        raise NotFoundError(
            f"Integration {integration_id!r} not found.",
            code="integration_not_found",
            param="integration_id",
        )
    raw = row["peer_catalog"]
    return [CatalogField(**f) for f in (_json.loads(raw) if raw else [])]


@router.get(
    "/integrations/{integration_id}/plans/{exposed_id}/inputs",
    response_model=list[ConsumedInput],
    tags=["integrations"],
)
def consumed_inputs_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
    exposed_id: str = FPath(..., min_length=1),
) -> list[ConsumedInput]:
    """The mapper's LEFT column: the published plan's form inputs, each
    annotated with the peer key covering it (Brief 77 step 3)."""
    db = _resolve_db(request)
    exposed = get_exposed_plan_or_404(
        db=db, integration_id=integration_id, exposed_id=exposed_id
    )
    return consumed_inputs_with_coverage(db=db, exposed=exposed)


@router.post(
    "/integrations/{integration_id}/plans/{exposed_id}/test-quote",
    response_model=QuoteSetMember,
    tags=["integrations"],
)
def test_quote_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
    exposed_id: str = FPath(..., min_length=1),
    body: TestQuoteRequest = Body(...),
) -> QuoteSetMember:
    """Brief 77 step 5 — the in-app try-it (operator session; the
    integrator-key rule of §6.1 governs integrator endpoints, and this
    is not one). Same composer path, write-nothing; a green result
    stamps the plan's test receipt — the gate Live checks."""
    db = _resolve_db(request)
    exposed = get_exposed_plan_or_404(
        db=db, integration_id=integration_id, exposed_id=exposed_id
    )
    member = test_quote_member(db=db, exposed=exposed, facts=body.facts)
    if member.row_status == "ok" and member.premium is not None:
        from datetime import datetime, timezone

        stamp_test_receipt(
            db=db,
            integration_id=integration_id,
            exposed_id=exposed_id,
            when=datetime.now(timezone.utc).isoformat(),
            premium_cents=round(member.premium * 100),
            snapshot_id=member.version.snapshot_id if member.version else None,
        )
    return member


@router.get(
    "/integrations/{integration_id}/pulse",
    response_model=IntegrationPulse,
    tags=["integrations"],
)
def pulse_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
) -> IntegrationPulse:
    """Step 6's strip — health, not analytics. Quote counts are
    deliberately absent: quoting writes nothing (D-A)."""
    return integration_pulse(db=_resolve_db(request), integration_id=integration_id)


@router.post(
    "/integrations/pair",
    response_model=PairResponse,
    tags=["integrations"],
)
def pair_endpoint(
    request: Request,
    body: PairRequest = Body(...),
) -> PairResponse:
    return exchange_pairing_code(
        db=_resolve_db(request),
        code=body.code,
        peer_name=body.peer_name,
        catalog=body.catalog,
    )


@router.get(
    "/integrations/{integration_id}/descriptor",
    response_model=Descriptor,
    response_model_exclude_none=True,
    tags=["integrations"],
)
def descriptor_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
    x_key: str | None = Header(default=None, alias=_KEY_HEADER),
) -> Descriptor:
    db = _resolve_db(request)
    require_integrator(db=db, integration_id=integration_id, presented_key=x_key)
    return build_descriptor(db=db, integration_id=integration_id)


@router.post(
    "/integrations/{integration_id}/quote-set",
    response_model=QuoteSetResponse,
    tags=["integrations"],
)
def quote_set_endpoint(
    request: Request,
    background_tasks: BackgroundTasks,
    integration_id: str = FPath(..., min_length=1),
    body: QuoteSetRequest = Body(...),
    x_key: str | None = Header(default=None, alias=_KEY_HEADER),
) -> QuoteSetResponse:
    """§4 — fan-out quoting. The compute writes nothing; members ordered by
    carrier label; refusals + gaps named; trace clamped to each plan's
    ceiling. A passive forensic ledger row per served member is recorded
    post-response (ADR-0058) — off the response path, best-effort, never read
    back, so §4.2 rule 4 stands for the compute path."""
    db = _resolve_db(request)
    require_integrator(db=db, integration_id=integration_id, presented_key=x_key)
    response = compose_quote_set(db=db, integration_id=integration_id, request=body)
    record_seam_quote_set(
        db=db,
        background_tasks=background_tasks,
        integration_id=integration_id,
        request=body,
        response=response,
    )
    return response


@router.post(
    "/integrations/{integration_id}/events",
    response_model=EventsResponse,
    status_code=202,
    tags=["integrations"],
)
def events_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
    body: EventsRequest = Body(...),
    x_key: str | None = Header(default=None, alias=_KEY_HEADER),
) -> EventsResponse:
    """§5 — the book feed. Idempotent on event_id; acks in request
    order; records facts that occurred elsewhere, executes nothing."""
    db = _resolve_db(request)
    require_integrator(db=db, integration_id=integration_id, presented_key=x_key)
    return apply_events(db=db, integration_id=integration_id, request=body)


@router.get(
    "/integrations/{integration_id}/events",
    response_model=EventsListResponse,
    tags=["integrations"],
)
def list_events_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
    kind: str | None = Query(
        default=None,
        pattern=(
            "^(sent|quoted|bound|declined|lost|corrected"
            "|issued|endorsed|cancelled|reinstated)$"
        ),
    ),
    risk_ref: str | None = Query(default=None),
    since: str | None = Query(
        default=None, description="ISO-8601; applied_at >= since"
    ),
    until: str | None = Query(
        default=None, description="ISO-8601; applied_at <= until"
    ),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> EventsListResponse:
    """ADR-0060 rule 5 — the event ledger, readable. Operator-facing (same
    trust posture as GET /quote-ledger: internal forensic data; integrators
    bring identity) and the surface the Spine's pull worker consumes — OpenRater
    never pushes. 404s on an unknown integration; newest first."""
    db = _resolve_db(request)
    if get_integration(db=db, integration_id=integration_id) is None:
        raise NotFoundError(
            f"Integration {integration_id!r} not found.",
            code="integration_not_found",
            param="integration_id",
        )
    return list_events(
        db=db,
        integration_id=integration_id,
        kind=kind,
        risk_ref=risk_ref,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )


@router.put(
    "/integrations/{integration_id}/catalog",
    status_code=204,
    tags=["integrations"],
)
def refresh_catalog_endpoint(
    request: Request,
    integration_id: str = FPath(..., min_length=1),
    catalog: list[CatalogField] = Body(...),
    x_key: str | None = Header(default=None, alias=_KEY_HEADER),
) -> None:
    db = _resolve_db(request)
    require_integrator(db=db, integration_id=integration_id, presented_key=x_key)
    refresh_catalog(db=db, integration_id=integration_id, catalog=catalog)
