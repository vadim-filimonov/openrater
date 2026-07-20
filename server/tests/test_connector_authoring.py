# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Route tests for the no-code connector authoring studio (Brief 47, Phase B).

Fully offline: the draft-test + invoke paths monkeypatch `httpx_transport` to
replay a recorded response — no real call, real key never used. Covers create /
list / get / update / delete, bundled-id protection, and draft testing.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from openrater.connectors.base import ConnectorSecrets
from openrater.connectors.models import HttpRequest, HttpResponse

# A recorded response the fake transport replays regardless of endpoint, so a
# user-authored manifest can extract a port from it.
SAMPLE_RESPONSE = {
    "result": {
        "address": {"postalAddress": {"postalCode": "67202"}},
        "score": {"wildfire": 0.12},
    },
    "responseId": "resp-xyz",
}

# A minimal user-authored connector: GET, zip → a hazard/postal port.
ACME_MANIFEST = {
    "connector_id": "acme-hazard",
    "display_name": "Acme Hazard Score",
    "vendor": "acme",
    "category": "property_peril",
    "method": "GET",
    "endpoint": "https://api.acme.test/hazard",
    "secret_env": "RATER_ACME_API_KEY",
    "secret_param": "key",
    "request_query": {"zip": "{{zip}}"},
    "inputs": [{"name": "zip", "required": True, "example": "67202"}],
    "outputs": [
        {"name": "postal_code", "json_path": "result.address.postalAddress.postalCode"},
        {"name": "wildfire", "data_type": "number", "json_path": "result.score.wildfire"},
    ],
    "cost_per_call_usd": 0.05,
}


async def _fake_transport(request: HttpRequest, secrets: ConnectorSecrets) -> HttpResponse:
    return HttpResponse(status_code=200, json_body=SAMPLE_RESPONSE)


def _patch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATER_ACME_API_KEY", "test-key")
    monkeypatch.setattr("openrater.connectors.service.httpx_transport", _fake_transport)


class TestAuthoringCrud:
    def test_create_then_appears_in_registry_as_user(self, client: TestClient) -> None:
        created = client.post("/api/v1/connectors", json=ACME_MANIFEST)
        assert created.status_code == 201, created.text
        assert created.json()["source"] == "user"

        listed = client.get("/api/v1/connectors").json()["connectors"]
        by_id = {c["connector_id"]: c for c in listed}
        assert by_id["acme-hazard"]["source"] == "user"
        # bundled connectors still present + flagged read-only
        assert by_id["google-address-validation"]["source"] == "bundled"

    def test_get_full_manifest_roundtrips(self, client: TestClient) -> None:
        client.post("/api/v1/connectors", json=ACME_MANIFEST)
        got = client.get("/api/v1/connectors/acme-hazard")
        assert got.status_code == 200, got.text
        m = got.json()
        assert m["endpoint"] == "https://api.acme.test/hazard"
        assert m["secret_env"] == "RATER_ACME_API_KEY"  # env-var NAME, not a key
        assert {o["name"] for o in m["outputs"]} == {"postal_code", "wildfire"}

    def test_get_bundled_manifest(self, client: TestClient) -> None:
        m = client.get("/api/v1/connectors/google-address-validation")
        assert m.status_code == 200
        assert "addressvalidation.googleapis.com" in m.json()["endpoint"]

    def test_update_user_connector(self, client: TestClient) -> None:
        client.post("/api/v1/connectors", json=ACME_MANIFEST)
        edited = {**ACME_MANIFEST, "display_name": "Acme Peril v2", "cost_per_call_usd": 0.09}
        r = client.put("/api/v1/connectors/acme-hazard", json=edited)
        assert r.status_code == 200, r.text
        assert r.json()["display_name"] == "Acme Peril v2"
        assert client.get("/api/v1/connectors/acme-hazard").json()["cost_per_call_usd"] == 0.09

    def test_delete_user_connector(self, client: TestClient) -> None:
        client.post("/api/v1/connectors", json=ACME_MANIFEST)
        assert client.delete("/api/v1/connectors/acme-hazard").status_code == 204
        assert client.get("/api/v1/connectors/acme-hazard").status_code == 404


class TestAuthoringGuards:
    def test_reserved_bundled_id_rejected(self, client: TestClient) -> None:
        clash = {**ACME_MANIFEST, "connector_id": "google-address-validation"}
        r = client.post("/api/v1/connectors", json=clash)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "connector_id_reserved"

    def test_duplicate_user_id_rejected(self, client: TestClient) -> None:
        client.post("/api/v1/connectors", json=ACME_MANIFEST)
        r = client.post("/api/v1/connectors", json=ACME_MANIFEST)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "connector_exists"

    def test_bundled_is_read_only(self, client: TestClient) -> None:
        put = client.put(
            "/api/v1/connectors/google-address-validation", json=ACME_MANIFEST
        )
        assert put.status_code == 403
        delete = client.delete("/api/v1/connectors/google-address-validation")
        assert delete.status_code == 403

    def test_update_unknown_is_404(self, client: TestClient) -> None:
        r = client.put("/api/v1/connectors/acme-hazard", json=ACME_MANIFEST)
        assert r.status_code == 404

    def test_update_id_mismatch_is_400(self, client: TestClient) -> None:
        client.post("/api/v1/connectors", json=ACME_MANIFEST)
        mismatched = {**ACME_MANIFEST, "connector_id": "something-else"}
        r = client.put("/api/v1/connectors/acme-hazard", json=mismatched)
        assert r.status_code == 400

    def test_delete_unknown_is_404(self, client: TestClient) -> None:
        assert client.delete("/api/v1/connectors/ghost").status_code == 404


class TestDraftTest:
    def test_test_draft_extracts_outputs(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch(monkeypatch)
        r = client.post(
            "/api/v1/connectors/test",
            json={"manifest": ACME_MANIFEST, "inputs": {"zip": "67202"}},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["outputs"]["postal_code"] == "67202"
        assert body["outputs"]["wildfire"] == 0.12
        # raw response is returned for click-to-extract; the key is never echoed
        assert body["response_json"]["responseId"] == "resp-xyz"
        assert "test-key" not in r.text
        assert "snapshot_id" not in body  # draft test persists nothing

    def test_test_draft_missing_input_is_inline_error(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch(monkeypatch)
        r = client.post(
            "/api/v1/connectors/test",
            json={"manifest": ACME_MANIFEST, "inputs": {}},
        )
        assert r.status_code == 200  # not a thrown request — an inline hint
        body = r.json()
        assert body["ok"] is False
        assert "zip" in (body["error"] or "")

    def test_test_draft_missing_key_is_inline_error(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("RATER_ACME_API_KEY", raising=False)
        monkeypatch.setattr("openrater.connectors.service.httpx_transport", _fake_transport)
        r = client.post(
            "/api/v1/connectors/test",
            json={"manifest": ACME_MANIFEST, "inputs": {"zip": "67202"}},
        )
        assert r.status_code == 200
        assert r.json()["ok"] is False


class TestUserConnectorInvokable:
    def test_saved_user_connector_runs_via_invoke(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch(monkeypatch)
        client.post("/api/v1/connectors", json=ACME_MANIFEST)
        r = client.post(
            "/api/v1/connectors/acme-hazard/invoke",
            json={"inputs": {"zip": "67202"}},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["outputs"]["postal_code"] == "67202"
        assert body["snapshot_id"].startswith("es_")  # saved invoke still snapshots
        assert body["cost_usd"] == 0.05

    def test_path_placeholder_is_rendered(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch(monkeypatch)
        path_manifest = {
            **ACME_MANIFEST,
            "connector_id": "acme-path",
            "request_query": {},
            "endpoint": "https://api.acme.test/zip/{{zip}}",
        }
        client.post("/api/v1/connectors", json=path_manifest)
        inv = client.post(
            "/api/v1/connectors/acme-path/invoke",
            json={"inputs": {"zip": "67202"}},
        ).json()
        snap = client.get(f"/api/v1/connectors/snapshots/{inv['snapshot_id']}").json()
        assert snap["request"]["url"] == "https://api.acme.test/zip/67202"  # path rendered
