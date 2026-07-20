# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""SQLite persistence for the integration seam (ADR-0057, L1).

Mirrors the `rates/api_keys/repo.py` conventions: kwarg-only functions,
raw SQL, soft deletes, hashes never secrets.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from openrater.integrations.models import ExposedPlan, MappingEntry
from openrater.persistence.db import Database

# ── integrations ────────────────────────────────────────────────────────────


def insert_integration(
    *,
    db: Database,
    integration_id: str,
    name: str,
    created_at: str,
    created_by: str | None,
) -> None:
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO integrations (integration_id, name, created_at, created_by)
            VALUES (?, ?, ?, ?)
            """,
            (integration_id, name, created_at, created_by),
        )


def get_integration(*, db: Database, integration_id: str) -> sqlite3.Row | None:
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            "SELECT * FROM integrations WHERE integration_id = ?",
            (integration_id,),
        ).fetchone()


def list_integrations(*, db: Database) -> list[sqlite3.Row]:
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            "SELECT * FROM integrations ORDER BY created_at DESC"
        ).fetchall()


def set_paired(
    *,
    db: Database,
    integration_id: str,
    peer_name: str,
    peer_catalog: list[dict[str, Any]],
    when: str,
) -> None:
    with db.connection() as conn:
        conn.execute(
            """
            UPDATE integrations
               SET peer_name = ?, peer_catalog = ?, paired_at = ?
             WHERE integration_id = ?
            """,
            (peer_name, json.dumps(peer_catalog), when, integration_id),
        )


def update_catalog(
    *, db: Database, integration_id: str, peer_catalog: list[dict[str, Any]]
) -> None:
    with db.connection() as conn:
        conn.execute(
            "UPDATE integrations SET peer_catalog = ? WHERE integration_id = ?",
            (json.dumps(peer_catalog), integration_id),
        )


# ── pairing codes ───────────────────────────────────────────────────────────


def insert_pairing_code(
    *,
    db: Database,
    code_id: str,
    integration_id: str,
    code_hash: str,
    code_prefix: str,
    created_at: str,
    created_by: str | None,
    expires_at: str,
) -> None:
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO integration_pairing_codes
                (code_id, integration_id, code_hash, code_prefix,
                 created_at, created_by, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                code_id,
                integration_id,
                code_hash,
                code_prefix,
                created_at,
                created_by,
                expires_at,
            ),
        )


def revoke_open_codes(*, db: Database, integration_id: str, when: str) -> None:
    """Regenerate-invalidates: every un-used, un-revoked code dies."""
    with db.connection() as conn:
        conn.execute(
            """
            UPDATE integration_pairing_codes
               SET revoked_at = ?
             WHERE integration_id = ? AND used_at IS NULL AND revoked_at IS NULL
            """,
            (when, integration_id),
        )


def find_open_code_by_hash(*, db: Database, code_hash: str) -> sqlite3.Row | None:
    """The un-used, un-revoked code matching the hash (expiry is the
    service's clock check, not SQL's)."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            """
            SELECT * FROM integration_pairing_codes
             WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL
            """,
            (code_hash,),
        ).fetchone()


def mark_code_used(*, db: Database, code_id: str, when: str) -> None:
    with db.connection() as conn:
        conn.execute(
            "UPDATE integration_pairing_codes SET used_at = ? WHERE code_id = ?",
            (when, code_id),
        )


# ── integrator keys ─────────────────────────────────────────────────────────


def insert_integrator_key(
    *,
    db: Database,
    key_id: str,
    integration_id: str,
    key_hash: str,
    secret_prefix: str,
    created_at: str,
) -> None:
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO integrator_keys
                (key_id, integration_id, key_hash, secret_prefix, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (key_id, integration_id, key_hash, secret_prefix, created_at),
        )


def revoke_integrator_keys(*, db: Database, integration_id: str, when: str) -> None:
    """Re-pair = rotate: every active key for the integration is revoked."""
    with db.connection() as conn:
        conn.execute(
            """
            UPDATE integrator_keys
               SET revoked_at = ?
             WHERE integration_id = ? AND revoked_at IS NULL
            """,
            (when, integration_id),
        )


def find_active_integrator_key(
    *, db: Database, integration_id: str, key_hash: str
) -> sqlite3.Row | None:
    """Scoped to the integration so one peer's key cannot read another's."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            """
            SELECT * FROM integrator_keys
             WHERE integration_id = ? AND key_hash = ? AND revoked_at IS NULL
            """,
            (integration_id, key_hash),
        ).fetchone()


def touch_integrator_key(*, db: Database, key_id: str, when: str) -> None:
    with db.connection() as conn:
        conn.execute(
            "UPDATE integrator_keys SET last_used_at = ? WHERE key_id = ?",
            (when, key_id),
        )


# ── exposed plans ───────────────────────────────────────────────────────────


def _row_to_exposed(row: sqlite3.Row) -> ExposedPlan:
    keys = row.keys()
    return ExposedPlan(
        exposed_id=row["exposed_id"],
        integration_id=row["integration_id"],
        rating_plan_id=row["rating_plan_id"],
        plan_ref=row["plan_ref"],
        carrier_label=row["carrier_label"],
        mapping=[MappingEntry(**e) for e in json.loads(row["mapping"])],
        trace_policy=row["trace_policy"],
        validity_days=row["validity_days"],
        live=bool(row["live"]),
        last_test_at=row["last_test_at"] if "last_test_at" in keys else None,
        last_test_premium_cents=(
            row["last_test_premium_cents"] if "last_test_premium_cents" in keys else None
        ),
        last_test_snapshot_id=(
            row["last_test_snapshot_id"] if "last_test_snapshot_id" in keys else None
        ),
        created_at=row["created_at"],
    )


def stamp_test_receipt(
    *,
    db: Database,
    integration_id: str,
    exposed_id: str,
    when: str,
    premium_cents: int | None,
    snapshot_id: str | None,
) -> None:
    """Step 5's receipt — the operator proved the wiring once, on this
    version. The test computation itself is never persisted (D-A)."""
    with db.connection() as conn:
        conn.execute(
            """
            UPDATE integration_exposed_plans
               SET last_test_at = ?, last_test_premium_cents = ?,
                   last_test_snapshot_id = ?
             WHERE integration_id = ? AND exposed_id = ?
            """,
            (when, premium_cents, snapshot_id, integration_id, exposed_id),
        )


def insert_exposed_plan(
    *,
    db: Database,
    exposed_id: str,
    integration_id: str,
    rating_plan_id: str,
    plan_ref: str,
    carrier_label: str,
    mapping: list[MappingEntry],
    trace_policy: str,
    validity_days: int,
    live: bool,
    created_at: str,
) -> None:
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO integration_exposed_plans
                (exposed_id, integration_id, rating_plan_id, plan_ref,
                 carrier_label, mapping, trace_policy, validity_days,
                 live, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                exposed_id,
                integration_id,
                rating_plan_id,
                plan_ref,
                carrier_label,
                json.dumps([e.model_dump() for e in mapping]),
                trace_policy,
                validity_days,
                1 if live else 0,
                created_at,
            ),
        )


def get_exposed_plan(
    *, db: Database, integration_id: str, exposed_id: str
) -> ExposedPlan | None:
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT * FROM integration_exposed_plans
             WHERE integration_id = ? AND exposed_id = ?
            """,
            (integration_id, exposed_id),
        ).fetchone()
    return _row_to_exposed(row) if row else None


def update_exposed_plan(
    *,
    db: Database,
    integration_id: str,
    exposed_id: str,
    carrier_label: str | None = None,
    mapping: list[MappingEntry] | None = None,
    trace_policy: str | None = None,
    validity_days: int | None = None,
    live: bool | None = None,
) -> bool:
    sets: list[str] = []
    args: list[Any] = []
    if carrier_label is not None:
        sets.append("carrier_label = ?")
        args.append(carrier_label)
    if mapping is not None:
        sets.append("mapping = ?")
        args.append(json.dumps([e.model_dump() for e in mapping]))
    if trace_policy is not None:
        sets.append("trace_policy = ?")
        args.append(trace_policy)
    if validity_days is not None:
        sets.append("validity_days = ?")
        args.append(validity_days)
    if live is not None:
        sets.append("live = ?")
        args.append(1 if live else 0)
    if not sets:
        return True
    args.extend([integration_id, exposed_id])
    with db.connection() as conn:
        cur = conn.execute(
            f"""
            UPDATE integration_exposed_plans SET {", ".join(sets)}
             WHERE integration_id = ? AND exposed_id = ?
            """,
            args,
        )
        return cur.rowcount > 0


def delete_exposed_plan(
    *, db: Database, integration_id: str, exposed_id: str
) -> bool:
    with db.connection() as conn:
        cur = conn.execute(
            """
            DELETE FROM integration_exposed_plans
             WHERE integration_id = ? AND exposed_id = ?
            """,
            (integration_id, exposed_id),
        )
        return cur.rowcount > 0


def events_pulse(*, db: Database, integration_id: str) -> dict[str, Any]:
    """The feed counts for step 6's strip — reads, never notifies."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT
                SUM(CASE WHEN ack_status = 'applied' THEN 1 ELSE 0 END) AS applied,
                SUM(CASE WHEN ack_status = 'duplicate' THEN 1 ELSE 0 END) AS duplicate,
                SUM(CASE WHEN ack_status = 'error' THEN 1 ELSE 0 END) AS error,
                MAX(applied_at) AS last_at
              FROM integration_events
             WHERE integration_id = ?
            """,
            (integration_id,),
        ).fetchone()
    return {
        "applied": row["applied"] or 0,
        "duplicate": row["duplicate"] or 0,
        "error": row["error"] or 0,
        "last_at": row["last_at"],
    }


def list_exposed_plans(*, db: Database, integration_id: str) -> list[ExposedPlan]:
    """Ordered by carrier label ascending — the same normative ordering
    the quote-set response carries (contract §4.2 rule 3)."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT * FROM integration_exposed_plans
             WHERE integration_id = ?
             ORDER BY carrier_label ASC
            """,
            (integration_id,),
        ).fetchall()
    return [_row_to_exposed(r) for r in rows]


def list_exposed_plans_for_plan(
    *, db: Database, rating_plan_id: str
) -> list[ExposedPlan]:
    """The reverse read (Brief 84 D-D): every integration's exposure of
    ONE plan — the Ship tab's Connect card renders this journey list.
    Oldest pairing first, so the card's order is stable as apps join."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT * FROM integration_exposed_plans
             WHERE rating_plan_id = ?
             ORDER BY created_at ASC, exposed_id ASC
            """,
            (rating_plan_id,),
        ).fetchall()
    return [_row_to_exposed(r) for r in rows]
