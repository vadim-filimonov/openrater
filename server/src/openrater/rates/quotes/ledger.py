# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The passive quote ledger — the forensic record of served quotes (ADR-0058).

Brief 76 D-A and integration-contract §4.2 rule 4 both shipped "quoting
writes nothing" — and the 2026-07-11 production audit found the cost: a
mispriced or disputed quote is unreconstructable after the fact (the V60
wire-string coercion and the sibling-output error-row leak were both cases
where we needed quote history and had none). This module is the owner-decided
remedy: a **passive, record-only, append-only** log of every quote the two
production quote paths served.

Passive is the whole contract (see also 038_quote_ledger.sql):

  · **Write-only from the hot path.** The quote path NEVER reads this back;
    `quote_plan` / `compose_quote_set` are untouched and still compute-and-
    return. The read functions here are a separate operator/forensic surface.
  · **Off the response path.** Both routes schedule the write on FastAPI's
    `BackgroundTasks`, so it runs AFTER the response is sent — a ledger write
    can never slow a quote.
  · **Never fatal.** Every scheduled task wraps build+persist in a total
    `try/except` that logs and returns — a ledger failure can never fail a
    quote (the guarantee this module's tests pin).
  · **No dedup.** `quote_id` is ledger-minted, not derived from the request;
    identical retries write distinct rows (the ledger records how many times
    a risk was quoted). The D4 `request_hash` idempotency of the quote path
    is deliberately NOT touched.

Grain is one row per plan-quote. This module owns the storage + the
plan-owner path (`record_owner_quote`) + reads; the seam builds its
per-member rows in `integrations/ledger.py` (which respects the integrations
→ rates layering) and persists them through the same `_persist` choke point.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import BackgroundTasks
from pydantic import BaseModel, ConfigDict

from openrater.observability import get_logger
from openrater.persistence.db import Database
from openrater.rates.quotes.models import QuoteRequest, QuoteResponse

_log = get_logger("openrater.quote_ledger")

LedgerSource = Literal["plan_owner", "integration_seam"]

# Column order is shared by the INSERT + every SELECT projection below.
_COLUMNS = (
    "quote_id",
    "quote_set_id",
    "created_at",
    "source",
    "rating_plan_id",
    "snapshot_id",
    "version_kind",
    "content_hash",
    "integration_id",
    "risk_ref",
    "risk_id",
    "request_hash",
    "carrier_label",
    "plan_ref",
    "as_of",
    "row_status",
    "premium",
    "tier",
    "request_json",
    "outcome_json",
)
_INSERT_SQL = (
    f"INSERT INTO quote_ledger ({', '.join(_COLUMNS)}) "
    f"VALUES ({', '.join('?' for _ in _COLUMNS)})"
)


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def new_quote_id() -> str:
    return f"q_{uuid.uuid4().hex[:12]}"


def new_quote_set_id() -> str:
    return f"qs_{uuid.uuid4().hex[:12]}"


def _dumps(obj: Any) -> str:
    """Deterministic JSON (sorted keys) so forensic rows diff cleanly; a
    non-serializable straggler falls back to str() rather than blowing up a
    best-effort write."""
    return json.dumps(obj, sort_keys=True, default=str)


class LedgerRow(BaseModel):
    """One row's worth of columns — the shared shape both quote paths build
    and `_persist` writes. `request_json` / `outcome_json` arrive already
    serialized."""

    model_config = ConfigDict(extra="forbid")

    quote_id: str
    quote_set_id: str | None = None
    created_at: str
    source: LedgerSource
    rating_plan_id: str
    snapshot_id: str | None = None
    version_kind: str | None = None
    content_hash: str | None = None
    integration_id: str | None = None
    risk_ref: str | None = None
    # ADR-0060 — the global risk identity: seam rows derive it from a
    # `risk_`-prefixed risk_ref; the owner path takes it on the request.
    risk_id: str | None = None
    request_hash: str | None = None
    carrier_label: str | None = None
    plan_ref: str | None = None
    as_of: str | None = None
    row_status: str
    premium: float | None = None
    tier: str | None = None
    request_json: str
    outcome_json: str | None = None


# ─────────────────────────────── read models ───────────────────────────────


class QuoteLedgerSummary(BaseModel):
    """A ledger row's scalars — the list surface. Bulky request/outcome JSON
    is omitted; fetch one entry for the full reconstruction."""

    model_config = ConfigDict(extra="forbid")

    quote_id: str
    quote_set_id: str | None
    created_at: str
    source: str
    rating_plan_id: str
    snapshot_id: str | None
    version_kind: str | None
    integration_id: str | None
    risk_ref: str | None
    risk_id: str | None
    carrier_label: str | None
    plan_ref: str | None
    as_of: str | None
    row_status: str
    premium: float | None
    tier: str | None


class QuoteLedgerEntry(QuoteLedgerSummary):
    """One ledger row in full — the scalars plus the request as received and
    the answer as served, so a single entry reconstructs the interaction."""

    content_hash: str | None
    request_hash: str | None
    request: dict[str, Any] | None
    outcome: dict[str, Any] | None


# ─────────────────────────────── write path ────────────────────────────────


def _row_tuple(row: LedgerRow) -> tuple[Any, ...]:
    return tuple(getattr(row, col) for col in _COLUMNS)


def _persist(db: Database, rows: list[LedgerRow]) -> int:
    """Insert the rows. Per-row best-effort (one malformed row never loses its
    siblings); a connection-level failure propagates to the caller's guard.
    Not called on the response path — see the module docstring."""
    if not rows:
        return 0
    written = 0
    with db.connection() as conn:
        for row in rows:
            try:
                conn.execute(_INSERT_SQL, _row_tuple(row))
                written += 1
            except Exception:  # noqa: BLE001 — a bad row must not sink siblings
                _log.warning(
                    "quote_ledger_row_insert_failed",
                    quote_id=row.quote_id,
                    source=row.source,
                    exc_info=True,
                )
    return written


def _build_owner_row(
    *, rating_plan_id: str, request: QuoteRequest, response: QuoteResponse
) -> LedgerRow:
    """A plan-owner `/quote` → one row. `request_json` is the inputs as the
    engine saw them (plan vocabulary); `outcome_json` is the QuoteResponse as
    served — build-up, outputs, the ADR-0056 tri-facet, trace, and the
    per-location breakdown for a policy quote."""
    version = response.version
    return LedgerRow(
        quote_id=new_quote_id(),
        created_at=_now_iso(),
        source="plan_owner",
        rating_plan_id=rating_plan_id,
        # ADR-0060 — the owner path's risk identity, when the caller sent
        # one (closes Brief 85 F1: this path previously had none).
        risk_id=request.risk_id,
        snapshot_id=version.snapshot_id,
        version_kind=version.kind,
        content_hash=version.content_hash,
        as_of=response.as_of,
        row_status=response.row_status,
        premium=response.premium,
        tier=response.tier,
        request_json=_dumps(request.model_dump(mode="json", exclude_none=True)),
        outcome_json=_dumps(response.model_dump(mode="json", exclude_none=True)),
    )


def _record_owner_task(
    db: Database, rating_plan_id: str, request: QuoteRequest, response: QuoteResponse
) -> None:
    """The scheduled work. The total guard is the "never fatal" boundary — it
    runs after the response is already sent, and even so must never raise."""
    try:
        _persist(db, [_build_owner_row(
            rating_plan_id=rating_plan_id, request=request, response=response
        )])
    except Exception:  # noqa: BLE001 — a forensic write must never disturb a quote
        _log.warning(
            "quote_ledger_write_failed", source="plan_owner", exc_info=True
        )


def record_owner_quote(
    *,
    db: Database,
    background_tasks: BackgroundTasks,
    rating_plan_id: str,
    request: QuoteRequest,
    response: QuoteResponse,
) -> None:
    """Schedule the passive ledger write for a plan-owner `/quote`. Called by
    the route AFTER `quote_plan` returns; the write runs post-response."""
    background_tasks.add_task(
        _record_owner_task, db, rating_plan_id, request, response
    )


# ─────────────────────────────── read path ─────────────────────────────────


def _row_to_summary(r: sqlite3.Row) -> QuoteLedgerSummary:
    return QuoteLedgerSummary(
        quote_id=r["quote_id"],
        quote_set_id=r["quote_set_id"],
        created_at=r["created_at"],
        source=r["source"],
        rating_plan_id=r["rating_plan_id"],
        snapshot_id=r["snapshot_id"],
        version_kind=r["version_kind"],
        integration_id=r["integration_id"],
        risk_ref=r["risk_ref"],
        risk_id=r["risk_id"],
        carrier_label=r["carrier_label"],
        plan_ref=r["plan_ref"],
        as_of=r["as_of"],
        row_status=r["row_status"],
        premium=r["premium"],
        tier=r["tier"],
    )


def _row_to_entry(r: sqlite3.Row) -> QuoteLedgerEntry:
    return QuoteLedgerEntry(
        **_row_to_summary(r).model_dump(),
        content_hash=r["content_hash"],
        request_hash=r["request_hash"],
        request=json.loads(r["request_json"]) if r["request_json"] else None,
        outcome=json.loads(r["outcome_json"]) if r["outcome_json"] else None,
    )


def get_ledger_entry(*, db: Database, quote_id: str) -> QuoteLedgerEntry | None:
    """One ledger row in full, for reconstruction by quote id."""
    with db.connection() as conn:
        row = conn.execute(
            "SELECT * FROM quote_ledger WHERE quote_id = ?", (quote_id,)
        ).fetchone()
    return _row_to_entry(row) if row is not None else None


def list_ledger_entries(
    *,
    db: Database,
    plan_id: str | None = None,
    integration_id: str | None = None,
    source: str | None = None,
    risk_ref: str | None = None,
    risk_id: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[QuoteLedgerSummary]:
    """Reconstruct by plan / integration / risk / time. Newest first; the
    optional filters compose (all AND-ed). `since`/`until` bound `created_at`
    (ISO-8601 strings sort lexically). `risk_id` is the ADR-0060 thread —
    every quote one risk was served, across BOTH paths."""
    clauses: list[str] = []
    args: list[Any] = []
    for column, value in (
        ("rating_plan_id", plan_id),
        ("integration_id", integration_id),
        ("source", source),
        ("risk_ref", risk_ref),
        ("risk_id", risk_id),
    ):
        if value is not None:
            clauses.append(f"{column} = ?")
            args.append(value)
    if since is not None:
        clauses.append("created_at >= ?")
        args.append(since)
    if until is not None:
        clauses.append("created_at <= ?")
        args.append(until)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = (
        f"SELECT * FROM quote_ledger{where} "
        f"ORDER BY created_at DESC, quote_id DESC LIMIT ? OFFSET ?"
    )
    args.extend([limit, offset])
    with db.connection() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [_row_to_summary(r) for r in rows]
