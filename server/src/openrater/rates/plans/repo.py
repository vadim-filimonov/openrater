# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Repository for the RatingPlan substrate.

All persistence flows through this module. Functions are pure side-
effects on the four `rating_plans*` tables; they take typed Pydantic
shapes from `models.py` as input and return them on output.

Concurrency model: SQLite + per-request transactions. `insert_plan` is
atomic — a failure mid-stages rolls back the plan and any prior stages
inserted in the same call.

Failure-loud: every read returns Optional/None when the plan or stage
doesn't exist. Writes raise `PlanParseError` (or pass through Pydantic
ValidationError) on contract violations; the route layer translates to
typed HTTPExceptions.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from openrater.persistence import Database
from openrater.rates.plans.errors import PlanParseError
from openrater.rates.plans.hashing import hash_plan
from openrater.rates.plans.models import (
    InputSource,
    LineOfBusiness,
    PlanStatus,
    ProductCode,
    RatingPlan,
    Stage,
    StageInput,
    StageKind,
    StageOutput,
)

# ===========================================================================
# Helpers
# ===========================================================================


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _build_content_dict(plan: RatingPlan, stages: list[Stage]) -> dict[str, Any]:
    """Canonical content shape that feeds `hash_plan()`. Extracted so
    `insert_plan` (initial hash) and `recompute_content_hash` (after
    mutations) use the same definition; if these drift, the hash on
    a newly-created plan and the hash after a no-op edit would differ."""
    return {
        "rating_plan_id": plan.rating_plan_id,
        "display_name": plan.display_name,
        "line_of_business": plan.line_of_business.value,
        "product": plan.product.value if plan.product else None,
        "jurisdiction": plan.jurisdiction,
        "effective_date": plan.effective_date,
        "description": plan.description,
        "parent_plan_id": plan.parent_plan_id,
        "source_filing_id": plan.source_filing_id,
        "template_id": plan.template_id,
        "coverages": list(plan.coverages) if plan.coverages else None,
        "section_layout": plan.section_layout,
        "stages": [
            {
                "stage_id": s.stage_id,
                "sequence": s.sequence,
                "stage_kind": s.stage_kind.value,
                "config_json": s.config_json,
            }
            for s in sorted(stages, key=lambda s: s.sequence)
        ],
    }


def recompute_content_hash(
    *,
    conn: sqlite3.Connection,
    rating_plan_id: str,
) -> str | None:
    """Recompute `content_hash` for a plan from its current rows and
    persist the new value (+ bump `last_edited_at`). Returns the new
    hash, or `None` if the plan doesn't exist.

    Called from every mutation in `author.py` (add/patch/remove/reorder
    stage, patch IO, connect/disconnect wire) within the same transaction
    so the hash never drifts from the plan's actual content. Retires
    WA-9 from DEVELOPMENT_PLAN.md §6.
    """
    plan_row = conn.execute(
        """
        SELECT rating_plan_id, display_name, line_of_business, product, jurisdiction,
               effective_date, description, parent_plan_id, status,
               source_filing_id, created_at, last_edited_at, content_hash,
               template_id, coverages, section_layout
        FROM rating_plans
        WHERE rating_plan_id = ?
        """,
        (rating_plan_id,),
    ).fetchone()
    if plan_row is None:
        return None

    plan = _row_to_plan(plan_row)
    stage_rows = conn.execute(
        """
        SELECT rating_plan_id, stage_id, sequence, stage_kind,
               display_name, config_json, citation_rule,
               citation_page, source_filing_id, x_position, y_position
        FROM rating_plan_stages
        WHERE rating_plan_id = ?
        ORDER BY sequence
        """,
        (rating_plan_id,),
    ).fetchall()
    stages = [_row_to_stage(r) for r in stage_rows]

    new_hash = hash_plan(_build_content_dict(plan, stages))
    now = _now_iso()
    conn.execute(
        """
        UPDATE rating_plans
        SET content_hash = ?,
            last_edited_at = ?
        WHERE rating_plan_id = ?
        """,
        (new_hash, now, rating_plan_id),
    )
    return new_hash


def _row_to_plan(row: sqlite3.Row) -> RatingPlan:
    keys = row.keys() if hasattr(row, "keys") else ()
    template_id = row["template_id"] if "template_id" in keys else None
    product_raw = row["product"] if "product" in keys else None
    coverages_json = row["coverages"] if "coverages" in keys else None
    section_layout_json = row["section_layout"] if "section_layout" in keys else None
    last_edited_at = row["last_edited_at"] if "last_edited_at" in keys else None
    content_hash = row["content_hash"] if "content_hash" in keys else None

    coverages: tuple[str, ...] | None
    if coverages_json:
        coverages = tuple(json.loads(coverages_json))
    else:
        coverages = None

    section_layout: dict[str, list[str]] | None
    if section_layout_json:
        section_layout = json.loads(section_layout_json)
    else:
        section_layout = None

    return RatingPlan(
        rating_plan_id=row["rating_plan_id"],
        display_name=row["display_name"],
        line_of_business=LineOfBusiness(row["line_of_business"]),
        product=ProductCode(product_raw) if product_raw else None,
        jurisdiction=row["jurisdiction"],
        effective_date=row["effective_date"],
        description=row["description"],
        parent_plan_id=row["parent_plan_id"],
        status=PlanStatus(row["status"]),
        source_filing_id=row["source_filing_id"],
        created_at=row["created_at"],
        template_id=template_id,
        coverages=coverages,
        section_layout=section_layout,
        last_edited_at=last_edited_at,
        content_hash=content_hash,
    )


def _row_to_stage(row: sqlite3.Row) -> Stage:
    keys = row.keys() if hasattr(row, "keys") else ()
    x_pos = row["x_position"] if "x_position" in keys else None
    y_pos = row["y_position"] if "y_position" in keys else None
    return Stage(
        rating_plan_id=row["rating_plan_id"],
        stage_id=row["stage_id"],
        sequence=int(row["sequence"]),
        stage_kind=StageKind(row["stage_kind"]),
        display_name=row["display_name"],
        config_json=json.loads(row["config_json"] or "{}"),
        citation_rule=row["citation_rule"],
        citation_page=row["citation_page"],
        source_filing_id=row["source_filing_id"],
        x_position=x_pos,
        y_position=y_pos,
    )


def _row_to_input(row: sqlite3.Row) -> StageInput:
    return StageInput(
        input_name=row["input_name"],
        input_source=InputSource(row["input_source"]),
        input_path=row["input_path"],
        data_type=row["data_type"],
        required=bool(row["required"]),
        default_value=row["default_value"],
    )


def _row_to_output(row: sqlite3.Row) -> StageOutput:
    return StageOutput(
        output_name=row["output_name"],
        data_type=row["data_type"],
        description=row["description"],
    )


# ===========================================================================
# Public API
# ===========================================================================


def get_plan(*, db: Database, rating_plan_id: str) -> RatingPlan | None:
    """Fetch one plan by id. Returns None if not found."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT rating_plan_id, display_name, line_of_business, product, jurisdiction,
                   effective_date, description, parent_plan_id, status,
                   source_filing_id, created_at,
                   template_id, coverages, section_layout, last_edited_at,
                   content_hash
            FROM rating_plans
            WHERE rating_plan_id = ?
            """,
            (rating_plan_id,),
        ).fetchone()
    if row is None:
        return None
    return _row_to_plan(row)


def list_plans(
    *,
    db: Database,
    line_of_business: LineOfBusiness | None = None,
    product: ProductCode | None = None,
    status: PlanStatus | None = PlanStatus.ACTIVE,
) -> list[RatingPlan]:
    """List plans, optionally filtered by product / LOB / status. Default
    returns only `active` plans. Pass `status=None` for every status.
    Ordering leads with `product` (the ADR-0033 truth axis) so a mixed
    book clusters by what the plans actually rate, not the legacy shim."""
    where: list[str] = []
    params: list[Any] = []
    if line_of_business is not None:
        where.append("line_of_business = ?")
        params.append(line_of_business.value)
    if product is not None:
        where.append("product = ?")
        params.append(product.value)
    if status is not None:
        where.append("status = ?")
        params.append(status.value)
    where_clause = (" WHERE " + " AND ".join(where)) if where else ""
    sql = f"""
        SELECT rating_plan_id, display_name, line_of_business, product, jurisdiction,
               effective_date, description, parent_plan_id, status,
               source_filing_id, created_at,
               template_id, coverages, section_layout, last_edited_at,
               content_hash
        FROM rating_plans
        {where_clause}
        ORDER BY product, jurisdiction, effective_date DESC, rating_plan_id
    """
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_plan(r) for r in rows]


def get_stages(*, db: Database, rating_plan_id: str) -> list[Stage]:
    """All stages for a plan, ordered by `sequence`."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT rating_plan_id, stage_id, sequence, stage_kind, display_name,
                   config_json, citation_rule, citation_page, source_filing_id,
                   x_position, y_position
            FROM rating_plan_stages
            WHERE rating_plan_id = ?
            ORDER BY sequence
            """,
            (rating_plan_id,),
        ).fetchall()
    return [_row_to_stage(r) for r in rows]


def get_stage_io(
    *,
    db: Database,
    rating_plan_id: str,
    stage_id: str,
) -> tuple[list[StageInput], list[StageOutput]]:
    """Fetch declared inputs + outputs for one stage."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        input_rows = conn.execute(
            """
            SELECT input_name, input_source, input_path, data_type, required,
                   default_value
            FROM rating_plan_stage_inputs
            WHERE rating_plan_id = ? AND stage_id = ?
            ORDER BY input_name
            """,
            (rating_plan_id, stage_id),
        ).fetchall()
        output_rows = conn.execute(
            """
            SELECT output_name, data_type, description
            FROM rating_plan_stage_outputs
            WHERE rating_plan_id = ? AND stage_id = ?
            ORDER BY output_name
            """,
            (rating_plan_id, stage_id),
        ).fetchall()
    return (
        [_row_to_input(r) for r in input_rows],
        [_row_to_output(r) for r in output_rows],
    )


def update_plan_provenance(
    *,
    db: Database,
    rating_plan_id: str,
    display_name: str,
    line_of_business: str,
    product: str | None,
    jurisdiction: str | None,
    effective_date: str,
    description: str | None,
    coverages: tuple[str, ...] | None,
) -> None:
    """Brief 92.R (D4) — the plan-row half of a re-ingest apply: the
    revision's provenance fields land on the SAME row. Caller guards
    state (author layer) and recomputes the content hash after the
    full replay."""
    conn = db.connection()
    try:
        conn.execute(
            """
            UPDATE rating_plans
               SET display_name = ?, line_of_business = ?, product = ?,
                   jurisdiction = ?, effective_date = ?, description = ?,
                   coverages = ?, last_edited_at = ?
             WHERE rating_plan_id = ?
            """,
            (
                display_name,
                line_of_business,
                product,
                jurisdiction,
                effective_date,
                description,
                json.dumps(list(coverages)) if coverages else None,
                _now_iso(),
                rating_plan_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def insert_plan(
    *,
    db: Database,
    plan: RatingPlan,
    stages: list[Stage],
    stage_io: dict[str, tuple[list[StageInput], list[StageOutput]]] | None = None,
) -> None:
    """Atomically insert a plan + all its stages + their declared IO.

    Raises:
        PlanParseError: if any stage's `rating_plan_id` doesn't match
            the plan's id, or if the sequence numbers aren't unique +
            dense + 1-indexed.
        sqlite3.IntegrityError: if a CHECK constraint or FK fails.
    """
    for s in stages:
        if s.rating_plan_id != plan.rating_plan_id:
            raise PlanParseError(
                f"insert_plan: stage_id={s.stage_id!r} carries "
                f"rating_plan_id={s.rating_plan_id!r}, expected "
                f"{plan.rating_plan_id!r}"
            )
    sequences = sorted(s.sequence for s in stages)
    if sequences != list(range(1, len(stages) + 1)):
        raise PlanParseError(
            f"insert_plan: stages must have dense, 1-indexed, unique "
            f"sequence numbers. Got {sequences!r} for plan_id={plan.rating_plan_id!r}"
        )

    stage_io = stage_io or {}

    now = _now_iso()
    last_edited_at = plan.last_edited_at or now
    coverages_json = json.dumps(list(plan.coverages)) if plan.coverages is not None else None
    section_layout_json = (
        json.dumps(plan.section_layout, sort_keys=True) if plan.section_layout is not None else None
    )
    content_hash = plan.content_hash or hash_plan(_build_content_dict(plan, stages))

    with db.connection() as conn:
        try:
            conn.execute("BEGIN")
            conn.execute(
                """
                INSERT INTO rating_plans (
                    rating_plan_id, display_name, line_of_business, product,
                    jurisdiction,
                    effective_date, description, parent_plan_id, status,
                    source_filing_id, created_at,
                    template_id, coverages, section_layout, last_edited_at,
                    content_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    plan.rating_plan_id,
                    plan.display_name,
                    plan.line_of_business.value,
                    plan.product.value if plan.product else None,
                    plan.jurisdiction,
                    plan.effective_date,
                    plan.description,
                    plan.parent_plan_id,
                    plan.status.value,
                    plan.source_filing_id,
                    plan.created_at or now,
                    plan.template_id,
                    coverages_json,
                    section_layout_json,
                    last_edited_at,
                    content_hash,
                ),
            )
            for s in stages:
                conn.execute(
                    """
                    INSERT INTO rating_plan_stages (
                        rating_plan_id, stage_id, sequence, stage_kind,
                        display_name, config_json, citation_rule,
                        citation_page, source_filing_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        s.rating_plan_id,
                        s.stage_id,
                        s.sequence,
                        s.stage_kind.value,
                        s.display_name,
                        json.dumps(s.config_json, sort_keys=True),
                        s.citation_rule,
                        s.citation_page,
                        s.source_filing_id,
                    ),
                )
                inputs, outputs = stage_io.get(s.stage_id, ([], []))
                for inp in inputs:
                    conn.execute(
                        """
                        INSERT INTO rating_plan_stage_inputs (
                            rating_plan_id, stage_id, input_name, input_source,
                            input_path, data_type, required, default_value
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            s.rating_plan_id,
                            s.stage_id,
                            inp.input_name,
                            inp.input_source.value,
                            inp.input_path,
                            inp.data_type,
                            int(inp.required),
                            inp.default_value,
                        ),
                    )
                for out in outputs:
                    conn.execute(
                        """
                        INSERT INTO rating_plan_stage_outputs (
                            rating_plan_id, stage_id, output_name,
                            data_type, description
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            s.rating_plan_id,
                            s.stage_id,
                            out.output_name,
                            out.data_type,
                            out.description,
                        ),
                    )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


__all__ = [
    "get_plan",
    "get_stage_io",
    "get_stages",
    "insert_plan",
    "list_plans",
]
