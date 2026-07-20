# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The market-events LEDGER — claim-then-judge idempotency + the fences.

Ledger-only since the Exhibits re-founding (current Exhibits design
§6): OpenRater keeps no book of record, so an accepted event is exactly
one `integration_events` row and its ack — nothing else. These tests pin:

  · idempotency — the ledger PK is the guarantee (§5.1, IC7): a replay
    acks `duplicate` and writes nothing; two CONCURRENT deliveries of
    one event_id land exactly one row (the claim-then-judge shape);
  · the contract fences that survived the book — identity-class fact
    keys, the exposure fence, required premium / policy_ref;
  · `submission_id` is always null on new rows (the column remains for
    rows recorded before the book was removed);
  · the read surface (`list_events`) — newest first, filters compose.

Conformance IC7/IC8/IC12 exercise the same path through the HTTP route;
the concurrency test here pins what the fixtures can't force
deterministically.
"""

from __future__ import annotations

import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import create_plan

_MAPPING = [
    {
        "peer_key": "rest.gross_receipts",
        "plan_input_key": "gross_receipts",
        "dtype": "number",
        "unit": "USD",
        "required": True,
    },
]


def _events_world(client: TestClient) -> str:
    """An integration exposing one published plan under carrier
    'acme-mutual' so `quoted` events pass the exposure fence. Returns
    the integration_id."""
    from openrater.integrations.models import MappingEntry
    from openrater.integrations.repo import insert_exposed_plan

    integration_id = client.post(
        "/api/v1/integrations", json={"name": "Events world"}
    ).json()["integration_id"]
    plan_id = create_plan(client, display_name="Events plan")["rating_plan_id"]
    frozen = client.post(
        f"/api/v1/plans/{plan_id}/snapshots",
        json={"display_name": "v1", "notes": "events world"},
    )
    assert frozen.status_code == 201, frozen.text
    published = client.patch(
        f"/api/v1/plans/{plan_id}/snapshots/{frozen.json()['snapshot_id']}/publish"
    )
    assert published.status_code == 200, published.text
    insert_exposed_plan(
        db=client.app.state.db,
        exposed_id="iep_" + secrets.token_hex(6),
        integration_id=integration_id,
        rating_plan_id=plan_id,
        plan_ref="ipl_" + secrets.token_hex(6),
        carrier_label="acme-mutual",
        mapping=[MappingEntry(**e) for e in _MAPPING],
        trace_policy="summary",
        validity_days=30,
        live=True,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    return integration_id


def _quoted_event(event_id: str = "pe_test_0001") -> dict[str, Any]:
    return {
        "event_id": event_id,
        "risk_ref": "r-ev-0001",
        "carrier": "acme-mutual",
        "kind": "quoted",
        "at": "2026-08-02T17:04:00Z",
        "premium_cents": 482100,
        "effective_on": "2026-08-15",
        "term_months": 12,
    }


def _ledger_rows(db: Any, event_id: str) -> list[sqlite3.Row]:
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            "SELECT * FROM integration_events WHERE event_id = ?",
            (event_id,),
        ).fetchall()


def _apply(
    db: Any, integration_id: str, events: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    from openrater.integrations.events import EventsRequest, apply_events

    response = apply_events(
        db=db,
        integration_id=integration_id,
        request=EventsRequest.model_validate({"events": events}),
    )
    return [a.model_dump() for a in response.acks]


def test_replay_is_idempotent(client: TestClient) -> None:
    """Re-applying a batch acks `duplicate` and writes nothing new (§5.1)."""
    db = client.app.state.db
    integration_id = _events_world(client)

    first = _apply(db, integration_id, [_quoted_event()])
    assert [a["status"] for a in first] == ["applied"]
    replay = _apply(db, integration_id, [_quoted_event()])
    assert [a["status"] for a in replay] == ["duplicate"]
    assert len(_ledger_rows(db, "pe_test_0001")) == 1


def test_ack_finalized_with_null_submission(client: TestClient) -> None:
    """The claimed row is finalized to the real outcome; `submission_id`
    stays NULL — there is no book row to link."""
    db = client.app.state.db
    integration_id = _events_world(client)

    acks = _apply(db, integration_id, [_quoted_event("pe_test_0002")])
    assert acks[0]["status"] == "applied"
    row = _ledger_rows(db, "pe_test_0002")[0]
    assert row["ack_status"] == "applied"
    assert row["submission_id"] is None


def test_concurrent_delivery_lands_one_row(client: TestClient) -> None:
    """Two racing deliveries of one event_id: exactly one applies, the
    other acks duplicate, the ledger gains exactly one row."""
    db = client.app.state.db
    integration_id = _events_world(client)
    results: list[str] = []
    lock = threading.Lock()

    def deliver() -> None:
        acks = _apply(db, integration_id, [_quoted_event("pe_test_race")])
        with lock:
            results.append(acks[0]["status"])

    threads = [threading.Thread(target=deliver) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(results) == ["applied", "duplicate"]
    assert len(_ledger_rows(db, "pe_test_race")) == 1


def test_unknown_carrier_acks_error(client: TestClient) -> None:
    """The exposure fence: a placement fact naming a carrier this
    integration never saw acks `error`, batch continues."""
    db = client.app.state.db
    integration_id = _events_world(client)

    bad = _quoted_event("pe_test_0003") | {"carrier": "nobody-mutual"}
    good = _quoted_event("pe_test_0004")
    acks = _apply(db, integration_id, [bad, good])
    assert acks[0]["status"] == "error"
    assert "unknown carrier" in (acks[0]["detail"] or "")
    assert acks[1]["status"] == "applied"


def test_premium_required_on_placement(client: TestClient) -> None:
    db = client.app.state.db
    integration_id = _events_world(client)
    event = _quoted_event("pe_test_0005")
    del event["premium_cents"]
    acks = _apply(db, integration_id, [event])
    assert acks[0]["status"] == "error"
    assert "premium_cents" in (acks[0]["detail"] or "")


def test_issued_requires_policy_ref(client: TestClient) -> None:
    db = client.app.state.db
    integration_id = _events_world(client)
    event = _quoted_event("pe_test_0006") | {"kind": "issued"}
    acks = _apply(db, integration_id, [event])
    assert acks[0]["status"] == "error"
    assert "policy_ref" in (acks[0]["detail"] or "")

    ratified = _quoted_event("pe_test_0007") | {
        "kind": "issued",
        "policy_ref": "PAS-000123",
    }
    acks = _apply(db, integration_id, [ratified])
    assert acks[0]["status"] == "applied"


def test_identity_fact_keys_ack_error(client: TestClient) -> None:
    """ADR-0059 rule 4 — identity-class fact keys are refused at EVENT
    grain; the ledger row records the refusal, facts are never stored."""
    db = client.app.state.db
    integration_id = _events_world(client)
    event = _quoted_event("pe_test_0008") | {
        "facts": {"insured.legal_name": "Jane's Shopfront", "rest.gross_receipts": 250000}
    }
    acks = _apply(db, integration_id, [event])
    assert acks[0]["status"] == "error"
    assert "identity_keys_rejected" in (acks[0]["detail"] or "")


def test_servicing_and_transitions_record(client: TestClient) -> None:
    """declined/lost/endorsed/cancelled/reinstated/corrected all record —
    there is no state to judge them against, and no state changes."""
    db = client.app.state.db
    integration_id = _events_world(client)
    kinds = ["declined", "lost", "endorsed", "cancelled", "reinstated"]
    events = [
        _quoted_event(f"pe_test_01{i:02d}") | {"kind": kind}
        for i, kind in enumerate(kinds)
    ]
    events.append(
        _quoted_event("pe_test_0199") | {"kind": "corrected", "removed": True}
    )
    acks = _apply(db, integration_id, events)
    assert [a["status"] for a in acks] == ["applied"] * 6
    assert all("recorded" in (a["detail"] or "") for a in acks)


def test_list_events_reads_the_ledger(client: TestClient) -> None:
    """The read surface: newest first; kind filter composes; facts and
    book links never appear."""
    from openrater.integrations.events import list_events

    db = client.app.state.db
    integration_id = _events_world(client)
    _apply(
        db,
        integration_id,
        [
            _quoted_event("pe_test_0301"),
            _quoted_event("pe_test_0302") | {"kind": "bound"},
        ],
    )
    out = list_events(db=db, integration_id=integration_id)
    assert [e.event_id for e in out.events] == ["pe_test_0302", "pe_test_0301"]
    assert all(e.submission_id is None for e in out.events)

    bound_only = list_events(db=db, integration_id=integration_id, kind="bound")
    assert [e.event_id for e in bound_only.events] == ["pe_test_0302"]
