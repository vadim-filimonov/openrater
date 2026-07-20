# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Repository for the per-plan class-code registry — Brief 51.

All functions take `db: Database` + typed Pydantic args, open per-call
connections via `with db.connection()`, and use raw SQL with `?`
placeholders. Matches the convention in `rates/dimensions/repo.py`.

`eligible_for` / `exposure_bases` / `attributes` round-trip as JSON in
the `*_json` columns — the backend stores + returns them verbatim; the
frontend / Engine introspect their shape.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3

from openrater.persistence.db import Database
from openrater.rates.class_codes.models import (
    PlanClassCode,
    UpsertClassCodeRequest,
)

# Column list shared by every SELECT — keep the read shape in one place.
_COLUMNS = (
    "rating_plan_id, class_code, display_name, family, description, "
    "naics_code, sic_code, eligible_for_json, exposure_bases_json, "
    "attributes_json, source, note, citation_rule, citation_page, "
    "created_at, updated_at, content_hash"
)


# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def _compute_hash(req: UpsertClassCodeRequest) -> str:
    """Canonical JSON → SHA-256 → 16-char prefix. Matches the dimension /
    plan-row convention."""
    canonical = json.dumps(req.model_dump(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _serialize_json_cols(req: UpsertClassCodeRequest) -> tuple[str, str, str]:
    """Serialize the three JSON columns from an upsert request."""
    return (
        json.dumps(req.eligible_for, separators=(",", ":")),
        json.dumps(req.exposure_bases, separators=(",", ":")),
        json.dumps(req.attributes, separators=(",", ":")),
    )


def _row_to_class_code(row: sqlite3.Row) -> PlanClassCode:
    """Decode a `plan_class_codes` row into a `PlanClassCode`."""
    return PlanClassCode(
        rating_plan_id=row["rating_plan_id"],
        class_code=row["class_code"],
        display_name=row["display_name"],
        family=row["family"],
        description=row["description"],
        naics_code=row["naics_code"],
        sic_code=row["sic_code"],
        eligible_for=(
            json.loads(row["eligible_for_json"]) if row["eligible_for_json"] else []
        ),
        exposure_bases=(
            json.loads(row["exposure_bases_json"])
            if row["exposure_bases_json"]
            else []
        ),
        attributes=(
            json.loads(row["attributes_json"]) if row["attributes_json"] else {}
        ),
        source=row["source"],
        note=row["note"],
        citation_rule=row["citation_rule"],
        citation_page=row["citation_page"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        content_hash=row["content_hash"],
    )


# ---------------------------------------------------------------
# Reads
# ---------------------------------------------------------------


def list_class_codes(
    *,
    db: Database,
    rating_plan_id: str,
) -> list[PlanClassCode]:
    """All classes for a plan, ordered by `class_code` (stable for UI).

    Returns an empty list when the plan has no classes yet (not an error).
    """
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"SELECT {_COLUMNS} FROM plan_class_codes "
            "WHERE rating_plan_id = ? ORDER BY class_code",
            (rating_plan_id,),
        ).fetchall()
    return [_row_to_class_code(r) for r in rows]


def get_class_code(
    *,
    db: Database,
    rating_plan_id: str,
    class_code: str,
) -> PlanClassCode | None:
    """Fetch one class by `(plan_id, class_code)`. Returns None if absent."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            f"SELECT {_COLUMNS} FROM plan_class_codes "
            "WHERE rating_plan_id = ? AND class_code = ?",
            (rating_plan_id, class_code),
        ).fetchone()
    return _row_to_class_code(row) if row is not None else None


# ---------------------------------------------------------------
# Writes
# ---------------------------------------------------------------

_INSERT_SQL = """
    INSERT OR REPLACE INTO plan_class_codes (
        rating_plan_id, class_code, display_name, family, description,
        naics_code, sic_code, eligible_for_json, exposure_bases_json,
        attributes_json, source, note, citation_rule, citation_page,
        created_at, updated_at, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def upsert_class_code(
    *,
    db: Database,
    rating_plan_id: str,
    req: UpsertClassCodeRequest,
) -> PlanClassCode:
    """Insert or replace one class. Atomic via `INSERT OR REPLACE`. The
    `created_at` is preserved across updates (read first). Returns the
    materialized `PlanClassCode`."""
    now = _now_iso()
    content_hash = _compute_hash(req)
    eligible_for_json, exposure_bases_json, attributes_json = _serialize_json_cols(req)

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        existing = conn.execute(
            "SELECT created_at FROM plan_class_codes "
            "WHERE rating_plan_id = ? AND class_code = ?",
            (rating_plan_id, req.class_code),
        ).fetchone()
        created_at = existing["created_at"] if existing else now

        conn.execute(
            _INSERT_SQL,
            (
                rating_plan_id,
                req.class_code,
                req.display_name,
                req.family,
                req.description,
                req.naics_code,
                req.sic_code,
                eligible_for_json,
                exposure_bases_json,
                attributes_json,
                req.source,
                req.note,
                req.citation_rule,
                req.citation_page,
                created_at,
                now,
                content_hash,
            ),
        )
        conn.commit()

    materialized = get_class_code(
        db=db, rating_plan_id=rating_plan_id, class_code=req.class_code
    )
    assert materialized is not None, "upsert + read race; should be unreachable"
    return materialized


def delete_class_code(
    *,
    db: Database,
    rating_plan_id: str,
    class_code: str,
) -> bool:
    """Remove one class. Returns True if a row was deleted, False if not
    found. The route layer translates False → 404."""
    with db.connection() as conn:
        cursor = conn.execute(
            "DELETE FROM plan_class_codes "
            "WHERE rating_plan_id = ? AND class_code = ?",
            (rating_plan_id, class_code),
        )
        conn.commit()
    return cursor.rowcount > 0


def bulk_import_class_codes(
    *,
    db: Database,
    rating_plan_id: str,
    reqs: list[UpsertClassCodeRequest],
    mode: str = "merge",
) -> list[PlanClassCode]:
    """Import a class table atomically (Brief 51 §−1 Q3).

    `mode='merge'` (default) upserts each provided class, preserving any
    others already in the plan. `mode='replace'` deletes ALL existing
    classes for the plan first. Either way the whole batch + the delete
    are one transaction. `created_at` is preserved per class on merge.

    Returns the full materialized list (ordered by class_code).
    """
    now = _now_iso()
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN")
        try:
            if mode == "replace":
                conn.execute(
                    "DELETE FROM plan_class_codes WHERE rating_plan_id = ?",
                    (rating_plan_id,),
                )
                existing_created: dict[str, str] = {}
            else:
                existing_created = {
                    r["class_code"]: r["created_at"]
                    for r in conn.execute(
                        "SELECT class_code, created_at FROM plan_class_codes "
                        "WHERE rating_plan_id = ?",
                        (rating_plan_id,),
                    ).fetchall()
                }

            for req in reqs:
                content_hash = _compute_hash(req)
                (
                    eligible_for_json,
                    exposure_bases_json,
                    attributes_json,
                ) = _serialize_json_cols(req)
                created_at = existing_created.get(req.class_code, now)
                conn.execute(
                    _INSERT_SQL,
                    (
                        rating_plan_id,
                        req.class_code,
                        req.display_name,
                        req.family,
                        req.description,
                        req.naics_code,
                        req.sic_code,
                        eligible_for_json,
                        exposure_bases_json,
                        attributes_json,
                        req.source,
                        req.note,
                        req.citation_rule,
                        req.citation_page,
                        created_at,
                        now,
                        content_hash,
                    ),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return list_class_codes(db=db, rating_plan_id=rating_plan_id)
