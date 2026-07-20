# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Repository for plan templates.

Templates are server-owned recipes — there's no public mutation
endpoint today. The lifespan upserts bundled JSON files via
`seed_bundled_templates` (see `seed.py`); CRUD here is in service of
that seeder + future admin tooling.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from typing import Any

from openrater.persistence.db import Database
from openrater.rates.templates.models import (
    PlanTemplate,
    PlanTemplateSummary,
    UpsertTemplateRequest,
)

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def _derive_counts(recipe: dict[str, Any]) -> dict[str, Any]:
    """Pre-compute the gallery card numbers so /list doesn't have to
    inflate every recipe blob just to count."""
    dims = recipe.get("dimensions", [])
    fts = recipe.get("factor_tables", [])
    chains = recipe.get("chain_stages", [])
    mapping = recipe.get("input_mapping")
    return {
        "dim_count": len(dims) if isinstance(dims, list) else 0,
        "factor_table_count": len(fts) if isinstance(fts, list) else 0,
        "chain_stage_count": len(chains) if isinstance(chains, list) else 0,
        "has_input_mapping": mapping is not None,
    }


def _row_to_summary(row: sqlite3.Row) -> PlanTemplateSummary:
    coverages: list[str] = (
        json.loads(row["coverages_json"]) if row["coverages_json"] else []
    )
    recipe: dict[str, Any] = json.loads(row["recipe_json"])
    counts = _derive_counts(recipe)
    return PlanTemplateSummary(
        template_id=row["template_id"],
        display_name=row["display_name"],
        description=row["description"],
        line_of_business=row["line_of_business"],
        coverages=coverages,
        dim_count=counts["dim_count"],
        factor_table_count=counts["factor_table_count"],
        chain_stage_count=counts["chain_stage_count"],
        has_input_mapping=counts["has_input_mapping"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_template(row: sqlite3.Row) -> PlanTemplate:
    coverages: list[str] = (
        json.loads(row["coverages_json"]) if row["coverages_json"] else []
    )
    recipe: dict[str, Any] = json.loads(row["recipe_json"])
    counts = _derive_counts(recipe)
    return PlanTemplate(
        template_id=row["template_id"],
        display_name=row["display_name"],
        description=row["description"],
        line_of_business=row["line_of_business"],
        coverages=coverages,
        dim_count=counts["dim_count"],
        factor_table_count=counts["factor_table_count"],
        chain_stage_count=counts["chain_stage_count"],
        has_input_mapping=counts["has_input_mapping"],
        recipe=recipe,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ---------------------------------------------------------------
# Reads
# ---------------------------------------------------------------


def list_templates(*, db: Database) -> list[PlanTemplateSummary]:
    """List every template, ordered by display_name (stable for the
    gallery)."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT template_id, display_name, description, line_of_business,
                   coverages_json, recipe_json, created_at, updated_at
            FROM plan_templates
            ORDER BY display_name
            """,
        ).fetchall()
    return [_row_to_summary(r) for r in rows]


def get_template(*, db: Database, template_id: str) -> PlanTemplate | None:
    """Fetch one template (including the recipe blob). Returns None
    if not found."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT template_id, display_name, description, line_of_business,
                   coverages_json, recipe_json, created_at, updated_at
            FROM plan_templates
            WHERE template_id = ?
            """,
            (template_id,),
        ).fetchone()
    if row is None:
        return None
    return _row_to_template(row)


def list_template_ids(*, db: Database) -> set[str]:
    """Return the set of every ``template_id`` currently in the table.

    Used by the seeder's reconcile pass to find DB rows that no longer
    have a backing recipe file on disk (orphans) so they can be pruned.
    """
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT template_id FROM plan_templates",
        ).fetchall()
    return {row[0] for row in rows}


# ---------------------------------------------------------------
# Writes
# ---------------------------------------------------------------


def upsert_template(
    *,
    db: Database,
    req: UpsertTemplateRequest,
) -> PlanTemplate:
    """Insert or update a template. Preserves `created_at` on update
    via ON CONFLICT — mirrors the convention used in the FT repo."""
    now = _now_iso()
    coverages_json = json.dumps(req.coverages) if req.coverages else None
    recipe_json = json.dumps(req.recipe, separators=(",", ":"))

    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        existing = conn.execute(
            "SELECT created_at FROM plan_templates WHERE template_id = ?",
            (req.template_id,),
        ).fetchone()
        created_at = existing["created_at"] if existing else now

        conn.execute(
            """
            INSERT INTO plan_templates (
                template_id, display_name, description, line_of_business,
                coverages_json, recipe_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(template_id) DO UPDATE SET
                display_name = excluded.display_name,
                description = excluded.description,
                line_of_business = excluded.line_of_business,
                coverages_json = excluded.coverages_json,
                recipe_json = excluded.recipe_json,
                updated_at = excluded.updated_at
            """,
            (
                req.template_id,
                req.display_name,
                req.description,
                req.line_of_business,
                coverages_json,
                recipe_json,
                created_at,
                now,
            ),
        )
        conn.commit()

    materialized = get_template(db=db, template_id=req.template_id)
    assert materialized is not None, "upsert + read race; should be unreachable"
    return materialized


def delete_template(*, db: Database, template_id: str) -> bool:
    """Remove a template. Returns True if a row was deleted."""
    with db.connection() as conn:
        cursor = conn.execute(
            "DELETE FROM plan_templates WHERE template_id = ?",
            (template_id,),
        )
        conn.commit()
    return cursor.rowcount > 0
