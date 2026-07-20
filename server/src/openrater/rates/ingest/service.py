# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The check orchestrator — parse → lint → manifest.

Pure and stateless: bytes in, report out. Nothing is created, no DB
is touched (the build half lands in Phase 92.3 and re-runs this check
before writing — defense in depth behind the UI's disabled button).
"""

from __future__ import annotations

import hashlib
from typing import Any

from pydantic import BaseModel

from openrater.rates.ingest.lint import lint_workbook, load_registry
from openrater.rates.ingest.manifest import build_manifest
from openrater.rates.ingest.model import (
    SPEC_VERSION,
    CheckIssue,
    Manifest,
    ParsedWorkbook,
)
from openrater.rates.ingest.parser import parse_workbook

_SEVERITY_ORDER = {"error": 0, "warning": 1, "notice": 2}


class AlreadyBuilt(BaseModel):
    """Duplicate awareness — a plan already built from these exact
    bytes (Brief 92 CT-5: inform, never block)."""

    rating_plan_id: str
    report_id: str
    created_at: str


class RevisionCandidate(BaseModel):
    """Brief 92.R (D2) — a clean check whose workbook carries the same
    `workbook_plan_id` as an existing plan's latest build (and different
    bytes) names the plan it revises. Offered BESIDE building a
    separate plan, never instead of it."""

    rating_plan_id: str
    display_name: str
    built_at: str
    version_from: str | None = None
    version_to: str | None = None


class CheckResult(BaseModel):
    """The check report — the same shape the endpoint returns and the
    CLI prints."""

    ok: bool
    spec_version: str = SPEC_VERSION
    workbook_hash: str
    filename: str | None = None
    sheet_count: int = 0
    errors: list[CheckIssue] = []
    warnings: list[CheckIssue] = []
    notices: list[CheckIssue] = []
    manifest: Manifest | None = None
    already_built: AlreadyBuilt | None = None
    revises: RevisionCandidate | None = None


def check_workbook(data: bytes, *, filename: str | None = None) -> CheckResult:
    """Validate a transcription workbook against spec v1.0.

    `ok=True` ⇒ zero errors ⇒ `manifest` is populated and a build may
    proceed. Warnings and notices never block; they ride into the
    build report (92.3).
    """
    result, _ = check_workbook_with_model(data, filename=filename)
    return result


def check_workbook_with_model(
    data: bytes, *, filename: str | None = None
) -> tuple[CheckResult, ParsedWorkbook]:
    """The check plus its parsed model — the internal seam
    `build_workbook` uses so a build parses the bytes ONCE
    (Brief 94.5 T7; the model is parse-order deterministic)."""
    workbook_hash = hashlib.sha256(data).hexdigest()
    parsed, issues = parse_workbook(data)

    unreadable = any(i.rule == "R-001" for i in issues)
    if not unreadable:
        issues = issues + lint_workbook(parsed, load_registry())

    issues.sort(
        key=lambda i: (_SEVERITY_ORDER[i.severity], i.sheet or "", i.cell or "", i.rule)
    )
    errors = [i for i in issues if i.severity == "error"]
    warnings = [i for i in issues if i.severity == "warning"]
    notices = [i for i in issues if i.severity == "notice"]

    manifest = build_manifest(parsed) if not errors and not unreadable else None

    result = CheckResult(
        ok=not errors,
        workbook_hash=workbook_hash,
        filename=filename,
        sheet_count=len(parsed.sheet_names),
        errors=errors,
        warnings=warnings,
        notices=notices,
        manifest=manifest,
    )
    return result, parsed


class WorkbookNotCleanError(Exception):
    """A build was requested against a workbook whose check fails —
    the route maps this to a 422 with the error count."""

    def __init__(self, result: CheckResult) -> None:
        self.result = result
        super().__init__(
            f"The workbook didn't pass the check — "
            f"{len(result.errors)} error(s). Nothing was created."
        )


class PlanAlreadyBuiltError(Exception):
    """Brief 95 A2/A3 — these exact bytes already built THIS plan
    (the workbook's pinned id exists and its build history carries the
    same hash). Nothing to do; the route maps this to a 409."""

    def __init__(self, already: AlreadyBuilt) -> None:
        self.already = already
        super().__init__(
            f"This exact workbook already built plan "
            f"'{already.rating_plan_id}' (report {already.report_id}, "
            f"{already.created_at}). Nothing was created."
        )


class PlanIdTakenError(Exception):
    """Brief 95 A2 — the workbook pins `rating_plan_id` to a plan that
    already exists with DIFFERENT content. Never silently suffix into a
    duplicate: the way forward is the re-ingest door (diff + apply to
    the same plan) or a new id. The route maps this to a 409."""

    def __init__(self, rating_plan_id: str, display_name: str) -> None:
        self.rating_plan_id = rating_plan_id
        self.display_name = display_name
        super().__init__(
            f"Plan id '{rating_plan_id}' is taken by \"{display_name}\" "
            "and this workbook's content differs from its last build. "
            "To update that plan, use re-ingest "
            f"(POST /plans/{rating_plan_id}/reingest/check) — or change "
            "the workbook's rating_plan_id to build a separate plan. "
            "Nothing was created."
        )


def build_workbook(
    *,
    db: Any,  # Database — typed loosely to keep this module import-light.
    data: bytes,
    filename: str | None = None,
    operator_id: str | None = None,
) -> "Any":  # BuildResponse — imported lazily below.
    """Check → build (one transaction) → vectors → persisted report.

    The check re-runs here regardless of what the client claims
    (defense in depth behind the UI's disabled button). Vectors run
    AFTER the commit — the scoring path reads the plan like any other
    consumer — and never block; the report records how they went.
    """
    from openrater.rates.ingest.builder import build_plan_from_workbook
    from openrater.rates.ingest.reports import (
        BuildResponse,
        VectorsSummary,
        insert_build_report,
        verification_verdict,
    )
    from openrater.rates.ingest.vectors import run_vectors

    # Brief 94.5 (T7) — one parse per build: the check's own model is
    # the build's input (previously the bytes were parsed twice).
    check, parsed = check_workbook_with_model(data, filename=filename)
    if not check.ok:
        raise WorkbookNotCleanError(check)

    # Brief 95 A2 — the workbook's rating_plan_id IS the plan id. When
    # that id already exists: identical bytes ⇒ already built (nothing
    # to do); different bytes ⇒ refuse toward the re-ingest door — a
    # pinned id must never silently mint a duplicate plan.
    requested_id = (
        str(parsed.plan_value("rating_plan_id"))
        if parsed.plan_value("rating_plan_id") is not None
        else None
    )
    if requested_id:
        conn = db.connection()
        try:
            holder = conn.execute(
                "SELECT display_name FROM rating_plans WHERE rating_plan_id = ?",
                (requested_id,),
            ).fetchone()
            prior = (
                conn.execute(
                    "SELECT report_id, created_at FROM plan_build_reports "
                    "WHERE rating_plan_id = ? AND workbook_hash = ? "
                    "ORDER BY created_at DESC LIMIT 1",
                    (requested_id, check.workbook_hash),
                ).fetchone()
                if holder is not None
                else None
            )
        finally:
            conn.close()
        if holder is not None:
            if prior is not None:
                raise PlanAlreadyBuiltError(
                    AlreadyBuilt(
                        rating_plan_id=requested_id,
                        report_id=prior["report_id"],
                        created_at=prior["created_at"],
                    )
                )
            raise PlanIdTakenError(requested_id, str(holder["display_name"]))

    built = build_plan_from_workbook(db=db, parsed=parsed, operator_id=operator_id)

    try:
        vectors = run_vectors(db=db, rating_plan_id=built.rating_plan_id, parsed=parsed)
    except Exception as exc:  # noqa: BLE001 — vectors never block a build.
        vectors = VectorsSummary(
            status="unavailable",
            detail=f"Vector run failed unexpectedly: {exc}",
            total_cases=(
                len(parsed.test_cases.rows) if parsed.test_cases is not None else 0
            ),
        )

    gaps = (
        [
            {k: v.value for k, v in row.cells.items()}
            for row in parsed.gaps.rows
        ]
        if parsed.gaps is not None
        else []
    )
    # Drift tracking: capture the as-built content hash so
    # "edited since build" is a hash comparison, never a guess.
    if check.manifest is not None:
        check.manifest.plan_content_hash_at_build = _plan_content_hash(
            db, built.rating_plan_id
        )
    report = insert_build_report(
        db=db,
        rating_plan_id=built.rating_plan_id,
        workbook_hash=check.workbook_hash,
        filename=filename,
        spec_version=check.spec_version,
        workbook_plan_id=(
            str(parsed.plan_value("rating_plan_id"))
            if parsed.plan_value("rating_plan_id") is not None
            else None
        ),
        manifest=check.manifest,  # type: ignore[arg-type] — ok ⇒ present.
        issues=check.warnings + check.notices,
        vectors=vectors,
        gaps=gaps,
        # Brief 92.R (D1) — the bytes ARE the base of every future
        # revision diff; the version rides for "v1.0.0 → v1.1.0".
        workbook_blob=data,
        workbook_version=(
            str(parsed.plan_value("version"))
            if parsed.plan_value("version") is not None
            else None
        ),
    )
    return BuildResponse(
        rating_plan_id=built.rating_plan_id,
        display_name=built.display_name,
        verification=verification_verdict(vectors),
        report=report,
    )


# ---------------------------------------------------------------------------
# Brief 92.R phase 92R.2 — the revision check (stateless).
# ---------------------------------------------------------------------------


class ReingestNoBuildHistory(Exception):
    """The target plan was never built from a workbook — there is no
    identity to revise against. Build fresh instead."""


class ReingestIdentityMismatch(Exception):
    """The workbook names a different plan than the one targeted —
    never a silent cross-apply (Brief 92.R §4 edge b)."""

    def __init__(self, workbook_plan_id: str, target_plan_id: str) -> None:
        self.workbook_plan_id = workbook_plan_id
        self.target_plan_id = target_plan_id
        super().__init__(
            f"This workbook names '{workbook_plan_id}', which does not "
            f"belong to plan '{target_plan_id}' — it can't revise it. "
            "Open the right plan, or build separately."
        )


class ReingestBase(BaseModel):
    """The build the diff is computed against."""

    report_id: str
    workbook_version: str | None = None
    built_at: str


class EditChange(BaseModel):
    """One in-app edit the workbook does not know about: the factor
    table cell whose live value differs from the as-built workbook."""

    table: str
    field: str
    workbook: Any
    yours: Any


class EditsSinceBuild(BaseModel):
    """Drift tracking: what the
    live plan carries that its workbook doesn't. `edited` is the
    PERFECT-fidelity signal (content hash when the report stored one,
    else the last_edited_at timestamp); `changes` is the best-effort
    itemization (factor cells today); `note` names the gap when the
    signal trips but the itemizer sees nothing."""

    edited: bool = False
    changes: list[EditChange] = []
    note: str | None = None


def _plan_content_hash(db: Any, rating_plan_id: str) -> str | None:
    conn = db.connection()
    try:
        row = conn.execute(
            "SELECT content_hash FROM rating_plans WHERE rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchone()
    finally:
        conn.close()
    return None if row is None else row["content_hash"]


def _itemize_cell_edits(
    db: Any, rating_plan_id: str, base_blob: bytes
) -> list[EditChange]:
    """Live factor cells vs the as-built workbook's — the surface the
    editor writes, so the surface edits live on."""
    base_parsed, _ = parse_workbook(base_blob)
    # Keys follow the BUILDER's persisted convention (grid rows key as
    # "row::col") — the diff renderer's pretty "row · col" would make
    # every 2-D cell a phantom edit.
    built: dict[str, dict[str, Any]] = {}
    for ft in base_parsed.factor_tables:
        cells_map: dict[str, Any] = {}
        if ft.grid:
            for gc in ft.grid:
                cells_map[f"{gc.row_key}::{gc.col_key}"] = gc.factor
        else:
            for r in ft.rows_1d:
                cells_map[str(r.get("level_id"))] = r.get("factor")
        # The builder hoists __default__ into unknown_key_policy — it
        # is never a persisted cell, so it is never an edit.
        cells_map.pop("__default__", None)
        built[ft.slug] = cells_map
    conn = db.connection()
    try:
        rows = conn.execute(
            "SELECT t.slug AS slug, c.cell_key AS cell_key, c.value AS value "
            "FROM plan_factor_table_cells c "
            "JOIN plan_factor_tables t "
            "  ON t.rating_plan_id = c.rating_plan_id AND t.table_id = c.table_id "
            "WHERE c.rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchall()
    finally:
        conn.close()
    live: dict[str, dict[str, Any]] = {}
    for r in rows:
        live.setdefault(str(r["slug"]), {})[str(r["cell_key"])] = r["value"]
    out: list[EditChange] = []
    for slug in sorted(set(built) | set(live)):
        b = built.get(slug, {})
        l = live.get(slug, {})
        for key in sorted(set(b) | set(l)):
            wv, lv = b.get(key), l.get(key)
            try:
                same = wv is not None and lv is not None and float(wv) == float(lv)
            except (TypeError, ValueError):
                same = wv == lv
            if not same:
                out.append(
                    EditChange(table=slug, field=key, workbook=wv, yours=lv)
                )
    return out


def edits_since_build(db: Any, rating_plan_id: str) -> EditsSinceBuild:
    """The plan's in-app edits relative to its latest build — the fact
    the re-ingest preview, the apply gate, and the drift chip share."""
    from openrater.rates.ingest.reports import get_latest_build_with_blob

    latest = get_latest_build_with_blob(db=db, rating_plan_id=rating_plan_id)
    if latest is None:
        return EditsSinceBuild()
    base_report, base_blob = latest
    # Belt and braces — the plan content hash covers metadata + stages
    # (so gate/chain edits trip it), the cell itemizer covers factor
    # cells directly (the hash never included them), and the edit
    # timestamp covers reports written before the hash was stored.
    changes = (
        _itemize_cell_edits(db, rating_plan_id, base_blob)
        if base_blob is not None
        else []
    )
    live_hash = _plan_content_hash(db, rating_plan_id)
    at_build = (
        base_report.manifest.plan_content_hash_at_build
        if base_report.manifest is not None
        else None
    )
    conn = db.connection()
    try:
        row = conn.execute(
            "SELECT last_edited_at FROM rating_plans WHERE rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchone()
    finally:
        conn.close()
    touched_since = bool(
        row is not None
        and row["last_edited_at"] is not None
        and str(row["last_edited_at"]) > base_report.created_at
    )
    hash_moved = (
        at_build is not None and live_hash is not None and live_hash != at_build
    )
    # The timestamp speaks when the modern signals can't: no stored
    # blob (the itemizer couldn't look at cells) or no stored hash.
    # With both present, a touch that changed no content (an edit
    # later restored by hand) is not an edit.
    legacy_touch = (at_build is None or base_blob is None) and touched_since
    edited = bool(changes) or hash_moved or legacy_touch
    note = None
    if edited and not changes:
        note = (
            "The plan changed since its build, but not in factor cells "
            "— the change is outside what this differ itemizes "
            "(dimensions, chains, gates, or inputs). Applying a "
            "workbook replaces those edits too."
        )
    return EditsSinceBuild(edited=edited, changes=changes, note=note)


class ReingestWouldReplaceEdits(Exception):
    """Apply refused: the plan carries in-app edits the workbook would
    silently replace, and the caller didn't consent ()."""

    def __init__(self, edits: EditsSinceBuild) -> None:
        self.edits = edits
        head = ", ".join(
            f"{c.table}[{c.field}] your {c.yours} -> workbook {c.workbook}"
            for c in edits.changes[:3]
        )
        more = max(0, len(edits.changes) - 3)
        detail = (
            head + (f" (+{more} more)" if more else "")
            if head
            else (edits.note or "edits present")
        )
        super().__init__(
            "This plan has been edited since its build; applying the "
            f"workbook would replace those edits: {detail}. Re-run with "
            "replace_edits=true after reviewing them — a pre-apply "
            "version is saved automatically."
        )


class ReingestCheckResult(BaseModel):
    """POST /plans/{id}/reingest/check — the review's data.

    `check` is the full R-### report of the NEW workbook (dirty ⇒
    `diff` is None and the review shows the cell-addressed errors);
    `diff` is base-vs-new when the base bytes exist; `base_missing_reason`
    is the pre-92R.1 caveat (D1's honest fallback)."""

    check: CheckResult
    diff: Any | None = None  # WorkbookDiff — typed loosely to keep imports light
    base: ReingestBase | None = None
    base_missing_reason: str | None = None
    hand_edited_since_build: bool = False
    plan_content_hash: str | None = None
    # : the itemized in-app edits an apply would replace.
    edits_since_build: EditsSinceBuild | None = None


def reingest_check(
    *, db: Any, rating_plan_id: str, data: bytes, filename: str | None = None
) -> ReingestCheckResult:
    """The stateless half of re-ingest: check the revision, verify the
    workbook's identity against the target plan, and diff it against
    the workbook the plan was last built from. Writes nothing."""
    from openrater.rates.ingest.diff import diff_workbooks
    from openrater.rates.ingest.reports import get_latest_build_with_blob

    # The plan first (a missing plan is a 404, not a revise-refusal),
    # carrying the hand-edit signal + the If-Match hash for 92R.3.
    conn = db.connection()
    try:
        row = conn.execute(
            "SELECT last_edited_at, content_hash FROM rating_plans "
            "WHERE rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise LookupError(rating_plan_id)

    latest = get_latest_build_with_blob(db=db, rating_plan_id=rating_plan_id)
    if latest is None:
        raise ReingestNoBuildHistory(
            f"Plan '{rating_plan_id}' has no build history — it wasn't "
            "built from a workbook, so there is nothing to revise "
            "against. Build from the workbook instead."
        )
    base_report, base_blob = latest

    check, parsed = check_workbook_with_model(data, filename=filename)
    if not check.ok:
        return ReingestCheckResult(check=check)

    wb_plan_id = (
        check.manifest.provenance.rating_plan_id if check.manifest else None
    )
    if (
        wb_plan_id
        and base_report.workbook_plan_id
        and wb_plan_id != base_report.workbook_plan_id
    ):
        raise ReingestIdentityMismatch(wb_plan_id, rating_plan_id)

    edits = edits_since_build(db, rating_plan_id)
    hand_edited = edits.edited

    if base_blob is None:
        return ReingestCheckResult(
            check=check,
            base=None,
            base_missing_reason=(
                "This plan was built before revisions stored the workbook "
                "bytes — the diff starts from the next build. Applying "
                "still works; review the revision in Excel this once."
            ),
            hand_edited_since_build=hand_edited,
            plan_content_hash=row["content_hash"] if row is not None else None,
            edits_since_build=edits,
        )

    base_parsed, _ = parse_workbook(base_blob)
    return ReingestCheckResult(
        check=check,
        diff=diff_workbooks(base_parsed, parsed),
        base=ReingestBase(
            report_id=base_report.report_id,
            workbook_version=base_report.workbook_version,
            built_at=base_report.created_at,
        ),
        hand_edited_since_build=hand_edited,
        plan_content_hash=row["content_hash"] if row is not None else None,
        edits_since_build=edits,
    )


def _compute_drift(
    prior: Any, new: Any, expectations_revised: int
) -> Any:  # VectorsSummary ×2 → DriftSummary
    """Brief 92.R (D6) — the measured move on the filing's own examples:
    the prior report's engine results vs this build's, case by case.
    Both sides already exist; nothing is simulated."""
    import statistics

    from openrater.rates.ingest.reports import DriftCase, DriftSummary

    old_by_key = {(c.case_id, c.field): c for c in prior.checks}
    cases: list[Any] = []
    pcts: list[float] = []
    for check in new.checks:
        old = old_by_key.get((check.case_id, check.field))
        if old is None:
            continue
        was, now = old.actual, check.actual
        pct: float | None = None
        if (
            isinstance(was, (int, float))
            and isinstance(now, (int, float))
            and float(was) != 0.0
        ):
            pct = round((float(now) - float(was)) / float(was) * 100.0, 1)
            if pct != 0.0:
                pcts.append(pct)
        if _norm_drift(was) != _norm_drift(now):
            cases.append(
                DriftCase(case_id=check.case_id, field=check.field, was=was, now=now, pct=pct)
            )
    return DriftSummary(
        compared=len([1 for c in new.checks if (c.case_id, c.field) in old_by_key]),
        median_pct=round(statistics.median(pcts), 1) if pcts else None,
        max_pct=max(pcts, key=abs) if pcts else None,
        expectations_revised=expectations_revised,
        cases=cases,
    )


def _norm_drift(v: Any) -> Any:
    return float(v) if isinstance(v, (int, float)) else v


def reingest_apply(
    *,
    db: Any,
    rating_plan_id: str,
    data: bytes,
    filename: str | None = None,
    if_match: str | None = None,
    operator_id: str | None = None,
    replace_edits: bool = False,
) -> Any:  # BuildResponse
    """Brief 92.R (D4 · D6 · D7) — apply the revision to the SAME plan:
    re-check + re-diff (defense in depth behind the review), If-Match
    against the plan's content hash (G14 — the review→apply gap),
    one-transaction replay through the domain layer, vectors re-run
    through the production scoring path, drift measured against the
    prior report, and a NEW report row appended (history, never
    overwrite)."""
    from openrater.errors import StaleWriteError
    from openrater.rates.ingest.builder import apply_workbook_to_plan
    from openrater.rates.ingest.diff import diff_workbooks
    from openrater.rates.ingest.reports import (
        BuildResponse,
        VectorsSummary,
        get_latest_build_with_blob,
        insert_build_report,
        verification_verdict,
    )
    from openrater.rates.ingest.vectors import run_vectors

    conn = db.connection()
    try:
        row = conn.execute(
            "SELECT content_hash FROM rating_plans WHERE rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise LookupError(rating_plan_id)
    if if_match is not None and row["content_hash"] != if_match:
        raise StaleWriteError(
            "This plan changed since you reviewed the revision (another "
            "tab or caller wrote in between). Nothing was applied — "
            "re-review from the latest state.",
            details={
                "current_hash": row["content_hash"],
                "supplied_hash": if_match,
            },
        )

    latest = get_latest_build_with_blob(db=db, rating_plan_id=rating_plan_id)
    if latest is None:
        raise ReingestNoBuildHistory(
            f"Plan '{rating_plan_id}' has no build history — it wasn't "
            "built from a workbook, so there is nothing to revise "
            "against. Build from the workbook instead."
        )
    base_report, base_blob = latest

    check, parsed = check_workbook_with_model(data, filename=filename)
    if not check.ok:
        raise WorkbookNotCleanError(check)

    wb_plan_id = check.manifest.provenance.rating_plan_id if check.manifest else None
    if (
        wb_plan_id
        and base_report.workbook_plan_id
        and wb_plan_id != base_report.workbook_plan_id
    ):
        raise ReingestIdentityMismatch(wb_plan_id, rating_plan_id)

    # Drift tracking: applying replaces the WHOLE substrate —
    # if the plan carries in-app edits, refuse without explicit consent,
    # and cut an automatic pre-apply version when consent is given.
    edits = edits_since_build(db, rating_plan_id)
    if edits.edited:
        if not replace_edits:
            raise ReingestWouldReplaceEdits(edits)
        from openrater.rates.snapshots.service import freeze_current_draft

        try:
            freeze_current_draft(
                db=db,
                plan_id=rating_plan_id,
                display_name=(
                    "Before re-ingest "
                    + __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M")
                ),
                notes=(
                    "Automatic pre-apply version: the plan carried edits "
                    "the incoming workbook replaced."
                ),
                created_by=operator_id or "system",
            )
        except Exception:  # noqa: BLE001 — a name collision must not block
            pass  # the apply the user just consented to.

    diff = None
    if base_blob is not None:
        base_parsed, _ = parse_workbook(base_blob)
        diff = diff_workbooks(base_parsed, parsed)

    applied = apply_workbook_to_plan(
        db=db, parsed=parsed, rating_plan_id=rating_plan_id, operator_id=operator_id
    )

    try:
        vectors = run_vectors(db=db, rating_plan_id=rating_plan_id, parsed=parsed)
    except Exception as exc:  # noqa: BLE001 — vectors never block an apply.
        vectors = VectorsSummary(
            status="unavailable",
            detail=f"Vector run failed unexpectedly: {exc}",
            total_cases=(
                len(parsed.test_cases.rows) if parsed.test_cases is not None else 0
            ),
        )

    expectations_revised = 0
    if diff is not None:
        tc_section = next(
            (s for s in diff.sections if s.section == "test_cases"), None
        )
        if tc_section is not None:
            expectations_revised = tc_section.changed
    drift = _compute_drift(base_report.vectors, vectors, expectations_revised)

    gaps = (
        [{k: v.value for k, v in row_.cells.items()} for row_ in parsed.gaps.rows]
        if parsed.gaps is not None
        else []
    )
    # Drift tracking: the as-applied hash makes the next
    # "edited since build" a hash comparison, never a guess.
    if check.manifest is not None:
        check.manifest.plan_content_hash_at_build = _plan_content_hash(
            db, rating_plan_id
        )
    report = insert_build_report(
        db=db,
        rating_plan_id=rating_plan_id,
        workbook_hash=check.workbook_hash,
        filename=filename,
        spec_version=check.spec_version,
        workbook_plan_id=wb_plan_id,
        manifest=check.manifest,  # type: ignore[arg-type] — ok ⇒ present.
        issues=check.warnings + check.notices,
        vectors=vectors,
        gaps=gaps,
        workbook_blob=data,
        workbook_version=(
            str(parsed.plan_value("version"))
            if parsed.plan_value("version") is not None
            else None
        ),
        diff=diff.model_dump(by_alias=True) if diff is not None else None,
        drift=drift,
    )
    return BuildResponse(
        rating_plan_id=rating_plan_id,
        display_name=applied.display_name,
        verification=verification_verdict(vectors),
        report=report,
    )
