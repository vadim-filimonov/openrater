# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Tests for the Idempotency-Key middleware.

Covers:
  · Replay semantics — same key + same body returns cached response with
    `Idempotent-Replayed: true`.
  · Conflict semantics — same key + different body returns
    `409 idempotency_key_conflict` envelope.
  · Key validation — bad lengths return `422 validation_error`.
  · Pass-through — GET requests + requests without the header are not
    cached.
  · Hash determinism — query-string ordering doesn't affect the hash.
  · Side effect non-replay — the cached path does NOT create a second
    plan row when a POST is replayed.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from openrater.middleware.idempotency import (
    KEY_MAX_LEN,
    KEY_MIN_LEN,
    compute_request_hash,
    lookup_cached_response,
    prune_expired_keys,
    store_cached_response,
)
from openrater.persistence import Database

# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestRequestHash:
    """Pure-Python tests for the canonicalization + hash function."""

    def test_same_inputs_same_hash(self) -> None:
        a = compute_request_hash("POST", "/api/v1/plans", "", b'{"x":1}')
        b = compute_request_hash("POST", "/api/v1/plans", "", b'{"x":1}')
        assert a == b

    def test_different_body_different_hash(self) -> None:
        a = compute_request_hash("POST", "/api/v1/plans", "", b'{"x":1}')
        b = compute_request_hash("POST", "/api/v1/plans", "", b'{"x":2}')
        assert a != b

    def test_method_changes_hash(self) -> None:
        a = compute_request_hash("POST", "/api/v1/plans", "", b"{}")
        b = compute_request_hash("PUT", "/api/v1/plans", "", b"{}")
        assert a != b

    def test_method_lowercase_normalized(self) -> None:
        upper = compute_request_hash("POST", "/api/v1/plans", "", b"{}")
        lower = compute_request_hash("post", "/api/v1/plans", "", b"{}")
        assert upper == lower

    def test_query_order_does_not_affect_hash(self) -> None:
        a = compute_request_hash("GET", "/api/v1/plans", "a=1&b=2", b"")
        b = compute_request_hash("GET", "/api/v1/plans", "b=2&a=1", b"")
        assert a == b

    def test_path_changes_hash(self) -> None:
        a = compute_request_hash("POST", "/api/v1/plans", "", b"{}")
        b = compute_request_hash("POST", "/api/v1/drafts/abc/stages", "", b"{}")
        assert a != b

    def test_empty_body_is_consistent(self) -> None:
        a = compute_request_hash("POST", "/api/v1/plans", "", b"")
        b = compute_request_hash("POST", "/api/v1/plans", "", b"")
        assert a == b
        assert len(a) == 64  # SHA-256 hex


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    """A `TestClient` wired against a throwaway SQLite DB."""
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


# A typed-friendly UUID-shaped key.
_KEY_A = "00000000-1111-2222-3333-444444444444"
_KEY_B = "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb"

_NEW_PLAN_BODY = {
    "display_name": "Idempotency Test Plan",
    "line_of_business": "bop",
    "effective_date": "2026-01-01",
    "jurisdiction": "WI",
}


# ---------------------------------------------------------------------------
# Replay semantics
# ---------------------------------------------------------------------------


class TestReplay:
    """Same key + same body → cached response + Idempotent-Replayed: true."""

    def test_first_request_marks_replay_false(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert response.status_code == 201
        assert response.headers.get("idempotent-replayed") == "false"

    def test_replay_returns_identical_body(self, client: TestClient) -> None:
        first = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert first.status_code == 201
        first_body = first.json()

        replay = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert replay.status_code == 201
        assert replay.headers.get("idempotent-replayed") == "true"
        assert replay.json() == first_body

    def test_replay_does_not_create_second_plan(self, client: TestClient) -> None:
        """The side effect (DB insert) must not fire twice."""
        first = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        plan_id = first.json()["rating_plan_id"]

        # Second POST with same key should return the SAME plan_id
        replay = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert replay.json()["rating_plan_id"] == plan_id

        # And the plans list should have exactly one entry
        listing = client.get("/api/v1/plans?status=all")
        assert listing.status_code == 200
        rows = listing.json()
        assert sum(1 for r in rows if r["rating_plan_id"] == plan_id) == 1

    def test_different_keys_run_independently(self, client: TestClient) -> None:
        """Two distinct keys with the same body create two plans."""
        first = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        second = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_B},
        )
        assert first.json()["rating_plan_id"] != second.json()["rating_plan_id"]


# ---------------------------------------------------------------------------
# Conflict semantics
# ---------------------------------------------------------------------------


class TestConflict:
    """Same key + different body → 409 idempotency_key_conflict."""

    def test_same_key_different_body_returns_409(self, client: TestClient) -> None:
        first = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert first.status_code == 201

        conflicting_body = {**_NEW_PLAN_BODY, "display_name": "Different Name"}
        conflict = client.post(
            "/api/v1/plans",
            json=conflicting_body,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert conflict.status_code == 409
        body = conflict.json()
        assert body["error"]["code"] == "idempotency_key_conflict"
        assert body["error"]["param"] == "Idempotency-Key"
        # The envelope's hint should guide remediation
        assert "Idempotency-Key" in body["error"]["hint"]
        # Details should fingerprint both hashes
        assert "original_request_hash" in body["error"]["details"]
        assert "current_request_hash" in body["error"]["details"]
        assert (
            body["error"]["details"]["original_request_hash"]
            != body["error"]["details"]["current_request_hash"]
        )


# ---------------------------------------------------------------------------
# Key validation
# ---------------------------------------------------------------------------


class TestKeyValidation:
    """Bad Idempotency-Key shapes return 422 validation_error."""

    def test_key_too_short(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": "short"},  # < KEY_MIN_LEN
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "idempotency_key_invalid_length"
        assert response.json()["error"]["param"] == "Idempotency-Key"

    def test_key_too_long(self, client: TestClient) -> None:
        too_long = "x" * (KEY_MAX_LEN + 1)
        response = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": too_long},
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "idempotency_key_invalid_length"

    def test_key_at_min_length_is_accepted(self, client: TestClient) -> None:
        boundary_key = "x" * KEY_MIN_LEN
        response = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": boundary_key},
        )
        assert response.status_code == 201

    def test_key_at_max_length_is_accepted(self, client: TestClient) -> None:
        boundary_key = "x" * KEY_MAX_LEN
        response = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": boundary_key},
        )
        assert response.status_code == 201


# ---------------------------------------------------------------------------
# Pass-through behavior
# ---------------------------------------------------------------------------


class TestPassThrough:
    """GETs + unkeyed POSTs are not cached."""

    def test_get_without_key_passes_through(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans")
        assert response.status_code == 200
        # No replay header on GETs
        assert response.headers.get("idempotent-replayed") is None

    def test_get_with_key_passes_through(self, client: TestClient) -> None:
        """GETs ignore the Idempotency-Key header (already idempotent)."""
        response = client.get(
            "/api/v1/plans",
            headers={"Idempotency-Key": _KEY_A},
        )
        assert response.status_code == 200
        # GETs bypass the middleware entirely — no replay header.
        assert response.headers.get("idempotent-replayed") is None

    def test_post_without_key_is_not_cached(self, client: TestClient) -> None:
        first = client.post("/api/v1/plans", json=_NEW_PLAN_BODY)
        second = client.post("/api/v1/plans", json=_NEW_PLAN_BODY)
        assert first.status_code == 201
        assert second.status_code == 201
        # Different plan_ids — no caching
        assert first.json()["rating_plan_id"] != second.json()["rating_plan_id"]

    def test_unkeyed_post_has_no_replay_header(self, client: TestClient) -> None:
        response = client.post("/api/v1/plans", json=_NEW_PLAN_BODY)
        assert response.status_code == 201
        assert response.headers.get("idempotent-replayed") is None


# ---------------------------------------------------------------------------
# Cache scoping
# ---------------------------------------------------------------------------


class TestCacheScoping:
    """The cache is scoped by (key, method, path)."""

    def test_same_key_different_path_no_conflict(self, client: TestClient) -> None:
        """A key on POST /plans does NOT collide with the same key on a
        different (method, path)."""
        # First request: POST /api/v1/plans with the key
        create = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert create.status_code == 201
        plan_id = create.json()["rating_plan_id"]

        # Second request: same KEY but DIFFERENT (method, path). Cache lookup
        # is keyed by the full triple (key, method, path), so this should be
        # a fresh cache miss — NOT an idempotency_key_conflict.
        delete_response = client.delete(
            f"/api/v1/drafts/{plan_id}",
            headers={"Idempotency-Key": _KEY_A},
        )
        # The DELETE proceeds as normal (plan was a draft; discard succeeds).
        assert delete_response.status_code == 200
        # First-time-seen on this (method, path) → replayed=false
        assert delete_response.headers.get("idempotent-replayed") == "false"

    def test_same_key_same_path_different_method_no_conflict(
        self,
        client: TestClient,
    ) -> None:
        """A key on POST /plans does NOT collide with the same key on
        GET /plans (GETs bypass the middleware anyway)."""
        client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        # Same key, same path, but GET — middleware passes through.
        response = client.get(
            "/api/v1/plans",
            headers={"Idempotency-Key": _KEY_A},
        )
        assert response.status_code == 200
        # No idempotency interaction on GET
        assert response.headers.get("idempotent-replayed") is None


# ---------------------------------------------------------------------------
# Replay header value
# ---------------------------------------------------------------------------


class TestReplayHeaderShape:
    """The Idempotent-Replayed header value follows the documented contract."""

    def test_first_request_replayed_false(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert response.headers.get("idempotent-replayed") == "false"

    def test_second_request_replayed_true(self, client: TestClient) -> None:
        client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        second = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert second.headers.get("idempotent-replayed") == "true"

    def test_replay_preserves_status_code(self, client: TestClient) -> None:
        """A 201 original returns 201 on replay (not 200)."""
        first = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        replay = client.post(
            "/api/v1/plans",
            json=_NEW_PLAN_BODY,
            headers={"Idempotency-Key": _KEY_A},
        )
        assert first.status_code == replay.status_code == 201


# ---------------------------------------------------------------------------
# Boot-time retention sweep
# ---------------------------------------------------------------------------


def _seed_row(conn, key: str, *, ttl_hours: int) -> None:
    """Insert one cached-response row with the given TTL (may be negative
    to force an already-expired row)."""
    store_cached_response(
        conn=conn,
        idempotency_key=key,
        request_method="POST",
        request_path="/api/v1/plans",
        request_hash=compute_request_hash("POST", "/api/v1/plans", "", b"{}"),
        response_status=201,
        response_body=b'{"ok":true}',
        response_headers={"content-type": "application/json"},
        response_media_type="application/json",
        ttl_hours=ttl_hours,
    )


class TestPruneExpiredKeys:
    """`prune_expired_keys` sweeps the backlog the lazy path never touches."""

    @pytest.fixture()
    def db(self) -> Generator[Database, None, None]:
        """A migrated throwaway DB (migration 003 creates idempotency_keys)."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = Path(f.name)
        try:
            database = Database(db_path)
            # Touch a connection so migrations run.
            with database.connection() as conn:
                conn.execute("SELECT 1")
            yield database
        finally:
            for suffix in ("", "-wal", "-shm"):
                p = db_path.with_name(db_path.name + suffix)
                if p.exists():
                    p.unlink()

    def test_deletes_expired_keeps_live(self, db: Database) -> None:
        with db.connection() as conn:
            _seed_row(conn, _KEY_A, ttl_hours=-1)  # already expired
            _seed_row(conn, _KEY_B, ttl_hours=24)  # still live

            deleted = prune_expired_keys(conn)
            assert deleted == 1

            remaining = conn.execute(
                "SELECT idempotency_key FROM idempotency_keys"
            ).fetchall()
            assert [r["idempotency_key"] for r in remaining] == [_KEY_B]

    def test_returns_zero_when_nothing_expired(self, db: Database) -> None:
        with db.connection() as conn:
            _seed_row(conn, _KEY_B, ttl_hours=24)
            assert prune_expired_keys(conn) == 0

    def test_second_sweep_is_a_noop(self, db: Database) -> None:
        with db.connection() as conn:
            _seed_row(conn, _KEY_A, ttl_hours=-1)
            assert prune_expired_keys(conn) == 1
            assert prune_expired_keys(conn) == 0

    def test_pruned_row_no_longer_replays(self, db: Database) -> None:
        """After the sweep, a swept key looks brand-new to a lookup."""
        with db.connection() as conn:
            _seed_row(conn, _KEY_A, ttl_hours=-1)
            prune_expired_keys(conn)
            hit = lookup_cached_response(
                conn=conn,
                idempotency_key=_KEY_A,
                request_method="POST",
                request_path="/api/v1/plans",
            )
            assert hit is None
