# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Tests for the observability layer.

Covers:
  · `configure_logging()` is idempotent.
  · `get_logger()` returns a logger that respects context binding.
  · Request ID header is generated when absent.
  · Client-supplied valid Request ID header is honored.
  · Invalid Request ID is dropped + replaced with a fresh UUID.
  · Response includes `X-Request-Id`.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from openrater.observability import (
    REQUEST_ID_HEADER,
    configure_logging,
    get_logger,
)
from openrater.observability.request_id import _is_valid_client_id

# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestValidClientId:
    """`_is_valid_client_id` accepts standard ID shapes + rejects garbage."""

    def test_uuid_accepted(self) -> None:
        assert _is_valid_client_id(str(uuid.uuid4())) is True

    def test_ulid_shape_accepted(self) -> None:
        # 26 chars; uppercase + digits
        assert _is_valid_client_id("01H8XJK1Y0Z2N3R4S5T6V7W8X9") is True

    def test_too_short_rejected(self) -> None:
        assert _is_valid_client_id("short-id") is False  # 8 chars

    def test_too_long_rejected(self) -> None:
        assert _is_valid_client_id("x" * 201) is False

    def test_non_ascii_rejected(self) -> None:
        assert _is_valid_client_id("中文-id-1234567890123") is False

    def test_special_chars_rejected(self) -> None:
        assert _is_valid_client_id("has spaces in it abcdef") is False
        assert _is_valid_client_id("has$dollars$1234567890") is False


# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------


class TestConfigureLogging:
    def test_idempotent(self) -> None:
        configure_logging()
        configure_logging()  # second call is a no-op; should not raise

    def test_get_logger_works(self) -> None:
        configure_logging()
        log = get_logger("test_logger")
        # We can't easily capture stderr in a test, but the call must
        # not raise.
        log.info("test_event", key="value")


# ---------------------------------------------------------------------------
# Request ID end-to-end
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)
    os.environ["RATER_DB_PATH"] = str(db_path)
    try:
        from openrater.main import create_app

        app = create_app()
        with TestClient(app) as c:
            yield c
    finally:
        if db_path.exists():
            db_path.unlink()
        for ext in ("-wal", "-shm"):
            sidecar = db_path.with_suffix(db_path.suffix + ext)
            if sidecar.exists():
                sidecar.unlink()
        os.environ.pop("RATER_DB_PATH", None)


class TestRequestIdMiddleware:
    def test_response_includes_request_id_header(self, client: TestClient) -> None:
        response = client.get("/health")
        assert response.status_code == 200
        request_id = response.headers.get(REQUEST_ID_HEADER.lower())
        assert request_id is not None
        # Should be a UUID-shaped string by default
        assert len(request_id) >= 16

    def test_each_request_gets_unique_id(self, client: TestClient) -> None:
        a = client.get("/health").headers[REQUEST_ID_HEADER.lower()]
        b = client.get("/health").headers[REQUEST_ID_HEADER.lower()]
        assert a != b

    def test_valid_client_id_is_honored(self, client: TestClient) -> None:
        client_id = str(uuid.uuid4())
        response = client.get(
            "/health",
            headers={REQUEST_ID_HEADER: client_id},
        )
        assert response.headers.get(REQUEST_ID_HEADER.lower()) == client_id

    def test_invalid_client_id_is_replaced(self, client: TestClient) -> None:
        response = client.get(
            "/health",
            headers={REQUEST_ID_HEADER: "x"},  # too short
        )
        returned = response.headers.get(REQUEST_ID_HEADER.lower())
        assert returned is not None
        assert returned != "x"
        # Should be UUID-shaped now
        assert len(returned) >= 16

    def test_request_id_present_on_error_responses(self, client: TestClient) -> None:
        """Request ID survives + is returned even when the route errors out."""
        response = client.get("/api/v1/plans/nonexistent-plan-id")
        assert response.status_code == 404
        assert response.headers.get(REQUEST_ID_HEADER.lower()) is not None
