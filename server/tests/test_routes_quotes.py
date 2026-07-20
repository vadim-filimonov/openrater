# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Quote endpoint (Brief 76, v4 P4) — the Ship zone's API path.

Scoring is stubbed at the `score_once` seam (same philosophy as the run
tests): these pin the ORCHESTRATION — version resolution (published by
default, draft/snapshot on request), the un-persisted passthrough, and
the honest 404 when nothing is published — not the engine (conformance
owns that).
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests._helpers import create_plan

# The scoring service's honest response for a rateable risk (P-001-like).
OK_RESULT: dict[str, Any] = {
    "outputs": {"total_premium": 4731},
    "views": {"premium": 4731, "perCoverage": {}, "tier": "standard"},
    "as_of": "2026-07-06",
    "durationMs": 3,
    "row_status": "ok",
    "composed": {"subtotal": 5085, "final": 4731, "adjustments": []},
}

# A NAMED refusal (Law 2 — an unrateable risk, premium withheld).
REFUSAL_RESULT: dict[str, Any] = {
    "outputs": {},
    "views": {"premium": None, "perCoverage": {}, "tier": "standard"},
    "as_of": "2026-07-06",
    "durationMs": 2,
    "row_status": "error",
    "rowIssues": [
        {
            "severity": "error",
            "code": "unknown_key",
            "nodeId": "class_lookup",
            "message": "Class code 99999 is not in the plan's class table.",
        }
    ],
}


# A PARTIAL-CHAIN refusal — one chain resolved (a REAL sibling number rides
# `outputs`), another errored the whole row (Law 2 withholds the premium). The
# engine keeps the sibling for the author's diagnosis; a QUOTE must not.
PARTIAL_CHAIN_REFUSAL_RESULT: dict[str, Any] = {
    "outputs": {"liability_premium": 20396},
    "views": {"premium": None, "perCoverage": {}, "tier": None},
    "as_of": "2026-07-06",
    "durationMs": 2,
    "row_status": "error",
    "rowIssues": [
        {
            "severity": "error",
            "code": "unknown_key",
            "nodeId": "prop_class_lookup",
            "message": "Property class code is not in the plan's table.",
        }
    ],
}


def _stub_scoring(monkeypatch: Any, result: dict[str, Any]) -> list[dict[str, Any]]:
    """Capture the outgoing scoring request; return a canned response."""
    calls: list[dict[str, Any]] = []

    def fake_score_once(*, request: dict[str, Any], base_url: str | None = None):
        calls.append(request)
        return result

    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_once", fake_score_once
    )
    return calls


def _freeze_and_publish(client: TestClient, plan_id: str) -> str:
    """Freeze the current draft + publish it; return the snapshot id."""
    frozen = client.post(
        f"/api/v1/plans/{plan_id}/snapshots",
        json={"display_name": "v1", "notes": "first"},
    )
    assert frozen.status_code == 201, frozen.text
    snapshot_id = frozen.json()["snapshot_id"]
    published = client.patch(
        f"/api/v1/plans/{plan_id}/snapshots/{snapshot_id}/publish"
    )
    assert published.status_code == 200, published.text
    return snapshot_id


def test_quote_against_the_published_version(
    client: TestClient, monkeypatch: Any
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    snapshot_id = _freeze_and_publish(client, plan_id)
    calls = _stub_scoring(monkeypatch, OK_RESULT)

    res = client.post(
        f"/api/v1/plans/{plan_id}/quote",
        json={"inputs": {"class_code": "62114"}},
    )
    assert res.status_code == 200, res.text
    q = res.json()
    # Law 1 — THE premium is composed.final (the filed number).
    assert q["premium"] == 4731
    assert q["tier"] == "standard"
    assert q["row_status"] == "ok"
    assert q["composed"]["final"] == 4731
    # Law 3 — the response names WHICH version answered (the published one).
    assert q["version"] == {
        "kind": "published",
        "snapshot_id": snapshot_id,
        "content_hash": None,
    }
    # The outgoing request carried the SNAPSHOT's substrate (plan_stages).
    assert len(calls) == 1
    assert calls[0]["source"] == "plan_stages"
    assert calls[0]["inputs"] == {"class_code": "62114"}


def test_quote_without_a_published_version_is_a_named_404(
    client: TestClient, monkeypatch: Any
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    _stub_scoring(monkeypatch, OK_RESULT)  # must never be called
    res = client.post(f"/api/v1/plans/{plan_id}/quote", json={"inputs": {}})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "no_published_version"


def test_quote_the_draft_with_the_query_flag(
    client: TestClient, monkeypatch: Any
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    # No published version — but ?draft=true composes the live draft.
    _stub_scoring(monkeypatch, OK_RESULT)
    res = client.post(
        f"/api/v1/plans/{plan_id}/quote?draft=true",
        json={"inputs": {"class_code": "62114"}},
    )
    assert res.status_code == 200, res.text
    q = res.json()
    assert q["premium"] == 4731
    assert q["version"]["kind"] == "draft"
    assert q["version"]["snapshot_id"] is None


def test_quote_a_specific_snapshot(
    client: TestClient, monkeypatch: Any
) -> None:
    plan_id = create_plan(client)["rating_plan_id"]
    snapshot_id = _freeze_and_publish(client, plan_id)
    _stub_scoring(monkeypatch, OK_RESULT)
    res = client.post(
        f"/api/v1/plans/{plan_id}/quote?snapshot_id={snapshot_id}",
        json={"inputs": {}},
    )
    assert res.status_code == 200, res.text
    assert res.json()["version"] == {
        "kind": "snapshot",
        "snapshot_id": snapshot_id,
        "content_hash": None,
    }

    missing = client.post(
        f"/api/v1/plans/{plan_id}/quote?snapshot_id=does_not_exist",
        json={"inputs": {}},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "snapshot_not_found"


def test_quote_passes_through_a_named_refusal(
    client: TestClient, monkeypatch: Any
) -> None:
    """Law 2 — an unrateable risk quotes a NAMED refusal, never a dollar."""
    plan_id = create_plan(client)["rating_plan_id"]
    _freeze_and_publish(client, plan_id)
    _stub_scoring(monkeypatch, REFUSAL_RESULT)
    res = client.post(
        f"/api/v1/plans/{plan_id}/quote",
        json={"inputs": {"class_code": "99999"}},
    )
    # A refusal is a 200 with a withheld premium — NOT a 4xx (Law 2 ≠ error).
    assert res.status_code == 200, res.text
    q = res.json()
    assert q["premium"] is None
    assert q["row_status"] == "error"
    assert q["row_issues"][0]["code"] == "unknown_key"


def test_quote_error_row_withholds_sibling_chain_outputs(
    client: TestClient, monkeypatch: Any
) -> None:
    """Law 2 on the quote ANSWER surface: a partial-chain refusal leaves a
    REAL sibling number in the engine's `outputs`, kept for the author's
    diagnosis (RUN path + trace). A QUOTE withholds it on an error row exactly
    as it withholds `premium` — mirrors the integration seam's clamp
    (test_integrations_quote_set::test_error_row_withholds_sibling_chain_outputs)."""
    plan_id = create_plan(client)["rating_plan_id"]
    _freeze_and_publish(client, plan_id)
    _stub_scoring(monkeypatch, PARTIAL_CHAIN_REFUSAL_RESULT)
    res = client.post(
        f"/api/v1/plans/{plan_id}/quote",
        json={"inputs": {"class_code": "99999"}},
    )
    assert res.status_code == 200, res.text
    q = res.json()
    assert q["row_status"] == "error"
    assert q["premium"] is None  # the withheld total
    # The resolved sibling chain does NOT ride the quote answer.
    assert q["outputs"] == {}
    assert 20396 not in q["outputs"].values()


def test_quote_ok_row_carries_its_outputs_breakdown(
    client: TestClient, monkeypatch: Any
) -> None:
    """The clamp is CONDITIONAL, not a blanket wipe: a green quote keeps its
    per-chain `outputs` as the answer (Law 1). Guards the error-row fix above
    from regressing into 'always {}'."""
    plan_id = create_plan(client)["rating_plan_id"]
    _freeze_and_publish(client, plan_id)
    _stub_scoring(monkeypatch, OK_RESULT)
    res = client.post(
        f"/api/v1/plans/{plan_id}/quote",
        json={"inputs": {"class_code": "62114"}},
    )
    assert res.status_code == 200, res.text
    q = res.json()
    assert q["row_status"] == "ok"
    assert q["outputs"] == {"total_premium": 4731}


def test_quote_on_an_unknown_plan_is_404(client: TestClient) -> None:
    res = client.post("/api/v1/plans/nope/quote", json={"inputs": {}})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "plan_not_found"


# The scoring service's response for a composed 2-location policy (P-001-like).
POLICY_RESULT: dict[str, Any] = {
    "premium": 4730.98,
    "tier": "standard",
    "row_status": "ok",
    "composed": {"subtotal": 5085, "final": 4730.98, "adjustments": []},
    "locations": [
        {"location_id": "L1", "premium": 1326, "tier": "standard", "row_status": "ok"},
        {"location_id": "L2", "premium": 3759, "tier": "standard", "row_status": "ok"},
    ],
    "location_count": 2,
    "as_of": "2026-07-06",
}


def _stub_policy_scoring(
    monkeypatch: Any, result: dict[str, Any]
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def fake(*, request: dict[str, Any], base_url: str | None = None):
        calls.append(request)
        return result

    monkeypatch.setattr(
        "openrater.rates.quotes.service.score_policy_once", fake
    )
    return calls


def test_policy_quote_composes_locations_into_one_premium(
    client: TestClient, monkeypatch: Any
) -> None:
    """P4.1b — a policy (locations) quotes the rolled-up FILED premium."""
    plan_id = create_plan(client)["rating_plan_id"]
    _freeze_and_publish(client, plan_id)
    calls = _stub_policy_scoring(monkeypatch, POLICY_RESULT)

    res = client.post(
        f"/api/v1/plans/{plan_id}/quote",
        json={
            "locations": [
                {"class_code": "62114", "irpm_location": "L1"},
                {"class_code": "c102", "irpm_location": "L2"},
            ],
            "policy_inputs": {"years_in_business": "12", "is_first_term": "false"},
        },
    )
    assert res.status_code == 200, res.text
    q = res.json()
    assert q["premium"] == 4730.98
    assert q["tier"] == "standard"
    assert q["location_count"] == 2
    assert [loc["premium"] for loc in q["locations"]] == [1326, 3759]
    assert q["version"]["kind"] == "published"

    # The outgoing request routed to /score-policy with the per-policy
    # constants declared as policyInputKeys + merged into every location.
    assert len(calls) == 1
    sent = calls[0]
    assert sent["source"] == "plan_stages"
    assert sent["projectorOptions"] == {"minPremiumScope": "policy"}
    assert sorted(sent["policyInputKeys"]) == ["is_first_term", "years_in_business"]
    assert sent["locations"][0]["years_in_business"] == "12"
    assert sent["locations"][0]["class_code"] == "62114"


def test_policy_quote_relays_a_composition_refusal(
    client: TestClient, monkeypatch: Any
) -> None:
    """Law 2 — a policy-level refusal (tail over a total-less plan) names
    itself to the quote consumer: row_status error, premium withheld, and
    the composition_failed issue rides row_issues."""
    plan_id = create_plan(client)["rating_plan_id"]
    _freeze_and_publish(client, plan_id)
    refusal = {
        "premium": None,
        "tier": None,
        "row_status": "error",
        "locations": [
            {"location_id": "L1", "premium": None, "tier": None, "row_status": "ok"},
        ],
        "location_count": 1,
        "rowIssues": [
            {
                "severity": "error",
                "code": "composition_failed",
                "nodeId": "policy_tail",
                "message": "The filed premium could not be composed: ...",
            }
        ],
        "as_of": "2026-07-15",
    }
    _stub_policy_scoring(monkeypatch, refusal)

    res = client.post(
        f"/api/v1/plans/{plan_id}/quote",
        json={"locations": [{"class_code": "62114"}]},
    )
    assert res.status_code == 200, res.text
    q = res.json()
    assert q["row_status"] == "error"
    assert q["premium"] is None
    assert q["row_issues"][0]["code"] == "composition_failed"
