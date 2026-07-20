# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""SQLite persistence for per-plan API keys (Brief 76, v4 P4.2)."""

from __future__ import annotations

import sqlite3

from openrater.persistence.db import Database
from openrater.rates.api_keys.models import ApiKeySummary

_COLS = (
    "key_id, rating_plan_id, secret_prefix, label, "
    "created_at, created_by, last_used_at, revoked_at"
)


def _row_to_summary(row: sqlite3.Row) -> ApiKeySummary:
    return ApiKeySummary(
        key_id=row["key_id"],
        rating_plan_id=row["rating_plan_id"],
        secret_prefix=row["secret_prefix"],
        label=row["label"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        last_used_at=row["last_used_at"],
        revoked_at=row["revoked_at"],
    )


def insert_api_key(
    *,
    db: Database,
    key_id: str,
    rating_plan_id: str,
    key_hash: str,
    secret_prefix: str,
    label: str | None,
    created_at: str,
    created_by: str | None,
) -> None:
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO plan_api_keys
                (key_id, rating_plan_id, key_hash, secret_prefix, label,
                 created_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                key_id,
                rating_plan_id,
                key_hash,
                secret_prefix,
                label,
                created_at,
                created_by,
            ),
        )


def list_api_keys(
    *, db: Database, rating_plan_id: str
) -> list[ApiKeySummary]:
    """All keys for a plan (active + revoked), newest first."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"""
            SELECT {_COLS} FROM plan_api_keys
             WHERE rating_plan_id = ?
             ORDER BY created_at DESC
            """,
            (rating_plan_id,),
        ).fetchall()
    return [_row_to_summary(r) for r in rows]


def find_active_key(
    *, db: Database, rating_plan_id: str, key_hash: str
) -> ApiKeySummary | None:
    """The non-revoked key on this plan matching `key_hash`, or None.
    Scoped to the plan so one plan's key cannot quote another's."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            f"""
            SELECT {_COLS} FROM plan_api_keys
             WHERE rating_plan_id = ? AND key_hash = ? AND revoked_at IS NULL
            """,
            (rating_plan_id, key_hash),
        ).fetchone()
    return _row_to_summary(row) if row else None


def plan_has_active_key(*, db: Database, rating_plan_id: str) -> bool:
    with db.connection() as conn:
        row = conn.execute(
            """
            SELECT 1 FROM plan_api_keys
             WHERE rating_plan_id = ? AND revoked_at IS NULL
             LIMIT 1
            """,
            (rating_plan_id,),
        ).fetchone()
    return row is not None


def revoke_api_key(
    *, db: Database, rating_plan_id: str, key_id: str, when: str
) -> bool:
    """Soft-delete: stamp `revoked_at`. Returns True if a currently-active
    key was revoked, False if it doesn't exist or was already revoked."""
    with db.connection() as conn:
        cur = conn.execute(
            """
            UPDATE plan_api_keys
               SET revoked_at = ?
             WHERE rating_plan_id = ? AND key_id = ? AND revoked_at IS NULL
            """,
            (when, rating_plan_id, key_id),
        )
        return cur.rowcount > 0


def touch_last_used(*, db: Database, key_id: str, when: str) -> None:
    with db.connection() as conn:
        conn.execute(
            "UPDATE plan_api_keys SET last_used_at = ? WHERE key_id = ?",
            (when, key_id),
        )
