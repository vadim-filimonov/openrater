# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""The OpenRater-side conformance harness for the integration contract
(ADR-0057; `docs/specs/conformance/integration/`).

Loads the portable IC*.json fixtures and replays their steps against the
live routes via TestClient, honoring the README's format: world
provisioning → pre-captured bindings → per-step calls → partial-match
expectations with the five-matcher vocabulary.

L1 runs IC1 + IC2. IC3–IC6 + IC9/IC10 unskip with the quote-set composer
(L2); IC7/IC8/IC12 exercise the market-events LEDGER (L3 — ledger-only
since the Exhibits re-founding removed the book of record; the IC13–IC17
book-projection vectors were retired with it). The skips are declared
per-fixture below so un-skipping is a one-line diff per slice.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests._helpers import add_stage, create_plan

FIXTURES_DIR = (
    Path(__file__).resolve().parents[2] / "docs" / "specs" / "conformance" / "integration"
)

# Which fixtures the CURRENT slice runs. Everything else is a named skip —
# the suite stays green and honest about what's built.
RUNNABLE = {
    "IC1",
    "IC2",
    "IC3",
    "IC4",
    "IC5",
    "IC6",
    "IC7",
    "IC8",
    "IC9",
    "IC10",
    "IC11",
    "IC12",
    "IC18",
}
SKIP_REASON: dict[str, str] = {}

# Scoring is stubbed at the `score_once` seam — the SAME philosophy as the
# Brief-76 quote tests: conformance pins the SEAM's orchestration (mapping,
# version pins, clamping, ordering, honest refusals); the engine's math is
# the engine conformance suite's job. plan-beta's eligibility rule is a
# marker stage the stub honors: tiv > 2,000,000 on a plan carrying
# `tiv_cap_eligibility` refuses with a named reason. plan-gamma (IC4's
# stale-mapping world) carries `stale_mapping_probe`: the stub replays the
# engine's G5 preflight over the plan's declared inputs, naming gaps in
# PLAN vocabulary so the composer's re-naming into peer vocabulary is what
# the fixture pins.
BETA_ELIGIBILITY_STAGE = "tiv_cap_eligibility"
GAMMA_STALE_MAPPING_STAGE = "stale_mapping_probe"
# IC18's version-discriminator: the fixture adds this stage to the DRAFT
# before freezing v2, so v1's body and v2's body price differently and a
# pin to v1 is observably the v1 computation (ADR-0060 rule 8).
PINNED_RERATE_STAGE = "pinned_rerate_probe"

# plan-gamma's declared input dictionary (what the published plan actually
# consumes). Held against GAMMA_MAPPING below, the mapping is stale in all
# three directions: `tiv` mapped optional though the plan requires it,
# `construction_class` still mapped though the plan dropped it, and
# `liab_exposure_base` required by the plan but never mapped.
GAMMA_CONSUMED_INPUTS = {"gross_receipts", "tiv", "liab_exposure_base"}

OK_RESULT: dict[str, Any] = {
    "outputs": {"total_premium": 4731},
    "views": {"premium": 4731, "perCoverage": {}, "tier": "standard"},
    "durationMs": 3,
    "row_status": "ok",
    "composed": {"subtotal": 5085, "final": 4731, "adjustments": []},
}

# IC18's v2 answer — a distinct number so "which version priced this?" is
# observable, not assumed. (The v1 answer is OK_RESULT's 4731.)
V2_RESULT: dict[str, Any] = {
    "outputs": {"total_premium": 9999},
    "views": {"premium": 9999, "perCoverage": {}, "tier": "standard"},
    "durationMs": 3,
    "row_status": "ok",
    "composed": {"subtotal": 9999, "final": 9999, "adjustments": []},
}

# Faithful including the wart (observed live 2026-07-09): the REAL engine
# holds resolved per-chain partials in `outputs` on an errored multi-chain
# row (here a leftover `liability_premium`), so the stub leaks one too.
# IC5's `outputs: {$empty: true}` pins the SEAM's clamp (ADR-0056/Law 2:
# a refusal crosses the wire carrying no numbers), not stub politeness.
REFUSAL_RESULT: dict[str, Any] = {
    "outputs": {"liability_premium": 20396},
    "views": {"premium": None, "perCoverage": {}, "tier": None},
    "durationMs": 2,
    "row_status": "error",
    "rowIssues": [
        {
            "code": "eligibility_refused",
            "detail": "TIV above the program maximum ($2,000,000).",
            "severity": "error",
        }
    ],
}


def _gamma_preflight(inputs: dict[str, Any]) -> dict[str, Any] | None:
    """A faithful replica of the engine's G5 preflight over plan-gamma's
    declared inputs — gaps named in PLAN vocabulary (`missing_inputs` /
    `unknown_inputs`), row refused (G8). Faithful including the wart:
    the REAL engine leaks a partial chain total in `views.premium` AND a
    resolved sibling output in `outputs` on an errored multi-chain row
    (observed live 2026-07-09), so the stub leaks both — IC4's
    `premium: null` + `outputs: {$empty: true}` expectations pin the
    SEAM's clamp, not stub politeness."""
    missing = sorted(k for k in GAMMA_CONSUMED_INPUTS if inputs.get(k) is None)
    unknown = sorted(k for k in inputs if k not in GAMMA_CONSUMED_INPUTS)
    if not missing and not unknown:
        return None
    partial = inputs.get("gross_receipts")
    return {
        "outputs": {"gr_premium": partial} if partial is not None else {"gr_premium": 1},
        "views": {"premium": partial, "perCoverage": {}, "tier": None},
        "durationMs": 2,
        "row_status": "error",
        "inputIssues": {"missing_inputs": missing, "unknown_inputs": unknown},
    }


def _fake_score_once(*, request: dict[str, Any], base_url: str | None = None) -> dict[str, Any]:
    blob = json.dumps(request)
    inputs = request.get("inputs") or {}
    as_of = (request.get("options") or {}).get("as_of")
    result: dict[str, Any] | None = None
    if GAMMA_STALE_MAPPING_STAGE in blob:
        result = _gamma_preflight(inputs)
    if result is None and PINNED_RERATE_STAGE in blob:
        # IC18 — the v2 body carries the probe stage, so the two VERSIONS
        # price differently: whichever body reaches the engine decides the
        # premium. A pin to v1 must produce the v1 number.
        result = dict(V2_RESULT)
    if result is None:
        refusing = BETA_ELIGIBILITY_STAGE in blob and (inputs.get("tiv") or 0) > 2_000_000
        result = dict(REFUSAL_RESULT if refusing else OK_RESULT)
    if as_of:
        result["as_of"] = as_of
    if request.get("trace") in ("summary", "full"):
        result["trace"] = {"steps": [{"nodeId": "class_lookup", "factor": 1.0}]}
    return result

_REF = re.compile(r"\{\{(\w+)\}\}")

# ── the matcher vocabulary (README §Matchers) ───────────────────────────────


def _is_matcher(node: Any) -> bool:
    return isinstance(node, dict) and any(k.startswith("$") for k in node)


def _match(expected: Any, actual: Any, bindings: dict[str, Any], path: str) -> list[str]:
    """Partial-match `expected` against `actual`; return mismatch strings."""
    if _is_matcher(expected):
        return _match_matcher(expected, actual, bindings, path)
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f"{path}: expected object, got {type(actual).__name__}"]
        errs: list[str] = []
        for k, v in expected.items():
            if k not in actual:
                # `$empty` means empty-OR-absent, so an absent key satisfies
                # it — otherwise a missing field is a mismatch.
                if _is_matcher(v) and v.get("$empty") is True:
                    continue
                errs.append(f"{path}.{k}: missing")
            else:
                errs.extend(_match(v, actual[k], bindings, f"{path}.{k}"))
        return errs
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return [f"{path}: expected array, got {type(actual).__name__}"]
        if len(actual) < len(expected):
            return [f"{path}: expected ≥{len(expected)} items, got {len(actual)}"]
        errs = []
        for i, item in enumerate(expected):  # by position (README)
            errs.extend(_match(item, actual[i], bindings, f"{path}[{i}]"))
        return errs
    if expected != actual:
        return [f"{path}: expected {expected!r}, got {actual!r}"]
    return []


def _match_matcher(
    m: dict[str, Any], actual: Any, bindings: dict[str, Any], path: str
) -> list[str]:
    if "$present" in m:
        return [] if actual is not None else [f"{path}: expected present, got null"]
    if "$type" in m:
        want = m["$type"]
        ok = {
            "string": isinstance(actual, str),
            "number": isinstance(actual, (int, float)) and not isinstance(actual, bool),
            "object": isinstance(actual, dict),
            "array": isinstance(actual, list),
            "null": actual is None,
        }.get(want, False)
        return [] if ok else [f"{path}: expected type {want}, got {actual!r}"]
    if "$same" in m:
        want = bindings.get(m["$same"])
        return (
            []
            if actual == want
            else [f"{path}: expected captured {m['$same']!r} == {want!r}, got {actual!r}"]
        )
    if "$oneOf" in m:
        return [] if actual in m["$oneOf"] else [f"{path}: {actual!r} not in {m['$oneOf']!r}"]
    if "$contains" in m:
        errs: list[str] = []
        for needle in m["$contains"]:
            if isinstance(actual, str):
                if not (isinstance(needle, str) and needle in actual):
                    errs.append(f"{path}: {needle!r} not a substring")
            elif isinstance(actual, list):
                if isinstance(needle, (dict, list)):
                    # An element matching the needle as a partial pattern.
                    if not any(
                        not _match(needle, el, bindings, path) for el in actual
                    ):
                        errs.append(f"{path}: no element matches {needle!r}")
                elif needle not in actual:
                    errs.append(f"{path}: {needle!r} not in array")
            else:
                errs.append(f"{path}: $contains needs string/array, got {actual!r}")
        return errs
    if "$empty" in m:
        # Empty == null, or a zero-length object/array/string. A number or
        # bool is never "empty" (0 and false are values, not absence). An
        # absent key is handled one level up in `_match`. Numbers/bools/etc
        # never satisfy `$empty: true`.
        is_empty = actual is None or (
            isinstance(actual, (dict, list, str)) and len(actual) == 0
        )
        if m["$empty"]:
            return [] if is_empty else [f"{path}: expected empty/absent, got {actual!r}"]
        return [] if not is_empty else [f"{path}: expected non-empty, got {actual!r}"]
    return [f"{path}: unknown matcher {sorted(m)!r}"]


# ── binding substitution + capture ──────────────────────────────────────────


def _substitute(node: Any, bindings: dict[str, Any]) -> Any:
    if isinstance(node, str):
        full = _REF.fullmatch(node)
        if full:  # a lone {{ref}} keeps the bound value's type
            return bindings[full.group(1)]
        return _REF.sub(lambda mo: str(bindings[mo.group(1)]), node)
    if isinstance(node, dict):
        return {k: _substitute(v, bindings) for k, v in node.items()}
    if isinstance(node, list):
        return [_substitute(v, bindings) for v in node]
    return node


def _capture(spec: str, body: Any) -> Any:
    """A deliberately small JSONPath subset: $.a.b[0].c"""
    node = body
    for part in re.findall(r"\.(\w+)|\[(\d+)\]", spec):
        key, idx = part
        node = node[key] if key else node[int(idx)]
    return node


# ── world provisioning (README §The world block) ────────────────────────────

W1_CATALOG = [
    {"key": "rest.gross_receipts", "label": "Annual gross receipts", "dtype": "number", "unit": "USD", "example": 1250000},
    {"key": "property.construction", "label": "Construction type", "dtype": "enum", "example": "JM"},
    {"key": "property.tiv", "label": "Total insured value", "dtype": "number", "unit": "USD", "example": 1500000},
]

W1_MAPPING = [
    {"peer_key": "rest.gross_receipts", "plan_input_key": "gross_receipts", "dtype": "number", "unit": "USD", "required": True},
    {"peer_key": "property.construction", "plan_input_key": "construction_class", "dtype": "enum", "required": True},
    {"peer_key": "property.tiv", "plan_input_key": "tiv", "dtype": "number", "unit": "USD", "required": True},
]

# plan-gamma's STALE mapping (see GAMMA_CONSUMED_INPUTS): `tiv` optional
# here so the composer's own required-check passes and the gap reaches
# the ENGINE's preflight — the layer IC4's second step pins.
GAMMA_MAPPING = [
    {"peer_key": "rest.gross_receipts", "plan_input_key": "gross_receipts", "dtype": "number", "unit": "USD", "required": True},
    {"peer_key": "property.construction", "plan_input_key": "construction_class", "dtype": "enum", "required": True},
    {"peer_key": "property.tiv", "plan_input_key": "tiv", "dtype": "number", "unit": "USD", "required": False},
]


def _provision_world(client: TestClient, world: dict[str, Any]) -> dict[str, Any]:
    """Provision the fixture's world natively + return the pre-captured
    bindings the README promises."""
    from openrater.integrations.models import MappingEntry
    from openrater.integrations.repo import insert_exposed_plan, stamp_test_receipt

    bindings: dict[str, Any] = {}

    created = client.post(
        "/api/v1/integrations",
        json={"name": world.get("integration", {}).get("name", "fixture")},
    )
    assert created.status_code == 201, created.text
    integration_id = created.json()["integration_id"]
    bindings["integration_id"] = integration_id

    plan_specs = {
        "plan-alpha": {"jurisdiction": "WA", "carrier": "acme-mutual", "mapping": W1_MAPPING},
        "plan-beta": {"jurisdiction": "KS", "carrier": "birch-specialty", "mapping": W1_MAPPING},
        "plan-gamma": {"jurisdiction": "OR", "carrier": "cedar-assurance", "mapping": GAMMA_MAPPING},
    }
    db = client.app.state.db
    import secrets as _secrets
    from datetime import datetime, timezone

    for alias in world.get("plans", []):
        spec = plan_specs[alias]
        plan = create_plan(
            client,
            display_name=f"Fixture {alias}",
            line_of_business="bop",
            jurisdiction=spec["jurisdiction"],
        )
        plan_id = plan["rating_plan_id"]
        # plan-beta carries the eligibility rule the world declares
        # (refuses tiv > 2,000,000) as a marker stage the scoring stub
        # honors; plan-gamma carries the stale-mapping preflight marker.
        if alias == "plan-beta":
            add_stage(
                client,
                plan_id,
                stage_id=BETA_ELIGIBILITY_STAGE,
                display_name="TIV cap eligibility",
            )
        if alias == "plan-gamma":
            add_stage(
                client,
                plan_id,
                stage_id=GAMMA_STALE_MAPPING_STAGE,
                display_name="Stale-mapping preflight probe",
            )
        # Freeze + publish — quoting resolves the published version (D-B),
        # and IC10's pins ride the snapshot id + body hash.
        frozen = client.post(
            f"/api/v1/plans/{plan_id}/snapshots",
            json={"display_name": "v1", "notes": "fixture world"},
        )
        assert frozen.status_code == 201, frozen.text
        snapshot_id = frozen.json()["snapshot_id"]
        published = client.patch(f"/api/v1/plans/{plan_id}/snapshots/{snapshot_id}/publish")
        assert published.status_code == 200, published.text
        plan_ref = "ipl_" + _secrets.token_hex(6)
        exposed_id = "iep_" + _secrets.token_hex(6)
        insert_exposed_plan(
            db=db,
            exposed_id=exposed_id,
            integration_id=integration_id,
            rating_plan_id=plan_id,
            plan_ref=plan_ref,
            carrier_label=spec["carrier"],
            mapping=[MappingEntry(**e) for e in spec["mapping"]],
            trace_policy="summary",
            validity_days=30,
            live=True,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        # A live plan's invariant is "its PUBLISHED version passed a green
        # test" — stamp the receipt on the published snapshot so the serving
        # gate (drift demotion, audit gap #3) sees the live version as tested.
        # Absent this, the world models live-without-a-current-test, which the
        # new gate correctly demotes — and IC3–IC10 would lose every member.
        stamp_test_receipt(
            db=db,
            integration_id=integration_id,
            exposed_id=exposed_id,
            when=datetime.now(timezone.utc).isoformat(),
            premium_cents=473100,
            snapshot_id=snapshot_id,
        )
        key = alias.replace("-", "_")
        bindings[f"{key}_id"] = plan_id
        bindings[f"{key}_ref"] = plan_ref
        bindings[f"{key}_snapshot"] = snapshot_id

    if world.get("integration", {}).get("paired"):
        code = client.post(
            f"/api/v1/integrations/{integration_id}/pairing-codes"
        ).json()["code"]
        paired = client.post(
            "/api/v1/integrations/pair",
            json={"code": code, "peer_name": "openrater-front (fixture)", "catalog": W1_CATALOG},
        )
        assert paired.status_code == 200, paired.text
        bindings["integrator_key"] = paired.json()["integrator_key"]

    return bindings


def _fixture_files() -> list[Path]:
    files = sorted(
        FIXTURES_DIR.glob("IC*.json"),
        key=lambda p: int(re.match(r"IC(\d+)", p.name).group(1)),
    )
    assert files, f"no fixtures at {FIXTURES_DIR}"
    return files


@pytest.mark.parametrize("path", _fixture_files(), ids=lambda p: p.stem)
def test_integration_conformance(
    client: TestClient, path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = json.loads(path.read_text())
    fid = fixture["id"]
    if fid not in RUNNABLE:
        pytest.skip(SKIP_REASON.get(fid, "not runnable in this slice"))

    # One seam, both paths: the composer's quote_plan AND IC3's direct
    # Brief-76 call hit the same stub, so parity pins the orchestration.
    monkeypatch.setattr("openrater.rates.quotes.service.score_once", _fake_score_once)

    bindings = _provision_world(client, fixture["world"])

    for i, step in enumerate(fixture["steps"]):
        call = _substitute(step["call"], bindings)
        response = client.request(
            call["method"],
            call["path"],
            headers=call.get("headers"),
            json=call.get("body"),
        )
        expect = step["expect"]
        assert response.status_code == expect["status"], (
            f"{fid} step[{i}] ({step.get('note', '')}): "
            f"expected {expect['status']}, got {response.status_code}: {response.text}"
        )
        body = response.json() if response.content else None
        mismatches = _match(expect.get("body", {}), body, bindings, "body")
        assert not mismatches, (
            f"{fid} step[{i}] ({step.get('note', '')}):\n  " + "\n  ".join(mismatches)
        )
        for name, spec in step.get("capture", {}).items():
            bindings[name] = _capture(spec, body)


# ── the matcher's own semantics (unit-level, no world) ──────────────────────


def test_empty_matcher_semantics() -> None:
    """`$empty` is the Law-2 pin: null / {} / [] / "" / absent all count as
    empty; numbers and bools never do; `$empty: false` is the inverse."""
    B: dict[str, Any] = {}
    # $empty: true accepts every flavor of empty…
    for value in (None, {}, [], ""):
        assert _match({"$empty": True}, value, B, "p") == []
    # …and an absent key (handled one level up, in the object branch).
    assert _match({"outputs": {"$empty": True}}, {}, B, "p") == []
    # A number or bool is a value, not absence — it must NOT read as empty.
    assert _match({"$empty": True}, 0, B, "p")
    assert _match({"$empty": True}, False, B, "p")
    assert _match({"$empty": True}, {"liability_premium": 20396}, B, "p")
    # $empty: false is the inverse — present and non-empty.
    assert _match({"$empty": False}, {"total_premium": 4731}, B, "p") == []
    assert _match({"$empty": False}, {}, B, "p")
    assert _match({"$empty": False}, None, B, "p")
