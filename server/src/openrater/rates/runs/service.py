# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Run orchestration (Brief 75, v4 P3).

A run is computed server-side, end to end: this module composes the
plan's substrate (the SAME `_compose_body` snapshots freeze), ships it
to the scoring service, and persists the full honest response as an
append-only `plan_runs` row. The browser never posts a number.

Sample runs are synchronous (ms-scale single risk). Book runs are
async batch jobs, lazily finalized on read. Probe runs (Brief 89 §3.2
B3) are the plan probing ITSELF: a client-built sweep of the authored
variable space scored through the same book batch path.
"""

from __future__ import annotations

from typing import Any

from openrater.errors import RaterError, NotFoundError, ValidationError
from openrater.persistence.db import Database
from openrater.rates.inputs_mapping.repo import get_input_mapping
from openrater.rates.plans.repo import get_plan
from openrater.rates.runs.models import CreateRunRequest, PlanRun
from openrater.rates.runs.repo import finalize_run, get_run, insert_run
from openrater.rates.runs.scoring import (
    fetch_batch_rows,
    fetch_batch_state,
    plan_stages_request,
    plan_stages_source_fields,
    score_once,
    submit_batch,
)
from openrater.rates.snapshots.service import compose_plan_body


def create_run(
    *,
    db: Database,
    rating_plan_id: str,
    request: CreateRunRequest,
    scoring_base_url: str | None = None,
) -> PlanRun:
    plan = get_plan(db=db, rating_plan_id=rating_plan_id)
    if plan is None:
        raise ValidationError(
            f"Plan {rating_plan_id!r} not found.",
            code="plan_not_found",
            param="rating_plan_id",
        )

    if request.kind == "book":
        # book intake — rows in the request = an ad-hoc book (the
        # chat door's CSV); no rows = the plan's connected book.
        if request.rows:
            return _create_adhoc_book_run(
                db=db,
                rating_plan_id=rating_plan_id,
                plan_content_hash=plan.content_hash,
                request=request,
                scoring_base_url=scoring_base_url,
            )
        return _create_book_run(
            db=db,
            rating_plan_id=rating_plan_id,
            plan_content_hash=plan.content_hash,
            request=request,
            scoring_base_url=scoring_base_url,
        )

    if request.kind == "probe":
        return _create_probe_run(
            db=db,
            rating_plan_id=rating_plan_id,
            plan_content_hash=plan.content_hash,
            request=request,
            scoring_base_url=scoring_base_url,
        )

    inputs = request.inputs or {}
    if not isinstance(inputs, dict) or len(inputs) == 0:
        raise ValidationError(
            "A sample run needs the risk's inputs (kind:'sample' with a "
            "non-empty `inputs` object).",
            code="missing_inputs",
            param="inputs",
        )

    # Compose the plan's OWN substrate — the same composition snapshots
    # freeze — and score it server-side. The response carries the G4
    # composed FILED premium + the ADR-0056 tri-facet fields.
    body = compose_plan_body(db=db, plan_id=rating_plan_id)
    score_request = plan_stages_request(
        body=body,
        inputs=inputs,
        as_of=request.as_of,
        # Trace-panel brief §14 (audit P4-01) — a sample run's trace is
        # the actuary's diagnosis surface, so keep the FULL per-node
        # inputs (which key missed, what each lookup actually saw). One
        # risk per request; the size cost is negligible. Book runs stay
        # trace="none".
        trace="full",
    )
    result: dict[str, Any] = score_once(
        request=score_request, base_url=scoring_base_url
    )

    mapping = get_input_mapping(db=db, rating_plan_id=rating_plan_id)
    return insert_run(
        db=db,
        rating_plan_id=rating_plan_id,
        kind="sample",
        status="done",
        as_of=result.get("as_of") if isinstance(result.get("as_of"), str) else request.as_of,
        snapshot_id=request.snapshot_id,
        plan_content_hash=plan.content_hash,
        book_content_hash=mapping.content_hash if mapping else None,
        # ADR-0064 — pinned verbatim; the staleness surfaces compare it
        # before falling back to plan_content_hash (which can't see
        # factor-table cells).
        scoring_fingerprint=request.scoring_fingerprint,
        job_id=None,
        request={"inputs": inputs},
        result=result,
    )


#: book intake — the chat door's ad-hoc book cap (mirrors the MCP
#: rerate cap; the connected-book path is unbounded by request shape).
ADHOC_BOOK_MAX_ROWS = 5000


def _create_adhoc_book_run(
    *,
    db: Database,
    rating_plan_id: str,
    plan_content_hash: str | None,
    request: CreateRunRequest,
    scoring_base_url: str | None,
) -> PlanRun:
    """Score caller-supplied rows as a BOOK run (book intake /
    ): a CSV handed to the chat door is a real book, not a
    probe — it must land in run history under the Book chip and open
    in the run detail like any other book. Identity column map (the
    caller's header names ARE the plan's declared input names — the
    pre-flight upstream guarantees it); rows are independent, so the
    floor scopes per row."""
    rows = request.rows or []
    if len(rows) > ADHOC_BOOK_MAX_ROWS:
        raise ValidationError(
            f"A book run is capped at {ADHOC_BOOK_MAX_ROWS} rows "
            f"(got {len(rows)}).",
            code="too_many_rows",
            param="rows",
        )

    wire_rows: list[dict[str, str]] = []
    keys: set[str] = set()
    for row in rows:
        wire_row: dict[str, str] = {}
        for k, v in row.items():
            s = _probe_wire_value(v)
            if s is None:
                continue
            wire_row[k] = s
            keys.add(k)
        wire_rows.append(wire_row)

    body = compose_plan_body(db=db, plan_id=rating_plan_id)
    batch_request: dict[str, Any] = {
        **plan_stages_source_fields(body),
        "projectorOptions": {"minPremiumScope": "row"},
        "rows": wire_rows,
        "trace": "none",
        "book": {
            "column_map": {k: k for k in sorted(keys)},
        },
    }
    if request.as_of:
        batch_request["options"] = {"as_of": request.as_of}

    job_id = submit_batch(request=batch_request, base_url=scoring_base_url)
    return insert_run(
        db=db,
        rating_plan_id=rating_plan_id,
        kind="book",
        status="running",
        as_of=request.as_of,
        snapshot_id=request.snapshot_id,
        plan_content_hash=plan_content_hash,
        book_content_hash=None,
        scoring_fingerprint=request.scoring_fingerprint,
        job_id=job_id,
        request={"row_count": len(rows), "adhoc": True},
        result=None,
    )


def _create_book_run(
    *,
    db: Database,
    rating_plan_id: str,
    plan_content_hash: str | None,
    request: CreateRunRequest,
    scoring_base_url: str | None,
) -> PlanRun:
    """Submit the plan's connected book to the scoring service as an
    async batch job (Brief 75 D-E). RAW rows ship with the mapping's
    column_map + grouping + roll-ups; the WORKER projects them through
    the shared UI path and composes policies; the API service never rates."""
    envelope = get_input_mapping(db=db, rating_plan_id=rating_plan_id)
    mapping = envelope.mapping if envelope else None
    source = (mapping or {}).get("source") or {}
    rows = source.get("sample_rows") or []
    if source.get("kind") != "csv" or len(rows) == 0:
        raise ValidationError(
            "This plan has no connected book to score — upload a CSV in "
            "Inputs first.",
            code="no_book",
            param="kind",
        )
    grouping = (mapping or {}).get("grouping_config") or {}
    rollups = (mapping or {}).get("rollup_fields") or []
    grouped = bool(grouping.get("policy_id_column"))

    body = compose_plan_body(db=db, plan_id=rating_plan_id)
    batch_request: dict[str, Any] = {
        **plan_stages_source_fields(body),
        # G9 — a grouped book floors ONCE per policy at composition.
        "projectorOptions": {
            "minPremiumScope": "policy" if grouped else "row"
        },
        "rows": rows,
        "trace": "none",
        "book": {
            "column_map": (mapping or {}).get("column_map") or {},
            # book intake — the mapping's alias vocabulary rides to
            # the worker, so a value translated in Inputs holds here.
            **(
                {"alias_overrides": (mapping or {}).get("alias_overrides")}
                if (mapping or {}).get("alias_overrides")
                else {}
            ),
            **({"grouping": grouping} if grouped else {}),
            **({"rollup_fields": rollups} if rollups else {}),
            # The per-policy CONSTANTS the tail's guards + GLM read
            # (mirrors the browser's grouped run).
            "policyInputKeys": ["years_in_business", "is_first_term"],
        },
    }
    if request.as_of:
        batch_request["options"] = {"as_of": request.as_of}

    job_id = submit_batch(request=batch_request, base_url=scoring_base_url)
    return insert_run(
        db=db,
        rating_plan_id=rating_plan_id,
        kind="book",
        status="running",
        as_of=request.as_of,
        snapshot_id=request.snapshot_id,
        plan_content_hash=plan_content_hash,
        book_content_hash=envelope.content_hash if envelope else None,
        scoring_fingerprint=request.scoring_fingerprint,
        job_id=job_id,
        request={"row_count": len(rows), "grouped": grouped},
        result=None,
    )


# The client-side sweep caps itself around 500 cells (Brief 89 §3.2 B3);
# the server bound is a hard backstop, not the design size.
PROBE_MAX_ROWS = 2000


def _probe_wire_value(value: object) -> str | None:
    """Render one probe input as the CSV-shaped string the book
    projection layer expects (`projectRowsToExternalInputs` coerces
    strings by dtype; handing it a raw JSON number would crash the
    job). None → omit the key (missing input, engine semantics)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _create_probe_run(
    *,
    db: Database,
    rating_plan_id: str,
    plan_content_hash: str | None,
    request: CreateRunRequest,
    scoring_base_url: str | None,
) -> PlanRun:
    """Score a client-built sweep of the plan's OWN variable space
    (Brief 89 §3.2 B3 — the probe book). Rides the book batch path so
    every row persists its projected inputs + verdict and the summary
    totals come from the same ADR-0056 accounting; the "book" is an
    identity column map over the sweep's own keys. Excluded from the
    real-book exhibits by kind, from the quote ledger and Portfolio by
    construction (neither reads plan_runs)."""
    rows = request.rows or []
    if len(rows) == 0:
        raise ValidationError(
            "A probe run needs the sweep rows (kind:'probe' with a "
            "non-empty `rows` array).",
            code="missing_rows",
            param="rows",
        )
    if len(rows) > PROBE_MAX_ROWS:
        raise ValidationError(
            f"A probe run is capped at {PROBE_MAX_ROWS} rows "
            f"(got {len(rows)}).",
            code="too_many_rows",
            param="rows",
        )

    wire_rows: list[dict[str, str]] = []
    keys: set[str] = set()
    for row in rows:
        wire_row: dict[str, str] = {}
        for k, v in row.items():
            s = _probe_wire_value(v)
            if s is None:
                continue
            wire_row[k] = s
            keys.add(k)
        wire_rows.append(wire_row)

    body = compose_plan_body(db=db, plan_id=rating_plan_id)
    batch_request: dict[str, Any] = {
        **plan_stages_source_fields(body),
        # Synthetic rows are independent cells — never a policy group.
        "projectorOptions": {"minPremiumScope": "row"},
        "rows": wire_rows,
        "trace": "none",
        "book": {
            # Identity projection: the sweep's keys ARE the runtime
            # input keys; dtypes still derive from the plan's stages.
            "column_map": {k: k for k in sorted(keys)},
        },
    }
    if request.as_of:
        batch_request["options"] = {"as_of": request.as_of}

    job_id = submit_batch(request=batch_request, base_url=scoring_base_url)
    return insert_run(
        db=db,
        rating_plan_id=rating_plan_id,
        kind="probe",
        status="running",
        as_of=request.as_of,
        snapshot_id=request.snapshot_id,
        plan_content_hash=plan_content_hash,
        book_content_hash=None,
        scoring_fingerprint=request.scoring_fingerprint,
        job_id=job_id,
        request={"row_count": len(rows), "probe": True},
        result=None,
    )


def refresh_run(
    *,
    db: Database,
    rating_plan_id: str,
    run_id: str,
    scoring_base_url: str | None = None,
) -> PlanRun | None:
    """GET-path lazy finalize (Brief 75 D-E): a `running` book run polls
    its scoring job and flips to done/error when the job is terminal.
    A scoring-service outage leaves the run `running` (honest on the
    next read — never a fake terminal state)."""
    run = get_run(db=db, rating_plan_id=rating_plan_id, run_id=run_id)
    if run is None or run.status != "running" or not run.job_id:
        return run
    try:
        state = fetch_batch_state(job_id=run.job_id, base_url=scoring_base_url)
    except RaterError:
        return run
    status = state.get("status")
    if status == "succeeded":
        summary = state.get("summary")
        finalize_run(
            db=db,
            run_id=run.run_id,
            status="done",
            result=summary if isinstance(summary, dict) else {"row_count": 0},
        )
    elif status == "failed":
        finalize_run(
            db=db,
            run_id=run.run_id,
            status="error",
            result=None,
            error_message=str(state.get("error") or "Book scoring failed."),
        )
    return get_run(db=db, rating_plan_id=rating_plan_id, run_id=run_id)


def get_run_rows(
    *,
    db: Database,
    rating_plan_id: str,
    run_id: str,
    offset: int,
    limit: int,
    scoring_base_url: str | None = None,
) -> dict[str, Any]:
    """A page of a DONE book run's per-row results (projected inputs +
    outputs + verdict), relayed from the scoring service's result store
    (Brief 75 phase 4). api-lab stays the one surface the client talks
    to; the job store remains transport (D-A) — a GC'd job is a named
    refusal, never an empty 200."""
    run = get_run(db=db, rating_plan_id=rating_plan_id, run_id=run_id)
    if run is None:
        # 404, matching the sibling GET /runs/{run_id} — same run_not_found
        # code must carry the same status (audit A-2026-07-12 P1-18).
        raise NotFoundError(
            f"Run {run_id!r} not found on plan {rating_plan_id!r}.",
            code="run_not_found",
            param="run_id",
        )
    if run.kind not in ("book", "probe"):
        raise ValidationError(
            "Only book and probe runs have per-row results — a sample "
            "run's full payload is on the run record itself.",
            code="not_a_book_run",
            param="run_id",
        )
    if run.status != "done" or not run.job_id:
        raise ValidationError(
            f"Run {run_id!r} is {run.status} — rows are available once "
            "the run is done.",
            code="run_not_done",
            param="run_id",
        )
    return fetch_batch_rows(
        job_id=run.job_id,
        offset=offset,
        limit=limit,
        base_url=scoring_base_url,
    )
