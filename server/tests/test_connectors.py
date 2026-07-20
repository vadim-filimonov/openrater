# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Unit tests for the generic, manifest-driven connector framework (Brief 47).

No network: the HTTP transport is injected with a fake that replays a recorded
Google Address Validation response.
"""

from __future__ import annotations

import asyncio

import pytest

from openrater.connectors.base import (
    ConnectorSecrets,
    HttpTransport,
    make_snapshot,
    redact_params,
)
from openrater.connectors.manifests import GOOGLE_ADDRESS_VALIDATION
from openrater.connectors.models import (
    ConnectorManifest,
    HttpRequest,
    HttpResponse,
    OutputPort,
)
from openrater.connectors.rest_connector import RestConnector, extract, render

GOOGLE_AV_67202 = {
    "result": {
        "verdict": {"addressComplete": True, "validationGranularity": "PREMISE"},
        "address": {
            "formattedAddress": "123 N Main St, Wichita, KS 67202, USA",
            "postalAddress": {"postalCode": "67202", "regionCode": "US"},
        },
        "geocode": {"location": {"latitude": 37.6884, "longitude": -97.3361}},
    },
    "responseId": "resp-abc-123",
}


async def _fake_transport(request: HttpRequest, secrets: ConnectorSecrets) -> HttpResponse:
    assert secrets.query.get("key")  # supplied at call time (query placement)...
    assert "key" not in request.params  # ...never in the kept request
    return HttpResponse(status_code=200, json_body=GOOGLE_AV_67202)


class TestRender:
    def test_exact_placeholder_preserves_type(self) -> None:
        assert render("{{n}}", {"n": 5}) == 5
        assert render("{{b}}", {"b": True}) is True

    def test_inline_placeholder_is_string(self) -> None:
        assert render("hi {{name}}!", {"name": "bob"}) == "hi bob!"

    def test_nested_structures(self) -> None:
        out = render({"a": ["{{x}}", "y"]}, {"x": "z"})
        assert out == {"a": ["z", "y"]}

    def test_missing_is_none(self) -> None:
        assert render("{{missing}}", {}) is None


class TestExtract:
    def test_dotted_path(self) -> None:
        assert extract({"a": {"b": 1}}, "a.b") == 1

    def test_list_index(self) -> None:
        assert extract({"a": [{"b": 2}]}, "a.0.b") == 2

    def test_absent_is_none(self) -> None:
        assert extract({"a": 1}, "a.b.c") is None


class TestManifestDrivenConnector:
    def test_runs_google_manifest_and_extracts_outputs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("RATER_GOOGLE_MAPS_API_KEY", "test-key")
        connector = RestConnector(GOOGLE_ADDRESS_VALIDATION)
        run = asyncio.run(
            connector.execute(
                {"address": "123 N Main St, Wichita, KS 67202"}, transport=_fake_transport
            )
        )
        # raw facts only — no territory
        assert run.outputs["postal_code"] == "67202"
        assert run.outputs["address_complete"] is True
        assert run.outputs["formatted_address"].startswith("123 N Main St")
        assert run.outputs["location"]["latitude"] == 37.6884
        # default applied: region_code → "US" → request body
        assert run.request.json_body == {
            "address": {"addressLines": ["123 N Main St, Wichita, KS 67202"], "regionCode": "US"}
        }

        snapshot = make_snapshot(connector.manifest, run)
        assert snapshot.snapshot_id.startswith("es_")
        assert snapshot.vendor_request_id == "resp-abc-123"
        assert "key" not in snapshot.request.params  # never persisted

    def test_missing_required_input_is_bad_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("RATER_GOOGLE_MAPS_API_KEY", "test-key")
        from openrater.errors import BadRequestError

        connector = RestConnector(GOOGLE_ADDRESS_VALIDATION)
        with pytest.raises(BadRequestError):
            asyncio.run(connector.execute({}, transport=_fake_transport))

    def test_missing_key_is_not_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("RATER_GOOGLE_MAPS_API_KEY", raising=False)
        from openrater.connectors.errors import ConnectorNotConfiguredError

        connector = RestConnector(GOOGLE_ADDRESS_VALIDATION)
        with pytest.raises(ConnectorNotConfiguredError):
            asyncio.run(
                connector.execute({"address": "x"}, transport=_fake_transport)
            )

    def test_redact_strips_secrets(self) -> None:
        assert redact_params({"key": "S", "q": "x"}) == {"key": "***redacted***", "q": "x"}


class TestSecretPlacement:
    """E05 — the API key is injected into the query OR a header per `secret_in`."""

    @staticmethod
    def _manifest(**over: object) -> ConnectorManifest:
        base: dict[str, object] = dict(
            connector_id="acme",
            display_name="Acme",
            vendor="Acme",
            endpoint="https://api.acme.test/v1/lookup",
            method="GET",
            secret_env="RATER_ACME_KEY",
            secret_param="api_key",
            outputs=[OutputPort(name="ok", json_path="ok")],
        )
        base.update(over)
        return ConnectorManifest(**base)  # type: ignore[arg-type]

    @staticmethod
    def _capture() -> tuple[HttpTransport, dict[str, ConnectorSecrets]]:
        captured: dict[str, ConnectorSecrets] = {}

        async def transport(request: HttpRequest, secrets: ConnectorSecrets) -> HttpResponse:
            captured["secrets"] = secrets
            return HttpResponse(status_code=200, json_body={"ok": True})

        return transport, captured

    def test_query_is_the_default_placement(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RATER_ACME_KEY", "sk-123")
        transport, cap = self._capture()
        asyncio.run(RestConnector(self._manifest()).execute({}, transport=transport))
        assert cap["secrets"].query == {"api_key": "sk-123"}
        assert cap["secrets"].headers == {}

    def test_header_placement(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RATER_ACME_KEY", "sk-123")
        transport, cap = self._capture()
        m = self._manifest(secret_in="header", secret_param="X-API-Key")
        asyncio.run(RestConnector(m).execute({}, transport=transport))
        assert cap["secrets"].headers == {"X-API-Key": "sk-123"}
        assert cap["secrets"].query == {}

    def test_header_bearer_prefix(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RATER_ACME_KEY", "sk-123")
        transport, cap = self._capture()
        m = self._manifest(
            secret_in="header", secret_param="Authorization", secret_prefix="Bearer "
        )
        asyncio.run(RestConnector(m).execute({}, transport=transport))
        assert cap["secrets"].headers == {"Authorization": "Bearer sk-123"}
        assert cap["secrets"].query == {}
