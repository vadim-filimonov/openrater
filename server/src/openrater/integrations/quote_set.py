# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The quote-set composer (ADR-0057 D4/D5, contract §4 — L2).

One pseudonymous risk in, one answer per exposed carrier plan out. The
composer owns the SEAM concerns — identity guard, carrier scoping,
mapping application (facts in, gap names out), trace clamping, version
pins, validity — and delegates every premium to the Brief-76
`quote_plan` path, so a member and a direct per-plan quote are the
same computation on the same version (Law 1; conformance IC3 pins it).

Write-nothing (Brief 76 D-A stands): the composer computes and returns.
Partial failure is normal — a refusing or unpublished plan never takes
its siblings down; integration-level notes ride `issues[]`.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from openrater.errors import NotFoundError, ValidationError
from openrater.integrations.models import (
    ExposedPlan,
    MappingEntry,
    QuoteSetMember,
    QuoteSetRequest,
    QuoteSetResponse,
    QuoteSetVersion,
    TracePolicy,
)
from openrater.integrations.repo import list_exposed_plans
from openrater.integrations.service import live_version_untested, reject_identity_keys
from openrater.persistence.db import Database
from openrater.rates.quotes.models import QuoteRequest
from openrater.rates.quotes.service import quote_plan
from openrater.rates.runs.scoring import ScoringFailedError, ScoringUnavailableError
from openrater.rates.snapshots.service import (
    get_published_snapshot_with_body,
    get_snapshot_with_body,
)

_TRACE_RANK: dict[str, int] = {"none": 0, "summary": 1, "full": 2}


def _clamp_trace(requested: TracePolicy, ceiling: TracePolicy) -> TracePolicy:
    """§4.3 — the plan's policy is a ceiling; the clamp is echoed."""
    return requested if _TRACE_RANK[requested] <= _TRACE_RANK[ceiling] else ceiling


def _valid_until(validity_days: int) -> str:
    """§4.4 — quote date + validity_days. Supersession additionally
    soft-flags (ADR-0057 resolution 1); nothing hard-expires here."""
    today = datetime.now(timezone.utc).date()
    return date.fromordinal(today.toordinal() + validity_days).isoformat()


def _translate_input_issues(
    issues: dict[str, Any] | None, mapping: list[MappingEntry]
) -> dict[str, Any] | None:
    """§4.2 rule 2 — the engine's preflight names gaps in PLAN vocabulary
    (`missing_inputs` / `unknown_inputs`); the seam re-names every entry
    through the mapping (plan_input_key → peer_key) into the same
    `missing` / `unknown` shape the composer's own required-field check
    emits. A plan input the mapping never covered can't be said in peer
    vocabulary: it surfaces under `unmapped_plan_inputs` — named, not
    dropped (Law 2) — because the fix is the plan owner's mapping, not
    the peer's facts. Keys the seam can't translate don't ride through."""
    if not issues:
        return None
    to_peer = {entry.plan_input_key: entry.peer_key for entry in mapping}
    missing: set[str] = set()
    unknown: set[str] = set()
    unmapped: set[str] = set()
    for plan_key in issues.get("missing_inputs") or []:
        peer_key = to_peer.get(plan_key)
        if peer_key is None:
            unmapped.add(plan_key)
        else:
            missing.add(peer_key)
    for plan_key in issues.get("unknown_inputs") or []:
        peer_key = to_peer.get(plan_key)
        if peer_key is None:
            unmapped.add(plan_key)
        else:
            unknown.add(peer_key)
    translated = {
        key: sorted(names)
        for key, names in (
            ("missing", missing),
            ("unknown", unknown),
            ("unmapped_plan_inputs", unmapped),
        )
        if names
    }
    return translated or None


def _published_pins(
    *, db: Database, exposed: ExposedPlan
) -> QuoteSetVersion | None:
    """The member's replay pins: published snapshot id + the body's own
    content hash (the same hash `publish_status` reads)."""
    snap = get_published_snapshot_with_body(db=db, plan_id=exposed.rating_plan_id)
    if snap is None:
        return None
    body_hash = snap.body.get("plan_content_hash") if isinstance(snap.body, dict) else None
    return QuoteSetVersion(
        kind="published",
        snapshot_id=snap.snapshot_id,
        content_hash=body_hash if isinstance(body_hash, str) else None,
    )


def _pinned_version(
    *, db: Database, exposed: ExposedPlan, snapshot_id: str
) -> QuoteSetVersion | None:
    """§4.6 — resolve the PINNED frozen version of the pinned plan. None
    when the snapshot doesn't exist or belongs to a different plan (the
    lookup is plan-scoped, so a pin can never quote across plans)."""
    snap = get_snapshot_with_body(
        db=db, plan_id=exposed.rating_plan_id, snapshot_id=snapshot_id
    )
    if snap is None:
        return None
    body_hash = snap.body.get("plan_content_hash") if isinstance(snap.body, dict) else None
    return QuoteSetVersion(
        kind="snapshot",
        snapshot_id=snap.snapshot_id,
        content_hash=body_hash if isinstance(body_hash, str) else None,
    )


def test_quote_member(
    *, db: Database, exposed: ExposedPlan, facts: dict[str, Any]
) -> QuoteSetMember:
    """Brief 77 step 5 — the Hub's in-app try-it: ONE member, the same
    composer path the peer's quote-set runs (Law 1 for the test too).
    Identity guard included; nothing persisted here — the caller stamps
    the receipt on a green result."""
    reject_identity_keys(list(facts.keys()))
    request = QuoteSetRequest(
        risk_ref=f"test:{exposed.exposed_id}",
        effective_date=datetime.now(timezone.utc).date().isoformat(),
        trace="summary",
        facts=facts,
    )
    member = _quote_member(
        db=db,
        exposed=exposed,
        request=request,
        as_of=request.effective_date,
        issues=[],
    )
    if member is None:
        # No published version — say it the way the composer would.
        raise NotFoundError(
            "This plan has no published version — publish one first.",
            code="no_published_version",
            param="exposed_id",
        )
    return member


def compose_quote_set(
    *, db: Database, integration_id: str, request: QuoteSetRequest
) -> QuoteSetResponse:
    if request.locations is not None:
        raise ValidationError(
            "`locations` is reserved — policy quotes land in v1.1 "
            "(integration contract §4.1; ADR-0057 resolution 5).",
            code="locations_reserved",
            param="locations",
        )
    # §7 — the deny-classes, request-side (the catalog was guarded at
    # pairing; the facts are guarded on every quote). Named-keys 422.
    reject_identity_keys(list(request.facts.keys()))

    exposed_plans = list_exposed_plans(db=db, integration_id=integration_id)
    by_label = {p.carrier_label: p for p in exposed_plans}
    as_of = request.as_of or request.effective_date

    issues: list[dict[str, Any]] = []
    scope: list[ExposedPlan] = []

    def _serving_note(p: ExposedPlan) -> dict[str, Any] | None:
        """Why an exposed plan is NOT in the live serving scope — None means
        it IS. `plan_paused` = the operator turned the toggle off;
        `live_version_untested` = the toggle is on but the currently-published
        version drifted from the one that passed its Hub mapping test (audit
        2026-07-11 gap #3), so the seam demotes it rather than price an
        unvalidated mapping live. Either way it's a NAMED integration-level
        issue, never a silent drop; re-running the Test step restores it."""
        if not p.live:
            return {"code": "plan_paused", "carrier": p.carrier_label}
        if live_version_untested(db=db, exposed=p):
            return {"code": "live_version_untested", "carrier": p.carrier_label}
        return None

    pinned_version: QuoteSetVersion | None = None
    if request.pins is not None:
        # §4.6 (ADR-0060 rule 8) — the pinned re-rate: scope collapses to
        # the ONE named plan at the ONE named frozen version. The
        # `live_version_untested` drift gate is deliberately NOT consulted:
        # it protects the CURRENTLY-published version's serving, and a pin
        # explicitly asks for a historical one (the version in force at
        # inception — IC18 holds the parity). The operator pause still
        # rules: a paused plan quotes nothing, pinned or not. Every miss is
        # a NAMED issue + zero members, never a 4xx (Law 2).
        pin = request.pins
        target = next(
            (p for p in exposed_plans if p.plan_ref == pin.plan_ref), None
        )
        if target is None:
            issues.append({"code": "unknown_pin", "plan_ref": pin.plan_ref})
        elif not target.live:
            issues.append(
                {"code": "plan_paused", "carrier": target.carrier_label}
            )
        else:
            pinned_version = _pinned_version(
                db=db, exposed=target, snapshot_id=pin.snapshot_id
            )
            if pinned_version is None:
                issues.append(
                    {
                        "code": "unknown_pin_snapshot",
                        "plan_ref": pin.plan_ref,
                        "snapshot_id": pin.snapshot_id,
                    }
                )
            else:
                scope.append(target)
    elif request.carriers is None:
        # `exposed_plans` is already carrier-label ascending (repo), so the
        # surviving scope keeps §4.2's ordering for free.
        for p in exposed_plans:
            note = _serving_note(p)
            if note is None:
                scope.append(p)
            else:
                issues.append(note)
    else:
        for label in request.carriers:
            p = by_label.get(label)
            if p is None:
                issues.append({"code": "unknown_carrier", "carrier": label})
                continue
            note = _serving_note(p)
            if note is None:
                scope.append(p)
            else:
                issues.append(note)
        scope.sort(key=lambda p: p.carrier_label)  # normative ordering, §4.2

    members: list[QuoteSetMember] = []
    for exposed in scope:
        members.append(
            _quote_member(
                db=db,
                exposed=exposed,
                request=request,
                as_of=as_of,
                issues=issues,
                pinned_version=pinned_version,
            )
        )
    members = [m for m in members if m is not None]

    return QuoteSetResponse(
        risk_ref=request.risk_ref,
        request_hash=request.request_hash,
        as_of=as_of,
        quotes=members,
        issues=issues,
    )


def _quote_member(
    *,
    db: Database,
    exposed: ExposedPlan,
    request: QuoteSetRequest,
    as_of: str,
    issues: list[dict[str, Any]],
    pinned_version: QuoteSetVersion | None = None,
) -> QuoteSetMember | None:
    granted = _clamp_trace(request.trace, exposed.trace_policy)
    version = pinned_version or _published_pins(db=db, exposed=exposed)
    valid_until = _valid_until(exposed.validity_days)

    # The mapping, applied (D3 — key-to-key; unmapped facts are dropped,
    # never stored). Missing REQUIRED peer fields refuse honestly with the
    # gap NAMED in peer vocabulary — no engine call, no fabricated number.
    inputs: dict[str, Any] = {}
    missing: list[str] = []
    for entry in exposed.mapping:
        if entry.peer_key in request.facts:
            inputs[entry.plan_input_key] = request.facts[entry.peer_key]
        elif entry.required:
            missing.append(entry.peer_key)
    if missing:
        return QuoteSetMember(
            carrier=exposed.carrier_label,
            plan_ref=exposed.plan_ref,
            version=version,
            row_status="error",
            premium=None,
            input_issues={"missing": sorted(missing)},
            trace_granted=granted,
            valid_until=valid_until,
        )

    try:
        qr = quote_plan(
            db=db,
            rating_plan_id=exposed.rating_plan_id,
            request=QuoteRequest(inputs=inputs, as_of=as_of, trace=granted),
            # §4.6 — a pinned member quotes the NAMED frozen version; the
            # default stays published (Brief 76 D-B). Same computation as
            # the owner path's ?snapshot_id= (Law 1 extended through time).
            snapshot_id=(
                pinned_version.snapshot_id if pinned_version else None
            ),
        )
    except NotFoundError as err:
        # No published version — an integration-level note; siblings stand.
        issues.append(
            {
                "code": err.effective_code,
                "carrier": exposed.carrier_label,
            }
        )
        return None
    except ScoringFailedError as err:
        # A plan-specific substrate failure (malformed body, engine 5xx):
        # THIS member errors, named `scoring_failed`; siblings stand.
        return QuoteSetMember(
            carrier=exposed.carrier_label,
            plan_ref=exposed.plan_ref,
            version=version,
            row_status="error",
            premium=None,
            row_issues=[{"code": "scoring_failed", "detail": err.message}],
            trace_granted=granted,
            valid_until=valid_until,
        )
    except ScoringUnavailableError as err:
        # The scoring service is unreachable (deploy rolling, transient
        # network). Contract §4.2 rule 3 — each member stands alone — so THIS
        # member errors, named `scoring_unavailable`, with premium + outputs
        # withheld (Law 2), rather than letting the 503 propagate and take the
        # WHOLE quote-set (and every sibling that may be quoting fine) down.
        # A whole-set 503 is only right when NO member can be attempted; here
        # every member is attempted independently, so the failure is per-row.
        return QuoteSetMember(
            carrier=exposed.carrier_label,
            plan_ref=exposed.plan_ref,
            version=version,
            row_status="error",
            premium=None,
            row_issues=[{"code": "scoring_unavailable", "detail": err.message}],
            trace_granted=granted,
            valid_until=valid_until,
        )

    return QuoteSetMember(
        carrier=exposed.carrier_label,
        plan_ref=exposed.plan_ref,
        version=QuoteSetVersion(
            kind=qr.version.kind,
            snapshot_id=qr.version.snapshot_id,
            content_hash=qr.version.content_hash
            or (version.content_hash if version else None),
        ),
        row_status=qr.row_status,
        # §4.2 rule 2 / Law 2 — a refusal NEVER carries a number, and a
        # PARTIAL chain leaves real ones. When one chain of several resolves
        # (liability computes, property refuses), the engine keeps both the
        # withheld total (views.premium → null, G8) and the resolved sibling
        # in `outputs`, on purpose: `outputs` + trace are the AUTHOR's
        # diagnosis surface (scoring deriveViews, deliberately). The seam is
        # the pseudonymous boundary, so neither number rides the wire to a
        # peer — `premium` and `outputs` are both withheld on an error row
        # (the sibling `liability_premium` leak, observed live 2026-07-10;
        # ADR-0056 follow-up, Brief 77 §8.5 erratum). A trusted peer's
        # diagnosis rides `trace`, governed by the trace-policy ceiling
        # (§4.3), not this answer surface. `tier` survives — a verdict, not
        # money. `composed` is already withheld upstream on any error row.
        premium=qr.premium if qr.row_status == "ok" else None,
        tier=qr.tier,
        outputs=qr.outputs if qr.row_status == "ok" else {},
        composed=qr.composed,
        row_issues=qr.row_issues,
        plan_issues=qr.plan_issues,
        input_issues=_translate_input_issues(qr.input_issues, exposed.mapping),
        trace=qr.trace,
        trace_granted=granted,
        valid_until=valid_until,
    )
