# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan Author service layer — fork/edit/promote primitives + audit log writer.

Owns the state-machine + audit-log writes that back every plan-author
endpoint:

  · `create_plan`             — make a new draft from scratch (blank template).
  · `fork_plan`               — copy an `active` plan into a new `draft` with
                                `parent_plan_id` set and stage + IO rows duplicated.
                                Idempotent per `(source_plan_id, operator_id)`.
  · `patch_draft_stages`      — apply a batch of stage-config patches atomically.
                                Each patched config_json parses against the
                                stage's per-`StageKind` Pydantic config; any
                                shape error rolls back the batch.
  · `add_stage_to_draft`      — insert a new stage at a chosen sequence.
  · `remove_stage_from_draft` — delete a stage + downstream-shift sequences.
  · `reorder_stage_in_draft`  — move a stage to a new sequence position.
  · `patch_stage_io_in_draft` — replace a stage's declared inputs + outputs.
  · `patch_stage_positions`   — operator-nudge canvas coordinates.
  · `connect_wire`/`disconnect_wire` — input-row level wire authoring.
  · `promote_draft`           — atomic state-machine transition: active sibling
                                → archived, this draft → active. Validation
                                runs first; promote is blocked on shape error.
  · `discard_draft`           — soft delete (status → archived).
  · `hard_delete_plan`        — permanently remove an archived plan + cascade
                                its child rows. Two-stage flow: discard first,
                                then hard-delete from the archive. Audit log
                                rows survive (rating_plan_id is nullable).
  · `rollback_plan`           — re-promote the most-recently-archived sibling
                                of the currently-active plan.
  · `write_audit_event` / `list_audit_events` — audit log writer + reader.
  · `current_operator`        — request-scoped operator identity. Local
                                development uses `operator@openrater.local`;
                                deployments can register an auth resolver.

The state-machine transitions are designed so illegal transitions raise
typed errors that the route layer surfaces with the right HTTP status.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

# ---------------------------------------------------------------------------
# Operator identity (delegated to openrater.auth)
# ---------------------------------------------------------------------------
#
# Operator resolution lives in `openrater.auth`, where deployments can
# register a resolver (JWT, session, mTLS, etc.). This module re-exports the
# helpers for plan-author call sites.
#
# See `openrater.auth` for the registration API + ContextVar pattern.
from openrater.auth import DEFAULT_OPERATOR_ID, current_operator
from openrater.persistence import Database
from openrater.rates.plans.configs import parse_stage_config
from openrater.rates.plans.errors import PlanParseError
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
from openrater.rates.plans.repo import (
    get_plan,
    get_stage_io,
    get_stages,
    insert_plan,
    recompute_content_hash,
)
from openrater.rates.plans.validator import (
    StageMeta,
    _check_one_reference,
    collect_stage_references,
)

__all_auth_compat__ = ["DEFAULT_OPERATOR_ID", "current_operator"]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class PlanAuthorError(PlanParseError):
    """Plan-author-service-specific error. Extends `PlanParseError` (which
    extends `RaterError`), so the global FastAPI exception handler in
    `openrater.errors` converts every instance to the structured envelope
    without per-route `except` boilerplate.

    Subclasses set their own `code` + `default_status_code`; those stable
    codes are part of the API error contract.
    """

    code = "plan_author_error"
    default_status_code = 400


class PlanNotFoundError(PlanAuthorError):
    """The requested plan doesn't exist."""

    code = "plan_not_found"
    default_status_code = 404


class PlanNotForkableError(PlanAuthorError):
    """Only ACTIVE plans can be forked. Drafts and archived plans can't."""

    code = "plan_not_forkable"
    default_status_code = 409
    default_hint = "Fork the current ACTIVE plan, not a draft or archived row."


class IllegalStateTransitionError(PlanAuthorError):
    """A state-machine operation was attempted on a row in the wrong state."""

    code = "illegal_state_transition"
    default_status_code = 409
    default_hint = (
        "Inspect the plan's current `status` and the operation's allowed "
        "states; fork to draft first if the operation requires draft."
    )


class PlanValidationError(PlanAuthorError):
    """A draft can't be promoted because validation failed."""

    code = "plan_validation_failed"
    default_status_code = 422
    default_hint = (
        "See `details.report.errors[]` for the per-stage findings to fix."
    )

    def __init__(self, message: str, *, report: PlanValidationReport) -> None:
        self.report = report
        super().__init__(message, details={"report": report.to_dict()})


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AuditEvent:
    """One audit-log row, as the service returns it to callers."""

    audit_id: str
    rating_plan_id: str
    operator_id: str
    event_kind: str
    event_at: str
    before_json: dict[str, Any] | None
    after_json: dict[str, Any] | None
    note: str | None


def write_audit_event(
    *,
    db: Database,
    conn: sqlite3.Connection | None = None,
    rating_plan_id: str,
    event_kind: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    note: str | None = None,
    operator_id: str | None = None,
) -> AuditEvent:
    """Append one row to `audit_log` (entity_kind='plan').

    Pass `conn` to enroll in an outer transaction. When `conn` is None
    the writer opens its own short-lived connection.

    `event_kind` must be one of fork | edit | promote | discard |
    rollback | hard_delete (the audit_log CHECK constraint, widened by
    migration 012 to include 'hard_delete'). Non-plan kinds (define,
    retire, nl_patch) are also valid but live on other entity_kinds.
    """
    audit_id = str(uuid4())
    event_at = datetime.now(UTC).isoformat()
    actual_operator = operator_id or current_operator()
    before_payload = json.dumps(before) if before is not None else None
    after_payload = json.dumps(after) if after is not None else None

    sql = """
        INSERT INTO audit_log (
            audit_id, rating_plan_id, entity_kind, entity_id,
            operator_id, event_kind, event_at,
            before_json, after_json, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    params = (
        audit_id,
        rating_plan_id,
        "plan",
        rating_plan_id,
        actual_operator,
        event_kind,
        event_at,
        before_payload,
        after_payload,
        note,
    )
    if conn is not None:
        conn.execute(sql, params)
    else:
        with db.connection() as own_conn:
            own_conn.execute(sql, params)
            own_conn.commit()

    return AuditEvent(
        audit_id=audit_id,
        rating_plan_id=rating_plan_id,
        operator_id=actual_operator,
        event_kind=event_kind,
        event_at=event_at,
        before_json=before,
        after_json=after,
        note=note,
    )


def list_audit_events(
    *,
    db: Database,
    rating_plan_id: str,
    limit: int = 100,
    event_kind: str | None = None,
) -> list[AuditEvent]:
    """Read the audit timeline for a plan, newest first."""
    sql = (
        "SELECT audit_id, rating_plan_id, operator_id, event_kind, "
        "event_at, before_json, after_json, note "
        "FROM audit_log "
        "WHERE entity_kind = 'plan' AND rating_plan_id = ?"
    )
    params: list[object] = [rating_plan_id]
    if event_kind is not None:
        sql += " AND event_kind = ?"
        params.append(event_kind)
    sql += " ORDER BY event_at DESC LIMIT ?"
    params.append(limit)

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [
        AuditEvent(
            audit_id=r["audit_id"],
            rating_plan_id=r["rating_plan_id"],
            operator_id=r["operator_id"],
            event_kind=r["event_kind"],
            event_at=r["event_at"],
            before_json=json.loads(r["before_json"]) if r["before_json"] else None,
            after_json=json.loads(r["after_json"]) if r["after_json"] else None,
            note=r["note"],
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Fork
# ---------------------------------------------------------------------------


def _existing_draft_for_operator(
    *,
    db: Database,
    source_plan_id: str,
    operator_id: str,
) -> RatingPlan | None:
    """Look for an open draft this operator already forked from this source."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT p.rating_plan_id
            FROM rating_plans p
            INNER JOIN audit_log a
                ON a.entity_kind = 'plan'
                AND a.rating_plan_id = p.rating_plan_id
            WHERE p.parent_plan_id = ?
              AND p.status = 'draft'
              AND a.event_kind = 'fork'
              AND a.operator_id = ?
            ORDER BY p.created_at DESC
            LIMIT 1
            """,
            (source_plan_id, operator_id),
        ).fetchone()
    if row is None:
        return None
    return get_plan(db=db, rating_plan_id=row["rating_plan_id"])


def _build_draft_plan_id(source_plan_id: str) -> str:
    """`<source>_draft_<uuid-prefix>`."""
    return f"{source_plan_id}_draft_{uuid4().hex[:8]}"


def _build_copy_plan_id(source_plan_id: str) -> str:
    """`<source>_copy_<uuid-prefix>` — with any trailing `_copy_<hex>`
    stripped first, so a copy-of-a-copy doesn't grow the id unboundedly."""
    base = re.sub(r"_copy_[0-9a-f]{8}$", "", source_plan_id)
    return f"{base}_copy_{uuid4().hex[:8]}"


def _build_new_plan_id(
    *,
    lob: str,
    jurisdiction: str | None,
    template: str,
) -> str:
    """`<lob>_<juris>_<template>_<uuid-prefix>`."""
    juris_seg = (jurisdiction or "multi").lower()
    return f"{lob}_{juris_seg}_{template}_{uuid4().hex[:8]}"


class CreatePlanTemplate:
    """Constants for supported `create_plan(template=...)` values.

    BLANK is the only hardcoded template: plans are born empty, and
    program content arrives as plan data. Starter plans are
    server-owned recipes (`rates/templates/`) stamped through the
    `*_override` args — never new constants here (genericity
    invariant, ADR-0033 §0).
    """

    BLANK = "blank"

    ALL: tuple[str, ...] = (BLANK,)


# Static template → (v4_template_id, coverages) metadata. Empty by
# design: starter plans are server-owned recipes stamped through the
# `*_override` args, not entries here.
_TEMPLATE_TO_V4: dict[str, tuple[str, tuple[str, ...]]] = {}


class UnknownTemplateError(PlanAuthorError):
    code = "unknown_template"
    default_status_code = 422
    """The `template` arg to `create_plan` isn't one of `CreatePlanTemplate.ALL`."""


def create_plan(
    *,
    db: Database,
    display_name: str,
    line_of_business: LineOfBusiness,
    jurisdiction: str | None,
    effective_date: str,
    product: ProductCode | None = None,
    template: str = CreatePlanTemplate.BLANK,
    description: str | None = None,
    operator_id: str | None = None,
    template_id_override: str | None = None,
    coverages_override: tuple[str, ...] | None = None,
    plan_id_override: str | None = None,
) -> RatingPlan:
    """Create a new rating plan from scratch (NOT a fork).

    The new plan is born in DRAFT status with a fresh plan_id, parent
    `None`, and a draft_session_id for the time-travel layer. One audit
    row is written with event_kind='fork' (re-used; `before=None` +
    parent=None signals create-vs-fork).

    `template_id_override` + `coverages_override` let D6.4's
    `/plans/from-template` endpoint stamp the plan with the recipe
    metadata that `_TEMPLATE_TO_V4` doesn't know about (templates are
    now server-owned recipes in `plan_templates`, not constants).
    Default-null preserves the legacy /plans creation path's behavior.

    `plan_id_override` (Brief 95 A2) lets the workbook ingester pin the
    plan's id to the workbook's declared `rating_plan_id` — same
    workbook, same plan id, on any box. Callers own uniqueness (the
    ingester refuses a taken id with the holder named); the PK is the
    backstop. Default-null keeps every other path on generated slugs.

    Raises:
      · UnknownTemplateError (422) — template not in `CreatePlanTemplate.ALL`
      · PlanAuthorError      (400) — display_name empty, malformed
        plan_id_override, etc.
    """
    if template not in CreatePlanTemplate.ALL:
        raise UnknownTemplateError(
            f"create_plan: template={template!r} not supported; "
            f"valid: {sorted(CreatePlanTemplate.ALL)}"
        )
    if not display_name.strip():
        raise PlanAuthorError("create_plan: display_name is required")

    operator = operator_id or current_operator()
    # ADR-0033: the PRODUCT axis is the truth. Derive it from
    # line_of_business when the caller didn't supply one (transitional —
    # the 5 LOB values are all valid ProductCodes). The plan slug uses
    # the product so a D&O plan is `do_…`, not the collapsed `cgl_…` (N2).
    resolved_product = product if product is not None else ProductCode(line_of_business.value)
    if plan_id_override is not None:
        # Brief 95 A2 — the ingester pins the workbook's declared id.
        # Same slug grammar the workbook check enforces (spec §2.3).
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", plan_id_override):
            raise PlanAuthorError(
                f"create_plan: plan_id_override {plan_id_override!r} is not "
                "a valid plan slug (lowercase [a-z0-9_-], ≤ 80 chars)."
            )
        new_plan_id = plan_id_override
    else:
        new_plan_id = _build_new_plan_id(
            lob=resolved_product.value,
            jurisdiction=jurisdiction,
            template=template,
        )

    v4_template_id: str | None = None
    v4_coverages: tuple[str, ...] | None = None
    if template in _TEMPLATE_TO_V4:
        v4_template_id, v4_coverages = _TEMPLATE_TO_V4[template]
    # The explicit overrides win when supplied — that's the D6.4
    # path where the template_id + coverages come from the recipe
    # row, not the static _TEMPLATE_TO_V4 map.
    if template_id_override is not None:
        v4_template_id = template_id_override
    if coverages_override is not None:
        v4_coverages = coverages_override

    new_plan = RatingPlan(
        rating_plan_id=new_plan_id,
        display_name=display_name.strip(),
        line_of_business=line_of_business,
        # ADR-0033: the real product (caller-supplied, or derived from the
        # legacy LOB as a transitional default — see resolved_product above).
        product=resolved_product,
        jurisdiction=jurisdiction,
        effective_date=effective_date,
        description=description,
        parent_plan_id=None,
        status=PlanStatus.DRAFT,
        source_filing_id=None,
        created_at=datetime.now(UTC).isoformat(),
        template_id=v4_template_id,
        coverages=v4_coverages,
    )

    new_stages, new_io = _build_template_seed(
        template=template,
        new_plan_id=new_plan_id,
        jurisdiction=jurisdiction,
    )

    insert_plan(db=db, plan=new_plan, stages=new_stages, stage_io=new_io)

    session_id = str(uuid4())
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO draft_sessions (
                draft_session_id, entity_kind, entity_id, operator_id,
                status, created_at
            ) VALUES (?, 'plan', ?, ?, 'draft', ?)
            """,
            (session_id, new_plan_id, operator, datetime.now(UTC).isoformat()),
        )
        conn.execute(
            "UPDATE rating_plans SET draft_session_id = ? WHERE rating_plan_id = ?",
            (session_id, new_plan_id),
        )
        conn.commit()

    write_audit_event(
        db=db,
        rating_plan_id=new_plan_id,
        event_kind="fork",
        before=None,
        after={
            "rating_plan_id": new_plan_id,
            "parent_plan_id": None,
            "display_name": new_plan.display_name,
            "status": "draft",
            "template": template,
            "stage_count": len(new_stages),
            "draft_session_id": session_id,
        },
        operator_id=operator,
        note=f"Created from template={template}",
    )

    return new_plan


def _build_template_seed(
    *,
    template: str,
    new_plan_id: str,
    jurisdiction: str | None,
) -> tuple[list[Stage], dict[str, tuple[list[StageInput], list[StageOutput]]]]:
    """Return `(stages, stage_io_by_stage_id)` for a template."""
    if template == CreatePlanTemplate.BLANK:
        return ([], {})

    # BLANK is the only template with a hardcoded seed (empty). The
    # `create_plan` gate on CreatePlanTemplate.ALL means we shouldn't
    # reach here through the public API — the explicit raise stays as
    # a fence in case someone bypasses the check.
    raise UnknownTemplateError(f"_build_template_seed: unhandled template={template!r}")


def fork_plan(
    *,
    db: Database,
    source_plan_id: str,
    operator_id: str | None = None,
    new_display_name: str | None = None,
) -> RatingPlan:
    """Fork an ACTIVE plan into a new DRAFT row owned by `operator_id`.

    Idempotent: if the operator already has an open draft forked from
    this source, that existing draft is returned (no new row, no
    duplicate audit row).

    Raises:
      · PlanNotFoundError (404) if `source_plan_id` doesn't exist.
      · PlanNotForkableError (409) if the source isn't active.
    """
    from openrater.rates.plans.state_machine import Action, is_legal

    operator = operator_id or current_operator()
    source = get_plan(db=db, rating_plan_id=source_plan_id)
    if source is None:
        raise PlanNotFoundError(f"fork_plan: source plan_id={source_plan_id!r} not found")
    # Fork has its own error code (`plan_not_forkable`) so clients can
    # distinguish it from generic illegal-state-transition. We consult the
    # state machine for the predicate but raise the specific error here.
    if not is_legal(status=source.status, action=Action.FORK):
        raise PlanNotForkableError(
            f"fork_plan: source plan {source_plan_id!r} has status "
            f"{source.status.value!r}; only ACTIVE plans can be forked"
        )

    existing = _existing_draft_for_operator(
        db=db, source_plan_id=source_plan_id, operator_id=operator
    )
    if existing is not None:
        return existing

    new_plan_id = _build_draft_plan_id(source_plan_id)
    draft_display_name = (
        new_display_name
        if new_display_name
        else f"{source.display_name} — Draft ({operator.split('@')[0]})"
    )
    draft_plan = RatingPlan(
        rating_plan_id=new_plan_id,
        display_name=draft_display_name,
        line_of_business=source.line_of_business,
        # Preserve the source plan's product across the fork (ADR-0033).
        product=source.product,
        jurisdiction=source.jurisdiction,
        effective_date=source.effective_date,
        description=source.description,
        parent_plan_id=source_plan_id,
        status=PlanStatus.DRAFT,
        source_filing_id=source.source_filing_id,
        created_at=datetime.now(UTC).isoformat(),
    )

    source_stages = get_stages(db=db, rating_plan_id=source_plan_id)
    if not source_stages:
        raise PlanAuthorError(
            f"fork_plan: source plan {source_plan_id!r} has zero stages — "
            f"won't fork an unexecutable plan"
        )
    draft_stages = [
        stage.model_copy(update={"rating_plan_id": new_plan_id}) for stage in source_stages
    ]
    draft_io: dict[str, tuple[list[StageInput], list[StageOutput]]] = {}
    for stage in source_stages:
        draft_io[stage.stage_id] = get_stage_io(
            db=db, rating_plan_id=source_plan_id, stage_id=stage.stage_id
        )

    insert_plan(db=db, plan=draft_plan, stages=draft_stages, stage_io=draft_io)

    session_id = str(uuid4())
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO draft_sessions (
                draft_session_id, entity_kind, entity_id, operator_id,
                status, created_at
            ) VALUES (?, 'plan', ?, ?, 'draft', ?)
            """,
            (session_id, new_plan_id, operator, datetime.now(UTC).isoformat()),
        )
        conn.execute(
            "UPDATE rating_plans SET draft_session_id = ? WHERE rating_plan_id = ?",
            (session_id, new_plan_id),
        )
        conn.commit()

    write_audit_event(
        db=db,
        rating_plan_id=new_plan_id,
        event_kind="fork",
        before=None,
        after={
            "rating_plan_id": new_plan_id,
            "parent_plan_id": source_plan_id,
            "display_name": draft_display_name,
            "status": "draft",
            "stage_count": len(draft_stages),
            "draft_session_id": session_id,
        },
        operator_id=operator,
        note=f"Forked from {source_plan_id}",
    )

    return draft_plan


# ---------------------------------------------------------------------------
# Duplicate (v4 G22) — copy ANY plan into a fresh, independent draft
# ---------------------------------------------------------------------------

# Every plan-scoped child table a copy must carry, in FK-safe insert order
# (parents before children). v4 G22: the client-side "Duplicate plan"
# replay carried only stages + dims + factor tables — everything below
# the first three was silently dropped. Keep this list in lock-step with
# `scripts/cold_test_sample_bop.py` PLAN_TABLES (minus the plan + stage
# tables the fork/duplicate machinery copies through `insert_plan`).
_SUBSTRATE_TABLES: tuple[str, ...] = (
    "plan_dimensions",
    "plan_factor_tables",
    "plan_factor_table_cells",
    "plan_class_codes",
    "plan_input_mappings",
    "plan_policy_tail",
)


def _copy_plan_substrate(
    *, db: Database, source_plan_id: str, new_plan_id: str
) -> dict[str, int]:
    """Copy every plan-scoped substrate row from source → new plan.

    Column-generic (PRAGMA-driven INSERT…SELECT) so a table gaining
    columns keeps copying whole rows — the G22 disease was substrates
    added later being silently dropped by a hand-maintained copy. All
    six tables key on `rating_plan_id` (alone or composite), so the id
    swap cannot collide.

    `plan_dimensions.class_library_id` is REWRITTEN to the new plan id
    when set: it names the plan whose class registry a classification
    dim reads, and the copy gets its own registry rows below — a
    verbatim copy would keep pointing at the source (the stale-pointer
    bug the v4 audit flagged; the cold-test fixture itself carries one
    from a pre-G22 duplicate).

    One transaction. Returns per-table copied-row counts for the audit
    event.
    """
    counts: dict[str, int] = {}
    with db.connection() as conn:
        try:
            conn.execute("BEGIN")
            for table in _SUBSTRATE_TABLES:
                cols = [
                    row[1] for row in conn.execute(f"PRAGMA table_info({table})")
                ]
                select_exprs: list[str] = []
                params: list[str] = []
                for col in cols:
                    if col == "rating_plan_id":
                        select_exprs.append("?")
                        params.append(new_plan_id)
                    elif table == "plan_dimensions" and col == "class_library_id":
                        select_exprs.append(
                            "CASE WHEN class_library_id IS NULL"
                            " THEN NULL ELSE ? END"
                        )
                        params.append(new_plan_id)
                    else:
                        select_exprs.append(col)
                cur = conn.execute(
                    f"INSERT INTO {table} ({', '.join(cols)}) "
                    f"SELECT {', '.join(select_exprs)} FROM {table} "
                    f"WHERE rating_plan_id = ?",
                    (*params, source_plan_id),
                )
                counts[table] = cur.rowcount
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
    return counts


def duplicate_plan(
    *,
    db: Database,
    source_plan_id: str,
    operator_id: str | None = None,
    new_display_name: str | None = None,
) -> RatingPlan:
    """Copy a plan — ANY status — into a fresh, independent DRAFT.

    This is the authoring "Save as copy", distinct from `fork_plan` (the
    lifecycle edit-an-ACTIVE-plan operation: ACTIVE-only, idempotent per
    operator). Every call creates a new plan; the source may be a draft
    mid-build or a frozen/active/archived plan; and the copy carries the
    WHOLE substrate: stages + IO, dimensions (`class_library_id`
    re-pointed at the copy's own registry), factor tables + cells, the
    class registry, the input mapping, and the policy tail — plus the
    plan row's template_id / coverages / section_layout.

    v4 G22: the client-side replay this replaces looped `add_stage` per
    stage (half-building on any mid-loop failure) and dropped the class
    registry, the input mapping, and the tail entirely.

    Never half-builds: any failure after the plan row lands rolls the
    substrate transaction back and deletes the new plan row (children go
    via ON DELETE CASCADE) before the error propagates.
    """
    operator = operator_id or current_operator()
    source = get_plan(db=db, rating_plan_id=source_plan_id)
    if source is None:
        raise PlanNotFoundError(
            f"duplicate_plan: source plan_id={source_plan_id!r} not found"
        )

    new_plan_id = _build_copy_plan_id(source_plan_id)
    display_name = new_display_name or f"{source.display_name} (copy)"
    new_plan = RatingPlan(
        rating_plan_id=new_plan_id,
        display_name=display_name,
        line_of_business=source.line_of_business,
        product=source.product,
        jurisdiction=source.jurisdiction,
        effective_date=source.effective_date,
        description=source.description,
        # Lineage. Safe alongside fork's per-operator idempotency lookup —
        # that query requires a `fork` audit event, and duplicates write
        # `duplicate`.
        parent_plan_id=source_plan_id,
        status=PlanStatus.DRAFT,
        source_filing_id=source.source_filing_id,
        created_at=datetime.now(UTC).isoformat(),
        # The fork path predates these fields; a copy without them loses
        # the template-resolved chain runtime defaults (LCM + base rates).
        template_id=source.template_id,
        coverages=source.coverages,
        section_layout=source.section_layout,
    )

    # A stage-less source is fine for duplicate (copying a plan mid-build
    # is the point); fork's zero-stage refusal is about forking an
    # unexecutable ACTIVE plan.
    source_stages = get_stages(db=db, rating_plan_id=source_plan_id)
    new_stages = [
        stage.model_copy(update={"rating_plan_id": new_plan_id})
        for stage in source_stages
    ]
    stage_io: dict[str, tuple[list[StageInput], list[StageOutput]]] = {}
    for stage in source_stages:
        stage_io[stage.stage_id] = get_stage_io(
            db=db, rating_plan_id=source_plan_id, stage_id=stage.stage_id
        )

    insert_plan(db=db, plan=new_plan, stages=new_stages, stage_io=stage_io)

    try:
        substrate_counts = _copy_plan_substrate(
            db=db, source_plan_id=source_plan_id, new_plan_id=new_plan_id
        )

        session_id = str(uuid4())
        with db.connection() as conn:
            conn.execute(
                """
                INSERT INTO draft_sessions (
                    draft_session_id, entity_kind, entity_id, operator_id,
                    status, created_at
                ) VALUES (?, 'plan', ?, ?, 'draft', ?)
                """,
                (session_id, new_plan_id, operator, datetime.now(UTC).isoformat()),
            )
            conn.execute(
                "UPDATE rating_plans SET draft_session_id = ? WHERE rating_plan_id = ?",
                (session_id, new_plan_id),
            )
            conn.commit()

        write_audit_event(
            db=db,
            rating_plan_id=new_plan_id,
            event_kind="duplicate",
            before=None,
            after={
                "rating_plan_id": new_plan_id,
                "source_plan_id": source_plan_id,
                "display_name": display_name,
                "status": "draft",
                "stage_count": len(new_stages),
                "substrate_counts": substrate_counts,
                "draft_session_id": session_id,
            },
            operator_id=operator,
            note=f"Duplicated from {source_plan_id}",
        )
    except BaseException:
        # Compensate — never leave a half-built copy behind. Children go
        # via ON DELETE CASCADE; a seconds-old copy has no snapshots to
        # clean and its audit rows (if any) are soft references.
        with db.connection() as conn:
            conn.execute(
                "DELETE FROM draft_sessions WHERE entity_kind = 'plan' AND entity_id = ?",
                (new_plan_id,),
            )
            conn.execute(
                "DELETE FROM rating_plans WHERE rating_plan_id = ?",
                (new_plan_id,),
            )
            conn.commit()
        raise

    return new_plan


# ---------------------------------------------------------------------------
# Validation report
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ValidationError:
    """One typed validation diagnostic, keyed by stage_id + JSON path."""

    code: str
    stage_id: str
    message: str
    path: str | None = None


@dataclass(frozen=True)
class PlanValidationReport:
    """Full validation result for a plan."""

    rating_plan_id: str
    valid: bool
    errors: tuple[ValidationError, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "rating_plan_id": self.rating_plan_id,
            "valid": self.valid,
            "errors": [
                {
                    "code": e.code,
                    "stage_id": e.stage_id,
                    "message": e.message,
                    "path": e.path,
                }
                for e in self.errors
            ],
        }


def validate_plan(
    *,
    db: Database,
    rating_plan_id: str,
) -> PlanValidationReport:
    """Run every available validation check against a plan.

      · Per-stage shape (each `config_json` parses against its kind).
      · Unknown stage reference, self-reference, forward reference,
        undeclared output reference.

    All errors are collected in a single pass.
    """
    plan = get_plan(db=db, rating_plan_id=rating_plan_id)
    if plan is None:
        return PlanValidationReport(
            rating_plan_id=rating_plan_id,
            valid=False,
            errors=(
                ValidationError(
                    code="plan_not_found",
                    stage_id="",
                    message=f"Plan {rating_plan_id!r} not found",
                ),
            ),
        )

    errors: list[ValidationError] = []
    stages = get_stages(db=db, rating_plan_id=rating_plan_id)

    for stage in stages:
        try:
            parse_stage_config(stage)
        except (PlanParseError, NotImplementedError, ValueError) as exc:
            errors.append(
                ValidationError(
                    code="stage_config_shape",
                    stage_id=stage.stage_id,
                    message=str(exc),
                    path=f"stages.{stage.stage_id}.config_json",
                )
            )

    by_id: dict[str, StageMeta] = {}
    for stage in stages:
        _inputs, outputs = get_stage_io(
            db=db, rating_plan_id=rating_plan_id, stage_id=stage.stage_id
        )
        by_id[stage.stage_id] = StageMeta(
            stage_id=stage.stage_id,
            sequence=stage.sequence,
            declared_outputs=frozenset(o.output_name for o in outputs),
        )

    for stage in stages:
        referencer_meta = by_id[stage.stage_id]
        for ref in collect_stage_references(stage.config_json):
            err = _check_one_reference(ref=ref, referencer=referencer_meta, by_id=by_id)
            if err is None:
                continue
            code, message = err
            errors.append(
                ValidationError(
                    code=code,
                    stage_id=stage.stage_id,
                    message=message,
                    path=(
                        f"stages.{stage.stage_id}.config_json.{ref.json_path}"
                        if ref.json_path
                        else f"stages.{stage.stage_id}.config_json"
                    ),
                )
            )

    return PlanValidationReport(
        rating_plan_id=rating_plan_id,
        valid=len(errors) == 0,
        errors=tuple(errors),
    )


# ---------------------------------------------------------------------------
# Patch draft stages
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StagePatch:
    """One stage-level config edit.

    Brief 70.1 — ``display_name`` rides the same patch: renames used to
    silently drop (the patch could only carry config_json while the UI
    announced the new name).
    """

    stage_id: str
    config_json: dict[str, Any]
    display_name: str | None = None


def _require_draft(plan: RatingPlan | None, plan_id: str, op: str) -> RatingPlan:
    """Common precondition check: target plan exists AND is a draft.

    Delegates to `state_machine.assert_action_allowed` so the
    allowed-state table is the single source of truth. The `op` string
    (e.g. "patch_draft_stages") is mapped to the matching `Action` enum
    value; an unknown value fails closed through `Action.PATCH`, the
    generic "edit a draft" action.
    """
    from openrater.rates.plans.state_machine import Action, assert_action_allowed

    op_to_action: dict[str, Action] = {
        "patch_draft_stages": Action.PATCH,
        "add_stage_to_draft": Action.ADD_STAGE,
        "remove_stage_from_draft": Action.REMOVE_STAGE,
        "reorder_stage_in_draft": Action.REORDER_STAGE,
        "patch_stage_io_in_draft": Action.PATCH_STAGE_IO,
        "promote_draft": Action.PROMOTE,
        "discard_draft": Action.DISCARD,
        "connect_wire": Action.CONNECT_WIRE,
        "disconnect_wire": Action.DISCONNECT_WIRE,
    }
    action = op_to_action.get(op, Action.PATCH)
    return assert_action_allowed(plan, action=action)


def patch_draft_stages(
    *,
    db: Database,
    draft_plan_id: str,
    patches: list[StagePatch],
    operator_id: str | None = None,
    note: str | None = None,
) -> list[Stage]:
    """Apply a batch of stage-config patches to a draft."""
    if not patches:
        return get_stages(db=db, rating_plan_id=draft_plan_id)

    plan = get_plan(db=db, rating_plan_id=draft_plan_id)
    _require_draft(plan, draft_plan_id, op="patch_draft_stages")
    from openrater.rates.plans.plan_signoff import assert_plan_unlocked

    assert_plan_unlocked(db=db, rating_plan_id=draft_plan_id)
    operator = operator_id or current_operator()

    current_stages = {s.stage_id: s for s in get_stages(db=db, rating_plan_id=draft_plan_id)}
    unknown = [p.stage_id for p in patches if p.stage_id not in current_stages]
    if unknown:
        # 404 stage_not_found, matching every sibling stage-mutation
        # endpoint — a client switching on the documented code/status
        # shouldn't miss this one path (audit A-2026-07-12 P1-17).
        raise StageNotFoundError(
            f"patch_draft_stages: stage_id(s) {unknown!r} not found in plan "
            f"{draft_plan_id!r}; valid stage_ids: {sorted(current_stages)}"
        )

    patched_by_id: dict[str, Stage] = {}
    errors: list[ValidationError] = []
    for patch in patches:
        current = current_stages[patch.stage_id]
        update: dict[str, Any] = {"config_json": patch.config_json}
        if patch.display_name is not None and patch.display_name.strip():
            update["display_name"] = patch.display_name.strip()
        new_stage = current.model_copy(update=update)
        try:
            parse_stage_config(new_stage)
        except (PlanParseError, NotImplementedError, ValueError) as exc:
            errors.append(
                ValidationError(
                    code="stage_config_shape",
                    stage_id=patch.stage_id,
                    message=str(exc),
                    path=f"stages.{patch.stage_id}.config_json",
                )
            )
        else:
            patched_by_id[patch.stage_id] = new_stage

    if errors:
        report = PlanValidationReport(
            rating_plan_id=draft_plan_id,
            valid=False,
            errors=tuple(errors),
        )
        raise PlanValidationError(
            f"patch_draft_stages: {len(errors)} stage(s) failed shape validation",
            report=report,
        )

    before_snapshot = {
        p.stage_id: dict(current_stages[p.stage_id].config_json or {}) for p in patches
    }
    after_snapshot = {sid: dict(stage.config_json) for sid, stage in patched_by_id.items()}

    with db.connection() as conn:
        for sid, stage in patched_by_id.items():
            # Brief 70.1 — the display name persists alongside the
            # config (renames used to silently drop at this UPDATE).
            conn.execute(
                """
                UPDATE rating_plan_stages
                SET config_json = ?, display_name = ?
                WHERE rating_plan_id = ? AND stage_id = ?
                """,
                (
                    json.dumps(stage.config_json),
                    stage.display_name,
                    draft_plan_id,
                    sid,
                ),
            )
        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=draft_plan_id,
            event_kind="edit",
            before={"stage_configs": before_snapshot},
            after={"stage_configs": after_snapshot},
            operator_id=operator,
            note=note or f"Edited {len(patched_by_id)} stage config(s)",
        )
        # Hash recompute (WA-9 retirement) — every mutation that changes
        # hashed content keeps the persisted content_hash in sync.
        recompute_content_hash(conn=conn, rating_plan_id=draft_plan_id)
        conn.commit()

    return get_stages(db=db, rating_plan_id=draft_plan_id)


# ---------------------------------------------------------------------------
# Add stage to draft
# ---------------------------------------------------------------------------


class DuplicateStageIdError(PlanAuthorError):
    """A stage with the supplied stage_id already exists in the plan."""

    code = "duplicate_stage_id"
    default_status_code = 409
    default_hint = "Pick a different `stage_id`, or delete the existing stage first."


class StageInsertPositionError(PlanAuthorError):
    """The insertion anchor (insert_after_stage_id) doesn't resolve."""

    code = "stage_insert_position_invalid"
    default_status_code = 404
    default_hint = "Pass `$last` to append, or a real existing stage_id as the anchor."


def add_stage_to_draft(
    *,
    db: Database,
    draft_plan_id: str,
    stage_id: str,
    stage_kind: StageKind,
    display_name: str,
    config_json: dict[str, Any],
    insert_after_stage_id: str | None,
    citation_rule: str | None = None,
    citation_page: str | None = None,
    inputs: list[StageInput] | None = None,
    outputs: list[StageOutput] | None = None,
    operator_id: str | None = None,
    note: str | None = None,
) -> Stage:
    """Insert a new stage into a draft plan at the chosen position.

    `insert_after_stage_id`:
      · None    -> insert at position 1
      · "$last" -> insert at end
      · <id>    -> insert at sequence = matched.sequence + 1

    Inserting mid-cascade bumps downstream sequences by 1 inside the
    same transaction (atomic).
    """
    plan = get_plan(db=db, rating_plan_id=draft_plan_id)
    _require_draft(plan, draft_plan_id, op="add_stage_to_draft")
    from openrater.rates.plans.plan_signoff import assert_plan_unlocked

    assert_plan_unlocked(db=db, rating_plan_id=draft_plan_id)
    operator = operator_id or current_operator()

    current_stages = get_stages(db=db, rating_plan_id=draft_plan_id)
    if any(s.stage_id == stage_id for s in current_stages):
        raise DuplicateStageIdError(
            f"add_stage_to_draft: stage_id={stage_id!r} already exists in "
            f"plan {draft_plan_id!r}; pick a unique slug."
        )

    if insert_after_stage_id is None:
        new_sequence = 1
    elif insert_after_stage_id == "$last":
        new_sequence = max((s.sequence for s in current_stages), default=0) + 1
    else:
        anchor = next(
            (s for s in current_stages if s.stage_id == insert_after_stage_id),
            None,
        )
        if anchor is None:
            raise StageInsertPositionError(
                f"add_stage_to_draft: insert_after_stage_id="
                f"{insert_after_stage_id!r} doesn't resolve in plan "
                f"{draft_plan_id!r}; valid stage_ids: "
                f"{[s.stage_id for s in current_stages]}"
            )
        new_sequence = anchor.sequence + 1

    new_stage = Stage(
        rating_plan_id=draft_plan_id,
        stage_id=stage_id,
        sequence=new_sequence,
        stage_kind=stage_kind,
        display_name=display_name,
        config_json=config_json,
        citation_rule=citation_rule,
        citation_page=citation_page,
        source_filing_id=None,
    )

    try:
        parse_stage_config(new_stage)
    except (PlanParseError, NotImplementedError, ValueError) as exc:
        report = PlanValidationReport(
            rating_plan_id=draft_plan_id,
            valid=False,
            errors=(
                ValidationError(
                    code="stage_config_shape",
                    stage_id=stage_id,
                    message=str(exc),
                    path=f"stages.{stage_id}.config_json",
                ),
            ),
        )
        raise PlanValidationError(
            f"add_stage_to_draft: stage {stage_id!r} config_json failed "
            f"shape validation for kind={stage_kind.value}",
            report=report,
        ) from exc

    inputs = inputs or []
    outputs = outputs or []

    with db.connection() as conn:
        # Bump from highest -> lowest to avoid transient UNIQUE collisions.
        downstream = sorted(
            (s for s in current_stages if s.sequence >= new_sequence),
            key=lambda s: s.sequence,
            reverse=True,
        )
        for s in downstream:
            conn.execute(
                "UPDATE rating_plan_stages SET sequence = ? "
                "WHERE rating_plan_id = ? AND stage_id = ?",
                (s.sequence + 1, draft_plan_id, s.stage_id),
            )

        conn.execute(
            """
            INSERT INTO rating_plan_stages (
                rating_plan_id, stage_id, sequence, stage_kind,
                display_name, config_json, citation_rule,
                citation_page, source_filing_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                draft_plan_id,
                stage_id,
                new_sequence,
                stage_kind.value,
                display_name,
                json.dumps(config_json, sort_keys=True),
                citation_rule,
                citation_page,
                None,
            ),
        )

        for inp in inputs:
            conn.execute(
                """
                INSERT INTO rating_plan_stage_inputs (
                    rating_plan_id, stage_id, input_name, input_source,
                    input_path, data_type, required, default_value
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    draft_plan_id,
                    stage_id,
                    inp.input_name,
                    inp.input_source.value,
                    inp.input_path,
                    inp.data_type,
                    int(inp.required),
                    inp.default_value,
                ),
            )
        for out in outputs:
            conn.execute(
                """
                INSERT INTO rating_plan_stage_outputs (
                    rating_plan_id, stage_id, output_name,
                    data_type, description
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    draft_plan_id,
                    stage_id,
                    out.output_name,
                    out.data_type,
                    out.description,
                ),
            )

        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=draft_plan_id,
            event_kind="edit",
            before=None,
            after={
                "added_stage": {
                    "stage_id": stage_id,
                    "stage_kind": stage_kind.value,
                    "sequence": new_sequence,
                    "display_name": display_name,
                }
            },
            operator_id=operator,
            note=note or f"Added stage {stage_id!r} at sequence {new_sequence}",
        )
        # Hash recompute (WA-9 retirement)
        recompute_content_hash(conn=conn, rating_plan_id=draft_plan_id)
        conn.commit()

    return new_stage


# ---------------------------------------------------------------------------
# Remove stage from draft
# ---------------------------------------------------------------------------


class StageNotFoundError(PlanAuthorError):
    """The supplied stage_id doesn't exist in the plan."""

    code = "stage_not_found"
    default_status_code = 404


class StageHasDownstreamConsumersError(PlanAuthorError):
    """Removing this stage would break one or more downstream stages."""

    code = "stage_has_downstream_consumers"
    default_status_code = 409
    default_hint = (
        "Re-wire the listed consumers to a different stage, or delete "
        "them first."
    )

    def __init__(
        self,
        message: str,
        *,
        consumers: list[tuple[str, str, str]],
    ) -> None:
        self.consumers = consumers
        super().__init__(
            message,
            details={
                "consumers": [
                    {
                        "consumer_stage_id": c,
                        "consumer_input_name": i_name,
                        "output_name": o_name,
                    }
                    for c, i_name, o_name in consumers
                ]
            },
        )


def remove_stage_from_draft(
    *,
    db: Database,
    draft_plan_id: str,
    stage_id: str,
    operator_id: str | None = None,
    note: str | None = None,
) -> Stage:
    """Remove a stage from a draft plan + shift downstream sequences down."""
    plan = get_plan(db=db, rating_plan_id=draft_plan_id)
    _require_draft(plan, draft_plan_id, op="remove_stage_from_draft")
    from openrater.rates.plans.plan_signoff import assert_plan_unlocked

    assert_plan_unlocked(db=db, rating_plan_id=draft_plan_id)
    operator = operator_id or current_operator()

    current_stages = get_stages(db=db, rating_plan_id=draft_plan_id)
    target = next((s for s in current_stages if s.stage_id == stage_id), None)
    if target is None:
        raise StageNotFoundError(
            f"remove_stage_from_draft: stage_id={stage_id!r} not found in "
            f"plan {draft_plan_id!r}; valid stage_ids: "
            f"{[s.stage_id for s in current_stages]}"
        )

    _target_inputs, target_outputs = get_stage_io(
        db=db, rating_plan_id=draft_plan_id, stage_id=stage_id
    )
    target_output_names = {o.output_name for o in target_outputs}
    consumers: list[tuple[str, str, str]] = []
    for other in current_stages:
        if other.stage_id == stage_id:
            continue
        other_inputs, _other_outputs = get_stage_io(
            db=db, rating_plan_id=draft_plan_id, stage_id=other.stage_id
        )
        for inp in other_inputs:
            if str(inp.input_source) != "stage_output":
                continue
            parts = inp.input_path.split(".")
            if len(parts) < 3 or parts[0] != "stages":
                continue
            from_stage = parts[1]
            from_output = ".".join(parts[2:])
            if from_stage == stage_id and (
                not target_output_names or from_output in target_output_names
            ):
                consumers.append((other.stage_id, inp.input_name, from_output))

    if consumers:
        consumer_summary = ", ".join(
            f"{c}.{i_name}<-{o_name}" for c, i_name, o_name in consumers[:5]
        )
        suffix = " (and more)" if len(consumers) > 5 else ""
        raise StageHasDownstreamConsumersError(
            f"remove_stage_from_draft: stage {stage_id!r} has "
            f"{len(consumers)} downstream consumer(s) — re-wire them "
            f"first: {consumer_summary}{suffix}",
            consumers=consumers,
        )

    removed_sequence = target.sequence
    with db.connection() as conn:
        conn.execute(
            "DELETE FROM rating_plan_stage_inputs WHERE rating_plan_id = ? AND stage_id = ?",
            (draft_plan_id, stage_id),
        )
        conn.execute(
            "DELETE FROM rating_plan_stage_outputs WHERE rating_plan_id = ? AND stage_id = ?",
            (draft_plan_id, stage_id),
        )
        conn.execute(
            "DELETE FROM rating_plan_stages WHERE rating_plan_id = ? AND stage_id = ?",
            (draft_plan_id, stage_id),
        )
        downstream = sorted(
            (s for s in current_stages if s.sequence > removed_sequence),
            key=lambda s: s.sequence,
        )
        for s in downstream:
            conn.execute(
                "UPDATE rating_plan_stages SET sequence = ? "
                "WHERE rating_plan_id = ? AND stage_id = ?",
                (s.sequence - 1, draft_plan_id, s.stage_id),
            )

        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=draft_plan_id,
            event_kind="edit",
            before={
                "removed_stage": {
                    "stage_id": stage_id,
                    "stage_kind": target.stage_kind.value,
                    "sequence": removed_sequence,
                    "display_name": target.display_name,
                    "config_json": target.config_json,
                }
            },
            after=None,
            operator_id=operator,
            note=note or f"Removed stage {stage_id!r} from sequence {removed_sequence}",
        )
        # Hash recompute (WA-9 retirement)
        recompute_content_hash(conn=conn, rating_plan_id=draft_plan_id)
        conn.commit()

    return target


# ---------------------------------------------------------------------------
# Reorder stage in draft
# ---------------------------------------------------------------------------


class InvalidSequenceError(PlanAuthorError):
    """The requested to_sequence is out of range for the plan."""

    code = "invalid_sequence"
    default_status_code = 422
    default_hint = "Use a sequence between 1 and the current stage count."


class StageReorderBreaksDagError(PlanAuthorError):
    """The requested reorder would put a producer stage AFTER one of
    its consumers (or vice versa)."""

    code = "stage_reorder_breaks_dag"
    default_status_code = 409
    default_hint = (
        "Move the stage to a sequence that preserves the producer-before-"
        "consumer ordering. `details.broken_edges` lists the wires that "
        "would be violated."
    )

    def __init__(
        self,
        message: str,
        *,
        broken_edges: list[tuple[str, str, int, int]],
    ) -> None:
        self.broken_edges = broken_edges
        super().__init__(
            message,
            details={
                "broken_edges": [
                    {
                        "producer_stage_id": p,
                        "consumer_stage_id": c,
                        "producer_sequence": ps,
                        "consumer_sequence": cs,
                    }
                    for p, c, ps, cs in broken_edges
                ]
            },
        )


# Out-of-range temporary sequence used to dodge SQLite's UNIQUE constraint
# during the multi-step reorder shuffle.
_TEMP_SEQUENCE = 9999


def _hypothetical_sequence_map(
    *,
    current_stages: list[Stage],
    stage_id: str,
    from_seq: int,
    to_seq: int,
) -> dict[str, int]:
    """Compute the {stage_id -> sequence} map AFTER the reorder."""
    out: dict[str, int] = {}
    for s in current_stages:
        if s.stage_id == stage_id:
            out[s.stage_id] = to_seq
        elif to_seq < from_seq and to_seq <= s.sequence < from_seq:
            out[s.stage_id] = s.sequence + 1
        elif to_seq > from_seq and from_seq < s.sequence <= to_seq:
            out[s.stage_id] = s.sequence - 1
        else:
            out[s.stage_id] = s.sequence
    return out


def _validate_reorder_dag(
    *,
    db: Database,
    draft_plan_id: str,
    current_stages: list[Stage],
    seq_map: dict[str, int],
) -> list[tuple[str, str, int, int]]:
    """Check every stage_output edge against the hypothetical seq map."""
    broken: list[tuple[str, str, int, int]] = []
    for consumer in current_stages:
        inputs, _outputs = get_stage_io(
            db=db,
            rating_plan_id=draft_plan_id,
            stage_id=consumer.stage_id,
        )
        for inp in inputs:
            if str(inp.input_source) != "stage_output":
                continue
            parts = inp.input_path.split(".")
            if len(parts) < 3 or parts[0] != "stages":
                continue
            producer_id = parts[1]
            if producer_id not in seq_map or consumer.stage_id not in seq_map:
                continue
            producer_seq = seq_map[producer_id]
            consumer_seq = seq_map[consumer.stage_id]
            if producer_seq >= consumer_seq:
                broken.append((producer_id, consumer.stage_id, producer_seq, consumer_seq))
    return broken


def reorder_stage_in_draft(
    *,
    db: Database,
    draft_plan_id: str,
    stage_id: str,
    to_sequence: int,
    operator_id: str | None = None,
    note: str | None = None,
) -> Stage:
    """Move a stage to a new sequence position within a draft."""
    plan = get_plan(db=db, rating_plan_id=draft_plan_id)
    _require_draft(plan, draft_plan_id, op="reorder_stage_in_draft")
    from openrater.rates.plans.plan_signoff import assert_plan_unlocked

    assert_plan_unlocked(db=db, rating_plan_id=draft_plan_id)
    operator = operator_id or current_operator()

    current_stages = get_stages(db=db, rating_plan_id=draft_plan_id)
    target = next((s for s in current_stages if s.stage_id == stage_id), None)
    if target is None:
        raise StageNotFoundError(
            f"reorder_stage_in_draft: stage_id={stage_id!r} not found in plan {draft_plan_id!r}"
        )

    n = len(current_stages)
    if to_sequence < 1 or to_sequence > n:
        raise InvalidSequenceError(
            f"reorder_stage_in_draft: to_sequence={to_sequence} is out of "
            f"range [1, {n}] for plan {draft_plan_id!r}"
        )

    from_sequence = target.sequence
    if from_sequence == to_sequence:
        return target

    seq_map = _hypothetical_sequence_map(
        current_stages=current_stages,
        stage_id=stage_id,
        from_seq=from_sequence,
        to_seq=to_sequence,
    )
    broken = _validate_reorder_dag(
        db=db,
        draft_plan_id=draft_plan_id,
        current_stages=current_stages,
        seq_map=seq_map,
    )
    if broken:
        summary = ", ".join(f"{p}({ps})->{c}({cs})" for p, c, ps, cs in broken[:5])
        suffix = " (and more)" if len(broken) > 5 else ""
        raise StageReorderBreaksDagError(
            f"reorder_stage_in_draft: moving {stage_id!r} to sequence "
            f"{to_sequence} would break {len(broken)} cascade edge(s): "
            f"{summary}{suffix}",
            broken_edges=broken,
        )

    with db.connection() as conn:
        conn.execute(
            "UPDATE rating_plan_stages SET sequence = ? WHERE rating_plan_id = ? AND stage_id = ?",
            (_TEMP_SEQUENCE, draft_plan_id, stage_id),
        )
        if to_sequence < from_sequence:
            shifters = sorted(
                (
                    s
                    for s in current_stages
                    if s.stage_id != stage_id and to_sequence <= s.sequence < from_sequence
                ),
                key=lambda s: s.sequence,
                reverse=True,
            )
            for s in shifters:
                conn.execute(
                    "UPDATE rating_plan_stages SET sequence = ? "
                    "WHERE rating_plan_id = ? AND stage_id = ?",
                    (s.sequence + 1, draft_plan_id, s.stage_id),
                )
        else:
            shifters = sorted(
                (
                    s
                    for s in current_stages
                    if s.stage_id != stage_id and from_sequence < s.sequence <= to_sequence
                ),
                key=lambda s: s.sequence,
            )
            for s in shifters:
                conn.execute(
                    "UPDATE rating_plan_stages SET sequence = ? "
                    "WHERE rating_plan_id = ? AND stage_id = ?",
                    (s.sequence - 1, draft_plan_id, s.stage_id),
                )
        conn.execute(
            "UPDATE rating_plan_stages SET sequence = ? WHERE rating_plan_id = ? AND stage_id = ?",
            (to_sequence, draft_plan_id, stage_id),
        )

        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=draft_plan_id,
            event_kind="edit",
            before={
                "reordered_stage": {
                    "stage_id": stage_id,
                    "from_sequence": from_sequence,
                }
            },
            after={
                "reordered_stage": {
                    "stage_id": stage_id,
                    "to_sequence": to_sequence,
                }
            },
            operator_id=operator,
            note=(
                note or f"Moved stage {stage_id!r} from sequence {from_sequence} to {to_sequence}"
            ),
        )
        # Hash recompute (WA-9 retirement) — sequence order is part of the hash
        recompute_content_hash(conn=conn, rating_plan_id=draft_plan_id)
        conn.commit()

    return target.model_copy(update={"sequence": to_sequence})


# ---------------------------------------------------------------------------
# Patch stage I/O
# ---------------------------------------------------------------------------


class DuplicateIONameError(PlanAuthorError):
    """Two inputs or outputs share the same name within one stage."""

    code = "duplicate_io_name"
    default_status_code = 422
    default_hint = "Rename one of the duplicates; input + output names must be unique per stage."


class OutputHasDownstreamConsumersError(PlanAuthorError):
    """Removing one or more outputs would break downstream consumers."""

    code = "output_has_downstream_consumers"
    default_status_code = 409
    default_hint = (
        "Disconnect the listed consumer wires before changing the output set."
    )

    def __init__(
        self,
        message: str,
        *,
        consumers: list[tuple[str, str, str]],
    ) -> None:
        self.consumers = consumers
        super().__init__(
            message,
            details={
                "consumers": [
                    {
                        "consumer_stage_id": c,
                        "consumer_input_name": i_name,
                        "output_name": o_name,
                    }
                    for c, i_name, o_name in consumers
                ]
            },
        )


def patch_stage_io_in_draft(
    *,
    db: Database,
    draft_plan_id: str,
    stage_id: str,
    inputs: list[StageInput],
    outputs: list[StageOutput],
    operator_id: str | None = None,
    note: str | None = None,
) -> tuple[list[StageInput], list[StageOutput]]:
    """Replace a stage's declared inputs + outputs atomically."""
    plan = get_plan(db=db, rating_plan_id=draft_plan_id)
    _require_draft(plan, draft_plan_id, op="patch_stage_io_in_draft")
    from openrater.rates.plans.plan_signoff import assert_plan_unlocked

    assert_plan_unlocked(db=db, rating_plan_id=draft_plan_id)
    operator = operator_id or current_operator()

    current_stages = get_stages(db=db, rating_plan_id=draft_plan_id)
    if not any(s.stage_id == stage_id for s in current_stages):
        raise StageNotFoundError(
            f"patch_stage_io_in_draft: stage_id={stage_id!r} not found in plan {draft_plan_id!r}"
        )

    in_names = [i.input_name for i in inputs]
    if len(in_names) != len(set(in_names)):
        dupes = sorted({n for n in in_names if in_names.count(n) > 1})
        raise DuplicateIONameError(
            f"patch_stage_io_in_draft: duplicate input_name(s) in payload: {dupes}"
        )
    out_names = [o.output_name for o in outputs]
    if len(out_names) != len(set(out_names)):
        dupes = sorted({n for n in out_names if out_names.count(n) > 1})
        raise DuplicateIONameError(
            f"patch_stage_io_in_draft: duplicate output_name(s) in payload: {dupes}"
        )

    _current_inputs, current_outputs = get_stage_io(
        db=db, rating_plan_id=draft_plan_id, stage_id=stage_id
    )
    current_output_names = {o.output_name for o in current_outputs}
    new_output_names = {o.output_name for o in outputs}
    removed_outputs = current_output_names - new_output_names

    consumers: list[tuple[str, str, str]] = []
    if removed_outputs:
        for other in current_stages:
            if other.stage_id == stage_id:
                continue
            other_inputs, _ = get_stage_io(
                db=db, rating_plan_id=draft_plan_id, stage_id=other.stage_id
            )
            for inp in other_inputs:
                if str(inp.input_source) != "stage_output":
                    continue
                parts = inp.input_path.split(".")
                if len(parts) < 3 or parts[0] != "stages":
                    continue
                if parts[1] != stage_id:
                    continue
                ref_output = ".".join(parts[2:])
                if ref_output in removed_outputs:
                    consumers.append((other.stage_id, inp.input_name, ref_output))

    if consumers:
        consumer_summary = ", ".join(
            f"{c}.{i_name}<-{o_name}" for c, i_name, o_name in consumers[:5]
        )
        suffix = " (and more)" if len(consumers) > 5 else ""
        raise OutputHasDownstreamConsumersError(
            f"patch_stage_io_in_draft: removing output(s) "
            f"{sorted(removed_outputs)!r} would break "
            f"{len(consumers)} downstream consumer(s): "
            f"{consumer_summary}{suffix}",
            consumers=consumers,
        )

    before_inputs = [
        {
            "input_name": i.input_name,
            "input_source": str(i.input_source),
            "input_path": i.input_path,
            "data_type": str(i.data_type),
            "required": i.required,
            "default_value": i.default_value,
        }
        for i in _current_inputs
    ]
    before_outputs = [
        {
            "output_name": o.output_name,
            "data_type": str(o.data_type),
            "description": o.description,
        }
        for o in current_outputs
    ]
    after_inputs = [
        {
            "input_name": i.input_name,
            "input_source": str(i.input_source),
            "input_path": i.input_path,
            "data_type": str(i.data_type),
            "required": i.required,
            "default_value": i.default_value,
        }
        for i in inputs
    ]
    after_outputs = [
        {
            "output_name": o.output_name,
            "data_type": str(o.data_type),
            "description": o.description,
        }
        for o in outputs
    ]

    with db.connection() as conn:
        conn.execute(
            "DELETE FROM rating_plan_stage_inputs WHERE rating_plan_id = ? AND stage_id = ?",
            (draft_plan_id, stage_id),
        )
        conn.execute(
            "DELETE FROM rating_plan_stage_outputs WHERE rating_plan_id = ? AND stage_id = ?",
            (draft_plan_id, stage_id),
        )
        for inp in inputs:
            conn.execute(
                """
                INSERT INTO rating_plan_stage_inputs (
                    rating_plan_id, stage_id, input_name, input_source,
                    input_path, data_type, required, default_value
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    draft_plan_id,
                    stage_id,
                    inp.input_name,
                    inp.input_source.value,
                    inp.input_path,
                    inp.data_type,
                    int(inp.required),
                    inp.default_value,
                ),
            )
        for out in outputs:
            conn.execute(
                """
                INSERT INTO rating_plan_stage_outputs (
                    rating_plan_id, stage_id, output_name,
                    data_type, description
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    draft_plan_id,
                    stage_id,
                    out.output_name,
                    out.data_type,
                    out.description,
                ),
            )
        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=draft_plan_id,
            event_kind="edit",
            before={
                "stage_io": {
                    "stage_id": stage_id,
                    "inputs": before_inputs,
                    "outputs": before_outputs,
                }
            },
            after={
                "stage_io": {"stage_id": stage_id, "inputs": after_inputs, "outputs": after_outputs}
            },
            operator_id=operator,
            note=note
            or (
                f"Updated stage {stage_id!r} I/O — {len(inputs)} input(s), {len(outputs)} output(s)"
            ),
        )
        conn.commit()

    return get_stage_io(db=db, rating_plan_id=draft_plan_id, stage_id=stage_id)


# ---------------------------------------------------------------------------
# Promote draft
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PromotionResult:
    """Outcome of a successful `promote_draft` call."""

    new_active_plan_id: str
    archived_plan_id: str | None


def promote_draft(
    *,
    db: Database,
    draft_plan_id: str,
    operator_id: str | None = None,
    note: str | None = None,
) -> PromotionResult:
    """Atomically flip a draft → active and the currently-active sibling → archived.

    Validation runs first. If `validate_plan` returns `valid=False`,
    raises `PlanValidationError(422)` with the typed report.
    """
    operator = operator_id or current_operator()
    plan = get_plan(db=db, rating_plan_id=draft_plan_id)
    _require_draft(plan, draft_plan_id, op="promote_draft")

    report = validate_plan(db=db, rating_plan_id=draft_plan_id)
    if not report.valid:
        raise PlanValidationError(
            f"promote_draft: plan {draft_plan_id!r} failed validation "
            f"({len(report.errors)} error(s)); fix errors before promoting",
            report=report,
        )

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        # The active slot is keyed on the ADR-0033 `product` axis (migration
        # 039) — NOT the legacy `line_of_business` shim, which collapses six
        # products onto 'cgl' and made promotes cross-evict live siblings of
        # a different product (2026-07-11 audit, taxonomy Sev1).
        sibling_row = conn.execute(
            """
            SELECT rating_plan_id, display_name, effective_date
            FROM rating_plans
            WHERE (product IS ? OR product = ?)
              AND (jurisdiction IS ? OR jurisdiction = ?)
              AND status = 'active'
              AND rating_plan_id != ?
            LIMIT 1
            """,
            (
                plan.product.value if plan.product else None,
                plan.product.value if plan.product else None,
                plan.jurisdiction,
                plan.jurisdiction,
                draft_plan_id,
            ),
        ).fetchone()
        archived_id: str | None = None
        archived_snapshot: dict[str, Any] | None = None
        if sibling_row is not None:
            archived_id = sibling_row["rating_plan_id"]
            archived_snapshot = {
                "rating_plan_id": sibling_row["rating_plan_id"],
                "display_name": sibling_row["display_name"],
                "effective_date": sibling_row["effective_date"],
            }
            conn.execute(
                "UPDATE rating_plans SET status = 'archived' WHERE rating_plan_id = ?",
                (archived_id,),
            )

        conn.execute(
            "UPDATE rating_plans SET status = 'active' WHERE rating_plan_id = ?",
            (draft_plan_id,),
        )
        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=draft_plan_id,
            event_kind="promote",
            before={"prior_active": archived_snapshot} if archived_snapshot else None,
            after={
                "rating_plan_id": draft_plan_id,
                "display_name": plan.display_name,
                "product": plan.product.value if plan.product else None,
                "line_of_business": plan.line_of_business.value,
                "jurisdiction": plan.jurisdiction,
            },
            operator_id=operator,
            note=note
            or (
                f"Promoted (archiving {archived_id})"
                if archived_id
                else "Promoted (first active plan in its slot)"
            ),
        )
        conn.commit()

    return PromotionResult(new_active_plan_id=draft_plan_id, archived_plan_id=archived_id)


# ---------------------------------------------------------------------------
# Discard draft
# ---------------------------------------------------------------------------


def discard_draft(
    *,
    db: Database,
    draft_plan_id: str,
    operator_id: str | None = None,
    note: str | None = None,
) -> None:
    """Soft-delete a draft by flipping its status to 'archived'.

    Brief 84 D-E — archiving a LIVE plan turns its API off, in the SAME
    transaction: the published pointer is cleared, so `/quote` 404s
    `no_published_version` and the integration seam's members drop the
    moment the archive lands. No silently-dead-but-still-serving plans.
    (The UI confirm names the consequence before this runs.)
    """
    operator = operator_id or current_operator()
    plan = get_plan(db=db, rating_plan_id=draft_plan_id)
    _require_draft(plan, draft_plan_id, op="discard_draft")

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        # One explicit transaction — the connection is autocommit (db.py
        # `isolation_level=None`), and D-E's promise is that the archive
        # and its API-off consequence land (or roll back) TOGETHER.
        conn.execute("BEGIN IMMEDIATE;")
        try:
            was_published = conn.execute(
                """
                SELECT snapshot_id, display_name FROM plan_snapshots
                WHERE plan_id = ? AND published_at IS NOT NULL
                ORDER BY published_at DESC LIMIT 1
                """,
                (draft_plan_id,),
            ).fetchone()
            conn.execute(
                "UPDATE rating_plans SET status = 'archived' WHERE rating_plan_id = ?",
                (draft_plan_id,),
            )
            conn.execute(
                """
                UPDATE plan_snapshots
                   SET published_at = NULL, published_by = NULL
                 WHERE plan_id = ? AND published_at IS NOT NULL
                """,
                (draft_plan_id,),
            )
            if was_published is not None:
                # The pointer was cleared with no successor — record the
                # API-off moment (migration 040; 2026-07-11 audit).
                write_audit_event(
                    db=db,
                    conn=conn,
                    rating_plan_id=draft_plan_id,
                    event_kind="unpublish",
                    before={
                        "snapshot_id": was_published["snapshot_id"],
                        "display_name": was_published["display_name"],
                    },
                    after=None,
                    operator_id=operator,
                    note="Archived — published pointer cleared; the quote API is off (D-E)",
                )
            write_audit_event(
                db=db,
                conn=conn,
                rating_plan_id=draft_plan_id,
                event_kind="discard",
                before={
                    "rating_plan_id": draft_plan_id,
                    "display_name": plan.display_name,
                    "status": "draft",
                },
                after=None,
                operator_id=operator,
                note=note or "Draft discarded",
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


# ---------------------------------------------------------------------------
# Hard-delete (status='archived' → permanent removal)
# ---------------------------------------------------------------------------


class PlanNotArchivedError(PlanAuthorError):
    """Tried to hard-delete a plan that isn't in 'archived' status.

    Hard-delete is restricted to archived plans so the user can't
    accidentally lose a draft they're still iterating on (drafts must
    be discarded first) or an active/proposed plan (which need rollback
    first). This is the data-loss prevention rail.
    """

    code = "plan_not_archived"
    default_status_code = 409
    default_hint = (
        "Only archived plans can be permanently deleted. Discard a "
        "draft first, or roll back an active plan, before hard-deleting."
    )


class PlanDeleteBlockedError(PlanAuthorError):
    """Hard-delete refused: durable records still hang off this plan.

    Deleting the row cascades its snapshots away — but integration
    exposures reference the plan (the pairing would silently lose that
    carrier mid-day). The operator either detaches those first, or
    passes force=true and owns the consequence — the audit event
    records the severed counts (2026-07-11 audit, delete-guard Sev2).
    """

    code = "plan_delete_blocked"
    default_status_code = 409
    default_hint = (
        "Un-expose the plan from its integration(s) in the Hub first; "
        "pass force=true only to knowingly sever them."
    )


def hard_delete_plan(
    *,
    db: Database,
    rating_plan_id: str,
    operator_id: str | None = None,
    note: str | None = None,
    force: bool = False,
) -> None:
    """Permanently remove an archived plan + all of its child rows.

    Hard-delete is the second stage of the two-step delete flow (the
    first being `discard_draft`). It removes the row from
    `rating_plans` and lets ON DELETE CASCADE clean up the FK-attached
    children:

      · plan_dimensions          (FK CASCADE)
      · plan_factor_tables       (FK CASCADE → cells via their own FK)
      · plan_input_mappings      (FK CASCADE)
      · rating_plan_stages       (FK CASCADE → stage I/O via their own FK)

    The non-cascading `plan_snapshots` table is cleaned manually before
    the parent row goes.

    Audit entries in `audit_log` are PRESERVED. Migration 012 dropped
    the FK from `audit_log.rating_plan_id` to `rating_plans` — the
    column is now a soft reference. Existing audit rows survive the
    hard delete, still carrying the now-orphan plan id so compliance
    queries like "show me everything that happened to plan X" still
    work even after X is gone. A final 'hard_delete' event is written
    before the deletion so the audit timeline shows the permanent-
    removal moment.

    Precondition: plan.status MUST be 'archived'. Drafts/active/
    proposed plans raise `PlanNotArchivedError`. PlanNotFoundError
    bubbles up unchanged when the plan id is unknown.
    """
    operator = operator_id or current_operator()
    plan = get_plan(db=db, rating_plan_id=rating_plan_id)
    if plan is None:
        raise PlanNotFoundError(
            f"hard_delete_plan: plan_id={rating_plan_id!r} not found"
        )
    if plan.status != "archived":
        # The envelope speaks values, never enum representations
        # ("status 'draft'", not "<PlanStatus.DRAFT: 'draft'>").
        status_value = getattr(plan.status, "value", plan.status)
        raise PlanNotArchivedError(
            f"Plan {rating_plan_id!r} has status '{status_value}'; "
            f"hard-delete requires 'archived'."
        )

    # The DELETE below cascades `plan_snapshots`, but integration exposures
    # reference the plan
    # (CASCADE would silently drop that carrier from a pairing). Refuse
    # unless the operator detaches first or forces knowingly.
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        exposures = conn.execute(
            "SELECT COUNT(*) AS n FROM integration_exposed_plans"
            " WHERE rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchone()["n"]
    if exposures and not force:
        raise PlanDeleteBlockedError(
            f"Plan {rating_plan_id!r} is still referenced: "
            f"{exposures} integration exposure(s). Detach them or pass "
            f"force=true."
        )

    # Snapshot of the pre-delete plan for the audit trail — copied
    # OUT of the row before the DELETE removes it. Keeps the audit
    # entry self-contained so a future query can reconstruct what
    # was removed without joining to the (now-gone) plan row.
    plan_snapshot = {
        "rating_plan_id": rating_plan_id,
        "display_name": plan.display_name,
        "line_of_business": plan.line_of_business,
        "status": plan.status,
        "effective_date": str(plan.effective_date) if plan.effective_date else None,
        "severed": {
            "integration_exposures": exposures,
        },
    }

    with db.connection() as conn:
        # Final audit entry BEFORE the cascade DELETE. The 'hard_delete'
        # event_kind was added to the audit_log CHECK constraint by
        # migration 012. Operator+note together let a future reader
        # see who removed the plan and why.
        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=rating_plan_id,
            event_kind="hard_delete",
            before=plan_snapshot,
            after=None,
            operator_id=operator,
            note=note,
        )
        # Manual cleanup for tables without ON DELETE CASCADE.
        conn.execute(
            "DELETE FROM plan_snapshots WHERE plan_id = ?",
            (rating_plan_id,),
        )
        # The parent DELETE triggers cascade for plan_dimensions,
        # plan_factor_tables (→ factor_table_cells), rating_plan_stages,
        # plan_input_mappings. audit_log rows are NOT cascaded (FK
        # dropped in migration 012) — by design.
        conn.execute(
            "DELETE FROM rating_plans WHERE rating_plan_id = ?",
            (rating_plan_id,),
        )
        conn.commit()


# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------


class NoArchivedSiblingError(PlanAuthorError):
    """Tried to roll back an active plan, but no archived sibling exists."""

    code = "no_archived_sibling"
    default_status_code = 409
    default_hint = "Roll-back requires a previously-promoted plan for the same LOB+jurisdiction."


@dataclass(frozen=True)
class RollbackResult:
    """Outcome of a successful `rollback_plan` call."""

    new_active_plan_id: str
    archived_plan_id: str


def rollback_plan(
    *,
    db: Database,
    rating_plan_id: str,
    operator_id: str | None = None,
    note: str | None = None,
) -> RollbackResult:
    """Atomically swap the current active plan with its most-recently-
    archived sibling (same LOB + jurisdiction)."""
    from openrater.rates.plans.state_machine import Action, assert_action_allowed

    operator = operator_id or current_operator()
    plan = assert_action_allowed(
        get_plan(db=db, rating_plan_id=rating_plan_id),
        action=Action.ROLLBACK,
    )

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        if plan.jurisdiction is None:
            target_row = conn.execute(
                """
                SELECT rating_plan_id, display_name, effective_date
                FROM rating_plans
                WHERE line_of_business = ?
                  AND jurisdiction IS NULL
                  AND status = 'archived'
                  AND rating_plan_id != ?
                ORDER BY effective_date DESC, rating_plan_id DESC
                LIMIT 1
                """,
                (plan.line_of_business.value, rating_plan_id),
            ).fetchone()
        else:
            target_row = conn.execute(
                """
                SELECT rating_plan_id, display_name, effective_date
                FROM rating_plans
                WHERE line_of_business = ?
                  AND jurisdiction = ?
                  AND status = 'archived'
                  AND rating_plan_id != ?
                ORDER BY effective_date DESC, rating_plan_id DESC
                LIMIT 1
                """,
                (plan.line_of_business.value, plan.jurisdiction, rating_plan_id),
            ).fetchone()

        if target_row is None:
            raise NoArchivedSiblingError(
                f"rollback_plan: plan {rating_plan_id!r} has no archived "
                f"sibling in ({plan.line_of_business.value}, "
                f"{plan.jurisdiction or 'multistate'}) to roll back to"
            )

        target_id = target_row["rating_plan_id"]
        target_snapshot = {
            "rating_plan_id": target_row["rating_plan_id"],
            "display_name": target_row["display_name"],
            "effective_date": target_row["effective_date"],
        }

        conn.execute(
            "UPDATE rating_plans SET status = 'archived' WHERE rating_plan_id = ?",
            (rating_plan_id,),
        )
        conn.execute(
            "UPDATE rating_plans SET status = 'active' WHERE rating_plan_id = ?",
            (target_id,),
        )

        rollback_note = note or f"Rolled back from {rating_plan_id} to {target_id}"
        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=rating_plan_id,
            event_kind="rollback",
            before={
                "rating_plan_id": rating_plan_id,
                "display_name": plan.display_name,
                "status": "active",
            },
            after={
                "rating_plan_id": rating_plan_id,
                "status": "archived",
                "rolled_back_to": target_snapshot,
            },
            operator_id=operator,
            note=rollback_note,
        )
        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=target_id,
            event_kind="rollback",
            before={
                "rating_plan_id": target_id,
                "display_name": target_row["display_name"],
                "status": "archived",
            },
            after={
                "rating_plan_id": target_id,
                "status": "active",
                "rolled_back_from": {
                    "rating_plan_id": rating_plan_id,
                    "display_name": plan.display_name,
                },
            },
            operator_id=operator,
            note=rollback_note,
        )
        conn.commit()

    return RollbackResult(
        new_active_plan_id=target_id,
        archived_plan_id=rating_plan_id,
    )


# ===========================================================================
# Stage positions — operator-nudge coordinates (no audit, no lock check)
# ===========================================================================


@dataclass(frozen=True)
class StagePositionPatch:
    """One stage_id → (x, y) update."""

    stage_id: str
    x: float | None
    y: float | None


def patch_stage_positions(
    *,
    db: Database,
    rating_plan_id: str,
    patches: list[StagePositionPatch],
) -> list[Stage]:
    """Persist a batch of operator-nudge coordinates atomically."""
    if not patches:
        return get_stages(db=db, rating_plan_id=rating_plan_id)

    plan = get_plan(db=db, rating_plan_id=rating_plan_id)
    if plan is None:
        raise PlanNotFoundError(f"patch_stage_positions: plan {rating_plan_id!r} not found")

    current = {s.stage_id: s for s in get_stages(db=db, rating_plan_id=rating_plan_id)}
    unknown = [p.stage_id for p in patches if p.stage_id not in current]
    if unknown:
        raise StageNotFoundError(
            f"patch_stage_positions: stage_id(s) {unknown!r} not found in plan "
            f"{rating_plan_id!r}; valid: {sorted(current)}"
        )

    with db.connection() as conn:
        for p in patches:
            conn.execute(
                """
                UPDATE rating_plan_stages
                SET x_position = ?, y_position = ?
                WHERE rating_plan_id = ? AND stage_id = ?
                """,
                (p.x, p.y, rating_plan_id, p.stage_id),
            )
        conn.commit()

    return get_stages(db=db, rating_plan_id=rating_plan_id)


# ===========================================================================
# Wire authoring (drag output → input)
# ===========================================================================


class WireCycleError(PlanAuthorError):
    """The proposed wire would create a cycle."""

    code = "wire_cycle"
    default_status_code = 409
    default_hint = "A wire from a downstream stage back to an upstream stage isn't allowed."


class WireNotFoundError(PlanAuthorError):
    """The disconnect target doesn't exist."""

    code = "wire_not_found"
    default_status_code = 404


class WireOutputNotFoundError(PlanAuthorError):
    """The producer stage doesn't declare the requested output_name."""

    code = "wire_output_not_found"
    default_status_code = 404
    default_hint = "Declare the output on the producer stage first."


class WireInputNameConflictError(PlanAuthorError):
    """The to_input_name already exists but points to a DIFFERENT source."""

    code = "wire_input_name_conflict"
    default_status_code = 409
    default_hint = (
        "Disconnect the existing wire to this input_name first, or pick a different input."
    )


def connect_wire(
    *,
    db: Database,
    draft_plan_id: str,
    from_stage_id: str,
    from_output_name: str,
    to_stage_id: str,
    to_input_name: str,
    data_type: str = "number",
    required: bool = True,
    operator_id: str | None = None,
) -> StageInput:
    """Wire one upstream output to one downstream input. Idempotent."""
    plan = get_plan(db=db, rating_plan_id=draft_plan_id)
    _require_draft(plan, draft_plan_id, op="connect_wire")
    from openrater.rates.plans.plan_signoff import assert_plan_unlocked

    assert_plan_unlocked(db=db, rating_plan_id=draft_plan_id)
    operator = operator_id or current_operator()

    stages_by_id = {s.stage_id: s for s in get_stages(db=db, rating_plan_id=draft_plan_id)}
    if from_stage_id not in stages_by_id:
        raise StageNotFoundError(
            f"connect_wire: from_stage_id={from_stage_id!r} not found in plan {draft_plan_id!r}"
        )
    if to_stage_id not in stages_by_id:
        raise StageNotFoundError(
            f"connect_wire: to_stage_id={to_stage_id!r} not found in plan {draft_plan_id!r}"
        )

    producer = stages_by_id[from_stage_id]
    consumer = stages_by_id[to_stage_id]
    if producer.sequence >= consumer.sequence:
        raise WireCycleError(
            f"connect_wire: from_stage {from_stage_id!r} (sequence={producer.sequence}) "
            f"is not before to_stage {to_stage_id!r} (sequence={consumer.sequence}); "
            f"reorder stages first"
        )

    _producer_inputs, producer_outputs = get_stage_io(
        db=db, rating_plan_id=draft_plan_id, stage_id=from_stage_id
    )
    if not any(o.output_name == from_output_name for o in producer_outputs):
        declared = sorted(o.output_name for o in producer_outputs)
        raise WireOutputNotFoundError(
            f"connect_wire: stage {from_stage_id!r} doesn't declare output "
            f"{from_output_name!r}; declared: {declared or '(none)'}"
        )

    consumer_inputs, _ = get_stage_io(db=db, rating_plan_id=draft_plan_id, stage_id=to_stage_id)
    target_path = f"stages.{from_stage_id}.{from_output_name}"
    existing = next((i for i in consumer_inputs if i.input_name == to_input_name), None)
    if existing is not None:
        if str(existing.input_source) == "stage_output" and existing.input_path == target_path:
            return existing
        raise WireInputNameConflictError(
            f"connect_wire: input_name {to_input_name!r} on stage {to_stage_id!r} "
            f"already exists with source={existing.input_source} path={existing.input_path!r}; "
            f"disconnect first or use a different name"
        )

    before_snapshot = {"input_name": to_input_name, "exists": False}
    new_input = StageInput(
        input_name=to_input_name,
        input_source=InputSource.STAGE_OUTPUT,
        input_path=target_path,
        data_type=data_type,
        required=required,
        default_value=None,
    )
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO rating_plan_stage_inputs
                (rating_plan_id, stage_id, input_name, input_source, input_path,
                 data_type, required, default_value)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                draft_plan_id,
                to_stage_id,
                to_input_name,
                str(new_input.input_source),
                new_input.input_path,
                new_input.data_type,
                int(new_input.required),
                None,
            ),
        )
        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=draft_plan_id,
            event_kind="edit",
            before={"wire": before_snapshot},
            after={
                "wire": {
                    "from_stage_id": from_stage_id,
                    "from_output_name": from_output_name,
                    "to_stage_id": to_stage_id,
                    "to_input_name": to_input_name,
                }
            },
            operator_id=operator,
            note=f"Connected wire {from_stage_id}.{from_output_name} → {to_stage_id}.{to_input_name}",
        )
        conn.commit()

    return new_input


def disconnect_wire(
    *,
    db: Database,
    draft_plan_id: str,
    to_stage_id: str,
    to_input_name: str,
    operator_id: str | None = None,
) -> None:
    """Remove the input row identified by (to_stage_id, to_input_name)."""
    plan = get_plan(db=db, rating_plan_id=draft_plan_id)
    _require_draft(plan, draft_plan_id, op="disconnect_wire")
    from openrater.rates.plans.plan_signoff import assert_plan_unlocked

    assert_plan_unlocked(db=db, rating_plan_id=draft_plan_id)
    operator = operator_id or current_operator()

    consumer_inputs, _ = get_stage_io(db=db, rating_plan_id=draft_plan_id, stage_id=to_stage_id)
    existing = next((i for i in consumer_inputs if i.input_name == to_input_name), None)
    if existing is None:
        raise WireNotFoundError(
            f"disconnect_wire: input_name {to_input_name!r} not found on "
            f"stage {to_stage_id!r} in plan {draft_plan_id!r}"
        )

    with db.connection() as conn:
        conn.execute(
            """
            DELETE FROM rating_plan_stage_inputs
            WHERE rating_plan_id = ? AND stage_id = ? AND input_name = ?
            """,
            (draft_plan_id, to_stage_id, to_input_name),
        )
        write_audit_event(
            db=db,
            conn=conn,
            rating_plan_id=draft_plan_id,
            event_kind="edit",
            before={
                "wire": {
                    "to_stage_id": to_stage_id,
                    "to_input_name": to_input_name,
                    "input_source": str(existing.input_source),
                    "input_path": existing.input_path,
                }
            },
            after={
                "wire": {
                    "to_stage_id": to_stage_id,
                    "to_input_name": to_input_name,
                    "exists": False,
                }
            },
            operator_id=operator,
            note=f"Disconnected wire {to_stage_id}.{to_input_name}",
        )
        conn.commit()


__all__ = [
    "DEFAULT_OPERATOR_ID",
    "AuditEvent",
    "CreatePlanTemplate",
    "DuplicateIONameError",
    "DuplicateStageIdError",
    "IllegalStateTransitionError",
    "InvalidSequenceError",
    "NoArchivedSiblingError",
    "OutputHasDownstreamConsumersError",
    "PlanAuthorError",
    "PlanNotArchivedError",
    "PlanNotForkableError",
    "PlanNotFoundError",
    "PlanValidationError",
    "PlanValidationReport",
    "PromotionResult",
    "RollbackResult",
    "StageHasDownstreamConsumersError",
    "StageInsertPositionError",
    "StageNotFoundError",
    "StagePatch",
    "StagePositionPatch",
    "StageReorderBreaksDagError",
    "UnknownTemplateError",
    "ValidationError",
    "WireCycleError",
    "WireInputNameConflictError",
    "WireNotFoundError",
    "WireOutputNotFoundError",
    "add_stage_to_draft",
    "connect_wire",
    "create_plan",
    "current_operator",
    "disconnect_wire",
    "discard_draft",
    "duplicate_plan",
    "fork_plan",
    "hard_delete_plan",
    "list_audit_events",
    "patch_draft_stages",
    "patch_stage_io_in_draft",
    "patch_stage_positions",
    "promote_draft",
    "remove_stage_from_draft",
    "reorder_stage_in_draft",
    "rollback_plan",
    "validate_plan",
    "write_audit_event",
]
