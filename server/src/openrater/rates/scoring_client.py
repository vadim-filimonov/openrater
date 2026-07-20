# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""mode:'score' delegation — API Lab → the scoring service (score delegation).

API Lab never runs the rating engine (it is TypeScript, and the ONE
projector lives on that side — ADR-0045). For score-on-ingest it POSTs
each location's inputs to the scoring service's `/score` with
`source:"plan_id"` — the service resolves the pinned snapshot bundle
back from THIS API (cached forever per immutable snapshot_id) and runs
the engine.

Failure semantics (fixture-pinned):
  · `/score` is pure → a timeout retry is safe; persistence (the
    caller's transaction) is the idempotent step. Nothing is written
    until every location scored.
  · service unreachable → 503 `scoring_unavailable` (try again).
  · service rejected the request (bad plan/snapshot/inputs) → the
    reason relays as a 422 with the service's message.
  · scored fine but no resolvable premium (multi-output plan without
    `premium_output_field`) → 502 `scoring_no_premium`, with the fix
    in the hint — never a silently-zero premium.

Config: `RATER_SCORING_URL` (default http://127.0.0.1:8080 — the
service's own PORT default).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx

from openrater.errors import RaterError, ValidationError

DEFAULT_SCORING_URL = "http://127.0.0.1:8080"


def scoring_base_url() -> str:
    return os.environ.get("RATER_SCORING_URL", DEFAULT_SCORING_URL).rstrip("/")


class ScoringUnavailableError(RaterError):
    code = "scoring_unavailable"
    default_status_code = 503
    default_hint = (
        "Start the scoring service (services/scoring: pnpm dev) or point "
        "RATER_SCORING_URL at a running instance, then retry — scoring is "
        "pure, so the retry is safe."
    )


class ScoringFailedError(RaterError):
    code = "scoring_failed"
    default_status_code = 502


@dataclass(frozen=True)
class ScoredInputs:
    premium_cents: int
    eligibility_tier: str | None
    outputs: dict[str, Any]


def _send(url: str, payload: dict[str, Any]) -> httpx.Response:
    """The one transport seam (tests monkeypatch this)."""
    return httpx.post(url, json=payload, timeout=30.0)


def score_inputs(
    *,
    plan_id: str,
    snapshot_id: str,
    inputs: dict[str, Any],
    as_of: str,
    premium_output_field: str | None = None,
    base_url: str | None = None,
) -> ScoredInputs:
    base = base_url or scoring_base_url()
    payload: dict[str, Any] = {
        "source": "plan_id",
        "planId": plan_id,
        "snapshotId": snapshot_id,
        "inputs": inputs,
        "options": {"as_of": as_of},
        "trace": "none",
    }
    if premium_output_field is not None:
        payload["views"] = {"premiumField": premium_output_field}

    try:
        response = _send(f"{base}/score", payload)
    except httpx.HTTPError as exc:
        raise ScoringUnavailableError(
            f"The scoring service at {base} is unreachable: {exc}.",
        ) from exc

    if response.status_code in (400, 404):
        detail = _service_message(response)
        raise ValidationError(
            f"The scoring service rejected the request: {detail}",
            code="scoring_rejected",
        )
    if response.status_code == 503:
        raise ScoringUnavailableError(
            f"The scoring service reported its own upstream unavailable: "
            f"{_service_message(response)}",
        )
    if response.status_code != 200:
        raise ScoringFailedError(
            f"The scoring service returned {response.status_code}: "
            f"{_service_message(response)}",
        )

    body = response.json()
    views = body.get("views") or {}
    premium = views.get("premium")
    if not isinstance(premium, (int, float)):
        raise ScoringFailedError(
            "The score succeeded but no premium view resolved (the plan "
            "has multiple numeric outputs).",
            code="scoring_no_premium",
            hint=(
                "Pass premium_output_field naming the plan's premium "
                "output (e.g. 'total_premium')."
            ),
        )
    tier = views.get("tier")
    outputs = body.get("outputs") or {}
    return ScoredInputs(
        premium_cents=int(round(float(premium) * 100)),
        eligibility_tier=tier if isinstance(tier, str) else None,
        outputs=outputs if isinstance(outputs, dict) else {},
    )


def _service_message(response: httpx.Response) -> str:
    try:
        body = response.json()
        return str(body.get("message") or body.get("error") or response.text)
    except ValueError:
        return response.text[:300]
