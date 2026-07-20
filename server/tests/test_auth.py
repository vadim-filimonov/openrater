# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Tests for the auth shim.

Covers:
  · Default `current_operator()` returns the stub.
  · `register_operator_resolver` swaps the resolver.
  · The resolver is invoked per-request with the `Request` object.
  · A resolver that raises `UnauthorizedError` produces the structured
    envelope.
  · `current_operator()` reflects the resolver's return value DURING
    a request (the ContextVar pattern).
  · The audit log records the resolved operator (not the stub) when
    a real resolver is registered.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from openrater.auth import (
    DEFAULT_OPERATOR_ID,
    current_operator,
    register_operator_resolver,
    reset_operator_resolver,
)
from openrater.errors import ForbiddenError, UnauthorizedError


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    """Fresh app for each test. Auth shim reset at teardown."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)
    os.environ["RATER_DB_PATH"] = str(db_path)
    try:
        from openrater.main import create_app

        app = create_app()
        with TestClient(app) as c:
            yield c
    finally:
        reset_operator_resolver()
        if db_path.exists():
            db_path.unlink()
        for ext in ("-wal", "-shm"):
            sidecar = db_path.with_suffix(db_path.suffix + ext)
            if sidecar.exists():
                sidecar.unlink()
        os.environ.pop("RATER_DB_PATH", None)


# ---------------------------------------------------------------------------
# Default behavior
# ---------------------------------------------------------------------------


class TestDefaultResolver:
    def test_current_operator_default_outside_request(self) -> None:
        """Outside any request, current_operator returns the stub."""
        reset_operator_resolver()
        assert current_operator() == DEFAULT_OPERATOR_ID

    def test_default_resolver_used_for_audit(self, client: TestClient) -> None:
        """Newly created plan's audit row attributes to the stub operator."""
        reset_operator_resolver()
        create = client.post(
            "/api/v1/plans",
            json={
                "display_name": "Default Auth Test",
                "line_of_business": "bop",
                "effective_date": "2026-01-01",
                "jurisdiction": "WI",
            },
        )
        assert create.status_code == 201
        plan_id = create.json()["rating_plan_id"]

        audit = client.get(f"/api/v1/plans/{plan_id}/audit").json()
        assert audit["events"][0]["operator_id"] == DEFAULT_OPERATOR_ID


# ---------------------------------------------------------------------------
# Custom resolver (sync)
# ---------------------------------------------------------------------------


class TestSyncResolver:
    def test_resolver_replaces_default(self, client: TestClient) -> None:
        """A registered sync resolver overrides the stub."""

        def my_resolver(request: Request) -> str:
            return "alice@acmecorp.com"

        register_operator_resolver(my_resolver)
        try:
            create = client.post(
                "/api/v1/plans",
                json={
                    "display_name": "Custom Auth Test",
                    "line_of_business": "bop",
                    "effective_date": "2026-01-01",
                    "jurisdiction": "WI",
                },
            )
            assert create.status_code == 201
            plan_id = create.json()["rating_plan_id"]

            audit = client.get(f"/api/v1/plans/{plan_id}/audit").json()
            assert audit["events"][0]["operator_id"] == "alice@acmecorp.com"
        finally:
            reset_operator_resolver()

    def test_resolver_reads_request_headers(self, client: TestClient) -> None:
        """A header-driven resolver pulls the operator from the request."""

        def header_resolver(request: Request) -> str:
            return request.headers.get("X-Operator", DEFAULT_OPERATOR_ID)

        register_operator_resolver(header_resolver)
        try:
            create = client.post(
                "/api/v1/plans",
                json={
                    "display_name": "Header Auth Test",
                    "line_of_business": "bop",
                    "effective_date": "2026-01-01",
                    "jurisdiction": "WI",
                },
                headers={"X-Operator": "bob@beta.example"},
            )
            assert create.status_code == 201
            plan_id = create.json()["rating_plan_id"]

            audit = client.get(f"/api/v1/plans/{plan_id}/audit").json()
            assert audit["events"][0]["operator_id"] == "bob@beta.example"
        finally:
            reset_operator_resolver()


# ---------------------------------------------------------------------------
# Custom resolver (async)
# ---------------------------------------------------------------------------


class TestAsyncResolver:
    def test_async_resolver_awaited(self, client: TestClient) -> None:
        """An async resolver coroutine is properly awaited by the middleware."""

        async def async_resolver(request: Request) -> str:
            return "async@example.com"

        register_operator_resolver(async_resolver)
        try:
            create = client.post(
                "/api/v1/plans",
                json={
                    "display_name": "Async Auth Test",
                    "line_of_business": "bop",
                    "effective_date": "2026-01-01",
                    "jurisdiction": "WI",
                },
            )
            assert create.status_code == 201
            plan_id = create.json()["rating_plan_id"]

            audit = client.get(f"/api/v1/plans/{plan_id}/audit").json()
            assert audit["events"][0]["operator_id"] == "async@example.com"
        finally:
            reset_operator_resolver()


# ---------------------------------------------------------------------------
# Auth errors
# ---------------------------------------------------------------------------


class TestAuthErrors:
    def test_unauthorized_resolver_returns_401_envelope(
        self,
        client: TestClient,
    ) -> None:
        def deny_resolver(request: Request) -> str:
            raise UnauthorizedError(
                "Missing Authorization header.",
                hint="Include `Authorization: Bearer <token>`.",
                param="Authorization",
            )

        register_operator_resolver(deny_resolver)
        try:
            response = client.post(
                "/api/v1/plans",
                json={
                    "display_name": "Denied",
                    "line_of_business": "bop",
                    "effective_date": "2026-01-01",
                    "jurisdiction": "WI",
                },
            )
            assert response.status_code == 401
            body = response.json()
            assert body["error"]["code"] == "unauthorized"
            assert body["error"]["param"] == "Authorization"
            assert "Bearer" in body["error"]["hint"]
        finally:
            reset_operator_resolver()

    def test_forbidden_resolver_returns_403_envelope(self, client: TestClient) -> None:
        def forbid_resolver(request: Request) -> str:
            raise ForbiddenError(
                "Operator lacks the 'plans:create' permission.",
                hint="Contact your admin to grant the permission.",
                param="operator_id",
            )

        register_operator_resolver(forbid_resolver)
        try:
            response = client.post(
                "/api/v1/plans",
                json={
                    "display_name": "Forbidden",
                    "line_of_business": "bop",
                    "effective_date": "2026-01-01",
                    "jurisdiction": "WI",
                },
            )
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "forbidden"
        finally:
            reset_operator_resolver()


# ---------------------------------------------------------------------------
# Reset semantics
# ---------------------------------------------------------------------------


class TestResetResolver:
    def test_reset_returns_to_default(self, client: TestClient) -> None:
        def my_resolver(request: Request) -> str:
            return "should-not-see-this"

        register_operator_resolver(my_resolver)
        reset_operator_resolver()

        create = client.post(
            "/api/v1/plans",
            json={
                "display_name": "Reset Test",
                "line_of_business": "bop",
                "effective_date": "2026-01-01",
                "jurisdiction": "WI",
            },
        )
        assert create.status_code == 201
        plan_id = create.json()["rating_plan_id"]

        audit = client.get(f"/api/v1/plans/{plan_id}/audit").json()
        assert audit["events"][0]["operator_id"] == DEFAULT_OPERATOR_ID
