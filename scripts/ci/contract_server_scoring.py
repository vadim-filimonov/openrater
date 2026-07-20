#!/usr/bin/env python3
# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""API Lab ↔ scoring HTTP contract check.

Every backend pytest monkeypatches `score_once`
(`server/tests/test_routes_quotes.py`) and the scoring service's own
tests never see api-lab's hand-built wire dict
(`openrater/rates/runs/scoring.py::plan_stages_request`) hit the zod schema
(`services/scoring/src/core/schema.ts`). So a field rename on EITHER side of
the wire ships CI-green and silently mis-prices production quotes. There is
documented precedent for exactly this failure class: zod once silently STRIPPED
`policyTail` and draft runs composed a pre-tail premium (see the comment near
`schema.ts:99-102`).

This script closes that gap. It drives the REAL two-service pipeline over HTTP:

    POST /api/v1/plans/{id}/snapshots        (freeze the committed cold-test plan)
    PATCH .../snapshots/{sid}/publish        (publish it as the version of record)
    POST /api/v1/plans/{id}/quote            (single risk → scoring /score)
    POST /api/v1/plans/{id}/quote            (2 locations → scoring /score-policy)
    POST /api/v1/plans/{id}/quote            (unrateable risk → named refusal)

and asserts the committed reference oracle to the dollar, plus the response envelope
(`version.snapshot_id` + the ADR-0056 tri-facet). It assumes BOTH services are
already running and api-lab is wired to scoring via `RATER_SCORING_URL`,
against a DB with the committed Meridian fixture loaded
(`python3 scripts/plan_fixture.py load …`). The contract job in
`.github/workflows/main.yml` sets that up; run it the same way locally.

── The oracle (pinned by the committed demo book, which the frontend
   regression test `meridianSeedFixture.verify.test.ts` verifies against the
   real engine) ──

  · Single-risk mv_01  → $1,898  (the filing's first worked example)
  · Policy [mv_01×2]   → $3,796  (a real /score-policy 2-location roll-up),
                          carrying the book's appetite tier
  · Wire-string mv_01  → $1,898 at the SAME tier: the anchor with every
                          value left as the raw CSV string
  · Unrateable (class c999) → premium withheld, row_status "error" (Law 2)

  Inputs are sent TYPED, coerced per the plan's own declared input schema
  (`GET /plans/{id}/input-schema` — which this check thereby also
  exercises); typed inputs remain the correct client behavior. Since
  The engine ALSO coerces wire strings onto the
  plan's declared input ports once at the run seam (conformance V62), so
  a string-encoded boolean ("true") can no longer price correctly while
  silently missing an appetite gate's match — the wire-string probe
  above pins that both ways over this HTTP seam.

Config (env; sensible localhost defaults):
    RATER_CONTRACT_API_BASE   api-lab base URL   (default http://127.0.0.1:8001)
    RATER_CONTRACT_PLAN_ID     plan id           (default meridian-shopfront-bop-ne-2026)
    RATER_CONTRACT_RAW_BOOK    raw-facts CSV      (default: the committed fixture)
    RATER_CONTRACT_FIXTURE     plan fixture JSON  (default: the committed fixture)

Exit code 0 = the wire contract holds; non-zero = drift (with the offending
response body dumped to the log).
"""
from __future__ import annotations

import csv
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

# ── Repo-relative defaults (resolve regardless of the caller's cwd) ──────────
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_RAW_BOOK = _REPO_ROOT / "docs/fixtures/meridian-demo-book.csv"
_DEFAULT_FIXTURE = _REPO_ROOT / "docs/fixtures/meridian-shopfront-bop-ne-2026.plan.json"

API_BASE = os.environ.get("RATER_CONTRACT_API_BASE", "http://127.0.0.1:8001").rstrip("/")
PLAN_ID = os.environ.get("RATER_CONTRACT_PLAN_ID", "meridian-shopfront-bop-ne-2026")
RAW_BOOK = Path(os.environ.get("RATER_CONTRACT_RAW_BOOK", _DEFAULT_RAW_BOOK))
FIXTURE = Path(os.environ.get("RATER_CONTRACT_FIXTURE", _DEFAULT_FIXTURE))

# ── The committed reference oracle ───────────────────────────────────────────────────────
# The anchor row (the filing's first worked example) + its literal premium.
# Row-level expectations are read from the committed demo book itself —
# `expected_total` / `expected_tier` are engine-verified by the frontend
# oracle test (meridianSeedFixture.verify.test.ts) — with the literal below
# double-pinning the anchor so a silently regenerated book can't drift the
# contract check along with it.
ANCHOR_CASE = "mv_01"
ANCHOR_TOTAL = 1898  # $1,898 — pinned as a literal, like MV_01_PINNED_TOTAL
# Book columns that are metadata, not declared plan inputs:
_META_COLUMNS = {"case_id", "name", "expected_tier", "expected_total"}
# A class code outside the invented c101–c140 vocabulary → unknown_key:
UNRATEABLE_CLASS = "c999"


class Drift(Exception):
    """A contract assertion failed — the wire drifted. Carries the response
    body so the CI log shows exactly what came back."""

    def __init__(self, message: str, *, response: Any = None) -> None:
        super().__init__(message)
        self.response = response


# ── Tiny HTTP client (stdlib only — no service deps, runs anywhere) ──────────
def _request(method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as exc:
        try:
            payload = json.load(exc)
        except (ValueError, json.JSONDecodeError):
            payload = exc.read().decode(errors="replace")
        return exc.code, payload
    except urllib.error.URLError as exc:
        raise Drift(
            f"Could not reach api-lab at {API_BASE}{path}: {exc}. "
            "Is the backend up and RATER_CONTRACT_API_BASE correct?"
        ) from exc


def get(path: str) -> tuple[int, Any]:
    return _request("GET", path)


def post(path: str, body: dict[str, Any]) -> tuple[int, Any]:
    return _request("POST", path, body)


def patch(path: str) -> tuple[int, Any]:
    return _request("PATCH", path)


# ── Build the anchor's declared inputs from the SAME committed sources the
#    verify test reads: the demo book + the fixture's column_map (or an
#    identity map when none is stored). Values are coerced to their declared
#    types via the plan's input-schema endpoint (see the docstring note on
#    the raw-string gate seam). Empty cells are dropped, exactly like
#    `projectRowsToExternalInputs`. ──────────────────────────────────────────
def _column_map() -> dict[str, str]:
    fixture = json.loads(FIXTURE.read_text())
    rows = fixture["tables"].get("plan_input_mappings", {}).get("rows") or []
    if rows:
        first = rows[0]
        raw = first["mapping_json"] if isinstance(first, dict) else first[
            fixture["tables"]["plan_input_mappings"]["columns"].index("mapping_json")
        ]
        mapping = json.loads(raw)
        # {declaredInputKey: csvColumn}; `chain.*` entries map to
        # expected-output comparison columns (not plan inputs), so drop them.
        return {k: v for k, v in mapping["column_map"].items() if not k.startswith("chain.")}
    # No stored mapping (the Meridian book's columns ARE the declared
    # input names): identity map over the non-metadata columns.
    with RAW_BOOK.open(newline="") as fh:
        header = next(csv.reader(fh))
    return {c: c for c in header if c not in _META_COLUMNS}


def _raw_rows() -> dict[str, dict[str, str]]:
    with RAW_BOOK.open(newline="") as fh:
        return {r["case_id"]: r for r in csv.DictReader(fh)}


def _input_types(plan_id: str) -> dict[str, str]:
    """Declared input name → data_type, from the plan's own schema endpoint
    (also proving that endpoint over the wire)."""
    status, schema = get(f"/api/v1/plans/{plan_id}/input-schema")
    if status != 200:
        raise Drift(f"input-schema endpoint returned HTTP {status}.", response=schema)
    return {i["name"]: i["data_type"] for i in schema.get("inputs", [])}


def _coerce(value: str, data_type: str) -> Any:
    if data_type in ("money", "number", "factor", "float", "int", "integer"):
        return float(value)
    if data_type in ("bool", "boolean"):
        return value.strip().lower() in ("true", "1", "yes")
    return value


def declared_inputs(
    row: dict[str, str],
    column_map: dict[str, str],
    types: dict[str, str],
    **overrides: str,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, column in column_map.items():
        value = row.get(column, "")
        if value is None or value == "":
            continue
        out[key] = _coerce(value, types.get(key, "string"))
    out.update(overrides)
    return out


# ── Assertion helpers ────────────────────────────────────────────────────────
def _fail(message: str, response: Any) -> None:
    raise Drift(message, response=response)


def _expect_status(label: str, status: int, want: int, body: Any) -> None:
    if status != want:
        _fail(f"{label}: expected HTTP {want}, got {status}.", body)


def check_single_risk(
    plan_id: str,
    snapshot_id: str,
    inputs: dict[str, Any],
    *,
    expected_total: int,
    expected_tier: str,
) -> None:
    """The anchor: the filing's first worked example, to the dollar, plus
    the full envelope."""
    status, q = post(f"/api/v1/plans/{plan_id}/quote", {"inputs": inputs})
    _expect_status("single-risk quote", status, 200, q)

    # Law 1 — THE premium is the composed filed number (whole dollars, exact).
    if q.get("premium") != expected_total:
        _fail(f"single-risk premium drifted: expected {expected_total}, got {q.get('premium')!r}.", q)
    composed = q.get("composed") or {}
    if composed.get("final") != expected_total:
        _fail(f"composed.final drifted: expected {expected_total}, got {composed.get('final')!r}.", q)
    if q.get("premium") != composed.get("final"):
        _fail("premium ≠ composed.final — Law 1 broken over the wire.", q)

    # ADR-0056 tri-facet: a rateable risk is an "ok" row with a verdict.
    # (The single-risk tier is the ROW verdict; the book's expected_tier
    # is the POLICY-composed appetite — asserted on the policy check.)
    if q.get("row_status") != "ok":
        _fail(f"row_status expected 'ok', got {q.get('row_status')!r}.", q)
    if not q.get("tier"):
        _fail(f"single-risk tier missing from the envelope, got {q.get('tier')!r}.", q)

    # The aggregate output field carries the same number (rounded, matching
    # the verify test's ±$ tolerance).
    outputs = q.get("outputs") or {}
    got = outputs.get("total_premium")
    if got is None or round(float(got)) != expected_total:
        _fail(f"outputs[total_premium] drifted: expected ≈{expected_total}, got {got!r}.", q)

    # Law 3 — the response names WHICH version answered (the published snapshot).
    version = q.get("version") or {}
    if version.get("kind") != "published":
        _fail(f"version.kind expected 'published', got {version.get('kind')!r}.", q)
    if version.get("snapshot_id") != snapshot_id:
        _fail(
            f"version.snapshot_id drifted: expected {snapshot_id!r}, "
            f"got {version.get('snapshot_id')!r}.",
            q,
        )
    print(f"  ✓ single-risk {ANCHOR_CASE} → ${int(q['premium']):,} (published {snapshot_id})")


def check_policy(
    plan_id: str,
    snapshot_id: str,
    location: dict[str, Any],
    *,
    per_location: int,
    expected_tier: str,
) -> None:
    """The /score-policy seam, both ways the book pins it:

    1. A 1-location policy — the exact shape behind the demo book's
       `expected_tier` (the frontend oracle asserts the same seam via
       evaluatePolicyBook) — must carry the book's appetite tier.
    2. A 2-location policy — the real roll-up (2 × anchor). Its tier is
       whatever the policy-scope gates decide for the DOUBLED totals, so
       only its money + envelope are pinned here.
    """
    status, q1 = post(f"/api/v1/plans/{plan_id}/quote", {"locations": [location]})
    _expect_status("1-location policy quote", status, 200, q1)
    if q1.get("premium") != per_location:
        _fail(f"1-location policy premium drifted: expected {per_location}, got {q1.get('premium')!r}.", q1)
    # G4 — the policy verdict is the composed appetite tier.
    if q1.get("tier") != expected_tier:
        _fail(f"policy appetite tier expected {expected_tier!r}, got {q1.get('tier')!r}.", q1)
    print(f"  ✓ policy [{ANCHOR_CASE}] → ${int(q1['premium']):,} at appetite tier '{q1['tier']}'")

    status, q = post(
        f"/api/v1/plans/{plan_id}/quote",
        {"locations": [location, location]},
    )
    _expect_status("policy quote", status, 200, q)

    expected_policy_total = 2 * per_location
    if q.get("premium") != expected_policy_total:
        _fail(
            f"policy premium drifted: expected {expected_policy_total}, "
            f"got {q.get('premium')!r}.",
            q,
        )
    composed = q.get("composed") or {}
    if composed.get("final") != expected_policy_total:
        _fail(f"policy composed.final drifted: got {composed.get('final')!r}.", q)
    if q.get("location_count") != 2:
        _fail(f"location_count expected 2, got {q.get('location_count')!r}.", q)
    locations = q.get("locations") or []
    if len(locations) != 2 or any(round(float(loc.get("premium", 0))) != per_location for loc in locations):
        _fail(f"per-location premiums drifted (expected two × {per_location}).", q)
    if (q.get("version") or {}).get("snapshot_id") != snapshot_id:
        _fail("policy version.snapshot_id drifted.", q)
    print(f"  ✓ policy [{ANCHOR_CASE} × 2] → ${int(q['premium']):,} across {q['location_count']} locations")


def check_wire_string_policy(
    plan_id: str,
    raw_location: dict[str, Any],
    *,
    per_location: int,
    expected_tier: str,
) -> None:
    """Check the same anchor risk with EVERY value left as the raw
    CSV string (the wire form integrators actually produce). The engine now
    coerces the record onto the plan's declared input ports once at the run
    seam (conformance V62), so the uncoerced form must price AND tier
    identically to the typed form. Before the fix this priced $1,898 but
    silently carried tier 'standard' ("true" ≠ true in the gate walk) —
    the same risk, two verdicts, no issue emitted (Law 2)."""
    status, q = post(f"/api/v1/plans/{plan_id}/quote", {"locations": [raw_location]})
    _expect_status("wire-string policy quote", status, 200, q)
    if q.get("premium") != per_location:
        _fail(
            f"wire-string premium drifted: expected {per_location}, got {q.get('premium')!r}.",
            q,
        )
    if q.get("tier") != expected_tier:
        _fail(
            f"wire-string appetite tier expected {expected_tier!r}, got {q.get('tier')!r} — "
            "the raw-string form of the anchor earned a different verdict than the typed "
            "form (the run-seam coercion regressed).",
            q,
        )
    print(f"  ✓ wire-string [{ANCHOR_CASE}] → ${int(q['premium']):,} at the same tier '{q['tier']}'")


def check_error_facet(plan_id: str, inputs: dict[str, Any]) -> None:
    """ADR-0056 tri-facet error arm: an unrateable risk is a NAMED refusal —
    premium withheld (never $0), row_status 'error', a structured issue. Proves
    the wire distinguishes error from a real $0 (Law 2)."""
    status, q = post(f"/api/v1/plans/{plan_id}/quote", {"inputs": inputs})
    # A refusal is a 200 with a withheld premium — NOT a 4xx (an error ≠ a bad request).
    _expect_status("error-facet quote", status, 200, q)

    if q.get("premium") is not None:
        _fail(f"unrateable risk returned a premium {q.get('premium')!r} — Law 2 broken.", q)
    if q.get("row_status") != "error":
        _fail(f"row_status expected 'error', got {q.get('row_status')!r}.", q)
    if q.get("outputs") not in ({}, None):
        _fail(f"error row leaked outputs {q.get('outputs')!r} (should be withheld).", q)
    issues = q.get("row_issues") or []
    if not any(i.get("severity") == "error" and i.get("code") == "unknown_key" for i in issues):
        _fail("error row carried no named 'unknown_key' issue.", q)
    print("  ✓ unrateable risk → named refusal (row_status 'error', premium withheld)")


def main() -> int:
    print(f"api-lab ↔ scoring contract check · {API_BASE} · plan {PLAN_ID}")
    for path in (RAW_BOOK, FIXTURE):
        if not path.exists():
            print(f"FATAL: committed fixture not found: {path}", file=sys.stderr)
            return 2

    column_map = _column_map()
    rows = _raw_rows()
    if ANCHOR_CASE not in rows:
        print(f"FATAL: {ANCHOR_CASE} not in raw book {RAW_BOOK}", file=sys.stderr)
        return 2
    anchor_row = rows[ANCHOR_CASE]
    expected_total = round(float(anchor_row["expected_total"]))
    if expected_total != ANCHOR_TOTAL:
        print(
            f"FATAL: the book's {ANCHOR_CASE} expected_total ({expected_total}) no longer "
            f"matches the pinned literal ({ANCHOR_TOTAL}) — if the program changed on "
            "purpose, re-pin ANCHOR_TOTAL alongside the fixture regeneration.",
            file=sys.stderr,
        )
        return 2
    expected_tier = anchor_row["expected_tier"].strip()
    try:
        types = _input_types(PLAN_ID)
    except Drift as drift:
        print(f"FATAL: {drift}", file=sys.stderr)
        return 2
    anchor = declared_inputs(anchor_row, column_map, types)
    # The SAME anchor with no client-side coercion at all — every value the
    # raw CSV string (types={} leaves _coerce on the string arm).
    raw_anchor = declared_inputs(anchor_row, column_map, {})
    unrateable = declared_inputs(anchor_row, column_map, types, class_code=UNRATEABLE_CLASS)

    try:
        # ── Freeze + publish the committed plan through the real API. The
        #    display_name is unique per run so the check is re-runnable against
        #    a reused DB (snapshot names are unique per plan); CI always starts
        #    from a fresh DB, so this only helps local iteration + retries. ──
        status, snap = post(
            f"/api/v1/plans/{PLAN_ID}/snapshots",
            {
                "display_name": f"contract-ci-{uuid.uuid4().hex[:8]}",
                "notes": "api-lab↔scoring seam check",
            },
        )
        _expect_status("freeze snapshot", status, 201, snap)
        snapshot_id = snap.get("snapshot_id")
        if not snapshot_id:
            _fail("freeze returned no snapshot_id.", snap)
        status, pub = patch(f"/api/v1/plans/{PLAN_ID}/snapshots/{snapshot_id}/publish")
        _expect_status("publish snapshot", status, 200, pub)
        print(f"  ✓ froze + published snapshot {snapshot_id}")

        # ── Exercise the wire in both directions of the contract. ──
        check_single_risk(
            PLAN_ID, snapshot_id, anchor,
            expected_total=expected_total, expected_tier=expected_tier,
        )
        check_policy(
            PLAN_ID, snapshot_id, anchor,
            per_location=expected_total, expected_tier=expected_tier,
        )
        check_wire_string_policy(
            PLAN_ID, raw_anchor,
            per_location=expected_total, expected_tier=expected_tier,
        )
        check_error_facet(PLAN_ID, unrateable)
    except Drift as drift:
        print("\n────────────────────────── CONTRACT DRIFT ──────────────────────────", file=sys.stderr)
        print(str(drift), file=sys.stderr)
        if drift.response is not None:
            print("\nResponse body:", file=sys.stderr)
            print(json.dumps(drift.response, indent=2, ensure_ascii=False), file=sys.stderr)
        print(
            "\nThe api-lab ↔ scoring HTTP contract broke. A field was renamed or "
            "dropped on one side of the wire (openrater/rates/runs/scoring.py ⇄ "
            "services/scoring/src/core/schema.ts), or the oracle moved. Reconcile "
            "the wire dict with the zod schema, or re-pin the oracle if the "
            "fixture changed on purpose.",
            file=sys.stderr,
        )
        return 1

    print("\nCONTRACT OK — the API Lab ↔ scoring seam prices the reference oracle to the dollar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
