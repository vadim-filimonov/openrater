# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Route tests for the generic connectors router (Brief 47).

Fully offline: the service's `httpx_transport` is monkeypatched to replay a
recorded Google response — no real call, real key never used.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from openrater.connectors.base import ConnectorSecrets
from openrater.connectors.models import HttpRequest, HttpResponse

GOOGLE_AV_67202 = {
    "result": {
        "verdict": {"addressComplete": True},
        "address": {
            "formattedAddress": "123 N Main St, Wichita, KS 67202, USA",
            "postalAddress": {"postalCode": "67202", "regionCode": "US"},
        },
        "geocode": {"location": {"latitude": 37.6884, "longitude": -97.3361}},
    },
    "responseId": "resp-abc-123",
}


async def _fake_transport(request: HttpRequest, secrets: ConnectorSecrets) -> HttpResponse:
    return HttpResponse(status_code=200, json_body=GOOGLE_AV_67202)


def _patch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATER_GOOGLE_MAPS_API_KEY", "test-key")
    monkeypatch.setattr("openrater.connectors.service.httpx_transport", _fake_transport)


class TestRegistry:
    def test_lists_connectors_with_ports(self, client: TestClient) -> None:
        body = client.get("/api/v1/connectors").json()
        google = next(
            c for c in body["connectors"] if c["connector_id"] == "google-address-validation"
        )
        assert {p["name"] for p in google["inputs"]} == {"address", "region_code"}
        assert "postal_code" in {p["name"] for p in google["outputs"]}
        assert "requires_secret" in google


class TestInvoke:
    def test_invoke_returns_raw_outputs(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch(monkeypatch)
        r = client.post(
            "/api/v1/connectors/google-address-validation/invoke",
            json={"inputs": {"address": "123 N Main St, Wichita, KS 67202"}},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["outputs"]["postal_code"] == "67202"
        assert body["outputs"]["address_complete"] is True
        assert "territory" not in body["outputs"]  # raw facts only — no interpretation
        assert body["snapshot_id"].startswith("es_")
        assert body["cost_usd"] == 0.017

    def test_snapshot_persisted_and_key_redacted(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch(monkeypatch)
        inv = client.post(
            "/api/v1/connectors/google-address-validation/invoke",
            json={"inputs": {"address": "100 N Broadway, Wichita, KS 67202"}},
        ).json()
        snap = client.get(f"/api/v1/connectors/snapshots/{inv['snapshot_id']}")
        assert snap.status_code == 200
        assert "key" not in snap.json()["request"]["params"]
        assert "test-key" not in snap.text

    def test_unknown_connector_is_404(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch(monkeypatch)
        r = client.post("/api/v1/connectors/nope/invoke", json={"inputs": {}})
        assert r.status_code == 404

    def test_missing_key_is_503(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("RATER_GOOGLE_MAPS_API_KEY", raising=False)
        monkeypatch.setattr("openrater.connectors.service.httpx_transport", _fake_transport)
        r = client.post(
            "/api/v1/connectors/google-address-validation/invoke",
            json={"inputs": {"address": "x"}},
        )
        assert r.status_code == 503


# Google Places Text Search — the bundled business-classification connector.
PLACES_RESPONSE = {
    "results": [
        {
            "name": "Riverside Community Health Foundation",
            "types": ["health", "point_of_interest", "establishment"],
            "business_status": "OPERATIONAL",
            "formatted_address": "4275 Lemon St, Riverside, CA 92501, USA",
        }
    ],
    "status": "OK",
}


async def _places_transport(request: HttpRequest, secrets: ConnectorSecrets) -> HttpResponse:
    return HttpResponse(status_code=200, json_body=PLACES_RESPONSE)


class TestPlacesConnector:
    def test_bundled_with_classification_ports(self, client: TestClient) -> None:
        body = client.get("/api/v1/connectors").json()
        places = next(
            c for c in body["connectors"] if c["connector_id"] == "google-places-text-search"
        )
        assert places["source"] == "bundled"
        assert {p["name"] for p in places["inputs"]} == {"query"}
        ports = {p["name"]: p for p in places["outputs"]}
        assert {"business_types", "matched_name", "business_status"} <= ports.keys()
        # Brief 50 — matched_name echoes the `query` input, which drives the
        # name-similarity confidence badge in the Route test-run step (#4).
        assert ports["matched_name"]["echo_of"] == "query"
        assert ports["business_types"].get("echo_of") is None

    def test_invoke_extracts_classification(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("RATER_GOOGLE_MAPS_API_KEY", "test-key")
        monkeypatch.setattr("openrater.connectors.service.httpx_transport", _places_transport)
        r = client.post(
            "/api/v1/connectors/google-places-text-search/invoke",
            json={"inputs": {"query": "Riverside Youth Foundation, CA"}},
        )
        assert r.status_code == 200, r.text
        out = r.json()["outputs"]
        assert out["business_types"] == ["health", "point_of_interest", "establishment"]
        # matched_name surfaces WHICH business Google picked (review signal for #4)
        assert out["matched_name"] == "Riverside Community Health Foundation"
        assert out["business_status"] == "OPERATIONAL"
