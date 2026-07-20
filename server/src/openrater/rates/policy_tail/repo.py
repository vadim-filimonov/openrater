# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Repository for the plan-scoped policy tail (ADR-0055).

Singleton-per-plan storage. `tail_json` carries the full ordered
`PolicyAdjustment[]` as opaque JSON; the backend doesn't introspect.
Mirrors `rates/inputs_mapping/repo.py`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3
from typing import Any

from openrater.persistence.db import Database
from openrater.rates.policy_tail.models import PolicyTailEnvelope

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def _compute_hash(tail: list[dict[str, Any]]) -> str:
    """Canonical JSON → SHA-256 → 16-char prefix. Same convention as
    input mapping + dims + factor tables."""
    canonical = json.dumps(tail, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _row_to_envelope(row: sqlite3.Row) -> PolicyTailEnvelope:
    return PolicyTailEnvelope(
        rating_plan_id=row["rating_plan_id"],
        tail=json.loads(row["tail_json"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        content_hash=row["content_hash"],
    )


# ---------------------------------------------------------------
# Reads
# ---------------------------------------------------------------


def get_policy_tail(
    *,
    db: Database,
    rating_plan_id: str,
) -> PolicyTailEnvelope | None:
    """Fetch the tail for a plan. Returns None when no tail has been
    authored yet (NOT an error — the UI renders the empty Final-
    adjustments state)."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT rating_plan_id, tail_json, created_at, updated_at,
                   content_hash
            FROM plan_policy_tail
            WHERE rating_plan_id = ?
            """,
            (rating_plan_id,),
        ).fetchone()
    if row is None:
        return None
    return _row_to_envelope(row)


# ---------------------------------------------------------------
# Writes
# ---------------------------------------------------------------


def upsert_policy_tail(
    *,
    db: Database,
    rating_plan_id: str,
    tail: list[dict[str, Any]],
) -> PolicyTailEnvelope:
    """Insert or replace the plan's tail. `created_at` is preserved
    across updates. An empty list is a valid tail (explicitly no
    adjustments) and is stored as such — distinct from "never authored"
    (no row), which `get_policy_tail` returns as None."""
    now = _now_iso()
    content_hash = _compute_hash(tail)
    tail_json = json.dumps(tail, separators=(",", ":"))

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        existing = conn.execute(
            "SELECT created_at FROM plan_policy_tail WHERE rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchone()
        created_at = existing["created_at"] if existing else now

        conn.execute(
            """
            INSERT INTO plan_policy_tail (
                rating_plan_id, tail_json, created_at, updated_at,
                content_hash
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(rating_plan_id) DO UPDATE SET
                tail_json = excluded.tail_json,
                updated_at = excluded.updated_at,
                content_hash = excluded.content_hash
            """,
            (rating_plan_id, tail_json, created_at, now, content_hash),
        )
        conn.commit()

    materialized = get_policy_tail(db=db, rating_plan_id=rating_plan_id)
    assert materialized is not None, "upsert + read race; should be unreachable"
    return materialized


def delete_policy_tail(
    *,
    db: Database,
    rating_plan_id: str,
) -> bool:
    """Remove the tail. Returns True if a row was deleted, False if not
    found."""
    with db.connection() as conn:
        cursor = conn.execute(
            "DELETE FROM plan_policy_tail WHERE rating_plan_id = ?",
            (rating_plan_id,),
        )
        conn.commit()
    return cursor.rowcount > 0
