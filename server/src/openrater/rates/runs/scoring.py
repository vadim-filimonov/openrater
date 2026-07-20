# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Run-zone scoring delegation (Brief 75) — api-lab → scoring service.

The generalized sibling of `rates/scoring_client.py`: instead of
the narrowed single-premium view, runs persist the service's FULL
response (outputs/views/composed/appetite/rowIssues/row_status/
planIssues — the ADR-0056 + G4 contract), because the Run ledger
renders all of it.

Draft plans have no snapshot, so the request ships the plan's OWN
substrate as `source: "plan_stages"` — composed by the SAME
`_compose_body` snapshots freeze (one composition, zero drift), split
into the wire catalog + cells map the projector expects (mirroring
`snapshot-plan.ts`'s split, on the write side).
"""

from __future__ import annotations

from typing import Any

import httpx

from openrater.rates.scoring_client import (
    ScoringFailedError,
    ScoringUnavailableError,
    scoring_base_url,
)


def plan_stages_request(
    *,
    body: dict[str, Any],
    inputs: dict[str, Any],
    as_of: str | None,
    trace: str = "summary",
) -> dict[str, Any]:
    """Transform a composed plan body (`_compose_body` output) into a
    `/score` request with `source: "plan_stages"`."""
    factor_tables: list[dict[str, Any]] = []
    cells: dict[str, dict[str, float]] = {}
    for ft in body.get("factor_tables") or []:
        table_id = ft.get("table_id")
        if not isinstance(table_id, str) or table_id == "":
            continue
        catalog_entry: dict[str, Any] = {"id": table_id}
        # `interpolation` (ADR-0063) rides through to the scoring service's
        # projector, which reads it to emit `lookup.multi.interpolateOn`.
        # Dropping it here would silently step a flagged table server-side.
        for key in ("slug", "display_name", "key_dimensions", "interpolation"):
            if ft.get(key) is not None:
                catalog_entry[key] = ft[key]
        factor_tables.append(catalog_entry)
        raw_cells = ft.get("cells") or {}
        cells[table_id] = {
            k: float(v)
            for k, v in raw_cells.items()
            if isinstance(v, (int, float))
        }

    # ADR-0055 — the tail lands in the body as its API envelope; the
    # scoring request wants the bare ordered list.
    tail_env = body.get("policy_tail")
    tail = (
        tail_env.get("tail")
        if isinstance(tail_env, dict)
        else tail_env
        if isinstance(tail_env, list)
        else None
    )

    request: dict[str, Any] = {
        "source": "plan_stages",
        "stages": body.get("stages") or [],
        "dimensions": body.get("dimensions") or [],
        "factorTables": factor_tables,
        "factorTableCells": cells,
        "inputs": inputs,
        "trace": trace,
    }
    if isinstance(tail, list) and len(tail) > 0:
        request["policyTail"] = tail
    if as_of:
        request["options"] = {"as_of": as_of}
    return request


def score_once(
    *, request: dict[str, Any], base_url: str | None = None
) -> dict[str, Any]:
    """POST /score, returning the FULL response body. Failure semantics
    mirror `rates/scoring_client` (503 unreachable / 422 relayed)."""
    base = (base_url or scoring_base_url()).rstrip("/")
    try:
        response = httpx.post(f"{base}/score", json=request, timeout=30.0)
    except httpx.HTTPError as exc:
        raise ScoringUnavailableError(
            f"The scoring service is unreachable at {base}: {exc}."
        ) from exc
    if response.status_code >= 500:
        raise ScoringFailedError(
            f"The scoring service failed ({response.status_code}).",
            hint="Check the scoring service logs; scoring is pure, retry is safe.",
        )
    if response.status_code >= 400:
        detail = ""
        try:
            detail = str(response.json())
        except ValueError:
            detail = response.text[:300]
        raise ScoringFailedError(
            f"The scoring service rejected the run ({response.status_code}): {detail}",
            hint="The plan substrate or inputs are invalid for scoring.",
        )
    payload = response.json()
    if not isinstance(payload, dict):
        raise ScoringFailedError("The scoring service returned a non-object body.")
    return payload


def score_policy_once(
    *, request: dict[str, Any], base_url: str | None = None
) -> dict[str, Any]:
    """POST /score-policy — synchronous multi-location policy composition
    (Brief 76 P4.1b). Same failure semantics as `score_once`; returns the
    FULL response body (the rolled-up FILED premium + per-location
    breakdown + composed build-up)."""
    base = (base_url or scoring_base_url()).rstrip("/")
    try:
        response = httpx.post(
            f"{base}/score-policy", json=request, timeout=30.0
        )
    except httpx.HTTPError as exc:
        raise ScoringUnavailableError(
            f"The scoring service is unreachable at {base}: {exc}."
        ) from exc
    if response.status_code >= 500:
        raise ScoringFailedError(
            f"The scoring service failed ({response.status_code}).",
            hint="Check the scoring service logs; scoring is pure, retry is safe.",
        )
    if response.status_code >= 400:
        detail = ""
        try:
            detail = str(response.json())
        except ValueError:
            detail = response.text[:300]
        raise ScoringFailedError(
            f"The scoring service rejected the policy quote "
            f"({response.status_code}): {detail}",
            hint="The plan substrate or locations are invalid for scoring.",
        )
    payload = response.json()
    if not isinstance(payload, dict):
        raise ScoringFailedError("The scoring service returned a non-object body.")
    return payload


def plan_stages_source_fields(body: dict[str, Any]) -> dict[str, Any]:
    """The `source: plan_stages` substrate fields shared by /score and
    /score-batch requests (split of `plan_stages_request`)."""
    factor_tables: list[dict[str, Any]] = []
    cells: dict[str, dict[str, float]] = {}
    for ft in body.get("factor_tables") or []:
        table_id = ft.get("table_id")
        if not isinstance(table_id, str) or table_id == "":
            continue
        catalog_entry: dict[str, Any] = {"id": table_id}
        # `interpolation` (ADR-0063) rides through to the scoring service's
        # projector, which reads it to emit `lookup.multi.interpolateOn`.
        # Dropping it here would silently step a flagged table server-side.
        for key in ("slug", "display_name", "key_dimensions", "interpolation"):
            if ft.get(key) is not None:
                catalog_entry[key] = ft[key]
        factor_tables.append(catalog_entry)
        raw_cells = ft.get("cells") or {}
        cells[table_id] = {
            k: float(v)
            for k, v in raw_cells.items()
            if isinstance(v, (int, float))
        }
    tail_env = body.get("policy_tail")
    tail = (
        tail_env.get("tail")
        if isinstance(tail_env, dict)
        else tail_env
        if isinstance(tail_env, list)
        else None
    )
    fields: dict[str, Any] = {
        "source": "plan_stages",
        "stages": body.get("stages") or [],
        "dimensions": body.get("dimensions") or [],
        "factorTables": factor_tables,
        "factorTableCells": cells,
    }
    if isinstance(tail, list) and len(tail) > 0:
        fields["policyTail"] = tail
    return fields


def submit_batch(
    *, request: dict[str, Any], base_url: str | None = None
) -> str:
    """POST /score-batch → the jobId. Same failure semantics as
    `score_once`."""
    base = (base_url or scoring_base_url()).rstrip("/")
    try:
        response = httpx.post(f"{base}/score-batch", json=request, timeout=30.0)
    except httpx.HTTPError as exc:
        raise ScoringUnavailableError(
            f"The scoring service is unreachable at {base}: {exc}."
        ) from exc
    if response.status_code >= 400:
        raise ScoringFailedError(
            f"The scoring service rejected the book run "
            f"({response.status_code}): {response.text[:300]}",
        )
    payload = response.json()
    job_id = payload.get("jobId") if isinstance(payload, dict) else None
    if not isinstance(job_id, str):
        raise ScoringFailedError("score-batch returned no jobId.")
    return job_id


def fetch_batch_state(
    *, job_id: str, base_url: str | None = None
) -> dict[str, Any]:
    """GET /score-batch/{id}/result — status + progress + summary (the
    summary is present once the worker finished a BOOK job). limit=1
    keeps the page tiny; the compact ledger rides the summary."""
    base = (base_url or scoring_base_url()).rstrip("/")
    try:
        response = httpx.get(
            f"{base}/score-batch/{job_id}/result",
            params={"offset": 0, "limit": 1},
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise ScoringUnavailableError(
            f"The scoring service is unreachable at {base}: {exc}."
        ) from exc
    if response.status_code >= 400:
        raise ScoringFailedError(
            f"The scoring service failed reading job {job_id} "
            f"({response.status_code}).",
        )
    payload = response.json()
    if not isinstance(payload, dict):
        raise ScoringFailedError("score-batch result was a non-object body.")
    return payload


def fetch_batch_rows(
    *,
    job_id: str,
    offset: int,
    limit: int,
    base_url: str | None = None,
) -> dict[str, Any]:
    """GET a page of a book job's per-row results (Brief 75 phase 4 —
    the exhibits' substrate: each stored row carries projected inputs
    + outputs + verdict). Returns {rows, total, offset, nextOffset}."""
    base = (base_url or scoring_base_url()).rstrip("/")
    try:
        response = httpx.get(
            f"{base}/score-batch/{job_id}/result",
            params={"offset": offset, "limit": limit},
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise ScoringUnavailableError(
            f"The scoring service is unreachable at {base}: {exc}."
        ) from exc
    if response.status_code == 404:
        raise ScoringFailedError(
            f"The scoring service no longer holds results for job {job_id} "
            "— re-run the book to regenerate them.",
        )
    if response.status_code >= 400:
        raise ScoringFailedError(
            f"The scoring service failed reading rows for job {job_id} "
            f"({response.status_code}).",
        )
    payload = response.json()
    if not isinstance(payload, dict):
        raise ScoringFailedError("score-batch rows page was a non-object body.")
    return {
        "rows": payload.get("rows") or [],
        "total": payload.get("total") or 0,
        "offset": payload.get("offset") or 0,
        "next_offset": payload.get("nextOffset"),
    }
