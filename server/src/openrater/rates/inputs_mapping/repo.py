# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Repository for plan-scoped input mapping.

Singleton-per-plan storage. `mapping_json` carries the full envelope
as opaque JSON; the backend doesn't introspect.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3
from typing import Any

from openrater.persistence.db import Database
from openrater.rates.inputs_mapping.models import InputMappingEnvelope

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def _compute_hash(mapping: dict[str, Any]) -> str:
    """Canonical JSON → SHA-256 → 16-char prefix. Same convention as
    dims + factor tables."""
    canonical = json.dumps(mapping, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _row_to_envelope(row: sqlite3.Row) -> InputMappingEnvelope:
    return InputMappingEnvelope(
        rating_plan_id=row["rating_plan_id"],
        mapping=json.loads(row["mapping_json"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        content_hash=row["content_hash"],
    )


# ---------------------------------------------------------------
# Reads
# ---------------------------------------------------------------


def get_input_mapping(
    *,
    db: Database,
    rating_plan_id: str,
) -> InputMappingEnvelope | None:
    """Fetch the mapping for a plan. Returns None when no mapping has
    been authored yet (NOT an error — the UI renders the empty-state
    drawer)."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT rating_plan_id, mapping_json, created_at, updated_at,
                   content_hash
            FROM plan_input_mappings
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


def upsert_input_mapping(
    *,
    db: Database,
    rating_plan_id: str,
    mapping: dict[str, Any],
) -> InputMappingEnvelope:
    """Insert or replace the plan's mapping. `created_at` is
    preserved across updates."""
    now = _now_iso()
    content_hash = _compute_hash(mapping)
    mapping_json = json.dumps(mapping, separators=(",", ":"))

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        existing = conn.execute(
            "SELECT created_at FROM plan_input_mappings "
            "WHERE rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchone()
        created_at = existing["created_at"] if existing else now

        conn.execute(
            """
            INSERT INTO plan_input_mappings (
                rating_plan_id, mapping_json, created_at, updated_at,
                content_hash
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(rating_plan_id) DO UPDATE SET
                mapping_json = excluded.mapping_json,
                updated_at = excluded.updated_at,
                content_hash = excluded.content_hash
            """,
            (rating_plan_id, mapping_json, created_at, now, content_hash),
        )
        conn.commit()

    materialized = get_input_mapping(db=db, rating_plan_id=rating_plan_id)
    assert materialized is not None, "upsert + read race; should be unreachable"
    return materialized


def delete_input_mapping(
    *,
    db: Database,
    rating_plan_id: str,
) -> bool:
    """Remove the mapping. Returns True if a row was deleted, False
    if not found."""
    with db.connection() as conn:
        cursor = conn.execute(
            "DELETE FROM plan_input_mappings WHERE rating_plan_id = ?",
            (rating_plan_id,),
        )
        conn.commit()
    return cursor.rowcount > 0
