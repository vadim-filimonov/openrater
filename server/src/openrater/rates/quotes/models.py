# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Pydantic contracts for the quote endpoint (Brief 76, v4 P4).

A quote is an UN-PERSISTED single-risk rating against a plan's version
of record (the published snapshot by default). It reuses the run-zone
scoring delegation (`rates/runs/scoring.py`) so the number it returns is
the SAME composed FILED premium the Run tab shows for the same risk on
the same version — Law 1, one premium.

Unlike a run, nothing is written: `POST /quote` computes and returns.
The response is snake_case (the public API surface); it maps the scoring
service's camelCase fields once, here, so callers never see the internal
wire shape.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from openrater.identity import RISK_ID_PATTERN

QuoteVersionKind = Literal["published", "snapshot", "draft"]


class QuoteRequest(BaseModel):
    """The risk to rate. Send EITHER a single risk (`inputs`) OR a policy
    (`locations` — one declared-input object per location, composed into
    one policy premium, P4.1b). `policy_inputs` are constants merged into
    every location (per-policy fields like years-in-business). Missing or
    unknown input keys are NAMED in the response (G5), not rejected with a
    4xx — the engine refuses honestly (Law 2)."""

    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, Any] = Field(default_factory=dict)
    locations: list[dict[str, Any]] | None = None
    policy_inputs: dict[str, Any] | None = None
    as_of: str | None = None
    trace: Literal["none", "summary", "full"] = "summary"
    # ADR-0060 — the caller's global risk identity, shape-validated.
    # Ignored by the engine (identical premium with or without it); recorded
    # on the passive ledger row so the served quote joins the risk's thread.
    risk_id: str | None = Field(default=None, pattern=RISK_ID_PATTERN)

    @property
    def is_policy(self) -> bool:
        return bool(self.locations)


class QuoteVersion(BaseModel):
    """Which version answered — the honesty of Law 3 made explicit."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: QuoteVersionKind
    snapshot_id: str | None = None
    content_hash: str | None = None


class QuoteResponse(BaseModel):
    """The quote — the composed filed premium + the ADR-0056 tri-facet +
    which version produced it. `premium` is `composed.final` (the filed
    number); it is `null` when the plan REFUSES the risk (row_status
    "error" — a named refusal, never $0)."""

    model_config = ConfigDict(extra="forbid")

    premium: float | None
    tier: str | None = None
    row_status: Literal["ok", "error"]
    outputs: dict[str, Any] = Field(default_factory=dict)
    # G4 build-up (subtotal → tail → final); present when the plan composes.
    composed: dict[str, Any] | None = None
    # ADR-0056 — structured per-row issues (unknown key, withheld output).
    row_issues: list[dict[str, Any]] | None = None
    # ADR-0056 — structured projection issues (from the version's substrate).
    plan_issues: list[dict[str, Any]] | None = None
    # G5 — named missing/unknown request fields vs the plan's consumed inputs.
    input_issues: dict[str, Any] | None = None
    trace: dict[str, Any] | None = None
    as_of: str | None = None
    version: QuoteVersion
    # P4.1b — a POLICY quote's per-location breakdown (premium + verdict);
    # None for a single-risk quote.
    locations: list[dict[str, Any]] | None = None
    location_count: int | None = None
