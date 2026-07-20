# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan Author Workbench REST API.

Per ADR-009, this module exposes the endpoints the Rate Lab SPA uses to
drive the fork → edit → promote cycle. Mounted at `/api/v1/...`
(see `openrater.main.create_app` for the prefix wiring).

## Error handling

Errors raised inside the service layer (`PlanAuthorError`, `PlanSignoffError`,
their subclasses) extend `openrater.errors.RaterError` and flow through the
global exception handler registered in `main.create_app`. The route layer
therefore does NOT wrap service calls in try/except — that would shadow the
handler and produce inconsistent response shapes.

Input-validation failures the route layer detects directly (e.g., an
unparseable `LineOfBusiness` string) raise typed `RaterError` subclasses
explicitly so they get the same envelope treatment.

## Response shape on error

Every error response uses the structured envelope:

    {
      "error": {
        "code": "plan_not_draft",
        "message": "Plan is not in draft status; cannot add stage.",
        "hint": "Fork the plan first to create a new draft.",
        "param": "rating_plan_id",
        "details": {...}     // when error-specific
      }
    }

See `openrater.errors` for the error-code contract.

## Scope

This router exposes plan creation, copying, draft editing, promotion,
discard, rollback, audit reads, sign-off reads, and wire editing. Preview,
filing-readiness, and sign-off creation are not exposed by this router.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Body, Query, Request
from fastapi import Path as FPath
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic import ValidationError as PydanticValidationError

from openrater.errors import BadRequestError, NotFoundError, ValidationError
from openrater.persistence import Database
from openrater.rates.plans.author import (
    CreatePlanTemplate,
    StagePatch,
    add_stage_to_draft,
    connect_wire,
    create_plan,
    current_operator,
    discard_draft,
    disconnect_wire,
    duplicate_plan,
    fork_plan,
    hard_delete_plan,
    list_audit_events,
    patch_draft_stages,
    patch_stage_io_in_draft,
    promote_draft,
    remove_stage_from_draft,
    reorder_stage_in_draft,
    rollback_plan,
)
from openrater.rates.plans.models import (
    InputSource,
    LineOfBusiness,
    PlanStatus,
    ProductCode,
    RatingPlan,
    Stage,
    StageInput,
    StageKind,
    StageOutput,
)
from openrater.rates.plans.plan_signoff import (
    get_active_signoff,
    get_signoff_history,
)
from openrater.rates.plans.repo import (
    get_plan,
    get_stage_io,
    get_stages,
    list_plans,
)
from openrater.rates.snapshots.models import PlanPublishFacts
from openrater.rates.snapshots.service import publish_overview_for_plans

router = APIRouter()


# ---------------------------------------------------------------------------
# DB helper — pulls the Database off app.state (set by main.create_app).
# ---------------------------------------------------------------------------


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        # The lifespan task sets this on startup; missing it is a server-config
        # bug, not a client error.
        raise RuntimeError("No database on app.state")
    return db


def _coerce_lob(value: str, *, param: str = "line_of_business") -> LineOfBusiness:
    """Parse a `LineOfBusiness` from a string or raise a structured 400."""
    try:
        return LineOfBusiness(value.lower())
    except ValueError as exc:
        valid = ", ".join(e.value for e in LineOfBusiness)
        raise BadRequestError(
            f"Unknown line_of_business {value!r}.",
            code="unknown_line_of_business",
            hint=f"Use one of: {valid}",
            param=param,
        ) from exc


def _coerce_product(value: str, *, param: str = "product") -> ProductCode:
    """Parse a `ProductCode` from a string or raise a structured 400."""
    try:
        return ProductCode(value.lower())
    except ValueError as exc:
        valid = ", ".join(e.value for e in ProductCode)
        raise BadRequestError(
            f"Unknown product {value!r}.",
            code="unknown_product",
            hint=f"Use one of: {valid}",
            param=param,
        ) from exc


# ADR-0033 deprecation-window shim: the legacy `line_of_business` column
# (5 values) can't represent all 11 ProductCodes, so products outside the
# legacy set map to a best-effort LOB purely to keep the DEPRECATED column
# populated. The TRUTH lives in `product` (persisted + hashed + used for
# the slug). This shim — and the column — are deletion-scheduled. It is
# NOT in the rating pipeline (engine/projector/composer never branch on a
# product; Genericity invariant ADR-0033 §0); it only feeds a dying column.
_PRODUCT_TO_LOB_SHIM: dict[ProductCode, LineOfBusiness] = {
    ProductCode.BOP: LineOfBusiness.BOP,
    ProductCode.CGL: LineOfBusiness.CGL,
    ProductCode.DO: LineOfBusiness.CGL,
    ProductCode.EO: LineOfBusiness.CGL,
    ProductCode.WC: LineOfBusiness.WC,
    ProductCode.AUTO: LineOfBusiness.AUTO,
    ProductCode.UMBRELLA: LineOfBusiness.UMBRELLA,
    ProductCode.EXCESS: LineOfBusiness.UMBRELLA,
    ProductCode.MARINE: LineOfBusiness.CGL,
    ProductCode.INLAND_MARINE: LineOfBusiness.CGL,
    ProductCode.HOMEOWNERS: LineOfBusiness.CGL,
    ProductCode.DWELLING: LineOfBusiness.CGL,
    ProductCode.OTHER: LineOfBusiness.CGL,
}


def _lob_shim_for_product(product: ProductCode) -> LineOfBusiness:
    """Best-effort LOB for the deprecated `line_of_business` column."""
    return _PRODUCT_TO_LOB_SHIM[product]


def _coerce_status(value: str | None) -> PlanStatus | None:
    """Parse a `PlanStatus` from a string. `'all'` → None; otherwise a status."""
    if value is None:
        return PlanStatus.ACTIVE
    if value == "all":
        return None
    try:
        return PlanStatus(value)
    except ValueError as exc:
        valid = ", ".join(e.value for e in PlanStatus)
        raise BadRequestError(
            f"Unknown status {value!r}.",
            code="unknown_plan_status",
            hint=f"Use one of: {valid}, all",
            param="status",
        ) from exc


def _coerce_stage_kind(value: str) -> StageKind:
    """Parse a `StageKind` from a string or raise a structured 422."""
    try:
        return StageKind(value)
    except ValueError as exc:
        valid = ", ".join(k.value for k in StageKind)
        raise ValidationError(
            f"Unknown stage_kind {value!r}.",
            code="unknown_stage_kind",
            hint=f"Use one of: {valid}",
            param="stage_kind",
        ) from exc


def _coerce_input_source(value: str, *, param: str = "input_source") -> InputSource:
    """Parse an `InputSource` from a string or raise a structured 422."""
    try:
        return InputSource(value)
    except ValueError as exc:
        valid = ", ".join(s.value for s in InputSource)
        raise ValidationError(
            f"Unknown input_source {value!r}.",
            code="unknown_input_source",
            hint=f"Use one of: {valid}",
            param=param,
        ) from exc


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class PublishedVersionInfo(BaseModel):
    """The plan's CURRENT published version — the production signal
    (Brief 84 D-F). `/quote` serves exactly this version; the UI derives
    its headline status (Draft / Live / Archived) from its presence."""

    model_config = ConfigDict(extra="forbid")

    snapshot_id: str
    display_name: str
    published_at: str


class PlanSummary(BaseModel):
    """Slim plan view for the index page."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "rating_plan_id": "bop_ne_2026_5feb8c63",
                "display_name": "Meridian BOP NE 2026-H2",
                "line_of_business": "bop",
                "product": "bop",
                "jurisdiction": "WI",
                "effective_date": "2026-07-01",
                "status": "active",
                "created_at": "2026-05-20T14:32:11Z",
                "description": "Nebraska BOP rate revision for H2 2026.",
                "template_id": None,
                "coverages": ["bpp", "bi", "liability"],
                "last_edited_at": "2026-05-20T14:32:11Z",
                "content_hash": "3f9d8a2b1c4e5f60",
            }
        },
    )

    rating_plan_id: str = Field(
        description="Stable, opaque plan identifier. Used as the path parameter.",
        examples=["bop_ne_2026_5feb8c63"],
    )
    display_name: str = Field(
        description="Human-readable plan name shown in the UI.",
        examples=["Meridian BOP NE 2026-H2"],
    )
    product: str | None = Field(
        default=None,
        description=(
            "The product axis (ADR-0033): bop, cgl, do, eo, wc, auto, "
            "umbrella, excess, marine, inland_marine, other. The UI prefers "
            "this over line_of_business."
        ),
        examples=["do"],
    )
    line_of_business: str = Field(
        description="@deprecated — use `product`. Legacy 5-value enum.",
        examples=["bop"],
    )
    jurisdiction: str | None = Field(
        description="2-letter USPS state code, or None for multi-state plans.",
        examples=["WI"],
    )
    effective_date: str = Field(
        description="ISO date string (YYYY-MM-DD).",
        examples=["2026-07-01"],
    )
    status: str = Field(
        description="One of: draft, proposed, active, archived.",
        examples=["active"],
    )
    # Lineage stays in the database and audit events; draft-session details
    # are server-internal and are not part of this response.
    created_at: str | None
    description: str | None = Field(
        default=None,
        description=(
            "Optional long-form note captured at create time. None when the "
            "author skipped it; serialized on subsequent reads."
        ),
    )
    template_id: str | None = None
    coverages: list[str] | None = None
    last_edited_at: str | None = None
    content_hash: str | None = Field(default=None, max_length=16)
    # ── Brief 84 D-F — the derived-status substrate. Populated on
    # GET /plans and GET /plans/{id} (one batch query, no N+1); stage-
    # mutation responses omit them (same precedent as draft_session_id) —
    # the canonical refetch carries the truth.
    published_version: PublishedVersionInfo | None = Field(
        default=None,
        description=(
            "The CURRENT published version, or None when nothing is "
            "published. Presence of this field is what makes a plan LIVE."
        ),
    )
    diverged: bool = Field(
        default=False,
        description=(
            "True when the working draft's content hash differs from the "
            "hash captured on the published version (Brief 76 P4.4 "
            "grammar). Always False when unpublished or unknown."
        ),
    )
    live_integration_count: int = Field(
        default=0,
        description=(
            "How many integrations serve this plan live (ADR-0057 exposed "
            "plans with live=1)."
        ),
    )


class StageSummary(BaseModel):
    """Slim stage view for the plan detail page."""

    model_config = ConfigDict(extra="forbid")

    stage_id: str
    sequence: int
    stage_kind: str
    display_name: str
    config_json: dict[str, Any]
    citation_rule: str | None
    citation_page: str | None
    source_filing_id: str | None


class PlanDetail(PlanSummary):
    """Full plan view with stages.

    `section_layout` remains storage-only for hashing continuity.
    """

    stages: list[StageSummary]


class ForkRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {"new_display_name": "Meridian BOP NE — 3% LCM bump"}
        },
    )

    new_display_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        description=(
            "Optional override for the new draft's display name. If omitted, "
            "the service uses '<source name> — Draft (<operator>)'."
        ),
        examples=["Meridian BOP NE — 3% LCM bump"],
    )


class ForkResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_draft_id: str
    source_plan_id: str
    operator_id: str
    is_existing_draft: bool


class DuplicateRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {"new_display_name": "Sample BOP → Missouri copy"}
        },
    )

    new_display_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        description=(
            "Optional display name for the copy. If omitted, the service "
            "uses '<source name> (copy)'."
        ),
        examples=["Sample BOP → Missouri copy"],
    )


class DuplicateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_plan_id: str
    source_plan_id: str
    display_name: str
    operator_id: str


class StagePatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage_id: str = Field(..., min_length=1, max_length=80)
    config_json: dict[str, Any] = Field(..., description="Full new config_json for the stage.")
    display_name: str | None = Field(
        default=None,
        min_length=1,
        # MUST match Stage.display_name (rates/plans/models.py, max 120):
        # the write model_copy's the value onto Stage WITHOUT re-validating
        # (pydantic v2), so a 121–200 char name persisted past the domain
        # cap and every later read reconstructed Stage(...) → 500 forever,
        # bricking the draft (audit A-2026-07-12 P1-02). A route cap equal
        # to the model's rejects it here with a clean 422 instead.
        max_length=120,
        description="Optional new display name (Brief 70.1 — renames persist).",
    )


class PatchDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage_patches: list[StagePatchRequest] = Field(..., min_length=1)
    note: str | None = Field(default=None, max_length=500)


class PatchDraftResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_plan_id: str
    patched_stage_count: int
    plan: PlanDetail


class PromoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=500)


class PromoteResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_active_plan_id: str
    archived_plan_id: str | None


class DiscardResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    discarded_plan_id: str
    new_status: str = Field(description="Always 'archived' (soft delete).")


class HardDeleteResponse(BaseModel):
    """Response shape for `DELETE /plans/{rating_plan_id}` (hard delete).

    The plan and all FK-attached child rows are gone after this returns.
    Audit-log entries are preserved (no FK on `audit_log.rating_plan_id`)
    so the deletion is still queryable historically.
    """

    model_config = ConfigDict(extra="forbid")

    deleted_plan_id: str


class RollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=500)


class RollbackResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_active_plan_id: str
    archived_plan_id: str


class AuditEventItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audit_id: str
    rating_plan_id: str
    operator_id: str
    event_kind: str
    event_at: str
    before_json: dict[str, Any] | None
    after_json: dict[str, Any] | None
    note: str | None


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    events: list[AuditEventItem]


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _plan_to_summary(
    plan: RatingPlan,
    db: Database | None = None,
    publish_facts: PlanPublishFacts | None = None,
) -> PlanSummary:
    """Build the wire summary.

    When `publish_facts` is passed, fill `published_version`, `diverged`,
    and `live_integration_count`. `db` remains in the signature for call-site
    compatibility and is not read.
    """
    _ = db
    published_version: PublishedVersionInfo | None = None
    diverged = False
    live_integration_count = 0
    if publish_facts is not None:
        live_integration_count = publish_facts.live_integration_count
        if (
            publish_facts.published_snapshot_id is not None
            and publish_facts.published_display_name is not None
            and publish_facts.published_at is not None
        ):
            published_version = PublishedVersionInfo(
                snapshot_id=publish_facts.published_snapshot_id,
                display_name=publish_facts.published_display_name,
                published_at=publish_facts.published_at,
            )
            # Same semantics as publish_status (Brief 76 P4.4): diverged
            # only when BOTH hashes are known and differ.
            diverged = bool(
                publish_facts.published_content_hash
                and plan.content_hash
                and publish_facts.published_content_hash != plan.content_hash
            )
    return PlanSummary(
        rating_plan_id=plan.rating_plan_id,
        display_name=plan.display_name,
        product=plan.product.value if plan.product else None,
        line_of_business=plan.line_of_business.value,
        jurisdiction=plan.jurisdiction,
        effective_date=plan.effective_date,
        status=plan.status.value,
        created_at=plan.created_at,
        description=plan.description,
        template_id=plan.template_id,
        coverages=list(plan.coverages) if plan.coverages is not None else None,
        last_edited_at=plan.last_edited_at,
        content_hash=plan.content_hash,
        published_version=published_version,
        diverged=diverged,
        live_integration_count=live_integration_count,
    )


def _stage_to_summary(stage: Stage) -> StageSummary:
    return StageSummary(
        stage_id=stage.stage_id,
        sequence=stage.sequence,
        stage_kind=stage.stage_kind.value,
        display_name=stage.display_name,
        config_json=dict(stage.config_json) if stage.config_json else {},
        citation_rule=stage.citation_rule,
        citation_page=stage.citation_page,
        source_filing_id=stage.source_filing_id,
    )


def _plan_to_detail(
    plan: RatingPlan,
    stages: list[Stage],
    db: Database | None = None,
    publish_facts: PlanPublishFacts | None = None,
) -> PlanDetail:
    summary = _plan_to_summary(plan, db, publish_facts)
    return PlanDetail(
        **summary.model_dump(),
        stages=[_stage_to_summary(s) for s in stages],
    )


def _require_plan(db: Database, rating_plan_id: str) -> RatingPlan:
    """Fetch a plan or raise the typed 404."""
    plan = get_plan(db=db, rating_plan_id=rating_plan_id)
    if plan is None:
        raise NotFoundError(
            f"Plan not found: {rating_plan_id!r}",
            code="plan_not_found",
            param="rating_plan_id",
        )
    return plan


# ===========================================================================
# Plan CRUD
# ===========================================================================


@router.get("/plans", response_model=list[PlanSummary])
async def list_plans_endpoint(
    request: Request,
    lob: Annotated[
        str | None,
        Query(description="Filter by line of business (e.g., 'bop', 'cgl')."),
    ] = None,
    product: Annotated[
        str | None,
        Query(
            description=(
                "Filter by the ADR-0033 product axis (e.g., 'bop', 'do', "
                "'eo'). Finer than `lob` — six products shim onto lob=cgl."
            ),
        ),
    ] = None,
    jurisdiction: Annotated[
        str | None,
        Query(min_length=2, max_length=2, description="2-letter USPS state code."),
    ] = None,
    status: Annotated[
        str | None,
        Query(
            description=(
                "Filter by lifecycle status. Defaults to 'active'. "
                "Pass 'all' to include draft + archived rows."
            ),
        ),
    ] = "active",
) -> list[PlanSummary]:
    """List rating plans, filtered by product / LOB / jurisdiction / status."""
    db = _resolve_db(request)

    lob_enum = _coerce_lob(lob, param="lob") if lob is not None else None
    product_enum = _coerce_product(product) if product is not None else None
    status_enum = _coerce_status(status)

    plans = list_plans(
        db=db,
        line_of_business=lob_enum,
        product=product_enum,
        status=status_enum,
    )
    if jurisdiction is not None:
        plans = [p for p in plans if p.jurisdiction == jurisdiction]

    # Brief 84 D-F — ONE batch query answers "is it live?" for every row.
    facts = publish_overview_for_plans(
        db=db, plan_ids=[p.rating_plan_id for p in plans]
    )
    return [_plan_to_summary(p, db, facts.get(p.rating_plan_id)) for p in plans]


@router.get(
    "/plans/{rating_plan_id}",
    response_model=PlanDetail,
)
async def get_plan_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The plan to fetch.")],
) -> PlanDetail:
    """Full plan view: metadata + ordered stages."""
    db = _resolve_db(request)
    plan = _require_plan(db, rating_plan_id)
    stages = get_stages(db=db, rating_plan_id=rating_plan_id)
    # Brief 84 D-F — the header chip derives Draft/Live/Archived from these.
    facts = publish_overview_for_plans(db=db, plan_ids=[rating_plan_id])
    return _plan_to_detail(plan, stages, db, facts.get(rating_plan_id))


# ---------------------------------------------------------------------------
# Create a NEW plan from scratch (not a fork)
# ---------------------------------------------------------------------------


class CreatePlanRequest(BaseModel):
    """POST body for `POST /api/v1/plans`."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "display_name": "Meridian BOP NE 2026-H2",
                "line_of_business": "bop",
                "product": "bop",
                "jurisdiction": "WI",
                "effective_date": "2026-07-01",
                "template": "blank",
                "description": "Nebraska BOP rate revision for H2 2026.",
            }
        },
    )

    display_name: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Human-readable plan name. Shown in the index + drawer header.",
        examples=["Meridian BOP NE 2026-H2"],
    )
    product: str | None = Field(
        default=None,
        description=(
            "The product axis (ADR-0033): bop, cgl, do, eo, wc, auto, "
            "umbrella, excess, marine, inland_marine, other. Preferred over "
            "line_of_business. The plan slug derives from this."
        ),
        examples=["do"],
    )
    line_of_business: str | None = Field(
        default=None,
        description=(
            "@deprecated — use `product`. Legacy 5-value enum (bop, cgl, wc, "
            "auto, umbrella). Optional now: if omitted, derived from `product` "
            "as a shim for the dying column. One of `product`/`line_of_business` "
            "is required."
        ),
        examples=["bop"],
    )
    jurisdiction: str | None = Field(
        default=None,
        max_length=4,
        description="2-letter USPS state code; None or omitted for multi-state plans.",
        examples=["WI"],
    )
    effective_date: str | None = Field(
        default=None,
        description=(
            "Date the plan takes effect (YYYY-MM-DD). Optional — defaults "
            "to the creation date when omitted (Brief 91: the rating path "
            "never reads it; it orders version lineages and shows in lists)."
        ),
        examples=["2026-07-01"],
    )
    template: str = Field(
        default=CreatePlanTemplate.BLANK,
        description=(
            "Template to seed the plan from. 'blank' (the only value) "
            "creates an empty plan; anything else is rejected with 422 "
            "unknown_template. Pre-populated starter plans come from the "
            "server-owned recipes behind POST /plans/from-template, not "
            "from this field."
        ),
        examples=["blank"],
    )
    description: str | None = Field(
        default=None,
        max_length=2000,
        description="Optional long-form description.",
    )


class CreatePlanResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    display_name: str
    product: str | None
    line_of_business: str
    jurisdiction: str | None
    status: str
    template: str
    stage_count: int


@router.post("/plans", response_model=CreatePlanResponse)
async def create_plan_endpoint(
    request: Request,
    payload: Annotated[CreatePlanRequest, Body()],
) -> JSONResponse:
    """Create a brand-new plan from a template.

    Only the BLANK template exists here — plans are born empty
    (Brief 91). Starter plans are server-owned recipes served through
    POST /plans/from-template, never hardcoded template constants
    (genericity invariant, ADR-0033 §0).
    """
    db = _resolve_db(request)
    # ADR-0033 gate 3: `product` is the real axis (drives the slug). Accept
    # either it or the deprecated `line_of_business`; derive whichever is
    # missing. One is required.
    product = _coerce_product(payload.product) if payload.product else None
    if payload.line_of_business:
        lob = _coerce_lob(payload.line_of_business)
        if product is None:
            # Legacy client (line_of_business only): derive product. The
            # 5 LOB values are all valid ProductCodes.
            product = ProductCode(lob.value)
    elif product is not None:
        lob = _lob_shim_for_product(product)
    else:
        raise BadRequestError(
            "Plan create requires `product` (preferred) or `line_of_business`.",
            code="missing_product",
            hint="Send a `product` such as 'do', 'cgl', or 'bop'.",
            param="product",
        )
    try:
        new_plan = create_plan(
            db=db,
            display_name=payload.display_name,
            line_of_business=lob,
            product=product,
            jurisdiction=payload.jurisdiction,
            # Brief 91 — the create form no longer asks for a date; the
            # domain still requires one, so the boundary defaults it.
            effective_date=payload.effective_date or date.today().isoformat(),
            template=payload.template,
            description=payload.description,
            operator_id=current_operator(),
        )
    except PydanticValidationError as exc:
        # The route model (CreatePlanRequest) is laxer than the domain
        # RatingPlan (e.g. effective_date shape-only, jurisdiction len), so
        # a client-reachable value the domain rejects raised a raw
        # pydantic error that escaped as a bare 500 (audit A-2026-07-12
        # P1-09/P1-16 — impossible date, wrong-length jurisdiction). Surface
        # it as a typed 422 naming the field instead.
        first = exc.errors()[0] if exc.errors() else {}
        loc = first.get("loc") or ()
        field = str(loc[-1]) if loc else None
        raise ValidationError(
            first.get("msg", "A plan field failed validation."),
            param=field,
        ) from exc
    stages = get_stages(db=db, rating_plan_id=new_plan.rating_plan_id)
    response = CreatePlanResponse(
        rating_plan_id=new_plan.rating_plan_id,
        display_name=new_plan.display_name,
        product=new_plan.product.value if new_plan.product else None,
        line_of_business=new_plan.line_of_business.value,
        jurisdiction=new_plan.jurisdiction,
        status=new_plan.status.value,
        template=payload.template,
        stage_count=len(stages),
    )
    return JSONResponse(content=response.model_dump(), status_code=201)


# ---------------------------------------------------------------------------
# Fork
# ---------------------------------------------------------------------------


@router.post(
    "/plans/{rating_plan_id}/fork",
    response_model=ForkResponse,
)
async def fork_plan_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The active plan to fork.")],
    payload: Annotated[ForkRequest, Body()] = ForkRequest(),
) -> JSONResponse:
    """Create a new draft from an active plan. Idempotent per operator."""
    db = _resolve_db(request)
    operator = current_operator()

    from openrater.rates.plans.author import _existing_draft_for_operator

    pre_existing = _existing_draft_for_operator(
        db=db, source_plan_id=rating_plan_id, operator_id=operator
    )

    draft = fork_plan(
        db=db,
        source_plan_id=rating_plan_id,
        operator_id=operator,
        new_display_name=payload.new_display_name,
    )

    response = ForkResponse(
        new_draft_id=draft.rating_plan_id,
        source_plan_id=rating_plan_id,
        operator_id=operator,
        is_existing_draft=pre_existing is not None,
    )
    status_code = 200 if pre_existing is not None else 201
    return JSONResponse(content=response.model_dump(), status_code=status_code)


# ---------------------------------------------------------------------------
# Duplicate (v4 G22)
# ---------------------------------------------------------------------------


@router.post(
    "/plans/{rating_plan_id}/duplicate",
    response_model=DuplicateResponse,
    status_code=201,
)
async def duplicate_plan_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The plan to copy.")],
    payload: Annotated[DuplicateRequest, Body()] = DuplicateRequest(),
) -> DuplicateResponse:
    """Copy a plan (any status) into a fresh, independent draft.

    One server-side transaction carries the WHOLE substrate — stages +
    IO, dimensions (class_library_id re-pointed), factor tables + cells,
    the class registry, the input mapping, and the policy tail. Replaces
    the rate-lab client-side replay that half-built on failure and
    dropped the last three (v4 G22). Never idempotent — every call is a
    new copy.
    """
    db = _resolve_db(request)
    operator = current_operator()
    copy = duplicate_plan(
        db=db,
        source_plan_id=rating_plan_id,
        operator_id=operator,
        new_display_name=payload.new_display_name,
    )
    return DuplicateResponse(
        new_plan_id=copy.rating_plan_id,
        source_plan_id=rating_plan_id,
        display_name=copy.display_name,
        operator_id=operator,
    )


# ---------------------------------------------------------------------------
# Patch draft (stage configs)
# ---------------------------------------------------------------------------


@router.patch(
    "/drafts/{rating_plan_id}",
    response_model=PatchDraftResponse,
)
async def patch_draft_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The draft to edit.")],
    payload: Annotated[PatchDraftRequest, Body()],
) -> PatchDraftResponse:
    """Apply a batch of stage-config patches to a draft atomically."""
    db = _resolve_db(request)
    updated_stages = patch_draft_stages(
        db=db,
        draft_plan_id=rating_plan_id,
        patches=[
            StagePatch(
                stage_id=p.stage_id,
                config_json=p.config_json,
                display_name=p.display_name,
            )
            for p in payload.stage_patches
        ],
        operator_id=current_operator(),
        note=payload.note,
    )
    plan = _require_plan(db, rating_plan_id)
    return PatchDraftResponse(
        draft_plan_id=rating_plan_id,
        patched_stage_count=len(payload.stage_patches),
        plan=_plan_to_detail(plan, updated_stages),
    )


# ---------------------------------------------------------------------------
# Add stage to draft
# ---------------------------------------------------------------------------


class StageInputSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_name: str = Field(..., min_length=1, max_length=80)
    input_source: str
    input_path: str = Field(..., min_length=1, max_length=200)
    data_type: str = Field(..., min_length=1, max_length=40)
    required: bool = True
    default_value: str | None = None


class StageOutputSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    output_name: str = Field(..., min_length=1, max_length=80)
    data_type: str = Field(..., min_length=1, max_length=40)
    description: str | None = None


class AddStageRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "stage_id": "class_factor_lookup",
                "stage_kind": "factor_table_lookup",
                "display_name": "BOP class factor",
                "config_json": {
                    "factor_table_id": "sample_bop_class_factors_2026",
                    "key_input": "class_code",
                },
                "insert_after_stage_id": "$last",
                "citation_rule": "ISO BP § 18.A.3",
                "citation_page": "BP-CR-18",
                "inputs": [
                    {
                        "input_name": "class_code",
                        "input_source": "external",
                        "input_path": "risk.class_code",
                        "data_type": "string",
                        "required": True,
                    }
                ],
                "outputs": [
                    {
                        "output_name": "class_factor",
                        "data_type": "number",
                        "description": "Class-rated multiplicative factor",
                    }
                ],
                "note": "Wiring the BOP class lookup into the rating chain.",
            }
        },
    )

    stage_id: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description="Stage identifier — unique within the plan.",
        examples=["class_factor_lookup"],
    )
    stage_kind: str = Field(
        description=(
            "One of the 13 active StageKinds (constant, factor_table_lookup, "
            "chain_multiply, etc. — the closed vocabulary in "
            "rates/plans/stage_kind_specs.py)."
        ),
        examples=["factor_table_lookup"],
    )
    display_name: str = Field(
        ...,
        min_length=1,
        max_length=120,
        description="Human-readable label rendered on the canvas + drawer.",
    )
    config_json: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Stage-kind-specific config. Validated server-side against the "
            "matching Pydantic config shape; failures return 422."
        ),
    )
    insert_after_stage_id: str | None = Field(
        default="$last",
        description=(
            "Anchor stage_id for the insertion. Pass `$last` to append; pass "
            "an existing stage_id to insert immediately after it."
        ),
        examples=["$last"],
    )
    citation_rule: str | None = None
    citation_page: str | None = None
    inputs: list[StageInputSpec] = Field(default_factory=list)
    outputs: list[StageOutputSpec] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=500)


class AddStageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_plan_id: str
    added_stage: StageSummary
    plan: PlanDetail


@router.post(
    "/drafts/{rating_plan_id}/stages",
    response_model=AddStageResponse,
    status_code=201,
)
async def add_stage_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The draft to add a stage to.")],
    payload: Annotated[AddStageRequest, Body()],
) -> AddStageResponse:
    """Insert a new stage into a draft plan."""
    db = _resolve_db(request)
    kind = _coerce_stage_kind(payload.stage_kind)
    typed_inputs = [
        StageInput(
            input_name=i.input_name,
            input_source=_coerce_input_source(i.input_source, param=f"inputs[{idx}].input_source"),
            input_path=i.input_path,
            data_type=i.data_type,
            required=i.required,
            default_value=i.default_value,
        )
        for idx, i in enumerate(payload.inputs)
    ]
    typed_outputs = [
        StageOutput(
            output_name=o.output_name,
            data_type=o.data_type,
            description=o.description,
        )
        for o in payload.outputs
    ]
    new_stage = add_stage_to_draft(
        db=db,
        draft_plan_id=rating_plan_id,
        stage_id=payload.stage_id,
        stage_kind=kind,
        display_name=payload.display_name,
        config_json=payload.config_json,
        insert_after_stage_id=payload.insert_after_stage_id,
        citation_rule=payload.citation_rule,
        citation_page=payload.citation_page,
        inputs=typed_inputs,
        outputs=typed_outputs,
        operator_id=current_operator(),
        note=payload.note,
    )
    plan = _require_plan(db, rating_plan_id)
    stages = get_stages(db=db, rating_plan_id=rating_plan_id)
    return AddStageResponse(
        draft_plan_id=rating_plan_id,
        added_stage=_stage_to_summary(new_stage),
        plan=_plan_to_detail(plan, stages),
    )


# ---------------------------------------------------------------------------
# Remove stage
# ---------------------------------------------------------------------------


class RemoveStageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_plan_id: str
    removed_stage_id: str
    removed_sequence: int
    plan: PlanDetail


@router.delete(
    "/drafts/{rating_plan_id}/stages/{stage_id}",
    response_model=RemoveStageResponse,
)
async def remove_stage_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The draft to mutate.")],
    stage_id: Annotated[
        str,
        FPath(description="The stage_id to remove.", min_length=1, max_length=80),
    ],
) -> RemoveStageResponse:
    """Remove a stage from a draft plan."""
    db = _resolve_db(request)
    removed = remove_stage_from_draft(
        db=db,
        draft_plan_id=rating_plan_id,
        stage_id=stage_id,
        operator_id=current_operator(),
    )
    plan = _require_plan(db, rating_plan_id)
    stages = get_stages(db=db, rating_plan_id=rating_plan_id)
    return RemoveStageResponse(
        draft_plan_id=rating_plan_id,
        removed_stage_id=removed.stage_id,
        removed_sequence=removed.sequence,
        plan=_plan_to_detail(plan, stages),
    )


# ---------------------------------------------------------------------------
# Reorder stage
# ---------------------------------------------------------------------------


class ReorderStageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to_sequence: int = Field(..., ge=1)
    note: str | None = Field(default=None, max_length=500)


class ReorderStageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_plan_id: str
    stage_id: str
    from_sequence: int
    to_sequence: int
    plan: PlanDetail


@router.patch(
    "/drafts/{rating_plan_id}/stages/{stage_id}/sequence",
    response_model=ReorderStageResponse,
)
async def reorder_stage_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The draft to mutate.")],
    stage_id: Annotated[
        str,
        FPath(description="The stage_id to reorder.", min_length=1, max_length=80),
    ],
    payload: Annotated[ReorderStageRequest, Body()],
) -> ReorderStageResponse:
    """Move a stage to a new sequence position."""
    db = _resolve_db(request)
    current_stages = get_stages(db=db, rating_plan_id=rating_plan_id)
    target_before = next((s for s in current_stages if s.stage_id == stage_id), None)
    moved = reorder_stage_in_draft(
        db=db,
        draft_plan_id=rating_plan_id,
        stage_id=stage_id,
        to_sequence=payload.to_sequence,
        operator_id=current_operator(),
        note=payload.note,
    )
    plan = _require_plan(db, rating_plan_id)
    stages = get_stages(db=db, rating_plan_id=rating_plan_id)
    from_seq = target_before.sequence if target_before else moved.sequence
    return ReorderStageResponse(
        draft_plan_id=rating_plan_id,
        stage_id=stage_id,
        from_sequence=from_seq,
        to_sequence=moved.sequence,
        plan=_plan_to_detail(plan, stages),
    )


# ---------------------------------------------------------------------------
# Stage IO + config
# ---------------------------------------------------------------------------


class StageInputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_name: str = Field(..., min_length=1, max_length=80)
    input_source: str
    input_path: str = Field(..., min_length=1, max_length=200)
    data_type: str = Field(..., min_length=1, max_length=40)
    required: bool = True
    default_value: str | None = None


class StageOutputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    output_name: str = Field(..., min_length=1, max_length=80)
    data_type: str = Field(..., min_length=1, max_length=40)
    description: str | None = None


class StageIOResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    stage_id: str
    inputs: list[StageInputModel]
    outputs: list[StageOutputModel]


class PatchStageIORequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inputs: list[StageInputModel] = Field(default_factory=list)
    outputs: list[StageOutputModel] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=500)


class StageConfigResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating_plan_id: str
    stage_id: str
    stage_kind: str
    config_json: dict[str, Any]


@router.get(
    "/plans/{rating_plan_id}/stages/{stage_id}/config",
    response_model=StageConfigResponse,
)
async def get_stage_config_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The plan whose stage config to read.")],
    stage_id: Annotated[str, FPath(min_length=1, max_length=80)],
) -> StageConfigResponse:
    """Read the full config_json for one stage."""
    db = _resolve_db(request)
    _require_plan(db, rating_plan_id)
    stages = get_stages(db=db, rating_plan_id=rating_plan_id)
    target = next((s for s in stages if s.stage_id == stage_id), None)
    if target is None:
        raise NotFoundError(
            f"Stage {stage_id!r} not found in plan {rating_plan_id!r}",
            code="stage_not_found",
            param="stage_id",
        )
    return StageConfigResponse(
        rating_plan_id=rating_plan_id,
        stage_id=stage_id,
        stage_kind=target.stage_kind.value,
        config_json=target.config_json,
    )


@router.get(
    "/plans/{rating_plan_id}/stages/{stage_id}/io",
    response_model=StageIOResponse,
)
async def get_stage_io_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The plan whose stage I/O to read.")],
    stage_id: Annotated[str, FPath(min_length=1, max_length=80)],
) -> StageIOResponse:
    """Read declared inputs + outputs for one stage."""
    db = _resolve_db(request)
    _require_plan(db, rating_plan_id)
    stages = get_stages(db=db, rating_plan_id=rating_plan_id)
    if not any(s.stage_id == stage_id for s in stages):
        raise NotFoundError(
            f"Stage {stage_id!r} not found in plan {rating_plan_id!r}",
            code="stage_not_found",
            param="stage_id",
        )
    inputs, outputs = get_stage_io(db=db, rating_plan_id=rating_plan_id, stage_id=stage_id)
    return StageIOResponse(
        rating_plan_id=rating_plan_id,
        stage_id=stage_id,
        inputs=[
            StageInputModel(
                input_name=i.input_name,
                input_source=str(i.input_source),
                input_path=i.input_path,
                data_type=str(i.data_type),
                required=i.required,
                default_value=i.default_value,
            )
            for i in inputs
        ],
        outputs=[
            StageOutputModel(
                output_name=o.output_name,
                data_type=str(o.data_type),
                description=o.description,
            )
            for o in outputs
        ],
    )


@router.patch(
    "/drafts/{rating_plan_id}/stages/{stage_id}/io",
    response_model=StageIOResponse,
)
async def patch_stage_io_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The draft to mutate.")],
    stage_id: Annotated[str, FPath(min_length=1, max_length=80)],
    payload: Annotated[PatchStageIORequest, Body()],
) -> StageIOResponse:
    """Atomic full-replace of a stage's declared I/O."""
    db = _resolve_db(request)

    typed_inputs = [
        StageInput(
            input_name=i.input_name,
            input_source=_coerce_input_source(i.input_source, param=f"inputs[{idx}].input_source"),
            input_path=i.input_path,
            data_type=i.data_type,
            required=i.required,
            default_value=i.default_value,
        )
        for idx, i in enumerate(payload.inputs)
    ]
    typed_outputs = [
        StageOutput(
            output_name=o.output_name,
            data_type=o.data_type,
            description=o.description,
        )
        for o in payload.outputs
    ]

    new_inputs, new_outputs = patch_stage_io_in_draft(
        db=db,
        draft_plan_id=rating_plan_id,
        stage_id=stage_id,
        inputs=typed_inputs,
        outputs=typed_outputs,
        operator_id=current_operator(),
        note=payload.note,
    )
    return StageIOResponse(
        rating_plan_id=rating_plan_id,
        stage_id=stage_id,
        inputs=[
            StageInputModel(
                input_name=i.input_name,
                input_source=str(i.input_source),
                input_path=i.input_path,
                data_type=str(i.data_type),
                required=i.required,
                default_value=i.default_value,
            )
            for i in new_inputs
        ],
        outputs=[
            StageOutputModel(
                output_name=o.output_name,
                data_type=str(o.data_type),
                description=o.description,
            )
            for o in new_outputs
        ],
    )


# ---------------------------------------------------------------------------
# Promote / discard / rollback
# ---------------------------------------------------------------------------


@router.post(
    "/drafts/{rating_plan_id}/promote",
    response_model=PromoteResponse,
)
async def promote_draft_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The draft to promote.")],
    payload: Annotated[PromoteRequest, Body()] = PromoteRequest(),
) -> PromoteResponse:
    """Atomically flip a draft → active."""
    db = _resolve_db(request)
    result = promote_draft(
        db=db,
        draft_plan_id=rating_plan_id,
        operator_id=current_operator(),
        note=payload.note,
    )
    return PromoteResponse(
        new_active_plan_id=result.new_active_plan_id,
        archived_plan_id=result.archived_plan_id,
    )


@router.delete(
    "/drafts/{rating_plan_id}",
    response_model=DiscardResponse,
)
async def discard_draft_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The draft to discard.")],
    note: Annotated[str | None, Query(max_length=500)] = None,
) -> DiscardResponse:
    """Soft-delete a draft."""
    db = _resolve_db(request)
    discard_draft(
        db=db,
        draft_plan_id=rating_plan_id,
        operator_id=current_operator(),
        note=note,
    )
    return DiscardResponse(discarded_plan_id=rating_plan_id, new_status="archived")


@router.delete(
    "/plans/{rating_plan_id}",
    response_model=HardDeleteResponse,
)
async def hard_delete_plan_endpoint(
    request: Request,
    rating_plan_id: Annotated[
        str,
        FPath(description="The archived plan to permanently delete."),
    ],
    note: Annotated[str | None, Query(max_length=500)] = None,
    force: Annotated[
        bool,
        Query(
            description=(
                "Knowingly sever integration exposures. Without it, a "
                "plan with any returns 409 plan_delete_blocked with the "
                "count."
            ),
        ),
    ] = False,
) -> HardDeleteResponse:
    """Permanently remove an archived plan + all FK-attached child rows.

    Second stage of the two-stage delete flow. Soft-delete (`DELETE
    /drafts/{id}` → status='archived') must run first; this endpoint
    refuses to hard-delete anything that isn't already archived. The
    `PlanNotArchivedError` raised from the service surfaces as 409 via
    the global RaterError handler — drafts/active/proposed plans return
    `{"code": "plan_not_archived", ...}` with the hint to discard or
    roll-back first.

    Cascade behavior: `rating_plans` parents `plan_dimensions`,
    `plan_factor_tables` (→ `factor_table_cells`), `rating_plan_stages`,
    and `plan_input_mappings` via `ON DELETE CASCADE`; `plan_snapshots`
    is cleaned manually inside the service transaction. `audit_log`
    rows are preserved (`rating_plan_id` is nullable, no FK) and a final
    'discard' event with a disambiguating note records the hard-delete
    moment.
    """
    db = _resolve_db(request)
    hard_delete_plan(
        db=db,
        rating_plan_id=rating_plan_id,
        operator_id=current_operator(),
        note=note,
        force=force,
    )
    return HardDeleteResponse(deleted_plan_id=rating_plan_id)


@router.post(
    "/plans/{rating_plan_id}/rollback",
    response_model=RollbackResponse,
)
async def rollback_plan_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The ACTIVE plan to roll back.")],
    payload: Annotated[RollbackRequest, Body()] = RollbackRequest(),
) -> RollbackResponse:
    """Atomically swap an active plan with its most-recently-archived sibling."""
    db = _resolve_db(request)
    result = rollback_plan(
        db=db,
        rating_plan_id=rating_plan_id,
        operator_id=current_operator(),
        note=payload.note,
    )
    return RollbackResponse(
        new_active_plan_id=result.new_active_plan_id,
        archived_plan_id=result.archived_plan_id,
    )


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


@router.get(
    "/plans/{rating_plan_id}/audit",
    response_model=AuditLogResponse,
)
async def get_plan_audit_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The plan whose audit timeline.")],
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    event_kind: Annotated[
        str | None,
        Query(description="Filter: fork | edit | promote | discard | rollback."),
    ] = None,
) -> AuditLogResponse:
    """Read the audit timeline for a plan, newest first."""
    db = _resolve_db(request)
    _require_plan(db, rating_plan_id)

    valid_event_kinds = {"fork", "edit", "promote", "discard", "rollback"}
    if event_kind is not None and event_kind not in valid_event_kinds:
        raise BadRequestError(
            f"Unknown event_kind {event_kind!r}.",
            code="unknown_event_kind",
            hint=f"Use one of: {', '.join(sorted(valid_event_kinds))}",
            param="event_kind",
        )

    events = list_audit_events(
        db=db,
        rating_plan_id=rating_plan_id,
        limit=limit,
        event_kind=event_kind,
    )
    return AuditLogResponse(
        rating_plan_id=rating_plan_id,
        events=[
            AuditEventItem(
                audit_id=e.audit_id,
                rating_plan_id=e.rating_plan_id,
                operator_id=e.operator_id,
                event_kind=e.event_kind,
                event_at=e.event_at,
                before_json=e.before_json,
                after_json=e.after_json,
                note=e.note,
            )
            for e in events
        ],
    )


# ---------------------------------------------------------------------------
# Sign-off — read-only. Creation and revoke are not exposed by this router;
# the read endpoint supports sign-off records authored at the data layer.
# ---------------------------------------------------------------------------


@router.get("/plans/{rating_plan_id}/signoff")
async def get_plan_signoff_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(description="The plan whose sign-off status to read.")],
) -> dict[str, Any]:
    """Read the active sign-off (if any) + history."""
    db = _resolve_db(request)
    _require_plan(db, rating_plan_id)
    active = get_active_signoff(db=db, rating_plan_id=rating_plan_id)
    history = get_signoff_history(db=db, rating_plan_id=rating_plan_id)
    return {
        "rating_plan_id": rating_plan_id,
        "active": active.model_dump() if active else None,
        "history": [s.model_dump() for s in history],
    }


# ---------------------------------------------------------------------------
# Wires (drag output → input)
# ---------------------------------------------------------------------------


class ConnectWireRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_stage_id: str = Field(..., min_length=1, max_length=80)
    from_output_name: str = Field(..., min_length=1, max_length=80)
    to_stage_id: str = Field(..., min_length=1, max_length=80)
    to_input_name: str = Field(..., min_length=1, max_length=80)
    data_type: str = Field(default="number", min_length=1, max_length=20)
    required: bool = True


@router.post("/plans/{rating_plan_id}/wires")
async def connect_wire_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(min_length=1, description="The DRAFT plan to wire.")],
    body: Annotated[ConnectWireRequest, Body()],
) -> Any:
    """Wire one upstream output to one downstream input. Idempotent."""
    db = _resolve_db(request)
    wire = connect_wire(
        db=db,
        draft_plan_id=rating_plan_id,
        from_stage_id=body.from_stage_id,
        from_output_name=body.from_output_name,
        to_stage_id=body.to_stage_id,
        to_input_name=body.to_input_name,
        data_type=body.data_type,
        required=body.required,
    )
    return {
        "rating_plan_id": rating_plan_id,
        "wire": {
            "from_stage_id": body.from_stage_id,
            "from_output_name": body.from_output_name,
            "to_stage_id": body.to_stage_id,
            "to_input_name": wire.input_name,
            "input_path": wire.input_path,
            "data_type": str(wire.data_type),
            "required": wire.required,
        },
    }


@router.delete(
    "/plans/{rating_plan_id}/wires/{to_stage_id}/{to_input_name}"
)
async def disconnect_wire_endpoint(
    request: Request,
    rating_plan_id: Annotated[str, FPath(min_length=1)],
    to_stage_id: Annotated[str, FPath(min_length=1)],
    to_input_name: Annotated[str, FPath(min_length=1)],
) -> Any:
    """Drop the input row identified by (to_stage_id, to_input_name)."""
    db = _resolve_db(request)
    disconnect_wire(
        db=db,
        draft_plan_id=rating_plan_id,
        to_stage_id=to_stage_id,
        to_input_name=to_input_name,
    )
    return {
        "rating_plan_id": rating_plan_id,
        "disconnected": {
            "to_stage_id": to_stage_id,
            "to_input_name": to_input_name,
        },
    }
