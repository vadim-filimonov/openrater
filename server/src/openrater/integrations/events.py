# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The market-events ledger (ADR-0057 D6, contract §5 — L3).

The integrator reports market facts; the ledger records them. Since the
Exhibits re-founding (Brief: portfolio-redesign v2 §6) OpenRater keeps
NO book of record — so this adapter is ledger-only: every accepted
event lands as one append-only `integration_events` row and nothing
else. The book materialization the original adapter performed
(`quoted` → submission row, `bound`/`declined`/`lost` → status
transitions, the ADR-0060 servicing updates) was deleted with the
portfolio store; the wire contract's *shape* is unchanged — same
batch envelope, same per-event acks, same idempotency grammar — and
`submission_id` in acks/records is always null going forward.

The fences, enforced in code shape: no event triggers any market
action, workflow, queue, or notification — every function here writes
a ledger row, full stop. Idempotency is the ledger's PRIMARY KEY:
replaying a batch acks `duplicate` and writes nothing (IC7).

Validation that guards the CONTRACT (not book state) survives:
  · identity-class fact keys ack `error` for that event alone
    (ADR-0059 rule 4 — the §7 identity fence);
  · `quoted`/`bound` against a carrier this integration never exposed
    ack `error` ("expose it or fix the label");
  · `quoted`/`bound` without a declared premium ack `error`;
  · `issued` without a `policy_ref` acks `error`.
State-dependent verdicts (illegal transitions, endorsement seq guards,
policy_ref conflicts) died with the state they judged — those events
now simply record.

Facts (§5 rule 6, ADR-0059): the ledger never stores them. With no
book row to land on, declared facts are validated (bounds + identity
fence) and then dropped — the event row records that the fact WAS
declared (premium, dates, refs), never the risk's attributes.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from openrater.identity import parse_risk_id
from openrater.integrations.repo import list_exposed_plans
from openrater.persistence.db import Database

EventKind = Literal[
    "sent",
    "quoted",
    "bound",
    "declined",
    "lost",
    "corrected",
    # ADR-0060 Part 2 — the servicing grammar: facts a PAS/TPA reports
    # about the policy the market issued. Records, never actions.
    "issued",
    "endorsed",
    "cancelled",
    "reinstated",
]


class QuotePins(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_ref: str | None = None
    snapshot_id: str | None = None
    request_hash: str | None = None


class PlacementEventIn(BaseModel):
    """§5 — one append-only market fact."""

    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(..., min_length=1, max_length=128)
    risk_ref: str = Field(..., min_length=1, max_length=128)
    carrier: str = Field(..., min_length=1, max_length=128)
    kind: EventKind
    at: str = Field(..., min_length=1)
    premium_cents: int | None = Field(default=None, ge=0)
    quote_pins: QuotePins | None = None
    effective_on: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    term_months: int | None = Field(default=None, ge=1, le=120)
    reason: str | None = None
    removed: bool = False
    # ADR-0060 rule 6 — what the servicing kinds carry. `policy_ref` is an
    # opaque POINTER to the PAS's policy record (required on `issued`,
    # enforced at apply — a pointer, never a policy master here);
    # `endorsement_seq` is the PAS's endorsement counter.
    policy_ref: str | None = Field(default=None, min_length=1, max_length=64)
    endorsement_seq: int | None = Field(default=None, ge=1)
    # ADR-0059 — the risk facts declared at placement, PEER vocabulary
    # (§4.1's field, restated). Validated (bounds + identity fence) and
    # then dropped — the ledger never stores facts.
    facts: dict[str, str | int | float | bool] | None = None

    @field_validator("facts")
    @classmethod
    def _facts_bounded(
        cls, value: dict[str, str | int | float | bool] | None
    ) -> dict[str, str | int | float | bool] | None:
        """§5 rule 6 caps (ADR-0059 rule 5): ≤ 64 keys, key names ≤ 128
        chars, string values ≤ 512 chars. Scalar-only is enforced by the
        field's type — a nested dict/list is a named shape 422 like any
        other malformed batch."""
        if value is None:
            return value
        if len(value) > 64:
            raise ValueError("facts: at most 64 keys per event (ADR-0059)")
        for key, item in value.items():
            if len(key) > 128:
                raise ValueError(f"facts: key exceeds 128 chars: {key[:32]}…")
            if isinstance(item, str) and len(item) > 512:
                raise ValueError(f"facts[{key}]: string value exceeds 512 chars")
        return value


class EventsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[PlacementEventIn] = Field(..., min_length=1, max_length=200)


class EventAck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str
    status: Literal["applied", "duplicate", "error"]
    detail: str | None = None


class EventsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    acks: list[EventAck]  # request order, normative (§5)


class EventRecord(BaseModel):
    """One event-ledger row, as recorded (ADR-0060 rule 5 — the read
    surface). `risk_id` is derived from the ref at read time (the ledger
    stores the wire verbatim); `facts` never appear — the ledger never
    stores them (ADR-0059). `submission_id` remains in the shape for
    rows recorded before the book of record was removed; it is always
    null on new rows."""

    model_config = ConfigDict(extra="forbid")

    event_id: str
    integration_id: str
    risk_ref: str
    risk_id: str | None
    carrier: str
    kind: str
    at: str
    premium_cents: int | None
    effective_on: str | None
    term_months: int | None
    reason: str | None
    removed: bool
    quote_pins: dict[str, Any] | None
    policy_ref: str | None
    endorsement_seq: int | None
    submission_id: str | None
    ack_status: str
    detail: str | None
    applied_at: str | None


class EventsListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[EventRecord]  # newest first (applied_at)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _claim_event(
    *, db: Database, integration_id: str, event: PlacementEventIn
) -> bool:
    """Claim the event by writing its ledger row FIRST — before judging it.

    Returns True when THIS caller won the claim (the row was inserted), False
    when the `event_id` was already claimed (rowcount 0 → a prior or concurrent
    delivery holds it, so the caller acks `duplicate`).

    Claim-before-apply is what makes concurrent deliveries of the same event
    safe: `INSERT OR IGNORE` collapses check-and-claim into one atomic write —
    SQLite serializes the two INSERTs, exactly one lands, the loser reads
    rowcount 0. `require_integrator` has already proven the integration
    exists, so the FK holds and the PK is the only thing this can ignore on.
    The row lands with a provisional `ack_status='pending'`;
    `_finalize_event` stamps the real outcome once validation returns."""
    with db.connection() as conn:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO integration_events
                (event_id, integration_id, risk_ref, carrier, kind, at,
                 premium_cents, effective_on, term_months, reason, removed,
                 quote_pins, policy_ref, endorsement_seq,
                 submission_id, ack_status, detail, applied_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.event_id,
                integration_id,
                event.risk_ref,
                event.carrier,
                event.kind,
                event.at,
                event.premium_cents,
                event.effective_on,
                event.term_months,
                event.reason,
                1 if event.removed else 0,
                json.dumps(event.quote_pins.model_dump(exclude_none=True))
                if event.quote_pins
                else None,
                event.policy_ref,
                event.endorsement_seq,
                None,  # submission_id — always null (no book of record)
                "pending",  # ack_status — provisional; finalized after apply
                None,  # detail — set by _finalize_event after apply
                _now_iso(),
            ),
        )
        conn.commit()
        return cur.rowcount == 1


def _finalize_event(*, db: Database, event_id: str, ack: EventAck) -> None:
    """Stamp the outcome onto the already-claimed ledger row: the real
    `ack_status` (applied | error), its detail, and the completion time.
    `_claim_event` guaranteed the row exists, so this is a plain UPDATE."""
    with db.connection() as conn:
        conn.execute(
            """
            UPDATE integration_events
               SET ack_status = ?, detail = ?, applied_at = ?
             WHERE event_id = ?
            """,
            (ack.status, ack.detail, _now_iso(), event_id),
        )
        conn.commit()


def _release_claim(*, db: Database, event_id: str) -> None:
    """Undo a claim whose apply raised before it could be finalized, so a
    retry re-attempts the event cleanly instead of it being acked `duplicate`
    forever on a still-`pending` row. Guarded on `ack_status='pending'` so it
    can only ever delete an un-finalized claim, never a recorded outcome."""
    with db.connection() as conn:
        conn.execute(
            "DELETE FROM integration_events WHERE event_id = ? AND ack_status = 'pending'",
            (event_id,),
        )
        conn.commit()


def apply_events(
    *, db: Database, integration_id: str, request: EventsRequest
) -> EventsResponse:
    exposed = {
        p.carrier_label: p
        for p in list_exposed_plans(db=db, integration_id=integration_id)
    }
    acks: list[EventAck] = []
    for event in request.events:
        # Claim first: win the event_id atomically or ack `duplicate`.
        if not _claim_event(db=db, integration_id=integration_id, event=event):
            acks.append(EventAck(event_id=event.event_id, status="duplicate"))
            continue
        try:
            ack = _judge_one(event=event, exposed=exposed)
        except Exception:
            # `_judge_one` returns an `error` ack for contract refusals;
            # reaching here means the substrate itself failed unexpectedly.
            # Release the claim so a retry re-attempts instead of the event
            # being masked as `duplicate`, then let the fault surface.
            _release_claim(db=db, event_id=event.event_id)
            raise
        _finalize_event(db=db, event_id=event.event_id, ack=ack)
        acks.append(ack)
    return EventsResponse(acks=acks)


def _judge_one(
    *, event: PlacementEventIn, exposed: dict[str, Any]
) -> EventAck:
    """Validate one event against the CONTRACT (never against book state —
    there is no book) and produce its ack. The ledger row already exists;
    this only decides applied-vs-error and the detail wording."""

    def ok(detail: str | None = "recorded") -> EventAck:
        return EventAck(event_id=event.event_id, status="applied", detail=detail)

    def err(detail: str) -> EventAck:
        return EventAck(event_id=event.event_id, status="error", detail=detail)

    # ADR-0059 rule 4 — the §7 identity fence, at EVENT grain: an
    # offending event acks `error`; the batch continues. Checked before
    # ANY verb so no kind can smuggle identity keys — and the ledger
    # never stores facts, so the claim row carries nothing to scrub.
    if event.facts:
        from openrater.integrations.service import reject_identity_keys

        try:
            reject_identity_keys(list(event.facts.keys()))
        except Exception as exc:  # ValidationError — offending keys named
            return err(f"identity_keys_rejected: {getattr(exc, 'message', exc)}")

    if event.kind in ("quoted", "bound"):
        # The exposure fence: a placement fact must name a plan/carrier
        # this integration was actually shown. Pins-first, label fallback.
        plan = None
        if event.quote_pins and event.quote_pins.plan_ref:
            plan = next(
                (
                    p
                    for p in exposed.values()
                    if p.plan_ref == event.quote_pins.plan_ref
                ),
                None,
            )
        if plan is None:
            plan = exposed.get(event.carrier)
        if plan is None:
            return err(
                f"unknown carrier {event.carrier!r} — expose it or fix the label"
            )
        if event.premium_cents is None:
            return err("premium_cents is required to record this event")
        return ok()

    if event.kind == "issued":
        if event.policy_ref is None:
            return err("policy_ref is required to record an issuance")
        return ok()

    if event.kind == "corrected":
        if event.removed:
            return ok("recorded — the correction is on the ledger")
        return ok("recorded — declared-value restatements are ledger-only")

    # sent · declined · lost · endorsed · cancelled · reinstated —
    # recorded facts, no state to judge them against.
    return ok()


def list_events(
    *,
    db: Database,
    integration_id: str,
    kind: str | None = None,
    risk_ref: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> EventsListResponse:
    """The event ledger, newest first (ADR-0060 rule 5). Read-only,
    operator-facing. Filters compose (all AND-ed); `since`/`until` bound
    `applied_at` — arrival time, the stable cursor for a puller (`at` is
    the integrator's business clock and may arrive out of order)."""
    clauses = ["integration_id = ?"]
    args: list[Any] = [integration_id]
    for column, value in (("kind", kind), ("risk_ref", risk_ref)):
        if value is not None:
            clauses.append(f"{column} = ?")
            args.append(value)
    if since is not None:
        clauses.append("applied_at >= ?")
        args.append(since)
    if until is not None:
        clauses.append("applied_at <= ?")
        args.append(until)
    sql = (
        f"SELECT * FROM integration_events WHERE {' AND '.join(clauses)} "
        f"ORDER BY applied_at DESC, event_id DESC LIMIT ? OFFSET ?"
    )
    args.extend([limit, offset])
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, args).fetchall()
    return EventsListResponse(
        events=[
            EventRecord(
                event_id=r["event_id"],
                integration_id=r["integration_id"],
                risk_ref=r["risk_ref"],
                risk_id=parse_risk_id(r["risk_ref"]),
                carrier=r["carrier"],
                kind=r["kind"],
                at=r["at"],
                premium_cents=r["premium_cents"],
                effective_on=r["effective_on"],
                term_months=r["term_months"],
                reason=r["reason"],
                removed=bool(r["removed"]),
                quote_pins=(
                    json.loads(r["quote_pins"]) if r["quote_pins"] else None
                ),
                policy_ref=r["policy_ref"],
                endorsement_seq=r["endorsement_seq"],
                submission_id=r["submission_id"],
                ack_status=r["ack_status"],
                detail=r["detail"],
                applied_at=r["applied_at"],
            )
            for r in rows
        ]
    )
