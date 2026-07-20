# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Repository for persisted plan runs (Brief 75).

Append-only: INSERT + status-finalize UPDATE only — a run is a record
of what happened, never edited. Mirrors `rates/policy_tail/repo.py`
conventions (ISO-UTC timestamps, opaque JSON payloads).
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
import uuid
from typing import Any

from openrater.persistence.db import Database
from openrater.rates.runs.models import (
    PlanRun,
    PlanRunSummary,
    RunKind,
    RunStatus,
)


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def _headline_of(kind: str, result: dict[str, Any] | None) -> dict[str, Any]:
    """The tiny summary the history rail renders without parsing row
    payloads: the filed premium + verdict for a sample; the facet
    totals for a book. Computed at write time, stored denormalized in
    the summary SELECT via result_json (cheap at our sizes) — kept
    here so list + detail agree on the derivation."""
    if not result:
        return {}
    if kind == "sample":
        views = result.get("views") or {}
        return {
            "premium": views.get("premium"),
            "tier": views.get("tier"),
            "row_status": result.get("row_status"),
        }
    totals = result.get("totals") or {}
    return {
        "totals": totals,
        # 89.4 — a probe's history line reads cells, not dollars (the
        # written sum over a synthetic sweep is not a book number).
        **(
            {"row_count": result["row_count"]}
            if kind == "probe" and isinstance(result.get("row_count"), int)
            else {}
        ),
        # Phase 4 — run-fed Analytics binds its premium column to the
        # summary's declared field, never a client-side name heuristic.
        **(
            {"premium_field": result["premium_field"]}
            if isinstance(result.get("premium_field"), str)
            else {}
        ),
    }


def _row_to_run(row: sqlite3.Row) -> PlanRun:
    return PlanRun(
        run_id=row["run_id"],
        rating_plan_id=row["rating_plan_id"],
        kind=row["kind"],
        status=row["status"],
        created_at=row["created_at"],
        finished_at=row["finished_at"],
        as_of=row["as_of"],
        snapshot_id=row["snapshot_id"],
        plan_content_hash=row["plan_content_hash"],
        book_content_hash=row["book_content_hash"],
        scoring_fingerprint=row["scoring_fingerprint"],
        job_id=row["job_id"],
        request=json.loads(row["request_json"]) if row["request_json"] else {},
        result=json.loads(row["result_json"]) if row["result_json"] else None,
        error_message=row["error_message"],
    )


def _row_to_summary(row: sqlite3.Row) -> PlanRunSummary:
    result = json.loads(row["result_json"]) if row["result_json"] else None
    return PlanRunSummary(
        run_id=row["run_id"],
        rating_plan_id=row["rating_plan_id"],
        kind=row["kind"],
        status=row["status"],
        created_at=row["created_at"],
        finished_at=row["finished_at"],
        as_of=row["as_of"],
        snapshot_id=row["snapshot_id"],
        plan_content_hash=row["plan_content_hash"],
        book_content_hash=row["book_content_hash"],
        scoring_fingerprint=row["scoring_fingerprint"],
        headline=_headline_of(row["kind"], result),
    )


def insert_run(
    *,
    db: Database,
    rating_plan_id: str,
    kind: RunKind,
    status: RunStatus,
    as_of: str | None,
    snapshot_id: str | None,
    plan_content_hash: str | None,
    book_content_hash: str | None,
    scoring_fingerprint: str | None,
    job_id: str | None,
    request: dict[str, Any],
    result: dict[str, Any] | None,
    error_message: str | None = None,
) -> PlanRun:
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    now = _now_iso()
    finished = now if status in ("done", "error") else None
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO plan_runs (
                run_id, rating_plan_id, kind, status, created_at,
                finished_at, as_of, snapshot_id, plan_content_hash,
                book_content_hash, scoring_fingerprint, job_id,
                request_json, result_json, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                rating_plan_id,
                kind,
                status,
                now,
                finished,
                as_of,
                snapshot_id,
                plan_content_hash,
                book_content_hash,
                scoring_fingerprint,
                job_id,
                json.dumps(request),
                json.dumps(result) if result is not None else None,
                error_message,
            ),
        )
        conn.commit()
    run = get_run(db=db, rating_plan_id=rating_plan_id, run_id=run_id)
    assert run is not None  # just inserted
    return run


def finalize_run(
    *,
    db: Database,
    run_id: str,
    status: RunStatus,
    result: dict[str, Any] | None,
    error_message: str | None = None,
) -> None:
    """Flip a `running` run to its terminal state (book runs, lazily
    on GET). Idempotent — a second finalize of a terminal run no-ops
    (WHERE status='running')."""
    with db.connection() as conn:
        conn.execute(
            """
            UPDATE plan_runs
               SET status = ?, result_json = ?, error_message = ?,
                   finished_at = ?
             WHERE run_id = ? AND status = 'running'
            """,
            (
                status,
                json.dumps(result) if result is not None else None,
                error_message,
                _now_iso(),
                run_id,
            ),
        )
        conn.commit()


def get_run(
    *, db: Database, rating_plan_id: str, run_id: str
) -> PlanRun | None:
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM plan_runs WHERE run_id = ? AND rating_plan_id = ?",
            (run_id, rating_plan_id),
        ).fetchone()
    return _row_to_run(row) if row else None


def list_runs(
    *,
    db: Database,
    rating_plan_id: str,
    limit: int = 20,
    kind: str | None = None,
    status: str | None = None,
) -> list[PlanRunSummary]:
    """Newest-first summaries, optionally narrowed by kind/status —
    Brief 75 phase 4: Analytics asks for `kind=book&status=done&limit=1`
    (the one run its exhibits read)."""
    where = ["rating_plan_id = ?"]
    params: list[object] = [rating_plan_id]
    if kind is not None:
        where.append("kind = ?")
        params.append(kind)
    if status is not None:
        where.append("status = ?")
        params.append(status)
    params.append(limit)
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"""
            SELECT * FROM plan_runs
             WHERE {" AND ".join(where)}
             ORDER BY created_at DESC
             LIMIT ?
            """,
            params,
        ).fetchall()
    return [_row_to_summary(r) for r in rows]
