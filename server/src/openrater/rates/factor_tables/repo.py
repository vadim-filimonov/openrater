# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Repository for plan-scoped factor tables + cells.

All functions take `db: Database` + typed Pydantic args, open per-call
connections via `with db.connection()`, use raw SQL with `?` placeholders.
Matches the convention in `rates/dimensions/repo.py`.

Storage split (see migration 005): metadata lives in `plan_factor_tables`,
cell values in `plan_factor_table_cells`. The API merges them inline on
read; mutations target either the metadata row, the cell map, or both.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3

from openrater.persistence.db import Database
from openrater.rates.factor_tables.models import (
    FactorTableInterpolation,
    PlanFactorTable,
    UpsertFactorTableRequest,
)

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def _compute_hash(req: UpsertFactorTableRequest) -> str:
    """Canonical JSON → SHA-256 → 16-char prefix. Matches the dim-row
    convention in `rates/dimensions/repo.py:_compute_hash`."""
    canonical = json.dumps(req.model_dump(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _row_to_factor_table(
    row: sqlite3.Row,
    cells: dict[str, float],
) -> PlanFactorTable:
    """Decode a `plan_factor_tables` row + the materialized cells dict
    into a `PlanFactorTable`. JSON columns are deserialized; missing
    optional fields fall back to Pydantic defaults."""
    key_dimensions: list[str] = json.loads(row["key_dimensions_json"] or "[]")
    interpolation_raw = row["interpolation_json"]
    interpolation = (
        FactorTableInterpolation.model_validate_json(interpolation_raw)
        if interpolation_raw
        else None
    )
    return PlanFactorTable(
        rating_plan_id=row["rating_plan_id"],
        table_id=row["table_id"],
        display_name=row["display_name"],
        slug=row["slug"],
        description=row["description"],
        key_dimensions=key_dimensions,
        draft_status=row["draft_status"],
        source_pdf_url=row["source_pdf_url"],
        source_page=row["source_page"],
        cells=cells,
        interpolation=interpolation,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        content_hash=row["content_hash"],
    )


def _load_cells_for_tables(
    conn: sqlite3.Connection,
    rating_plan_id: str,
    table_ids: list[str],
) -> dict[str, dict[str, float]]:
    """Bulk-load cells for the supplied table ids. Returns a dict
    keyed by table_id; each value is the cell map. Empty dict for
    tables with no cells yet."""
    out: dict[str, dict[str, float]] = {tid: {} for tid in table_ids}
    if not table_ids:
        return out
    placeholders = ",".join(["?"] * len(table_ids))
    rows = conn.execute(
        f"""
        SELECT table_id, cell_key, value
        FROM plan_factor_table_cells
        WHERE rating_plan_id = ? AND table_id IN ({placeholders})
        """,
        (rating_plan_id, *table_ids),
    ).fetchall()
    for r in rows:
        out[r["table_id"]][r["cell_key"]] = r["value"]
    return out


def _write_cells(
    conn: sqlite3.Connection,
    rating_plan_id: str,
    table_id: str,
    cells: dict[str, float],
) -> None:
    """Replace-all cells for one FT inside an OPEN transaction.
    Caller owns the BEGIN / COMMIT / ROLLBACK envelope."""
    now = _now_iso()
    conn.execute(
        "DELETE FROM plan_factor_table_cells "
        "WHERE rating_plan_id = ? AND table_id = ?",
        (rating_plan_id, table_id),
    )
    if not cells:
        return
    conn.executemany(
        """
        INSERT INTO plan_factor_table_cells (
            rating_plan_id, table_id, cell_key, value, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        """,
        [
            (rating_plan_id, table_id, key, float(value), now)
            for key, value in cells.items()
        ],
    )


# ---------------------------------------------------------------
# Reads
# ---------------------------------------------------------------


def list_factor_tables(
    *,
    db: Database,
    rating_plan_id: str,
) -> list[PlanFactorTable]:
    """All factor tables (with cells inlined) for a plan, ordered by
    slug (stable for UI). Returns an empty list if the plan has no
    FTs yet (not an error)."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT rating_plan_id, table_id, display_name, slug, description,
                   key_dimensions_json, draft_status, source_pdf_url, source_page,
                   interpolation_json, created_at, updated_at, content_hash
            FROM plan_factor_tables
            WHERE rating_plan_id = ?
            ORDER BY slug
            """,
            (rating_plan_id,),
        ).fetchall()
        if not rows:
            return []
        table_ids = [r["table_id"] for r in rows]
        cells_by_table = _load_cells_for_tables(conn, rating_plan_id, table_ids)
    return [
        _row_to_factor_table(r, cells_by_table.get(r["table_id"], {}))
        for r in rows
    ]


def get_factor_table(
    *,
    db: Database,
    rating_plan_id: str,
    table_id: str,
) -> PlanFactorTable | None:
    """Fetch one FT (with cells) by `(plan_id, table_id)`. Returns
    None if not found."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT rating_plan_id, table_id, display_name, slug, description,
                   key_dimensions_json, draft_status, source_pdf_url, source_page,
                   interpolation_json, created_at, updated_at, content_hash
            FROM plan_factor_tables
            WHERE rating_plan_id = ? AND table_id = ?
            """,
            (rating_plan_id, table_id),
        ).fetchone()
        if row is None:
            return None
        cells = _load_cells_for_tables(conn, rating_plan_id, [table_id])
    return _row_to_factor_table(row, cells.get(table_id, {}))


# ---------------------------------------------------------------
# Writes
# ---------------------------------------------------------------


def upsert_factor_table(
    *,
    db: Database,
    rating_plan_id: str,
    req: UpsertFactorTableRequest,
) -> PlanFactorTable:
    """Insert or replace one FT (metadata + optional cells), atomically.

    When `req.cells is None` the metadata is upserted + the cell map
    is preserved; when `req.cells` is an explicit dict (even empty)
    the cell map is REPLACED with the supplied content.

    `created_at` is preserved across updates.
    """
    now = _now_iso()
    content_hash = _compute_hash(req)
    key_dimensions_json = json.dumps(req.key_dimensions, separators=(",", ":"))
    interpolation_json = (
        req.interpolation.model_dump_json() if req.interpolation is not None else None
    )

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        existing = conn.execute(
            "SELECT created_at FROM plan_factor_tables "
            "WHERE rating_plan_id = ? AND table_id = ?",
            (rating_plan_id, req.table_id),
        ).fetchone()
        created_at = existing["created_at"] if existing else now

        conn.execute("BEGIN")
        try:
            # Use ON CONFLICT DO UPDATE rather than INSERT OR REPLACE.
            # INSERT OR REPLACE is implemented as DELETE + INSERT, and
            # the DELETE fires `plan_factor_table_cells`'s ON DELETE
            # CASCADE — wiping every cell on every metadata edit.
            # ON CONFLICT updates the row in place without a DELETE,
            # so cells survive when `req.cells is None`.
            conn.execute(
                """
                INSERT INTO plan_factor_tables (
                    rating_plan_id, table_id, display_name, slug, description,
                    key_dimensions_json, draft_status, source_pdf_url, source_page,
                    interpolation_json, created_at, updated_at, content_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(rating_plan_id, table_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    slug = excluded.slug,
                    description = excluded.description,
                    key_dimensions_json = excluded.key_dimensions_json,
                    draft_status = excluded.draft_status,
                    source_pdf_url = excluded.source_pdf_url,
                    source_page = excluded.source_page,
                    interpolation_json = excluded.interpolation_json,
                    updated_at = excluded.updated_at,
                    content_hash = excluded.content_hash
                """,
                (
                    rating_plan_id,
                    req.table_id,
                    req.display_name,
                    req.slug,
                    req.description,
                    key_dimensions_json,
                    req.draft_status,
                    req.source_pdf_url,
                    req.source_page,
                    interpolation_json,
                    created_at,
                    now,
                    content_hash,
                ),
            )
            if req.cells is not None:
                _write_cells(conn, rating_plan_id, req.table_id, req.cells)
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    materialized = get_factor_table(
        db=db, rating_plan_id=rating_plan_id, table_id=req.table_id
    )
    assert materialized is not None, "upsert + read race; should be unreachable"
    return materialized


def upsert_factor_table_cells(
    *,
    db: Database,
    rating_plan_id: str,
    table_id: str,
    cells: dict[str, float],
) -> PlanFactorTable:
    """Replace-all the cell map for one FT, atomically. Metadata is
    untouched (use `upsert_factor_table` for that). Bumps the FT's
    `updated_at`.

    Raises if the FT doesn't exist — the route layer turns this into a
    404 `factor_table_not_found`.
    """
    now = _now_iso()
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        existing = conn.execute(
            "SELECT created_at FROM plan_factor_tables "
            "WHERE rating_plan_id = ? AND table_id = ?",
            (rating_plan_id, table_id),
        ).fetchone()
        if existing is None:
            raise LookupError(
                f"Factor table {table_id!r} not found in plan {rating_plan_id!r}"
            )

        conn.execute("BEGIN")
        try:
            _write_cells(conn, rating_plan_id, table_id, cells)
            conn.execute(
                "UPDATE plan_factor_tables SET updated_at = ? "
                "WHERE rating_plan_id = ? AND table_id = ?",
                (now, rating_plan_id, table_id),
            )
            # Drift tracking: every substrate mutation
            # recomputes the plan hash — the authoring paths always
            # did; the direct cells edit was the gap that made both
            # If-Match and "edited since build" blind to it.
            from openrater.rates.plans.repo import recompute_content_hash

            recompute_content_hash(conn=conn, rating_plan_id=rating_plan_id)
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    materialized = get_factor_table(
        db=db, rating_plan_id=rating_plan_id, table_id=table_id
    )
    assert materialized is not None, "cells write + read race; should be unreachable"
    return materialized


def delete_factor_table(
    *,
    db: Database,
    rating_plan_id: str,
    table_id: str,
) -> bool:
    """Remove one FT. Returns True if a row was deleted, False if not
    found. Cells cascade away via the FK."""
    with db.connection() as conn:
        cursor = conn.execute(
            "DELETE FROM plan_factor_tables "
            "WHERE rating_plan_id = ? AND table_id = ?",
            (rating_plan_id, table_id),
        )
        conn.commit()
    return cursor.rowcount > 0


def bulk_upsert_factor_tables(
    *,
    db: Database,
    rating_plan_id: str,
    reqs: list[UpsertFactorTableRequest],
) -> list[PlanFactorTable]:
    """Atomic replace-all. Deletes every existing FT (and via cascade,
    every cell) for the plan, then inserts the supplied set + their
    cells, all in a single transaction. Used by the localStorage → API
    one-shot migration per ADR-0027 §3.

    Returns the full materialized list (ordered by slug, like
    `list_factor_tables`).
    """
    now = _now_iso()
    with db.connection() as conn:
        conn.execute("BEGIN")
        try:
            # Cascade kills the cell rows too.
            conn.execute(
                "DELETE FROM plan_factor_tables WHERE rating_plan_id = ?",
                (rating_plan_id,),
            )
            for req in reqs:
                content_hash = _compute_hash(req)
                key_dimensions_json = json.dumps(
                    req.key_dimensions, separators=(",", ":")
                )
                interpolation_json = (
                    req.interpolation.model_dump_json()
                    if req.interpolation is not None
                    else None
                )
                conn.execute(
                    """
                    INSERT INTO plan_factor_tables (
                        rating_plan_id, table_id, display_name, slug, description,
                        key_dimensions_json, draft_status, source_pdf_url,
                        source_page, interpolation_json, created_at, updated_at,
                        content_hash
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        rating_plan_id,
                        req.table_id,
                        req.display_name,
                        req.slug,
                        req.description,
                        key_dimensions_json,
                        req.draft_status,
                        req.source_pdf_url,
                        req.source_page,
                        interpolation_json,
                        now,
                        now,
                        content_hash,
                    ),
                )
                if req.cells:
                    _write_cells(conn, rating_plan_id, req.table_id, req.cells)
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return list_factor_tables(db=db, rating_plan_id=rating_plan_id)


def factor_tables_collection_hash(*, db: Database, rating_plan_id: str) -> str:
    """Deterministic hash of the WHOLE factor-table set — sorted
    (table_id, content_hash) pairs; each row's content_hash already
    covers its cells — so the bulk replace-all can be preconditioned
    with If-Match (v4 G14). Same convention as
    `dimensions_collection_hash`."""
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT table_id, content_hash FROM plan_factor_tables"
            " WHERE rating_plan_id = ? ORDER BY table_id",
            (rating_plan_id,),
        ).fetchall()
    canonical = json.dumps(
        [[row[0], row[1]] for row in rows], separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
