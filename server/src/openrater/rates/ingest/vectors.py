# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Verification vectors — the workbook's test_cases through the
PRODUCTION scoring path (Law 1: the same engine bytes that serve
/quote and the Run zone; never a side calculator).

Vectors never block a build: mismatches are loud findings in the
report, and an unreachable scoring service degrades to
status="unavailable" (the report says exactly why nothing ran).
"""

from __future__ import annotations

from typing import Any

from openrater.persistence import Database
from openrater.rates.scoring_client import (
    ScoringFailedError,
    ScoringUnavailableError,
)
from openrater.rates.ingest.model import ParsedWorkbook
from openrater.rates.ingest.reports import VectorCase, VectorResult, VectorsSummary
from openrater.rates.runs.scoring import plan_stages_request, score_once
from openrater.rates.snapshots.service import compose_plan_body

#: match = cent-exact by default (spec §4.13); "near" is a soft band the
#: report tints amber — within a dollar, worth a look, not a failure.
DEFAULT_TOLERANCE = 0.005
NEAR_BAND = 1.0

_RESERVED = {"case_id", "name", "notes"}


def _case_inputs(columns: list[str], row) -> dict[str, Any]:  # noqa: ANN001
    inputs: dict[str, Any] = {}
    for col in columns:
        if col in _RESERVED or col.startswith(("expected_", "tolerance_")):
            continue
        v = row.get(col)
        if v is not None:
            inputs[col] = v
    return inputs


def _total_field(parsed: ParsedWorkbook) -> str | None:
    """The output field that carries the PLAN TOTAL — the round
    adjustment's declared output (or the coverage:total mapping).

    The engine floors once per POLICY at the composition seam (G9), so
    the raw plan output for this field is PRE-floor; the filed number
    lives in `views.premium` / `composed.final`. The runner must
    compare the filed number."""
    adjustments = (
        parsed.final_adjustments.rows if parsed.final_adjustments is not None else []
    )
    round_ids = {
        str(r.get("adjustment_id"))
        for r in adjustments
        if str(r.get("kind")) == "round"
    }
    outputs = parsed.outputs.rows if parsed.outputs is not None else []
    for row in outputs:
        if str(row.get("source")) in round_ids or str(row.get("source")) == "coverage:total":
            return str(row.get("field_name"))
    return None


def _tier_of(response: dict[str, Any]) -> str | None:
    views = response.get("views")
    if isinstance(views, dict) and views.get("tier") is not None:
        return str(views["tier"])
    appetite = response.get("appetite")
    if isinstance(appetite, dict) and appetite.get("tier") is not None:
        return str(appetite["tier"])
    return None


def run_vectors(
    *, db: Database, rating_plan_id: str, parsed: ParsedWorkbook
) -> VectorsSummary:
    cases = parsed.test_cases.rows if parsed.test_cases is not None else []
    if not cases:
        return VectorsSummary(status="none", detail="The workbook has no test cases.")

    columns = parsed.test_cases.columns  # type: ignore[union-attr]
    expected_cols = [c for c in columns if c.startswith("expected_")]
    total_field = _total_field(parsed)

    body = compose_plan_body(db=db, plan_id=rating_plan_id)
    checks: list[VectorResult] = []
    # Brief 95 D2 — the case INPUTS ride the report so surfaces can
    # replay a verified filed example (Run-zone sample seeding). Built
    # up front: they exist whether or not scoring is reachable.
    case_records = [
        VectorCase(
            case_id=str(row.get("case_id")),
            name=str(row.get("name")) if row.get("name") is not None else None,
            inputs=_case_inputs(columns, row),
        )
        for row in cases
    ]
    matched = near = mismatched = 0

    for row, record in zip(cases, case_records, strict=True):
        case_id = record.case_id
        name = record.name
        request = plan_stages_request(
            body=body,
            inputs=record.inputs,
            as_of=None,
            trace="summary",
        )
        try:
            response = score_once(request=request)
        except ScoringUnavailableError as exc:
            return VectorsSummary(
                status="unavailable",
                detail=str(exc),
                total_cases=len(cases),
                checks=checks,
                cases=case_records,
                matched=matched,
                near=near,
                mismatched=mismatched,
            )
        except ScoringFailedError as exc:
            for col in expected_cols:
                checks.append(
                    VectorResult(
                        case_id=case_id,
                        name=name,
                        field=col[len("expected_") :],
                        expected=row.get(col),
                        status="error",
                        detail=str(exc),
                    )
                )
            mismatched += len(expected_cols)
            continue

        outputs = response.get("outputs") if isinstance(response.get("outputs"), dict) else {}
        for col in expected_cols:
            field = col[len("expected_") :]
            expected = row.get(col)
            if expected is None:
                continue
            if field == "tier":
                actual_tier = _tier_of(response)
                ok = (
                    actual_tier is not None
                    and str(expected).strip().lower() == actual_tier.strip().lower()
                )
                checks.append(
                    VectorResult(
                        case_id=case_id,
                        name=name,
                        field="tier",
                        expected=str(expected),
                        actual=actual_tier,
                        status="match" if ok else "mismatch",
                    )
                )
                matched += 1 if ok else 0
                mismatched += 0 if ok else 1
                continue

            actual = outputs.get(field)
            if field == total_field:
                views = response.get("views")
                if isinstance(views, dict) and isinstance(
                    views.get("premium"), (int, float)
                ):
                    actual = views["premium"]
            tolerance_v = row.get(f"tolerance_{field}")
            tolerance = float(tolerance_v) if tolerance_v is not None else DEFAULT_TOLERANCE
            if not isinstance(actual, (int, float)):
                checks.append(
                    VectorResult(
                        case_id=case_id,
                        name=name,
                        field=field,
                        expected=float(expected),
                        status="mismatch",
                        detail=f"The run produced no numeric output named '{field}'.",
                    )
                )
                mismatched += 1
                continue
            delta = float(actual) - float(expected)
            if abs(delta) <= tolerance:
                status = "match"
                matched += 1
            elif abs(delta) <= NEAR_BAND:
                status = "near"
                near += 1
            else:
                status = "mismatch"
                mismatched += 1
            checks.append(
                VectorResult(
                    case_id=case_id,
                    name=name,
                    field=field,
                    expected=float(expected),
                    actual=round(float(actual), 2),
                    delta=round(delta, 2),
                    status=status,
                )
            )

    return VectorsSummary(
        status="ran",
        total_cases=len(cases),
        checks=checks,
        cases=case_records,
        matched=matched,
        near=near,
        mismatched=mismatched,
    )
