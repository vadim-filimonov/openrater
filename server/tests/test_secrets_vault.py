# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Tests for the connector secret vault (E06) — encrypt API keys at rest.

Covers the round-trip, the fail-safe posture (writes refuse without the master
key; reads degrade to None), call-time injection placement (header vs query +
prefix), and the in-product PUT/DELETE secret endpoints + `configured` flag.
"""

from __future__ import annotations

import asyncio
import sqlite3

import pytest
from cryptography.fernet import Fernet

from openrater.connectors.base import ConnectorSecrets
from openrater.connectors.errors import (
    ConnectorNotConfiguredError,
    SecretsVaultUnavailableError,
)
from openrater.connectors.models import ConnectorManifest, HttpRequest, HttpResponse
from openrater.connectors.rest_connector import RestConnector
from openrater.connectors.secrets_vault import (
    clear_secret,
    get_secret,
    has_secret,
    master_key_available,
    set_secret,
)
from openrater.persistence.db import Database


@pytest.fixture()
def db(tmp_path) -> Database:
    return Database(tmp_path / "vault.db")


@pytest.fixture()
def master_key(monkeypatch) -> str:
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("RATER_SECRETS_KEY", key)
    return key


class TestVaultRoundTrip:
    def test_set_get_has_clear(self, db: Database, master_key: str) -> None:
        assert has_secret(db=db, connector_id="c1") is False
        assert get_secret(db=db, connector_id="c1") is None

        set_secret(db=db, connector_id="c1", value="lbx_demo_key_2025", updated_by="t")
        assert has_secret(db=db, connector_id="c1") is True
        assert get_secret(db=db, connector_id="c1") == "lbx_demo_key_2025"

        # upsert overwrites (rotation)
        set_secret(db=db, connector_id="c1", value="rotated", updated_by="t")
        assert get_secret(db=db, connector_id="c1") == "rotated"

        assert clear_secret(db=db, connector_id="c1") is True
        assert has_secret(db=db, connector_id="c1") is False
        assert get_secret(db=db, connector_id="c1") is None

    def test_ciphertext_is_not_plaintext(self, db: Database, master_key: str) -> None:
        set_secret(db=db, connector_id="c2", value="super-secret-value", updated_by="t")
        with db.connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT ciphertext FROM connector_secrets WHERE connector_id = 'c2'"
            ).fetchone()
        # the raw at-rest column must not contain the plaintext
        assert "super-secret-value" not in row["ciphertext"]
        # but it round-trips
        assert get_secret(db=db, connector_id="c2") == "super-secret-value"


class TestFailSafe:
    def test_set_without_master_key_raises_and_persists_nothing(
        self, db: Database, monkeypatch
    ) -> None:
        monkeypatch.delenv("RATER_SECRETS_KEY", raising=False)
        assert master_key_available() is False
        with pytest.raises(SecretsVaultUnavailableError):
            set_secret(db=db, connector_id="c3", value="x", updated_by="t")
        assert has_secret(db=db, connector_id="c3") is False

    def test_get_without_master_key_degrades_to_none(
        self, db: Database, master_key: str, monkeypatch
    ) -> None:
        set_secret(db=db, connector_id="c4", value="x", updated_by="t")
        # master key rotated away / lost → read must not crash, returns None
        monkeypatch.delenv("RATER_SECRETS_KEY", raising=False)
        assert get_secret(db=db, connector_id="c4") is None
        assert has_secret(db=db, connector_id="c4") is True  # row still present


def _manifest(**kw) -> ConnectorManifest:
    base = dict(
        connector_id="vault-test",
        display_name="Vault Test",
        vendor="x",
        endpoint="https://api.example.com/v1",
        method="GET",
        request_query={"q": "{{q}}"},
    )
    base.update(kw)
    return ConnectorManifest(**base)


class TestInjectionPlacement:
    """The resolved vault value is placed per `secret_in` (header vs query)."""

    def _run(self, manifest: ConnectorManifest, secret_value) -> ConnectorSecrets:
        captured: dict[str, ConnectorSecrets] = {}

        async def transport(request: HttpRequest, secrets: ConnectorSecrets) -> HttpResponse:
            captured["secrets"] = secrets
            return HttpResponse(status_code=200, json_body={"ok": True})

        asyncio.run(
            RestConnector(manifest).execute(
                {"q": "z"}, transport=transport, secret_value=secret_value
            )
        )
        return captured["secrets"]

    def test_header_placement(self) -> None:
        secrets = self._run(
            _manifest(secret_param="X-API-Key", secret_in="header"), "vault-key-123"
        )
        assert secrets.headers == {"X-API-Key": "vault-key-123"}
        assert secrets.query == {}

    def test_query_placement_with_prefix(self) -> None:
        secrets = self._run(
            _manifest(secret_param="key", secret_in="query", secret_prefix="Bearer "), "abc"
        )
        assert secrets.query == {"key": "Bearer abc"}

    def test_vault_value_wins_over_env(self, monkeypatch) -> None:
        monkeypatch.setenv("MY_ENV_KEY", "from-env")
        secrets = self._run(
            _manifest(secret_param="X-API-Key", secret_in="header", secret_env="MY_ENV_KEY"),
            "from-vault",
        )
        assert secrets.headers == {"X-API-Key": "from-vault"}

    def test_env_fallback_when_no_vault_value(self, monkeypatch) -> None:
        monkeypatch.setenv("MY_ENV_KEY", "from-env")
        secrets = self._run(
            _manifest(secret_param="X-API-Key", secret_in="header", secret_env="MY_ENV_KEY"),
            None,
        )
        assert secrets.headers == {"X-API-Key": "from-env"}

    def test_missing_key_raises_not_configured(self, monkeypatch) -> None:
        monkeypatch.delenv("MY_ENV_KEY", raising=False)
        with pytest.raises(ConnectorNotConfiguredError):
            self._run(_manifest(secret_param="X-API-Key", secret_in="header"), None)

    def test_no_auth_needed_returns_empty(self) -> None:
        secrets = self._run(_manifest(), None)  # no secret_param / secret_env
        assert secrets.headers == {} and secrets.query == {}


class TestSecretEndpoints:
    """PUT/DELETE /connectors/{id}/secret + the `configured` flag end-to-end."""

    def test_put_secret_configures_a_bundled_connector(self, client, monkeypatch) -> None:
        monkeypatch.setenv("RATER_SECRETS_KEY", Fernet.generate_key().decode())
        monkeypatch.delenv("RATER_LIGHTBOX_API_KEY", raising=False)

        listing = client.get("/api/v1/connectors").json()
        assert listing["vault_available"] is True
        lb = next(c for c in listing["connectors"] if c["connector_id"] == "lightbox-structures")
        assert lb["needs_secret"] is True
        assert lb["configured"] is False

        resp = client.put(
            "/api/v1/connectors/lightbox-structures/secret",
            json={"value": "lbx_demo_key_2025"},
        )
        assert resp.status_code == 200
        assert resp.json()["configured"] is True

        after = client.get("/api/v1/connectors").json()
        lb2 = next(c for c in after["connectors"] if c["connector_id"] == "lightbox-structures")
        assert lb2["configured"] is True

        # clear → back to unconfigured
        assert client.delete("/api/v1/connectors/lightbox-structures/secret").status_code == 204
        cleared = client.get("/api/v1/connectors").json()
        lb3 = next(c for c in cleared["connectors"] if c["connector_id"] == "lightbox-structures")
        assert lb3["configured"] is False

    def test_put_secret_without_master_key_fails_safe(self, client, monkeypatch) -> None:
        monkeypatch.delenv("RATER_SECRETS_KEY", raising=False)
        resp = client.put(
            "/api/v1/connectors/lightbox-structures/secret", json={"value": "x"}
        )
        assert resp.status_code == 503

        listing = client.get("/api/v1/connectors").json()
        assert listing["vault_available"] is False

    def test_put_secret_unknown_connector_404(self, client, monkeypatch) -> None:
        monkeypatch.setenv("RATER_SECRETS_KEY", Fernet.generate_key().decode())
        resp = client.put(
            "/api/v1/connectors/does-not-exist/secret", json={"value": "x"}
        )
        assert resp.status_code == 404
