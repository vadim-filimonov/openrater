# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Quote-set composer — §4.2 rule 2, the ENGINE-level gap path.

The composer's own required-field check already names gaps in peer
vocabulary (conformance IC4 step 1). These tests pin the other layer:
`quote_plan`'s preflight speaks PLAN vocabulary (`missing_inputs` /
`unknown_inputs`), and the seam must re-name every entry through the
exposed mapping (plan_input_key → peer_key) into the same `missing` /
`unknown` shape — with plan inputs the mapping never covered surfacing
under `unmapped_plan_inputs`, named rather than dropped (Law 2).

Scoring is stubbed at the `score_once` seam, same philosophy as the
conformance harness: the seam's translation is under test, not the
engine's math.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests._helpers import add_stage, create_plan

CATALOG = [
    {"key": "rest.gross_receipts", "label": "Annual gross receipts", "dtype": "number", "unit": "USD", "example": 1250000},
    {"key": "property.construction", "label": "Construction type", "dtype": "enum", "example": "JM"},
    {"key": "property.tiv", "label": "Total insured value", "dtype": "number", "unit": "USD", "example": 1500000},
]

# `property.tiv → tiv` is deliberately NOT required: the composer's own
# check passes without the fact, so the gap reaches the engine layer.
MAPPING = [
    {"peer_key": "rest.gross_receipts", "plan_input_key": "gross_receipts", "dtype": "number", "unit": "USD", "required": True},
    {"peer_key": "property.construction", "plan_input_key": "construction_class", "dtype": "enum", "required": True},
    {"peer_key": "property.tiv", "plan_input_key": "tiv", "dtype": "number", "unit": "USD", "required": False},
]


def _pair_exposed_world(client: TestClient) -> tuple[str, str]:
    """One paired integration exposing one published plan under the
    stale-ish MAPPING above; returns (integration_id, integrator_key)."""
    from openrater.integrations.models import MappingEntry
    from openrater.integrations.repo import insert_exposed_plan, stamp_test_receipt

    integration_id = client.post(
        "/api/v1/integrations", json={"name": "Quote-set unit world"}
    ).json()["integration_id"]

    plan_id = create_plan(client, display_name="Gamma-style plan")["rating_plan_id"]
    frozen = client.post(
        f"/api/v1/plans/{plan_id}/snapshots",
        json={"display_name": "v1", "notes": "unit world"},
    )
    assert frozen.status_code == 201, frozen.text
    snapshot_id = frozen.json()["snapshot_id"]
    published = client.patch(
        f"/api/v1/plans/{plan_id}/snapshots/{snapshot_id}/publish"
    )
    assert published.status_code == 200, published.text

    exposed_id = "iep_" + secrets.token_hex(6)
    insert_exposed_plan(
        db=client.app.state.db,
        exposed_id=exposed_id,
        integration_id=integration_id,
        rating_plan_id=plan_id,
        plan_ref="ipl_" + secrets.token_hex(6),
        carrier_label="cedar-assurance",
        mapping=[MappingEntry(**e) for e in MAPPING],
        trace_policy="summary",
        validity_days=30,
        live=True,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    # A live plan is, by construction, one whose PUBLISHED version passed a
    # green test — stamp that receipt against the published snapshot so the
    # serving gate (drift demotion, audit gap #3) sees the live version as
    # the tested one. Without it these helpers model live-without-a-current-
    # test, the exact state the new gate demotes.
    stamp_test_receipt(
        db=client.app.state.db,
        integration_id=integration_id,
        exposed_id=exposed_id,
        when=datetime.now(timezone.utc).isoformat(),
        premium_cents=473100,
        snapshot_id=snapshot_id,
    )

    code = client.post(f"/api/v1/integrations/{integration_id}/pairing-codes").json()["code"]
    paired = client.post(
        "/api/v1/integrations/pair",
        json={"code": code, "peer_name": "unit peer", "catalog": CATALOG},
    )
    assert paired.status_code == 200, paired.text
    return integration_id, paired.json()["integrator_key"]


def _stub_score_once(
    input_issues: dict[str, Any],
    leaked_premium: float | None = None,
    leaked_outputs: dict[str, Any] | None = None,
):
    """An engine that refuses with the given PLAN-vocabulary preflight
    (G8: row errored). `leaked_premium` mirrors the real engine's wart —
    a partial chain total riding `views.premium` on an errored
    multi-chain row (observed live 2026-07-09) — which the seam clamps.
    `leaked_outputs` mirrors the SECOND vector: a partial chain that
    resolves leaves a REAL sibling number in `outputs` on the same
    errored row (observed live 2026-07-10) — the engine keeps it for the
    author's diagnosis, and the seam withholds it from the peer."""

    def fake(*, request: dict[str, Any], base_url: str | None = None) -> dict[str, Any]:
        return {
            "outputs": leaked_outputs or {},
            "views": {"premium": leaked_premium, "perCoverage": {}, "tier": None},
            "durationMs": 2,
            "row_status": "error",
            "inputIssues": input_issues,
        }

    return fake


def _stub_score_once_ok(outputs: dict[str, Any], premium: float, tier: str | None = None):
    """A green engine — an OK row carries its per-chain `outputs` breakdown
    as the answer. Pins that the seam's error-row clamp is CONDITIONAL: it
    withholds partials on refusal without wiping the breakdown on success."""

    def fake(*, request: dict[str, Any], base_url: str | None = None) -> dict[str, Any]:
        return {
            "outputs": outputs,
            "views": {"premium": premium, "perCoverage": {}, "tier": tier},
            "durationMs": 3,
            "row_status": "ok",
            "composed": {"subtotal": premium, "final": premium, "adjustments": []},
        }

    return fake


def _quote_set(client: TestClient, integration_id: str, key: str) -> Any:
    response = client.post(
        f"/api/v1/integrations/{integration_id}/quote-set",
        headers={"X-OpenRater-Integration-Key": key},
        json={
            "risk_ref": "r-unit-0001",
            "effective_date": "2026-08-01",
            "trace": "none",
            "facts": {
                "rest.gross_receipts": 1250000,
                "property.construction": "JM",
            },
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_engine_input_issues_renamed_into_peer_vocabulary(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """missing_inputs/unknown_inputs (plan keys) → missing/unknown (peer
    keys); the never-mapped plan input is named under unmapped_plan_inputs;
    the engine's leaked partial premium is clamped to null on the way."""
    integration_id, key = _pair_exposed_world(client)
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        _stub_score_once(
            {
                "missing_inputs": ["tiv", "liab_exposure_base"],
                "unknown_inputs": ["construction_class"],
            },
            leaked_premium=1250000.0,
        ),
    )

    body = _quote_set(client, integration_id, key)
    (member,) = body["quotes"]
    assert member["row_status"] == "error"
    assert member["premium"] is None  # Law 2 — the leaked number is clamped
    assert member["input_issues"] == {
        "missing": ["property.tiv"],
        "unknown": ["property.construction"],
        "unmapped_plan_inputs": ["liab_exposure_base"],
    }


def test_engine_input_issues_fully_mapped_omits_unmapped_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When every gap translates, the member carries ONLY peer keys —
    no empty lists, no unmapped_plan_inputs, no plan vocabulary."""
    integration_id, key = _pair_exposed_world(client)
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        _stub_score_once({"missing_inputs": ["tiv"], "unknown_inputs": []}),
    )

    body = _quote_set(client, integration_id, key)
    (member,) = body["quotes"]
    assert member["input_issues"] == {"missing": ["property.tiv"]}


def test_error_row_withholds_sibling_chain_outputs(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The reported leak (Brief 77 §8.5 erratum; PR #393; observed live
    2026-07-10). A partial-chain refusal — liability resolves, property
    fails — leaves a REAL sibling number in the engine's `outputs`, kept
    for the author's own diagnosis (deriveViews, deliberately). The seam is
    the pseudonymous boundary: that number never rides the wire to a peer.
    `outputs` is withheld on an error row exactly as `premium` is (Law 2 /
    ADR-0056 — a refusal never carries a number)."""
    integration_id, key = _pair_exposed_world(client)
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        _stub_score_once(
            {"missing_inputs": ["tiv"], "unknown_inputs": []},
            leaked_premium=1250000.0,
            leaked_outputs={"liability_premium": 20396},
        ),
    )

    body = _quote_set(client, integration_id, key)
    (member,) = body["quotes"]
    assert member["row_status"] == "error"
    assert member["premium"] is None  # the withheld total
    # The resolved sibling chain does NOT ride the wire — no number, of
    # any name, on a refusal. (Diagnosis for a trusted peer rides `trace`.)
    assert member["outputs"] == {}
    assert 20396 not in member["outputs"].values()


def test_ok_row_passes_outputs_through(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The clamp is CONDITIONAL, not a blanket wipe: a green row carries its
    per-chain `outputs` breakdown as the answer (Law 1). Guards against a
    'just always return {}' regression of the error-row fix above."""
    integration_id, key = _pair_exposed_world(client)
    breakdown = {"liability_premium": 20396, "property_premium": 4180, "total_premium": 24576}
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        _stub_score_once_ok(breakdown, premium=24576.0, tier="standard"),
    )

    body = _quote_set(client, integration_id, key)
    (member,) = body["quotes"]
    assert member["row_status"] == "ok"
    assert member["premium"] == 24576.0
    assert member["outputs"] == breakdown


# ---------------------------------------------------------------------------
# Scoring availability — §4.2 rule 3, "each member stands alone" (audit item 4)
# ---------------------------------------------------------------------------

# A marker stage a scoring stub treats as "this plan's backend is unreachable".
SCORING_DOWN_STAGE = "scoring_down_probe"


def _stub_score_once_unavailable():
    """A scoring seam that is unreachable for every plan (deploy rolling,
    network blip) — it raises the 503-mapped ScoringUnavailableError."""
    from openrater.rates.scoring_client import ScoringUnavailableError

    def fake(*, request: dict[str, Any], base_url: str | None = None) -> dict[str, Any]:
        raise ScoringUnavailableError("The scoring service is unreachable.")

    return fake


def _stub_score_once_down_for(marker: str, ok_premium: float = 4731.0):
    """Unreachable for any plan whose body carries `marker`; green otherwise —
    lets one member fail scoring while a sibling quotes."""
    from openrater.rates.scoring_client import ScoringUnavailableError

    def fake(*, request: dict[str, Any], base_url: str | None = None) -> dict[str, Any]:
        if marker in json.dumps(request):
            raise ScoringUnavailableError("The scoring service is unreachable.")
        return {
            "outputs": {"total_premium": ok_premium},
            "views": {"premium": ok_premium, "perCoverage": {}, "tier": "standard"},
            "durationMs": 3,
            "row_status": "ok",
            "composed": {"subtotal": ok_premium, "final": ok_premium, "adjustments": []},
        }

    return fake


def _expose_published_plan(
    client: TestClient, integration_id: str, *, carrier: str, marker_stage: str | None
) -> None:
    from openrater.integrations.models import MappingEntry
    from openrater.integrations.repo import insert_exposed_plan, stamp_test_receipt

    plan_id = create_plan(client, display_name=f"{carrier} plan")["rating_plan_id"]
    if marker_stage:
        add_stage(client, plan_id, stage_id=marker_stage, display_name="scoring down probe")
    frozen = client.post(
        f"/api/v1/plans/{plan_id}/snapshots",
        json={"display_name": "v1", "notes": "sibling world"},
    )
    assert frozen.status_code == 201, frozen.text
    snapshot_id = frozen.json()["snapshot_id"]
    published = client.patch(
        f"/api/v1/plans/{plan_id}/snapshots/{snapshot_id}/publish"
    )
    assert published.status_code == 200, published.text
    exposed_id = "iep_" + secrets.token_hex(6)
    insert_exposed_plan(
        db=client.app.state.db,
        exposed_id=exposed_id,
        integration_id=integration_id,
        rating_plan_id=plan_id,
        plan_ref="ipl_" + secrets.token_hex(6),
        carrier_label=carrier,
        mapping=[MappingEntry(**e) for e in MAPPING],
        trace_policy="summary",
        validity_days=30,
        live=True,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    # Live ⇒ its published version passed a green test — stamp the receipt so
    # the drift gate (audit gap #3) doesn't demote it from the serving scope.
    stamp_test_receipt(
        db=client.app.state.db,
        integration_id=integration_id,
        exposed_id=exposed_id,
        when=datetime.now(timezone.utc).isoformat(),
        premium_cents=473100,
        snapshot_id=snapshot_id,
    )


def _pair_two_plan_world(client: TestClient) -> tuple[str, str]:
    """Two published plans under two carrier labels — 'birch-specialty' carries
    the scoring-down marker, 'acme-mutual' quotes green. Returns
    (integration_id, integrator_key)."""
    integration_id = client.post(
        "/api/v1/integrations", json={"name": "Sibling world"}
    ).json()["integration_id"]
    _expose_published_plan(client, integration_id, carrier="acme-mutual", marker_stage=None)
    _expose_published_plan(
        client, integration_id, carrier="birch-specialty", marker_stage=SCORING_DOWN_STAGE
    )
    code = client.post(
        f"/api/v1/integrations/{integration_id}/pairing-codes"
    ).json()["code"]
    paired = client.post(
        "/api/v1/integrations/pair",
        json={"code": code, "peer_name": "sibling peer", "catalog": CATALOG},
    )
    assert paired.status_code == 200, paired.text
    return integration_id, paired.json()["integrator_key"]


def test_scoring_unavailable_is_member_error_not_whole_set_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A scoring outage becomes a NAMED per-member error row, not a 503 that
    sinks the whole quote-set. `_quote_set` asserts the 200 — the guard
    against the old propagate-and-503 behavior."""
    integration_id, key = _pair_exposed_world(client)
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once", _stub_score_once_unavailable()
    )

    body = _quote_set(client, integration_id, key)  # asserts status 200
    (member,) = body["quotes"]
    assert member["row_status"] == "error"
    assert member["premium"] is None  # Law 2 — a refusal carries no number
    assert member["outputs"] == {}  # …and no sibling outputs
    assert any(i["code"] == "scoring_unavailable" for i in member["row_issues"]), (
        member["row_issues"]
    )


def test_scoring_unavailable_one_member_does_not_sink_siblings(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Each member stands alone (§4.2 rule 3): one plan's backend being
    unreachable errors THAT row while a sibling with a reachable backend still
    returns a real premium."""
    integration_id, key = _pair_two_plan_world(client)
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        _stub_score_once_down_for(SCORING_DOWN_STAGE, ok_premium=4731.0),
    )

    body = _quote_set(client, integration_id, key)  # asserts status 200
    by_carrier = {m["carrier"]: m for m in body["quotes"]}
    assert set(by_carrier) == {"acme-mutual", "birch-specialty"}

    # The healthy sibling quotes for real…
    healthy = by_carrier["acme-mutual"]
    assert healthy["row_status"] == "ok"
    assert healthy["premium"] == 4731.0

    # …while the scoring-down member is a named error row, not a dropped quote.
    down = by_carrier["birch-specialty"]
    assert down["row_status"] == "error"
    assert down["premium"] is None
    assert any(i["code"] == "scoring_unavailable" for i in down["row_issues"]), (
        down["row_issues"]
    )


def _republish(client: TestClient, integration_id: str) -> str:
    """Freeze + publish a NEW snapshot on the paired world's plan WITHOUT
    re-testing — the republish drift of audit gap #3. Returns exposed_id."""
    plans = client.get(f"/api/v1/integrations/{integration_id}/plans").json()
    plan_id = plans[0]["rating_plan_id"]
    frozen = client.post(
        f"/api/v1/plans/{plan_id}/snapshots",
        json={"display_name": "v2", "notes": "republish, untested"},
    )
    assert frozen.status_code == 201, frozen.text
    new_snap = frozen.json()["snapshot_id"]
    published = client.patch(f"/api/v1/plans/{plan_id}/snapshots/{new_snap}/publish")
    assert published.status_code == 200, published.text
    return plans[0]["exposed_id"]


def test_republish_drift_demotes_live_plan(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Audit gap #3: republishing a new snapshot to a live plan whose mapping
    was never re-tested DEMOTES it — no member, a named `live_version_untested`
    integration issue (fan-out AND explicit-carrier), and the descriptor status
    flips to `paused`. Never a silently mispriced quote."""
    integration_id, key = _pair_exposed_world(client)
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        _stub_score_once_ok({"total_premium": 4731}, premium=4731.0, tier="standard"),
    )
    assert len(_quote_set(client, integration_id, key)["quotes"]) == 1  # baseline serves

    _republish(client, integration_id)

    # Fan-out (carriers: null) — demoted, named.
    fanout = _quote_set(client, integration_id, key)
    assert fanout["quotes"] == []
    assert {"code": "live_version_untested", "carrier": "cedar-assurance"} in fanout["issues"]

    # Explicit carrier — same demotion through the other branch.
    explicit = client.post(
        f"/api/v1/integrations/{integration_id}/quote-set",
        headers={"X-OpenRater-Integration-Key": key},
        json={
            "risk_ref": "r-unit-0002",
            "effective_date": "2026-08-01",
            "trace": "none",
            "carriers": ["cedar-assurance"],
            "facts": {"rest.gross_receipts": 1250000, "property.construction": "JM"},
        },
    ).json()
    assert explicit["quotes"] == []
    assert {"code": "live_version_untested", "carrier": "cedar-assurance"} in explicit["issues"]

    # The descriptor tells the integrator the same story (paused, §4.4).
    descriptor = client.get(
        f"/api/v1/integrations/{integration_id}/descriptor",
        headers={"X-OpenRater-Integration-Key": key},
    ).json()
    assert descriptor["plans"][0]["status"] == "paused"

    # And the Hub read model flags the drift for the operator.
    row = client.get(f"/api/v1/integrations/{integration_id}/plans").json()[0]
    assert row["live"] is True and row["live_version_untested"] is True
    assert row["status"] == "live"  # toggle still on; serving is what paused


def test_retest_restores_serving_after_drift(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Not a one-way trap: re-running the Test step against the new version
    re-stamps the receipt, the drift clears, and the plan serves again."""
    integration_id, key = _pair_exposed_world(client)
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        _stub_score_once_ok({"total_premium": 4731}, premium=4731.0, tier="standard"),
    )
    exposed_id = _republish(client, integration_id)
    assert _quote_set(client, integration_id, key)["quotes"] == []  # demoted

    retest = client.post(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}/test-quote",
        json={"facts": {"rest.gross_receipts": 1250000, "property.construction": "JM"}},
    )
    assert retest.status_code == 200 and retest.json()["row_status"] == "ok"

    restored = _quote_set(client, integration_id, key)
    assert [m["carrier"] for m in restored["quotes"]] == ["cedar-assurance"]
    assert restored["quotes"][0]["row_status"] == "ok"
    assert not any(i["code"] == "live_version_untested" for i in restored["issues"])
