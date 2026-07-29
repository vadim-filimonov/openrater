# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Workbook ingestion endpoints — Brief 92 (ADR-0065).

  POST /api/v1/plans/ingest/check              — validate; writes nothing
  POST /api/v1/plans/ingest                    — build the plan (one transaction)
  GET  /api/v1/plans/{rating_plan_id}/build-report  — the newest persisted report
  GET  /api/v1/plans/{rating_plan_id}/build-reports — the full history (Brief 92.R)
  GET  /api/v1/plans/ingest/assets/{kind}      — the starter kit (Brief 94 §2)

The workbook travels as the RAW request body (any content type; the
bytes are the contract), with the original filename in an optional
`?filename=` query param. No multipart layer — trivial from a browser
(`fetch(url, {method: "POST", body: file})`), from curl
(`--data-binary @book.xlsx`), and from the CLI twin
(`python -m openrater.rates.ingest check|build`).
"""

from __future__ import annotations

import csv
import io
import json
import re
from importlib import resources
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response

from openrater.auth import current_operator
from openrater.errors import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from openrater.persistence import Database
from openrater.rates.ingest import CheckResult, check_workbook
from openrater.rates.ingest.builder import BuildError
from openrater.rates.ingest.lint import load_registry
from openrater.rates.ingest.reports import (
    BuildReport,
    BuildResponse,
    find_build_by_hash,
    find_latest_build_by_workbook_plan_id,
    get_build_report_for_plan,
    get_latest_build_with_blob,
    list_build_reports_for_plan,
)
from openrater.rates.ingest.service import (
    AlreadyBuilt,
    PlanAlreadyBuiltError,
    PlanIdTakenError,
    RevisionCandidate,
    WorkbookNotCleanError,
    build_workbook,
)

router = APIRouter()


def _resolve_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise RuntimeError("No database on app.state")
    return db

#: Workbooks bigger than this are almost certainly not transcription
#: workbooks (the 747-ZIP Kansas program is ~0.5 MB).
MAX_WORKBOOK_BYTES = 30 * 1024 * 1024


@router.post("/plans/ingest/check", response_model=CheckResult)
async def check_workbook_endpoint(
    request: Request,
    filename: Annotated[
        str | None,
        Query(description="Original filename, echoed into the report."),
    ] = None,
) -> CheckResult:
    """Validate a transcription workbook against spec v1.0.

    Stateless and side-effect-free: parses, runs the R-### rules +
    the capability registry, and returns errors/warnings cited by
    sheet!cell — plus the dry-run manifest when (and only when) the
    check is clean. A failed check is still HTTP 200: the report IS
    the resource; nothing about the request was malformed."""
    data = _require_workbook_body(await request.body())
    result = check_workbook(data, filename=filename)
    if result.ok:
        prior = find_build_by_hash(
            db=_resolve_db(request), workbook_hash=result.workbook_hash
        )
        if prior is not None:
            # FCA #16 — when the plan these bytes built has since been
            # edited in-app, the workbook PRE-DATES the live plan:
            # building a what-if from it resurrects whatever the edits
            # repaired. Stamp the staleness on the answer.
            from openrater.rates.ingest.service import edits_since_build

            source_edits = edits_since_build(
                _resolve_db(request), str(prior["rating_plan_id"])
            )
            n_edits = len(source_edits.changes) + len(source_edits.stage_edits)
            result.already_built = AlreadyBuilt(
                rating_plan_id=prior["rating_plan_id"],
                report_id=prior["report_id"],
                created_at=prior["created_at"],
                edited_since_build=source_edits.edited,
                edits_note=(
                    (
                        f"Plan {prior['rating_plan_id']!r} has been edited "
                        f"in-app since this workbook built it"
                        + (
                            f" ({n_edits} tracked edit"
                            f"{'s' if n_edits != 1 else ''})"
                            if n_edits > 0
                            else ""
                        )
                        + " — those edits are NOT in these bytes. A plan "
                        "built from this workbook will not include them."
                    )
                    if source_edits.edited
                    else None
                ),
            )
        else:
            # Brief 92.R (D2) — different bytes, same workbook identity:
            # this is a revision candidate. Byte-identical stays
            # `already_built` (above); an unseen id stays a plain build.
            wb_plan_id = (
                result.manifest.provenance.rating_plan_id
                if result.manifest is not None
                else None
            )
            if wb_plan_id:
                base = find_latest_build_by_workbook_plan_id(
                    db=_resolve_db(request), workbook_plan_id=wb_plan_id
                )
                if base is not None:
                    result.revises = RevisionCandidate(
                        rating_plan_id=base["rating_plan_id"],
                        display_name=base["display_name"],
                        built_at=base["built_at"],
                        version_from=base["workbook_version"],
                        version_to=result.manifest.provenance.version
                        if result.manifest is not None
                        else None,
                    )
    return result


def _require_workbook_body(data: bytes) -> bytes:
    if not data:
        raise BadRequestError(
            "Send the workbook as the raw request body "
            "(e.g. curl --data-binary @workbook.xlsx).",
            code="ingest_empty_body",
        )
    if len(data) > MAX_WORKBOOK_BYTES:
        raise BadRequestError(
            f"Workbook is {len(data)} bytes; the limit is "
            f"{MAX_WORKBOOK_BYTES} (30 MB). Transcription workbooks are "
            "small — this file is probably not one.",
            code="ingest_too_large",
        )
    return data


@router.post("/plans/ingest", response_model=BuildResponse)
async def build_workbook_endpoint(
    request: Request,
    filename: Annotated[
        str | None,
        Query(description="Original filename, echoed into the build report."),
    ] = None,
) -> BuildResponse:
    """Build a plan from a clean workbook — Brief 92 scene 4→5.

    Re-checks regardless of what the client saw (a dirty workbook is a
    422 `ingest_check_failed`, nothing created); a construct the check
    passed but the builder refuses is a 422 `ingest_unbuildable` with
    the builder's message (the check=build backstop — also nothing
    created); writes the whole plan in ONE transaction through the
    typed domain layer; runs the workbook's test cases through the
    production scoring path (mismatches report loudly, never block);
    persists the build report."""
    data = _require_workbook_body(await request.body())
    db = _resolve_db(request)
    try:
        return build_workbook(
            db=db, data=data, filename=filename, operator_id=current_operator()
        )
    except WorkbookNotCleanError as exc:
        raise ValidationError(
            str(exc),
            code="ingest_check_failed",
            hint="Run POST /plans/ingest/check for the full cell-addressed report.",
        ) from exc
    except PlanAlreadyBuiltError as exc:
        # Brief 95 A2/A3 — same bytes, same pinned id: the plan exists.
        raise ConflictError(
            str(exc),
            code="ingest_already_built",
            hint=(
                "The plan is already on this box "
                f"(GET /plans/{exc.already.rating_plan_id}). Revise the "
                "workbook and use re-ingest to update it."
            ),
        ) from exc
    except PlanIdTakenError as exc:
        # Brief 95 A2 — pinned id held by different content: point at
        # the re-ingest door, never mint a silent duplicate.
        raise ConflictError(
            str(exc),
            code="ingest_plan_id_taken",
            hint=(
                f"POST /plans/{exc.rating_plan_id}/reingest/check diffs "
                "this workbook against that plan's last build."
            ),
        ) from exc
    except BuildError as exc:
        # A construct the check accepted but the builder can't express —
        # a check/build contract gap. Surface the builder's message (it
        # names the construct and the way out) instead of a generic 500.
        raise ValidationError(
            str(exc),
            code="ingest_unbuildable",
            hint=(
                "The check passed but the build refused — nothing was "
                "created. The message names the construct; this pairing "
                "is a spec-conformance gap worth reporting."
            ),
        ) from exc


#: The starter kit (Brief 94 §2) — packaged bytes, no DB, no auth change.
#: Each file is pinned byte-identical to its docs/ source by CI (the same
#: no-drift guard the packaged capability registry uses).
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
STARTER_KIT_ASSETS: dict[str, tuple[str, str]] = {
    "spec": ("filing-transcription-spec.md", "text/markdown; charset=utf-8"),
    "template": ("openrater_workbook_template.xlsx", _XLSX_MIME),
    "example": ("nonprofit_do_gl.workbook.xlsx", _XLSX_MIME),
}


@router.get("/plans/ingest/capability-registry")
async def get_capability_registry_endpoint() -> dict:
    """The packaged capability registry (Brief 2 §4 — the agent's copy
    of what the platform cannot express, R-190/R-191). Same bytes the
    check enforces with; CI pins it to docs/specs/."""
    return load_registry()


@router.get("/plans/ingest/assets/{kind}")
async def get_ingest_asset(kind: str) -> Response:
    """One starter-kit artifact: the format spec (hand it to your AI with
    the filing), the template workbook (the spec §9 mini example — checks
    clean and builds), or the worked example (the nonprofit bundle)."""
    entry = STARTER_KIT_ASSETS.get(kind)
    if entry is None:
        raise NotFoundError(
            f"Unknown starter-kit asset {kind!r} — one of: "
            + ", ".join(sorted(STARTER_KIT_ASSETS)),
            code="ingest_asset_not_found",
            param="kind",
        )
    filename, media_type = entry
    data = (
        resources.files("openrater.rates.ingest")
        .joinpath("assets")
        .joinpath(filename)
        .read_bytes()
    )
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/plans/{rating_plan_id}/book-template.csv")
async def get_book_template_csv(
    request: Request,
    rating_plan_id: str,
) -> Response:
    """Brief 95 D1 — the plan's book, as a fill-in CSV.

    Headers = the plan's declared inputs in stage order — EXCLUDING
    derived inputs (the platform computes those; a book must not carry
    them). One example row rides below the header when the plan has a
    build report with persisted vector cases (a verified filed example
    beats schema archaeology). Works for any plan with declared inputs,
    ingested or hand-authored."""
    db = _resolve_db(request)
    conn = db.connection()
    try:
        rows = conn.execute(
            "SELECT stage_id, config_json FROM rating_plan_stages "
            "WHERE rating_plan_id = ? AND stage_kind = 'input_node' "
            "ORDER BY sequence",
            (rating_plan_id,),
        ).fetchall()
        plan_exists = (
            conn.execute(
                "SELECT 1 FROM rating_plans WHERE rating_plan_id = ?",
                (rating_plan_id,),
            ).fetchone()
            is not None
        )
    finally:
        conn.close()
    if not plan_exists:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )

    fields: list[str] = []
    for row in rows:
        try:
            cfg = json.loads(row["config_json"] or "{}")
        except ValueError:
            continue
        name = str(cfg.get("name") or "").strip()
        if not name or cfg.get("source") == "derived":
            continue  # derived inputs are computed — never book columns
        fields.append(name)
    if not fields:
        raise ValidationError(
            f"Plan {rating_plan_id!r} declares no inputs — there is no book "
            "template to produce. Bring the plan's variables first.",
            code="book_template_no_inputs",
        )

    # FCA fca-2026-07-25 #12 — the schedule-rating door on the BOOK
    # path: the engine consumes `schedule_app_{id}` per row, so the
    # fill-in template shows the column (leave a cell blank for no
    # modification; the input-schema documents the JSON cell shape).
    conn = db.connection()
    try:
        sched_rows = conn.execute(
            "SELECT config_json FROM rating_plan_stages "
            "WHERE rating_plan_id = ? AND stage_kind = 'modifier.schedule' "
            "ORDER BY sequence",
            (rating_plan_id,),
        ).fetchall()
    finally:
        conn.close()
    for srow in sched_rows:
        try:
            scfg = json.loads(srow["config_json"] or "{}")
        except ValueError:
            continue
        sched = scfg.get("schedule") if isinstance(scfg, dict) else None
        source = sched if isinstance(sched, dict) else scfg
        sid = source.get("schedule_id") if isinstance(source, dict) else None
        if isinstance(sid, str) and sid:
            hook = "schedule_app_" + re.sub(
                r"[^a-z0-9]+", "_", sid.lower()
            ).strip("_")
            if hook not in fields:
                fields.append(hook)

    example: dict[str, Any] = {}
    report = get_build_report_for_plan(db=db, rating_plan_id=rating_plan_id)
    if report is not None and report.vectors.cases:
        example = report.vectors.cases[0].inputs

    def _cell(v: Any) -> str:
        if isinstance(v, bool):
            return "true" if v else "false"
        return "" if v is None else str(v)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(fields)
    if example:
        writer.writerow([_cell(example.get(f)) for f in fields])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{rating_plan_id}-book-template.csv"'
            )
        },
    )


@router.get(
    "/plans/{rating_plan_id}/build-reports", response_model=list[BuildReport]
)
async def list_build_reports_endpoint(
    request: Request,
    rating_plan_id: str,
) -> list[BuildReport]:
    """The plan's full build history, newest first (Brief 92.R —
    re-ingest appends; nothing is overwritten). Empty list when the
    plan wasn't built from a workbook."""
    return list_build_reports_for_plan(
        db=_resolve_db(request), rating_plan_id=rating_plan_id
    )


def _header_line(parts: list[str], cap: int = 900) -> str:
    """A best-effort list header: latin-1-safe, newline-free, capped.
    The counts are the reliable signal; the names are a courtesy."""
    joined = " | ".join(p.replace("\n", " ").replace("\r", " ") for p in parts)
    safe = joined.encode("latin-1", "replace").decode("latin-1")
    return safe[: cap - 1] + "…" if len(safe) > cap else safe


@router.get("/plans/{rating_plan_id}/workbook")
async def get_plan_workbook_endpoint(
    request: Request,
    rating_plan_id: str,
    current: Annotated[
        bool,
        Query(
            description=(
                "false (default): the EXACT build-time bytes, "
                "hash-identical (owner O1). true: the same container "
                "REWRITTEN to the live plan state — tracked factor-table "
                "cells and gates!value cells carry the in-app edits, "
                "untouched sheet entries stay byte-identical, and the "
                "filename gains a '-current' suffix. A current export is "
                "NOT the build identity: re-ingesting it registers as a "
                "revision, not already_built."
            ),
        ),
    ] = False,
) -> Response:
    """The EXACT workbook bytes that built this plan (mvp-tightness
    §5.6 / MVP-023, owner O1): the canonical container comes back out.
    Serves the newest build's stored blob with `X-Workbook-Hash` (the
    sha256 the report records) — re-ingesting the download is
    hash-identical, so the round trip answers `ingest_already_built`.
    404s, BY NAME, when the plan wasn't built from a workbook or the
    build predates blob storage.

    `?current=true` (FCA #16 follow-up) serves the CURRENT-state
    variant instead: the stored container with the live plan state
    written into the two tracked edit classes (factor-table cells,
    gates!value cells), so in-app repairs physically travel. Divergence
    the rewriter cannot place is named in `X-Current-Unapplied`, never
    silently dropped. `X-Workbook-Hash` rides only when the served
    bytes ARE the build bytes; `X-Workbook-Sha256` always hashes what
    was actually served."""
    from openrater.rates.ingest.service import edits_since_build

    latest = get_latest_build_with_blob(
        db=_resolve_db(request), rating_plan_id=rating_plan_id
    )
    if latest is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} has no build report — it wasn't "
            "built from a workbook, so there is no workbook to export.",
            code="workbook_not_stored",
            param="rating_plan_id",
        )
    report, blob = latest
    if blob is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} was built before workbook storage "
            "existed — keep your original transcription file; re-ingest "
            "it once to store it here.",
            code="workbook_not_stored",
            param="rating_plan_id",
        )
    filename = report.filename or f"{rating_plan_id}.workbook.xlsx"
    # FCA fca-2026-07-25 #16 — the divergence stamp. These are the
    # BUILD-TIME bytes (owner O1: the canonical container comes back
    # out, hash-identical). When the plan has been edited in-app since,
    # the export must SAY so — a what-if built from a stale export
    # silently resurrected a repaired defect.
    edits = edits_since_build(db=_resolve_db(request), rating_plan_id=rating_plan_id)
    edit_count = len(edits.changes) + len(edits.stage_edits)
    media_type = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    common = {
        "X-Edited-Since-Build": "true" if edits.edited else "false",
        "X-Edits-Since-Build-Count": str(edit_count),
    }
    if not current:
        return Response(
            content=blob,
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Workbook-Hash": report.workbook_hash or "",
                "X-Workbook-State": "build",
                **common,
            },
        )
    # FCA #16 follow-up — repairs physically travel. The rewrite is
    # surgical (only touched sheet entries differ from the build
    # export), and what cannot travel is NAMED, not dropped.
    from openrater.rates.ingest.current import (
        current_filename,
        rewrite_workbook_to_current,
    )

    cw = rewrite_workbook_to_current(
        db=_resolve_db(request), rating_plan_id=rating_plan_id, blob=blob
    )
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{current_filename(filename)}"'
        ),
        "X-Workbook-State": "current",
        "X-Workbook-Sha256": cw.sha256,
        "X-Current-Rewrite-Count": str(len(cw.rewrites)),
        "X-Current-Unapplied-Count": str(len(cw.unapplied)),
        **common,
    }
    if cw.data == blob:
        # Zero rewrites: the build bytes ARE current, and the identity
        # claim is still true — an honest hash beats a withheld one.
        headers["X-Workbook-Hash"] = report.workbook_hash or ""
    if cw.unapplied:
        headers["X-Current-Unapplied"] = _header_line(cw.unapplied)
    return Response(content=cw.data, media_type=media_type, headers=headers)


@router.get("/plans/{rating_plan_id}/build-report", response_model=BuildReport)
async def get_build_report_endpoint(
    request: Request,
    rating_plan_id: str,
) -> BuildReport:
    """The newest persisted build report for a plan (404 when the plan
    wasn't built from a workbook)."""
    report = get_build_report_for_plan(
        db=_resolve_db(request), rating_plan_id=rating_plan_id
    )
    if report is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} has no build report — it wasn't built "
            "from a workbook.",
            code="build_report_not_found",
            param="rating_plan_id",
        )
    return report


@router.get("/plans/{rating_plan_id}/edits-since-build")
async def edits_since_build_endpoint(request: Request, rating_plan_id: str):
    """Drift honesty (brief drift-honesty.md, MVP-008): the in-app
    edits the live plan carries relative to its latest build — the
    fact the drift chip, the re-ingest preview, and the apply gate
    share. `edited` is hash-exact on reports that stored the as-built
    hash; `changes` itemizes factor-cell edits; `note` names anything
    the itemizer can't see."""
    from openrater.rates.ingest.service import edits_since_build

    conn = _resolve_db(request).connection()
    try:
        row = conn.execute(
            "SELECT 1 FROM rating_plans WHERE rating_plan_id = ?",
            (rating_plan_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )
    return edits_since_build(_resolve_db(request), rating_plan_id)


@router.post("/plans/{rating_plan_id}/reingest/check")
async def reingest_check_endpoint(
    request: Request,
    rating_plan_id: str,
    filename: Annotated[
        str | None,
        Query(description="Original filename, echoed into the report."),
    ] = None,
):
    """Brief 92.R (92R.2) — the stateless half of re-ingest: check the
    revised workbook, verify its identity against this plan, and diff
    it against the workbook the plan was last built from. Writes
    nothing; the review surface renders the result. A dirty workbook is
    still HTTP 200 with the cell-addressed report (`diff` is null)."""
    from openrater.rates.ingest.service import (
        ReingestIdentityMismatch,
        ReingestNoBuildHistory,
        reingest_check,
    )

    data = _require_workbook_body(await request.body())
    try:
        return reingest_check(
            db=_resolve_db(request),
            rating_plan_id=rating_plan_id,
            data=data,
            filename=filename,
        )
    except LookupError as exc:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        ) from exc
    except ReingestNoBuildHistory as exc:
        raise ValidationError(
            str(exc), code="reingest_no_build_history"
        ) from exc
    except ReingestIdentityMismatch as exc:
        raise ValidationError(
            str(exc),
            code="reingest_identity_mismatch",
            hint=(
                "The workbook's plan sheet carries its identity "
                "(rating_plan_id); re-ingest only updates the plan that "
                "identity built."
            ),
        ) from exc


@router.post("/plans/{rating_plan_id}/reingest")
async def reingest_apply_endpoint(
    request: Request,
    rating_plan_id: str,
    filename: Annotated[
        str | None,
        Query(description="Original filename, echoed into the report."),
    ] = None,
    replace_edits: Annotated[
        bool,
        Query(
            description=(
                "Consent to replace in-app edits made since the last "
                "build. Without it, an apply against an edited plan "
                "refuses (reingest_would_replace_edits) and names the "
                "edits; a pre-apply version is saved automatically when "
                "consent is given."
            ),
        ),
    ] = False,
):
    """Brief 92.R (92R.3) — apply the revision to the SAME plan.

    Re-checks and re-diffs regardless of what the review saw (defense
    in depth); `If-Match: <content_hash>` guards the review→apply gap
    (mismatch = 412 stale_write, nothing applied — omit the header only
    for unconditional script writes); the replay runs in ONE
    transaction through the domain layer (a non-draft plan refuses via
    the state machine, exactly as hand-editing would); the filing's
    examples re-run through the production scoring path; the drift vs
    the prior build is measured and the report row APPENDED. Returns
    the same envelope as /plans/ingest."""
    from openrater.rates.ingest.service import (
        ReingestIdentityMismatch,
        ReingestNoBuildHistory,
        ReingestWouldReplaceEdits,
        reingest_apply,
    )

    data = _require_workbook_body(await request.body())
    if_match = request.headers.get("if-match")
    try:
        return reingest_apply(
            db=_resolve_db(request),
            rating_plan_id=rating_plan_id,
            data=data,
            filename=filename,
            if_match=if_match,
            operator_id=current_operator(),
            replace_edits=replace_edits,
        )
    except LookupError as exc:
        raise NotFoundError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        ) from exc
    except ReingestNoBuildHistory as exc:
        raise ValidationError(str(exc), code="reingest_no_build_history") from exc
    except ReingestWouldReplaceEdits as exc:
        raise ValidationError(
            str(exc),
            code="reingest_would_replace_edits",
            hint=(
                "Review the edits (they are itemized on "
                "reingest/check under edits_since_build), then re-run "
                "with ?replace_edits=true — a pre-apply version is "
                "saved automatically."
            ),
        ) from exc
    except ReingestIdentityMismatch as exc:
        raise ValidationError(
            str(exc), code="reingest_identity_mismatch"
        ) from exc
    except WorkbookNotCleanError as exc:
        raise ValidationError(
            str(exc),
            code="ingest_check_failed",
            hint=(
                "Run POST /plans/{id}/reingest/check for the full "
                "cell-addressed report."
            ),
        ) from exc
    except BuildError as exc:
        raise ValidationError(
            str(exc),
            code="ingest_unbuildable",
            hint=(
                "The check passed but the apply refused — nothing was "
                "changed. The message names the construct."
            ),
        ) from exc
