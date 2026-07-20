# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for persisted plan runs (Brief 75, v4 P3).

A run is an append-only record of one execution — a sample rate or a
book score — computed server-side (api-lab → scoring service) and
pinned to exactly what produced it (snapshot id or draft content hash).
`result_json` is stored opaque and returned verbatim; the ledger
grammar (ADR-0056: error ≠ decline ≠ $0) narrows at the consumption
site, so new response fields need no schema bump here.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

RunKind = Literal["sample", "book", "probe"]
RunStatus = Literal["running", "done", "error"]


class PlanRun(BaseModel):
    """One persisted run — the wire shape GET returns."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str
    rating_plan_id: str
    kind: RunKind
    status: RunStatus
    created_at: str
    finished_at: str | None = None
    as_of: str | None = None
    snapshot_id: str | None = None
    plan_content_hash: str | None = None
    book_content_hash: str | None = None
    # ADR-0064 — the client-attested scoring fingerprint captured when
    # the run was requested (stages + dims + factor-table cells + tail).
    # Opaque: stored and echoed, never interpreted server-side. The
    # staleness surfaces compare it before falling back to
    # plan_content_hash, which (per ADR-0015) can't see cells.
    scoring_fingerprint: str | None = None
    job_id: str | None = None
    request: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | None = None
    error_message: str | None = None


class PlanRunSummary(BaseModel):
    """List-shape: everything but the (potentially large) payloads —
    plus the headline the history rail renders (lifted from the result
    at write time so lists never parse row payloads)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str
    rating_plan_id: str
    kind: RunKind
    status: RunStatus
    created_at: str
    finished_at: str | None = None
    as_of: str | None = None
    snapshot_id: str | None = None
    plan_content_hash: str | None = None
    book_content_hash: str | None = None
    # ADR-0064 — see PlanRun.scoring_fingerprint; the history rail +
    # probe book compare against it per row.
    scoring_fingerprint: str | None = None
    headline: dict[str, Any] = Field(default_factory=dict)


class CreateRunRequest(BaseModel):
    """POST body. `kind: sample` requires `inputs` (the risk); `kind:
    book` with no payload scores the plan's connected book (Brief 75
    D-D: Inputs owns intake, Run owns execution), and with `rows` an
    AD-HOC book — the chat door's CSV, input-keyed, capped at 5,000
    (book intake: a caller's CSV is a real book, never a probe);
    `kind: probe` requires `rows` — the client-built sweep of the
    plan's own variable space (Brief 89 §3.2 B3)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: RunKind
    inputs: dict[str, Any] | None = None
    rows: list[dict[str, Any]] | None = None
    as_of: str | None = Field(default=None, max_length=10)
    snapshot_id: str | None = Field(default=None, max_length=80)
    # ADR-0064 — optional client scoring fingerprint pinned to the run
    # (see PlanRun.scoring_fingerprint). Browser clients send it; API
    # consumers may omit it (staleness then keys on content_hash).
    scoring_fingerprint: str | None = Field(default=None, max_length=64)


class PlanRunList(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    runs: list[PlanRunSummary]
