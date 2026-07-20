# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Per-plan API keys + the optional quote gate (Brief 76, v4 P4.2).

The secret is shown ONCE (mint) and never again (list = metadata). The
gate is open by default (OSS/dev) and enforced only when
`RATER_QUOTE_REQUIRE_KEY` is set — then a valid `X-API-Key` is
mandatory for an external caller.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import create_plan

OK_RESULT: dict[str, Any] = {
    "outputs": {"total_premium": 4731},
    "views": {"premium": 4731, "perCoverage": {}, "tier": "standard"},
    "as_of": "2026-07-06",
    "row_status": "ok",
    "composed": {"subtotal": 5085, "final": 4731, "adjustments": []},
}


def _stub_scoring(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once",
        lambda *, request, base_url=None: OK_RESULT,
    )


def test_mint_shows_the_secret_once_then_only_metadata(
    client: TestClient,
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    minted = client.post(
        f"/api/v1/plans/{plan_id}/api-keys", json={"label": "prod"}
    )
    assert minted.status_code == 201, minted.text
    key = minted.json()
    # The secret is returned exactly once, and it looks like a key.
    assert key["secret"].startswith("rater_live_")
    assert key["secret_prefix"] == key["secret"][:16]
    assert key["label"] == "prod"
    assert key["revoked_at"] is None

    # The list is metadata ONLY — the secret never reappears.
    listed = client.get(f"/api/v1/plans/{plan_id}/api-keys").json()["keys"]
    assert len(listed) == 1
    assert "secret" not in listed[0]
    assert listed[0]["key_id"] == key["key_id"]
    assert listed[0]["secret_prefix"] == key["secret_prefix"]


def test_revoke_removes_the_key(client: TestClient) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    key_id = client.post(f"/api/v1/plans/{plan_id}/api-keys", json={}).json()[
        "key_id"
    ]
    dropped = client.delete(f"/api/v1/plans/{plan_id}/api-keys/{key_id}")
    assert dropped.status_code == 204

    # Still listed (audit trail) but marked revoked.
    listed = client.get(f"/api/v1/plans/{plan_id}/api-keys").json()["keys"]
    assert listed[0]["revoked_at"] is not None

    # Revoking again is a 404 (nothing active to revoke).
    again = client.delete(f"/api/v1/plans/{plan_id}/api-keys/{key_id}")
    assert again.status_code == 404
    assert again.json()["error"]["code"] == "api_key_not_found"


def test_quote_is_open_by_default_no_key_needed(
    client: TestClient, monkeypatch: Any
) -> None:
    """OSS/dev default — no gate, so a quote succeeds with no key."""
    plan_id = create_plan(client)["rating_plan_id"]
    _stub_scoring(monkeypatch)
    res = client.post(
        f"/api/v1/plans/{plan_id}/quote?draft=true", json={"inputs": {}}
    )
    assert res.status_code == 200, res.text
    assert res.json()["premium"] == 4731


def test_quote_gated_requires_a_valid_key(
    client: TestClient, monkeypatch: Any
) -> None:
    """With the flag set, an external caller MUST present a valid key."""
    monkeypatch.setenv("RATER_QUOTE_REQUIRE_KEY", "1")
    _stub_scoring(monkeypatch)
    plan_id = create_plan(client)["rating_plan_id"]
    secret = client.post(f"/api/v1/plans/{plan_id}/api-keys", json={}).json()[
        "secret"
    ]

    # No key → 401 (the gate fires before version resolution).
    denied = client.post(
        f"/api/v1/plans/{plan_id}/quote?draft=true", json={"inputs": {}}
    )
    assert denied.status_code == 401
    assert denied.json()["error"]["code"] == "quote_key_required"

    # A bogus key → 401.
    bogus = client.post(
        f"/api/v1/plans/{plan_id}/quote?draft=true",
        json={"inputs": {}},
        headers={"X-API-Key": "rater_live_not_a_real_key"},
    )
    assert bogus.status_code == 401

    # The real key → 200.
    ok = client.post(
        f"/api/v1/plans/{plan_id}/quote?draft=true",
        json={"inputs": {}},
        headers={"X-API-Key": secret},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["premium"] == 4731

    # A REVOKED key fails closed.
    key_id = client.get(f"/api/v1/plans/{plan_id}/api-keys").json()["keys"][0][
        "key_id"
    ]
    client.delete(f"/api/v1/plans/{plan_id}/api-keys/{key_id}")
    revoked = client.post(
        f"/api/v1/plans/{plan_id}/quote?draft=true",
        json={"inputs": {}},
        headers={"X-API-Key": secret},
    )
    assert revoked.status_code == 401


def test_a_plans_key_cannot_quote_another_plan(
    client: TestClient, monkeypatch: Any
) -> None:
    """Keys are plan-scoped — one plan's key is invalid on another."""
    monkeypatch.setenv("RATER_QUOTE_REQUIRE_KEY", "1")
    _stub_scoring(monkeypatch)
    plan_a = create_plan(client)["rating_plan_id"]
    plan_b = create_plan(client)["rating_plan_id"]
    secret_a = client.post(f"/api/v1/plans/{plan_a}/api-keys", json={}).json()[
        "secret"
    ]
    cross = client.post(
        f"/api/v1/plans/{plan_b}/quote?draft=true",
        json={"inputs": {}},
        headers={"X-API-Key": secret_a},
    )
    assert cross.status_code == 401


def test_api_keys_on_unknown_plan_are_404(client: TestClient) -> None:
    assert client.post("/api/v1/plans/nope/api-keys", json={}).status_code == 404
    assert client.get("/api/v1/plans/nope/api-keys").status_code == 404
