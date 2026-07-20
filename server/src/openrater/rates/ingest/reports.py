# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The persisted build report (migration 047) — Brief 92 scene 5.

Append-only receipts: which workbook (by content hash) built which
plan, what the check said, how the filing's own examples scored, and
what the transcriber flagged. The Overview's "View build report" and
the check endpoint's duplicate awareness both read here.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from openrater.persistence import Database
from openrater.rates.ingest.model import CheckIssue, Manifest


class VectorResult(BaseModel):
    """One test-case vector, scored through the production engine."""

    case_id: str
    name: str | None = None
    field: str
    expected: float | str
    actual: float | str | None = None
    delta: float | None = None
    status: str  # "match" | "near" | "mismatch" | "not_run" | "error"
    detail: str | None = None


class VectorCase(BaseModel):
    """Brief 95 D2 — one test case's INPUTS, persisted with the report so
    surfaces can replay a verified filed example (the Run zone seeds its
    sample risk from cases[0]). Additive: reports built before this field
    parse with `cases=[]` and surfaces fall back to synthesis."""

    case_id: str
    name: str | None = None
    inputs: dict[str, Any] = {}


class VectorsSummary(BaseModel):
    status: str  # "ran" | "unavailable" | "none"
    detail: str | None = None
    total_cases: int = 0
    checks: list[VectorResult] = []
    cases: list[VectorCase] = []
    matched: int = 0
    near: int = 0
    mismatched: int = 0


def verification_verdict(vectors: VectorsSummary) -> str:
    """Brief 94.5 (T6) — the envelope-level verdict, so an API caller
    learns "does the plan reproduce the filing?" without digging into
    `report.vectors` (the CLI already exits 3 on mismatches; HTTP
    callers had nothing)."""
    if vectors.status == "none":
        return "none"
    if vectors.status != "ran":
        return "unavailable"
    if vectors.mismatched > 0:
        return "mismatches"
    if vectors.near > 0:
        return "near"
    return "all_match"


class DriftCase(BaseModel):
    """One check's move between builds — Brief 92.R (D6): measured
    through the production engine on the filing's own example, old
    report vs new, never simulated."""

    case_id: str
    field: str
    was: float | str | None = None
    now: float | str | None = None
    pct: float | None = None


class DriftSummary(BaseModel):
    compared: int = 0
    median_pct: float | None = None
    max_pct: float | None = None
    #: How many cases' EXPECTED values the filing itself revised (from
    #: the diff's test-case section — the strongest rate-change signal).
    expectations_revised: int = 0
    cases: list[DriftCase] = []


class BuildReport(BaseModel):
    report_id: str
    rating_plan_id: str
    workbook_hash: str
    filename: str | None = None
    spec_version: str
    workbook_plan_id: str | None = None
    # Brief 92.R (D2) — the workbook's own `version` at build time
    # ("v1.0.0 → v1.1.0" in revision discovery); None on pre-92R rows.
    workbook_version: str | None = None
    manifest: Manifest
    issues: list[CheckIssue] = []
    vectors: VectorsSummary
    gaps: list[dict[str, Any]] = []
    # Brief 92.R (92R.3) — present on re-ingested rows only: the
    # construct diff as applied (D3/D4) and the measured drift (D6).
    diff: dict[str, Any] | None = None
    drift: DriftSummary | None = None
    created_at: str


class BuildResponse(BaseModel):
    """POST /plans/ingest response — the plan + its build report."""

    rating_plan_id: str
    display_name: str
    # Brief 94.5 (T6) — the verdict at the envelope: "all_match" |
    # "near" | "mismatches" | "none" | "unavailable" (derived via
    # verification_verdict; additive, non-breaking).
    verification: str = "unavailable"
    report: BuildReport


def insert_build_report(
    *,
    db: Database,
    rating_plan_id: str,
    workbook_hash: str,
    filename: str | None,
    spec_version: str,
    workbook_plan_id: str | None,
    manifest: Manifest,
    issues: list[CheckIssue],
    vectors: VectorsSummary,
    gaps: list[dict[str, Any]],
    workbook_blob: bytes | None = None,
    workbook_version: str | None = None,
    diff: dict[str, Any] | None = None,
    drift: DriftSummary | None = None,
) -> BuildReport:
    report = BuildReport(
        report_id=f"br_{uuid.uuid4().hex[:12]}",
        rating_plan_id=rating_plan_id,
        workbook_hash=workbook_hash,
        filename=filename,
        spec_version=spec_version,
        workbook_plan_id=workbook_plan_id,
        workbook_version=workbook_version,
        diff=diff,
        drift=drift,
        manifest=manifest,
        issues=issues,
        vectors=vectors,
        gaps=gaps,
        created_at=datetime.now(UTC).isoformat(),
    )
    conn = db.connection()
    try:
        conn.execute(
            "INSERT INTO plan_build_reports (report_id, rating_plan_id, "
            "workbook_hash, filename, spec_version, workbook_plan_id, "
            "workbook_version, workbook_blob, diff_json, drift_json, "
            "manifest_json, issues_json, vectors_json, gaps_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                report.report_id,
                report.rating_plan_id,
                report.workbook_hash,
                report.filename,
                report.spec_version,
                report.workbook_plan_id,
                workbook_version,
                workbook_blob,
                json.dumps(diff) if diff is not None else None,
                drift.model_dump_json() if drift is not None else None,
                manifest.model_dump_json(),
                json.dumps([i.model_dump() for i in issues]),
                vectors.model_dump_json(),
                json.dumps(gaps),
                report.created_at,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return report


def _row_to_report(row: Any) -> BuildReport:
    return BuildReport(
        report_id=row["report_id"],
        rating_plan_id=row["rating_plan_id"],
        workbook_hash=row["workbook_hash"],
        filename=row["filename"],
        spec_version=row["spec_version"],
        workbook_plan_id=row["workbook_plan_id"],
        workbook_version=row["workbook_version"],
        diff=json.loads(row["diff_json"]) if row["diff_json"] else None,
        drift=(
            DriftSummary.model_validate_json(row["drift_json"])
            if row["drift_json"]
            else None
        ),
        manifest=Manifest.model_validate_json(row["manifest_json"]),
        issues=[CheckIssue.model_validate(i) for i in json.loads(row["issues_json"])],
        vectors=VectorsSummary.model_validate_json(row["vectors_json"]),
        gaps=json.loads(row["gaps_json"]),
        created_at=row["created_at"],
    )


def get_build_report_for_plan(*, db: Database, rating_plan_id: str) -> BuildReport | None:
    conn = db.connection()
    try:
        row = conn.execute(
            # Named columns — the workbook blob (92R.1 D1) never rides
            # a read model.
            "SELECT report_id, rating_plan_id, workbook_hash, filename, spec_version, workbook_plan_id, workbook_version, diff_json, drift_json, manifest_json, issues_json, vectors_json, gaps_json, created_at "
            "FROM plan_build_reports WHERE rating_plan_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            (rating_plan_id,),
        ).fetchone()
    finally:
        conn.close()
    return _row_to_report(row) if row else None


def list_build_reports_for_plan(
    *, db: Database, rating_plan_id: str
) -> list[BuildReport]:
    """The plan's full build history, newest first (Brief 92.R —
    reports are append-only; re-ingest makes the history meaningful).
    Blobs never ride the list."""
    conn = db.connection()
    try:
        rows = conn.execute(
            "SELECT report_id, rating_plan_id, workbook_hash, filename, spec_version, workbook_plan_id, workbook_version, diff_json, drift_json, manifest_json, issues_json, vectors_json, gaps_json, created_at "
            "FROM plan_build_reports WHERE rating_plan_id = ? "
            "ORDER BY created_at DESC",
            (rating_plan_id,),
        ).fetchall()
    finally:
        conn.close()
    return [_row_to_report(r) for r in rows]


def get_latest_build_with_blob(
    *, db: Database, rating_plan_id: str
) -> tuple[BuildReport, bytes | None] | None:
    """The newest report PLUS its stored workbook bytes — the base
    side of a revision diff (Brief 92.R D1). The only read that ever
    touches the blob."""
    conn = db.connection()
    try:
        row = conn.execute(
            "SELECT report_id, rating_plan_id, workbook_hash, filename, "
            "spec_version, workbook_plan_id, workbook_version, "
            "diff_json, drift_json, "
            "manifest_json, issues_json, vectors_json, gaps_json, "
            "created_at, workbook_blob "
            "FROM plan_build_reports WHERE rating_plan_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            (rating_plan_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    blob = row["workbook_blob"]
    return _row_to_report(row), (bytes(blob) if blob is not None else None)


def find_latest_build_by_workbook_plan_id(
    *, db: Database, workbook_plan_id: str
) -> dict[str, Any] | None:
    """Revision discovery (Brief 92.R D2): the newest build whose
    workbook carried this `rating_plan_id` on its plan sheet — joined
    to the plan's display name so the check can say which plan a
    revision updates."""
    conn = db.connection()
    try:
        row = conn.execute(
            "SELECT r.rating_plan_id, r.created_at, r.workbook_version, "
            "       p.display_name "
            "FROM plan_build_reports r "
            "JOIN rating_plans p ON p.rating_plan_id = r.rating_plan_id "
            "WHERE r.workbook_plan_id = ? "
            "ORDER BY r.created_at DESC LIMIT 1",
            (workbook_plan_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return {
        "rating_plan_id": row["rating_plan_id"],
        "display_name": row["display_name"],
        "built_at": row["created_at"],
        "workbook_version": row["workbook_version"],
    }


def find_build_by_hash(*, db: Database, workbook_hash: str) -> dict[str, str] | None:
    """Duplicate awareness for the check endpoint: the newest plan built
    from these exact bytes, if any."""
    conn = db.connection()
    try:
        row = conn.execute(
            "SELECT report_id, rating_plan_id, created_at FROM plan_build_reports "
            "WHERE workbook_hash = ? ORDER BY created_at DESC LIMIT 1",
            (workbook_hash,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return {
        "report_id": row["report_id"],
        "rating_plan_id": row["rating_plan_id"],
        "created_at": row["created_at"],
    }
