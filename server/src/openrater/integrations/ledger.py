# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The seam's passive quote-ledger writer (ADR-0058, contract §4.2 rule 4).

The integration-seam counterpart to `rates/quotes/ledger.py`'s plan-owner
writer. A `POST …/quote-set` fans one pseudonymous risk out to N carriers;
this records **one ledger row per served member** — each member is a distinct
plan's answer with its own version, premium, and outcome — grouped by a shared
`quote_set_id`. Living in the integrations layer keeps the dependency arrow
pointing the right way (integrations → rates, never back); the actual insert
goes through the same `_persist` choke point the owner path uses.

Passive, exactly as the owner path: scheduled on `BackgroundTasks` (off the
response path), wrapped in a total guard (never fatal), no dedup — see the
`rates/quotes/ledger.py` docstring for the full contract. Only SERVED members
are recorded; integration-level notes about carriers that produced no quote
(paused plan, unknown carrier) ride the peer's response `issues[]` and have no
premium to reconstruct.

The seam withholds a partial chain's sibling outputs on an error row before
the member is ever returned (quote_set `_quote_member`), so the `outcome_json`
stored here is the answer AS SERVED to the peer — the clamp is already applied.
"""

from __future__ import annotations

from fastapi import BackgroundTasks

from openrater.identity import parse_risk_id
from openrater.integrations.models import QuoteSetRequest, QuoteSetResponse
from openrater.integrations.repo import list_exposed_plans
from openrater.persistence.db import Database
from openrater.rates.quotes import ledger


def _build_seam_rows(
    db: Database,
    integration_id: str,
    request: QuoteSetRequest,
    response: QuoteSetResponse,
) -> list[ledger.LedgerRow]:
    """One `LedgerRow` per served member. `rating_plan_id` is resolved from
    the exposed plans (the ledger records the INTERNAL id — the forensic
    surface is operator-facing, unlike the pseudonymous wire). Resolution
    is guaranteed for members produced this request, but a plan deleted
    between compute and this post-response task would miss; rather than drop
    the row we fall back to the opaque `plan_ref` so the record survives."""
    exposed = list_exposed_plans(db=db, integration_id=integration_id)
    by_ref = {p.plan_ref: p for p in exposed}
    by_label = {p.carrier_label: p for p in exposed}

    quote_set_id = ledger.new_quote_set_id()
    created_at = ledger._now_iso()
    request_json = ledger._dumps(request.model_dump(mode="json", exclude_none=True))

    rows: list[ledger.LedgerRow] = []
    for member in response.quotes:
        plan = by_ref.get(member.plan_ref) or by_label.get(member.carrier)
        if plan is None:
            ledger._log.warning(
                "quote_ledger_seam_plan_unresolved",
                integration_id=integration_id,
                carrier=member.carrier,
                plan_ref=member.plan_ref,
            )
        rating_plan_id = plan.rating_plan_id if plan is not None else member.plan_ref
        version = member.version
        rows.append(
            ledger.LedgerRow(
                quote_id=ledger.new_quote_id(),
                quote_set_id=quote_set_id,
                created_at=created_at,
                source="integration_seam",
                rating_plan_id=rating_plan_id,
                snapshot_id=version.snapshot_id if version else None,
                version_kind=version.kind if version else None,
                content_hash=version.content_hash if version else None,
                integration_id=integration_id,
                risk_ref=response.risk_ref,
                # ADR-0060 — a `risk_`-prefixed ref is the global identity.
                risk_id=parse_risk_id(response.risk_ref),
                request_hash=response.request_hash,
                carrier_label=member.carrier,
                plan_ref=member.plan_ref,
                as_of=response.as_of,
                row_status=member.row_status,
                premium=member.premium,
                tier=member.tier,
                request_json=request_json,
                outcome_json=ledger._dumps(
                    member.model_dump(mode="json", exclude_none=True)
                ),
            )
        )
    return rows


def _record_seam_task(
    db: Database,
    integration_id: str,
    request: QuoteSetRequest,
    response: QuoteSetResponse,
) -> None:
    """The scheduled work — build (a DB read to resolve plan ids) + persist,
    behind the "never fatal" guard. Runs after the response is sent."""
    try:
        ledger._persist(
            db, _build_seam_rows(db, integration_id, request, response)
        )
    except Exception:  # noqa: BLE001 — a forensic write must never disturb a quote
        ledger._log.warning(
            "quote_ledger_write_failed",
            source="integration_seam",
            integration_id=integration_id,
            exc_info=True,
        )


def record_seam_quote_set(
    *,
    db: Database,
    background_tasks: BackgroundTasks,
    integration_id: str,
    request: QuoteSetRequest,
    response: QuoteSetResponse,
) -> None:
    """Schedule the passive ledger write for a seam `quote-set`. Called by the
    route AFTER `compose_quote_set` returns; the write runs post-response."""
    background_tasks.add_task(
        _record_seam_task, db, integration_id, request, response
    )
