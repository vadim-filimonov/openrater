# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Quote orchestration (Brief 76, v4 P4).

A quote resolves the plan's version of record — the PUBLISHED snapshot by
default (D-B) — composes a scoring request from that immutable body, and
returns the composed FILED premium WITHOUT persisting anything (D-A). It
reuses the run-zone delegation (`plan_stages_request` + `score_once`) so a
quote and a run of the same risk on the same version return the identical
number (Law 1); the only quote-specific logic is version resolution.
"""

from __future__ import annotations

from typing import Any

from openrater.errors import ConflictError, NotFoundError
from openrater.persistence.db import Database
from openrater.rates.ingest.reports import (
    get_build_report_for_plan,
    verification_verdict,
)
from openrater.rates.inputs_mapping.repo import get_input_mapping
from openrater.rates.plans.models import PlanStatus
from openrater.rates.plans.repo import get_plan
from openrater.rates.quotes.models import QuoteRequest, QuoteResponse, QuoteVersion
from openrater.rates.runs.scoring import (
    plan_stages_request,
    plan_stages_source_fields,
    score_once,
    score_policy_once,
)
from openrater.rates.snapshots.service import (
    compose_plan_body,
    get_published_snapshot_with_body,
    get_snapshot_with_body,
)


def _plan_health_issues(
    *, db: Database, rating_plan_id: str, version: QuoteVersion
) -> list[dict[str, Any]]:
    """FCA fca-2026-07-25 #6 (critical) — pricing-time silence. A plan
    whose build verification MISMATCHED the filing, and whose ledger
    declared money-affecting gaps, quoted a bare premium: row_status
    'ok', plan_issues null, the only qualifier a version.kind buried
    in metadata. The honesty existed at build time and evaporated at
    the exact moment someone relied on the number.

    These are WARNINGS — qualifiers, never refusals: the premium still
    serves and row_status is untouched. They read the plan's LATEST
    build report (the message says so), which is the health signal a
    caller needs regardless of which version answered the quote.
    """
    issues: list[dict[str, Any]] = []
    report = get_build_report_for_plan(db=db, rating_plan_id=rating_plan_id)
    if report is not None:
        v = report.vectors
        if verification_verdict(v) == "mismatches":
            near = f", {v.near} near" if v.near else ""
            issues.append(
                {
                    "severity": "warning",
                    "code": "verification_mismatches",
                    "message": (
                        f"The plan's latest build did NOT reproduce the "
                        f"filing: {v.mismatched} of {v.total_cases} "
                        f"verification check(s) mismatched "
                        f"({v.matched} matched{near}). Review the build "
                        f"report before relying on this number."
                    ),
                }
            )
        if report.gaps:
            n = len(report.gaps)
            issues.append(
                {
                    "severity": "warning",
                    "code": "declared_gaps",
                    "message": (
                        f"The build declares {n} transcription "
                        f"gap(s)/assumption(s) in its ledger — some may "
                        f"affect premium. See the build report's gaps "
                        f"ledger."
                    ),
                }
            )
    if version.kind == "draft":
        issues.append(
            {
                "severity": "warning",
                "code": "draft_version",
                "message": (
                    "Quoted from the working DRAFT — unpublished, not "
                    "signed off, and subject to change. The published "
                    "version is the version of record."
                ),
            }
        )
    return issues


def quote_plan(
    *,
    db: Database,
    rating_plan_id: str,
    request: QuoteRequest,
    snapshot_id: str | None = None,
    draft: bool = False,
    scoring_base_url: str | None = None,
) -> QuoteResponse:
    plan = get_plan(db=db, rating_plan_id=rating_plan_id)
    if plan is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )

    # An archived plan is API off (Brief 84 D-E). The default path already
    # refuses (archive clears the published pointer), but `?draft=true` and
    # `?snapshot_id=` bypassed that and still priced it (audit A-2026-07-12
    # P1-04). Guard all three paths uniformly so an archived plan never
    # serves a premium, by any door.
    if plan.status == PlanStatus.ARCHIVED:
        raise ConflictError(
            f"Plan {rating_plan_id!r} is archived — it no longer serves "
            f"quotes (Brief 84 D-E: an archived plan is read-only, API off).",
            code="plan_archived",
            param="rating_plan_id",
        )

    # ── Resolve the version (D-B: published is 'what's live'). ──
    if draft:
        body = compose_plan_body(db=db, plan_id=rating_plan_id)
        version = QuoteVersion(kind="draft", content_hash=plan.content_hash)
    elif snapshot_id is not None:
        snap = get_snapshot_with_body(
            db=db, plan_id=rating_plan_id, snapshot_id=snapshot_id
        )
        if snap is None:
            raise NotFoundError(
                f"Snapshot {snapshot_id!r} not found on plan {rating_plan_id!r}.",
                code="snapshot_not_found",
                param="snapshot_id",
            )
        body = snap.body
        version = QuoteVersion(kind="snapshot", snapshot_id=snap.snapshot_id)
    else:
        snap = get_published_snapshot_with_body(db=db, plan_id=rating_plan_id)
        if snap is None:
            raise NotFoundError(
                "This plan has no published version — publish one first, or "
                "pass ?draft=true to quote the working draft.",
                code="no_published_version",
                param="rating_plan_id",
            )
        body = snap.body
        version = QuoteVersion(kind="published", snapshot_id=snap.snapshot_id)

    # ── A POLICY quote (N locations → one rolled-up premium, P4.1b). ──
    if request.is_policy:
        return _quote_policy(
            db=db,
            rating_plan_id=rating_plan_id,
            request=request,
            body=body,
            version=version,
            scoring_base_url=scoring_base_url,
        )

    # ── A single-risk quote (the SAME composition the Run zone runs). ──
    score_request = plan_stages_request(
        body=body,
        inputs=request.inputs,
        as_of=request.as_of,
        trace=request.trace,
    )
    result = score_once(request=score_request, base_url=scoring_base_url)
    views = result.get("views") or {}
    row_status = result.get("row_status") or "ok"

    # FCA #6 — plan health rides every quote (warnings, never refusals).
    plan_issues = [
        *(result.get("planIssues") or []),
        *_plan_health_issues(
            db=db, rating_plan_id=rating_plan_id, version=version
        ),
    ]

    return QuoteResponse(
        # Law 1 — THE premium is composed.final (surfaced as views.premium
        # since G4); null when the plan refuses the risk (Law 2).
        premium=views.get("premium"),
        tier=views.get("tier"),
        row_status=row_status,
        # Law 2 — a quote is an ANSWER surface, so a refusal carries no
        # number, and a PARTIAL chain leaves real ones. When one chain of
        # several resolves (liability computes, property refuses), the engine
        # keeps the resolved sibling in `outputs` for the AUTHOR's diagnosis
        # (deriveViews, deliberately — the RUN path + trace surface it in run
        # history); a QUOTE withholds it on an error row exactly as it
        # withholds `premium`. `composed`/`views.premium` are already withheld
        # upstream on an error row; `outputs` is the one that rode through.
        # The integration seam re-clamps as defense in depth
        # (quote_set._quote_member).
        outputs=(result.get("outputs") or {}) if row_status == "ok" else {},
        composed=result.get("composed"),
        row_issues=result.get("rowIssues"),
        plan_issues=plan_issues or None,
        input_issues=result.get("inputIssues"),
        trace=result.get("trace"),
        as_of=result.get("as_of") or request.as_of,
        version=version,
    )


def _quote_policy(
    *,
    db: Database,
    rating_plan_id: str,
    request: QuoteRequest,
    body: dict[str, Any],
    version: QuoteVersion,
    scoring_base_url: str | None,
) -> QuoteResponse:
    """Compose N locations into ONE policy via the scoring service's
    synchronous /score-policy seam. The roll-up declarations come from the
    plan's mapping (so a tail GLM whose features are policy aggregates sums
    correctly — the SAME fields the book path rolls); per-policy constants
    ride `policy_inputs`, merged into every location."""
    policy_inputs = request.policy_inputs or {}
    locations = [
        {**policy_inputs, **loc} for loc in (request.locations or [])
    ]

    # The roll-up declarations ride the RESOLVED version's frozen body —
    # snapshots capture `input_mapping` precisely so a published version
    # re-scores as filed. Reading the live mapping here let draft edits
    # silently change published/pinned multi-location quotes (2026-07-11
    # audit). Legacy snapshots frozen before input_mapping joined the body
    # lack the key entirely; only those fall back to the live mapping.
    if "input_mapping" in body:
        frozen = body.get("input_mapping")
        mapping_dict = (
            (frozen or {}).get("mapping") if isinstance(frozen, dict) else None
        )
        rollup_fields = (mapping_dict or {}).get("rollup_fields") or []
    else:
        envelope = get_input_mapping(db=db, rating_plan_id=rating_plan_id)
        rollup_fields = (
            (envelope.mapping.get("rollup_fields") if envelope else None) or []
        )

    policy_request: dict[str, Any] = {
        **plan_stages_source_fields(body),
        # G9 — a policy floors ONCE, post-tail, at composition.
        "projectorOptions": {"minPremiumScope": "policy"},
        "locations": locations,
        "trace": request.trace,
    }
    if rollup_fields:
        policy_request["rollupFields"] = rollup_fields
    if policy_inputs:
        policy_request["policyInputKeys"] = sorted(policy_inputs.keys())
    if request.as_of:
        policy_request["options"] = {"as_of": request.as_of}

    result = score_policy_once(request=policy_request, base_url=scoring_base_url)
    # FCA #6 — plan health rides policy quotes identically.
    plan_issues = [
        *(result.get("planIssues") or []),
        *_plan_health_issues(
            db=db, rating_plan_id=rating_plan_id, version=version
        ),
    ]
    return QuoteResponse(
        premium=result.get("premium"),
        tier=result.get("tier"),
        row_status=result.get("row_status") or "ok",
        outputs={},
        composed=result.get("composed"),
        # Law 2 — a policy-level refusal (e.g. composition_failed over a
        # total-less plan) names itself to the quote consumer.
        row_issues=result.get("rowIssues"),
        plan_issues=plan_issues or None,
        input_issues=None,
        trace=result.get("trace"),
        as_of=result.get("as_of") or request.as_of,
        version=version,
        locations=result.get("locations"),
        location_count=result.get("location_count"),
    )
