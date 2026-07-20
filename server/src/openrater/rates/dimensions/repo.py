# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Repository for plan-scoped dimensions.

All functions take `db: Database` + typed Pydantic args, open per-call
connections via `with db.connection()`, use raw SQL with `?` placeholders.
Matches the convention in `rates/plans/repo.py`.

`levels` + `axes` round-trip as JSON in the `levels_json` / `axes_json`
columns — the backend doesn't introspect their shape, just stores +
returns. Frontend / Engine discriminate by `kind` on each entry.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3
from typing import Any

from openrater.persistence.db import Database
from openrater.rates.dimensions.models import (
    DerivedFrom,
    GeoScopeNational,
    GeoScopeSubset,
    GeoTerritory,
    PlanDimension,
    UpsertDimensionRequest,
)

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def _compute_hash(req: UpsertDimensionRequest) -> str:
    """Canonical JSON → SHA-256 → 16-char prefix. Matches the plan-row
    convention in `rates/plans/repo.py:recompute_content_hash`."""
    canonical = json.dumps(req.model_dump(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _decode_geo_scope(raw: str | None) -> GeoScopeNational | GeoScopeSubset | None:
    """Discriminator-aware decoder for `geo_scope_json`. Returns None
    when the column is NULL (non-geographic dim)."""
    if raw is None:
        return None
    decoded = json.loads(raw)
    kind = decoded.get("kind")
    if kind == "national":
        return GeoScopeNational(kind="national")
    if kind == "subset":
        return GeoScopeSubset(kind="subset", states=decoded.get("states", []))
    raise ValueError(f"unknown geo_scope kind: {kind!r}")


def _decode_geo_territories(raw: str | None) -> list[GeoTerritory] | None:
    """Decode `geo_territories_json` into a list of `GeoTerritory`.
    Returns None for non-geo dims; an empty list for geo dims with no
    territory grouping."""
    if raw is None:
        return None
    decoded = json.loads(raw)
    return [GeoTerritory(**t) for t in decoded]


def _decode_json_or_none(raw: str | None):
    """Decode an optional JSON column; NULL → None (Brief 66 §3.2 —
    classification_mapping_json / options_json)."""
    if raw is None:
        return None
    return json.loads(raw)


def _decode_derived_from(raw: str | None) -> DerivedFrom | None:
    """Decode `derived_from_json` into a `DerivedFrom`. NULL → None (a
    non-derived dim). Per ADR-0035 / Brief 51."""
    if raw is None:
        return None
    return DerivedFrom(**json.loads(raw))


def _row_to_dimension(row: sqlite3.Row) -> PlanDimension:
    """Decode a `plan_dimensions` row into a `PlanDimension`. JSON
    columns are deserialized; missing optional fields use Pydantic
    defaults."""
    levels_raw = row["levels_json"]
    levels: list[dict[str, Any]] = json.loads(levels_raw) if levels_raw else []
    axes_raw = row["axes_json"]
    axes: list[str] | None = json.loads(axes_raw) if axes_raw else None

    return PlanDimension(
        rating_plan_id=row["rating_plan_id"],
        dim_id=row["dim_id"],
        display_name=row["display_name"],
        slug=row["slug"],
        data_type=row["data_type"],
        role=row["role"],
        dimension_type=row["dimension_type"],
        shape=row["shape"],
        description=row["description"],
        levels=levels,
        axes=axes,
        source_field=row["source_field"],
        # Brief 44 substrate.
        geo_granularity=row["geo_granularity"],
        geo_scope=_decode_geo_scope(row["geo_scope_json"]),
        geo_territories=_decode_geo_territories(row["geo_territories_json"]),
        class_library_id=row["class_library_id"],
        derived_from=_decode_derived_from(row["derived_from_json"]),
        classification_mapping=_decode_json_or_none(
            row["classification_mapping_json"]
        ),
        options=_decode_json_or_none(row["options_json"]),
        monotonicity_expected=_decode_json_or_none(
            row["monotonicity_expected_json"]
        ),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        content_hash=row["content_hash"],
    )


# ---------------------------------------------------------------
# Reads
# ---------------------------------------------------------------


def list_dimensions(
    *,
    db: Database,
    rating_plan_id: str,
) -> list[PlanDimension]:
    """All dimensions for a plan, ordered by `slug` (stable for UI).

    Returns an empty list if the plan has no dims yet (not an error).
    """
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT rating_plan_id, dim_id, display_name, slug, data_type, role,
                   dimension_type, shape, description, levels_json, axes_json,
                   source_field,
                   geo_granularity, geo_scope_json, geo_territories_json,
                   class_library_id, derived_from_json,
                   classification_mapping_json, options_json,
                   monotonicity_expected_json,
                   created_at, updated_at, content_hash
            FROM plan_dimensions
            WHERE rating_plan_id = ?
            ORDER BY slug
            """,
            (rating_plan_id,),
        ).fetchall()
    return [_row_to_dimension(r) for r in rows]


def get_dimension(
    *,
    db: Database,
    rating_plan_id: str,
    dim_id: str,
) -> PlanDimension | None:
    """Fetch one dim by `(plan_id, dim_id)`. Returns None if not found."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT rating_plan_id, dim_id, display_name, slug, data_type, role,
                   dimension_type, shape, description, levels_json, axes_json,
                   source_field,
                   geo_granularity, geo_scope_json, geo_territories_json,
                   class_library_id, derived_from_json,
                   classification_mapping_json, options_json,
                   monotonicity_expected_json,
                   created_at, updated_at, content_hash
            FROM plan_dimensions
            WHERE rating_plan_id = ? AND dim_id = ?
            """,
            (rating_plan_id, dim_id),
        ).fetchone()
    if row is None:
        return None
    return _row_to_dimension(row)


# ---------------------------------------------------------------
# Writes
# ---------------------------------------------------------------


def upsert_dimension(
    *,
    db: Database,
    rating_plan_id: str,
    req: UpsertDimensionRequest,
) -> PlanDimension:
    """Insert or replace a dim. Atomic via `INSERT OR REPLACE`.

    The `created_at` is preserved across updates (an UPDATE preserves
    the column when not in the SET list; INSERT OR REPLACE re-issues
    the row, so we read the existing created_at first if present).

    Returns the materialized `PlanDimension` (with hash + timestamps).
    """
    now = _now_iso()
    content_hash = _compute_hash(req)
    levels_json = json.dumps(req.levels, separators=(",", ":"))
    axes_json = json.dumps(req.axes) if req.axes is not None else None
    # Brief 44 — geo_scope is a Pydantic discriminated union; serialize
    # via .model_dump() so the on-disk shape matches the schema.
    geo_scope_json = (
        json.dumps(req.geo_scope.model_dump(), separators=(",", ":"))
        if req.geo_scope is not None
        else None
    )
    geo_territories_json = (
        json.dumps([t.model_dump() for t in req.geo_territories], separators=(",", ":"))
        if req.geo_territories is not None
        else None
    )
    # Brief 51 / ADR-0035 — class-derived structural dim marker.
    derived_from_json = (
        json.dumps(req.derived_from.model_dump(), separators=(",", ":"))
        if req.derived_from is not None
        else None
    )
    # Brief 66 §3.2 — the last two round-trip gaps (migration 025).
    classification_mapping_json = (
        json.dumps(
            [r.model_dump(exclude_none=True) for r in req.classification_mapping],
            separators=(",", ":"),
        )
        if req.classification_mapping is not None
        else None
    )
    options_json = (
        json.dumps(list(req.options), separators=(",", ":"))
        if req.options is not None
        else None
    )
    monotonicity_expected_json = (
        json.dumps(req.monotonicity_expected)
        if req.monotonicity_expected is not None
        else None
    )

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        existing = conn.execute(
            "SELECT created_at FROM plan_dimensions "
            "WHERE rating_plan_id = ? AND dim_id = ?",
            (rating_plan_id, req.dim_id),
        ).fetchone()
        created_at = existing["created_at"] if existing else now

        conn.execute(
            """
            INSERT OR REPLACE INTO plan_dimensions (
                rating_plan_id, dim_id, display_name, slug, data_type, role,
                dimension_type, shape, description, levels_json, axes_json,
                source_field,
                geo_granularity, geo_scope_json, geo_territories_json,
                class_library_id, derived_from_json,
                classification_mapping_json, options_json,
                monotonicity_expected_json,
                created_at, updated_at, content_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rating_plan_id,
                req.dim_id,
                req.display_name,
                req.slug,
                req.data_type,
                req.role,
                req.dimension_type,
                req.shape,
                req.description,
                levels_json,
                axes_json,
                req.source_field,
                req.geo_granularity,
                geo_scope_json,
                geo_territories_json,
                req.class_library_id,
                derived_from_json,
                classification_mapping_json,
                options_json,
                monotonicity_expected_json,
                created_at,
                now,
                content_hash,
            ),
        )
        conn.commit()

    materialized = get_dimension(
        db=db, rating_plan_id=rating_plan_id, dim_id=req.dim_id
    )
    assert materialized is not None, "upsert + read race; should be unreachable"
    return materialized


def delete_dimension(
    *,
    db: Database,
    rating_plan_id: str,
    dim_id: str,
) -> bool:
    """Remove one dim. Returns True if a row was deleted, False if not
    found. The route layer translates False → 404."""
    with db.connection() as conn:
        cursor = conn.execute(
            "DELETE FROM plan_dimensions WHERE rating_plan_id = ? AND dim_id = ?",
            (rating_plan_id, dim_id),
        )
        conn.commit()
    return cursor.rowcount > 0


def bulk_upsert_dimensions(
    *,
    db: Database,
    rating_plan_id: str,
    reqs: list[UpsertDimensionRequest],
) -> list[PlanDimension]:
    """Atomic replace-all. Deletes every existing dim for the plan and
    inserts the supplied set, in a single transaction. Used by the
    localStorage → API one-shot migration per ADR-0027 §3.

    Returns the full materialized list (ordered by slug, like
    `list_dimensions`).
    """
    now = _now_iso()
    with db.connection() as conn:
        conn.execute("BEGIN")
        try:
            conn.execute(
                "DELETE FROM plan_dimensions WHERE rating_plan_id = ?",
                (rating_plan_id,),
            )
            for req in reqs:
                content_hash = _compute_hash(req)
                levels_json = json.dumps(req.levels, separators=(",", ":"))
                axes_json = (
                    json.dumps(req.axes) if req.axes is not None else None
                )
                # Brief 44 — same serialization as upsert_dimension.
                geo_scope_json = (
                    json.dumps(req.geo_scope.model_dump(), separators=(",", ":"))
                    if req.geo_scope is not None
                    else None
                )
                geo_territories_json = (
                    json.dumps(
                        [t.model_dump() for t in req.geo_territories],
                        separators=(",", ":"),
                    )
                    if req.geo_territories is not None
                    else None
                )
                derived_from_json = (
                    json.dumps(req.derived_from.model_dump(), separators=(",", ":"))
                    if req.derived_from is not None
                    else None
                )
                conn.execute(
                    """
                    INSERT INTO plan_dimensions (
                        rating_plan_id, dim_id, display_name, slug, data_type, role,
                        dimension_type, shape, description, levels_json, axes_json,
                        source_field,
                        geo_granularity, geo_scope_json, geo_territories_json,
                        class_library_id, derived_from_json,
                        created_at, updated_at, content_hash
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        rating_plan_id,
                        req.dim_id,
                        req.display_name,
                        req.slug,
                        req.data_type,
                        req.role,
                        req.dimension_type,
                        req.shape,
                        req.description,
                        levels_json,
                        axes_json,
                        req.source_field,
                        req.geo_granularity,
                        geo_scope_json,
                        geo_territories_json,
                        req.class_library_id,
                        derived_from_json,
                        now,
                        now,
                        content_hash,
                    ),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return list_dimensions(db=db, rating_plan_id=rating_plan_id)


def dimensions_collection_hash(*, db: Database, rating_plan_id: str) -> str:
    """Deterministic hash of the WHOLE dim set — sorted (dim_id,
    content_hash) pairs — so the bulk replace-all can be preconditioned
    with If-Match (v4 G14: two tabs' unconditional replace-alls silently
    destroyed each other's work). Row-order independent; the empty set
    hashes to a stable constant, so a client that loaded an empty plan
    can still precondition its first write."""
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT dim_id, content_hash FROM plan_dimensions"
            " WHERE rating_plan_id = ? ORDER BY dim_id",
            (rating_plan_id,),
        ).fetchall()
    canonical = json.dumps(
        [[row[0], row[1]] for row in rows], separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
