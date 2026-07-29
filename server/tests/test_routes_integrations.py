# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Integration-seam route tests (ADR-0057 L1) — the behaviors IC1/IC2
don't reach: the catalog identity guard, regenerate-invalidates, and
re-pair key rotation."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _create(client: TestClient) -> str:
    r = client.post("/api/v1/integrations", json={"name": "OpenRater Front — test"})
    assert r.status_code == 201, r.text
    return r.json()["integration_id"]


def _code(client: TestClient, integration_id: str) -> str:
    r = client.post(f"/api/v1/integrations/{integration_id}/pairing-codes")
    assert r.status_code == 201, r.text
    return r.json()["code"]


def _pair(client: TestClient, code: str, catalog: list | None = None):
    return client.post(
        "/api/v1/integrations/pair",
        json={"code": code, "peer_name": "test-peer", "catalog": catalog or []},
    )


def test_catalog_identity_keys_rejected_at_pairing(client: TestClient) -> None:
    """Contract §7: the deny-classes run at the catalog boundary too, so
    the Hub's mapper can never even list an identity field."""
    integration_id = _create(client)
    code = _code(client, integration_id)
    r = _pair(
        client,
        code,
        catalog=[
            {"key": "rest.gross_receipts", "dtype": "number"},
            {"key": "identity.legal_name"},
            {"key": "contact.owner_email"},
        ],
    )
    assert r.status_code == 422, r.text
    err = r.json()["error"]
    assert err["code"] == "identity_keys_rejected"
    assert set(err["details"]["keys"]) == {"identity.legal_name", "contact.owner_email"}
    # The rejected exchange consumed nothing: the code stays open and a
    # clean catalog exchanges fine afterwards.
    r2 = _pair(client, code, catalog=[{"key": "rest.gross_receipts"}])
    assert r2.status_code == 200, r2.text


def test_regenerate_invalidates_prior_code(client: TestClient) -> None:
    integration_id = _create(client)
    first = _code(client, integration_id)
    _ = _code(client, integration_id)  # regenerating revokes `first`
    r = _pair(client, first)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "pairing_code_invalid"


def test_repair_rotates_integrator_key(client: TestClient) -> None:
    integration_id = _create(client)
    first_key = _pair(client, _code(client, integration_id)).json()["integrator_key"]
    ok = client.get(
        f"/api/v1/integrations/{integration_id}/descriptor",
        headers={"X-OpenRater-Integration-Key": first_key},
    )
    assert ok.status_code == 200, ok.text

    second_key = _pair(client, _code(client, integration_id)).json()["integrator_key"]
    stale = client.get(
        f"/api/v1/integrations/{integration_id}/descriptor",
        headers={"X-OpenRater-Integration-Key": first_key},
    )
    assert stale.status_code == 401
    assert stale.json()["error"]["code"] == "integration_key_invalid"
    fresh = client.get(
        f"/api/v1/integrations/{integration_id}/descriptor",
        headers={"X-OpenRater-Integration-Key": second_key},
    )
    assert fresh.status_code == 200, fresh.text


def test_exposed_plan_authoring_journey(
    client: TestClient, monkeypatch
) -> None:
    """Brief 77 steps 2→4→6 over the API: drafts can't be exposed; a
    published plan exposes unmapped; the mapping + green test + live
    switch walk the Hub ladder (unmapped → mapped → tested → live);
    pulse counts plans; duplicates conflict."""
    from tests._helpers import create_plan

    integration_id = _create(client)
    plan_id = create_plan(client, display_name="Hub BOP", jurisdiction="WA")["rating_plan_id"]

    # §5 guardrail — a draft (no published version) cannot be exposed.
    draft_refused = client.post(
        f"/api/v1/integrations/{integration_id}/plans",
        json={"rating_plan_id": plan_id, "carrier_label": "acme-mutual"},
    )
    assert draft_refused.status_code == 422, draft_refused.text
    assert draft_refused.json()["error"]["code"] == "plan_not_published"

    snap = client.post(
        f"/api/v1/plans/{plan_id}/snapshots",
        json={"display_name": "v1", "notes": "journey"},
    ).json()["snapshot_id"]
    assert client.patch(f"/api/v1/plans/{plan_id}/snapshots/{snap}/publish").status_code == 200

    exposed = client.post(
        f"/api/v1/integrations/{integration_id}/plans",
        json={"rating_plan_id": plan_id, "carrier_label": "acme-mutual"},
    )
    assert exposed.status_code == 201, exposed.text
    body = exposed.json()
    assert body["status"] == "unmapped" and body["live"] is False
    assert body["plan_display_name"] == "Hub BOP"
    exposed_id = body["exposed_id"]

    # A second exposure of the same plan (or label) conflicts — one-to-one.
    dup = client.post(
        f"/api/v1/integrations/{integration_id}/plans",
        json={"rating_plan_id": plan_id, "carrier_label": "other-label"},
    )
    assert dup.status_code == 422
    assert dup.json()["error"]["code"] == "exposed_plan_conflict"

    patched = client.patch(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}",
        json={
            "mapping": [
                {"peer_key": "rest.gross_receipts", "plan_input_key": "gross_receipts", "required": True}
            ],
            "validity_days": 45,
        },
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["validity_days"] == 45
    assert patched.json()["required_mapped"] == 1
    assert patched.json()["status"] == "mapped"  # the Hub ladder's 2nd rung

    # Step 5's gate (Brief 77): no live without a green test.
    early = client.patch(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}",
        json={"live": True},
    )
    assert early.status_code == 422
    assert early.json()["error"]["code"] == "test_required"

    # A stubbed green test → the receipt stamps → live opens.
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        lambda *, request, base_url=None: {
            "outputs": {},
            "views": {"premium": 4731, "tier": "standard"},
            "row_status": "ok",
            "composed": {"subtotal": 5085, "final": 4731, "adjustments": []},
        },
    )
    tested = client.post(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}/test-quote",
        json={"facts": {"rest.gross_receipts": 1250000}},
    )
    assert tested.status_code == 200, tested.text
    assert tested.json()["row_status"] == "ok" and tested.json()["premium"] == 4731

    receipt = client.get(f"/api/v1/integrations/{integration_id}/plans").json()[0]
    assert receipt["last_test_premium_cents"] == 473100
    assert receipt["last_test_snapshot_id"] == snap
    assert receipt["last_test_version_name"] == "v1"  # names the version, not the id
    assert receipt["status"] == "tested"  # the ladder's 3rd rung
    assert receipt["consumed_required"] == 0  # blank plan declares no form inputs

    lived = client.patch(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}",
        json={"live": True},
    )
    assert lived.status_code == 200, lived.text
    assert lived.json()["status"] == "live"

    pulse = client.get(f"/api/v1/integrations/{integration_id}/pulse")
    assert pulse.status_code == 200
    assert pulse.json()["plans_exposed"] == 1 and pulse.json()["plans_live"] == 1

    # Switch off via the live toggle — the chip falls back to its earned
    # rung (tested), not a "paused" the operator never chose as a status.
    paused = client.patch(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}",
        json={"live": False},
    )
    assert paused.json()["status"] == "tested"

    gone = client.delete(f"/api/v1/integrations/{integration_id}/plans/{exposed_id}")
    assert gone.status_code == 204
    assert client.get(f"/api/v1/integrations/{integration_id}/plans").json() == []


def test_republish_demotes_live_and_blocks_reflip_until_retest(
    client: TestClient, monkeypatch
) -> None:
    """Audit 2026-07-11 gap #3 — the live gate is tied to the CURRENT live
    snapshot's own test-pass, not 'tested ever'. Once a plan is tested + live
    on v1, republishing v2 (whose mapping was never tested) flags the drift on
    the Hub read model and blocks a re-flip to live with a VERSION-AWARE
    `test_required` (it names the republish, not 'never tested') — until v2
    itself passes a green test, which restores live."""
    from tests._helpers import create_plan

    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        lambda *, request, base_url=None: {
            "outputs": {},
            "views": {"premium": 4731, "tier": "standard"},
            "row_status": "ok",
            "composed": {"subtotal": 5085, "final": 4731, "adjustments": []},
        },
    )
    integration_id = _create(client)
    plan_id = create_plan(client, display_name="Drift BOP", jurisdiction="WA")["rating_plan_id"]
    v1 = client.post(
        f"/api/v1/plans/{plan_id}/snapshots", json={"display_name": "v1", "notes": "x"}
    ).json()["snapshot_id"]
    assert client.patch(f"/api/v1/plans/{plan_id}/snapshots/{v1}/publish").status_code == 200

    exposed_id = client.post(
        f"/api/v1/integrations/{integration_id}/plans",
        json={"rating_plan_id": plan_id, "carrier_label": "acme-mutual"},
    ).json()["exposed_id"]
    client.patch(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}",
        json={
            "mapping": [
                {"peer_key": "rest.gross_receipts", "plan_input_key": "gross_receipts", "required": True}
            ]
        },
    )
    client.post(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}/test-quote",
        json={"facts": {"rest.gross_receipts": 1250000}},
    )
    assert (
        client.patch(
            f"/api/v1/integrations/{integration_id}/plans/{exposed_id}", json={"live": True}
        ).json()["status"]
        == "live"
    )

    # Republish v2 WITHOUT re-testing → drift.
    v2 = client.post(
        f"/api/v1/plans/{plan_id}/snapshots", json={"display_name": "v2", "notes": "y"}
    ).json()["snapshot_id"]
    assert client.patch(f"/api/v1/plans/{plan_id}/snapshots/{v2}/publish").status_code == 200

    # The Hub read model flags the drift: toggle still on, but demoted.
    row = client.get(f"/api/v1/integrations/{integration_id}/plans").json()[0]
    assert row["live"] is True and row["live_version_untested"] is True
    assert row["status"] == "live"  # the toggle rung, unchanged

    # Re-flip is blocked with a version-aware message (this plan WAS tested,
    # just not on v2) — distinct from the never-tested wording.
    client.patch(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}", json={"live": False}
    )
    blocked = client.patch(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}", json={"live": True}
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "test_required"
    assert "republished" in blocked.json()["error"]["message"]

    # Re-test on v2 clears the drift; live opens again and the flag falls.
    client.post(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}/test-quote",
        json={"facts": {"rest.gross_receipts": 1250000}},
    )
    relive = client.patch(
        f"/api/v1/integrations/{integration_id}/plans/{exposed_id}", json={"live": True}
    )
    assert relive.status_code == 200 and relive.json()["status"] == "live"
    assert relive.json()["live_version_untested"] is False
