# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Idempotency-Key replay middleware.

Per Stripe/Plaid convention, clients can attach an `Idempotency-Key`
header to mutating requests (POST/PUT/PATCH/DELETE). Behavior:

  1. **First request with the key**: processed normally; the response
     (status + body + headers) is cached under (key, method, path).
     The response includes `Idempotent-Replayed: false`.

  2. **Repeat request with the same key + same body**: the cached
     response is replayed verbatim — same status code, same body,
     same headers — plus `Idempotent-Replayed: true`. The route
     handler is NOT invoked, so side effects (DB writes, audit log
     entries, downstream calls) don't fire a second time.

  3. **Repeat request with the same key + DIFFERENT body**: returns
     `409 idempotency_key_conflict` per `openrater.errors`. Prevents
     accidental reuse of a key with mismatched bodies from corrupting
     state.

  4. **TTL**: keys live 24 hours by default
     (`RATER_IDEMPOTENCY_TTL_HOURS` env override). After expiry the
     key behaves as never-seen.

  5. **GET/HEAD/OPTIONS**: pass through unmolested — these are
     already idempotent by HTTP semantics.

  6. **No header**: pass through unmolested — opt-in feature.

  7. **5xx responses**: NOT cached. Server errors are typically
     transient; clients should be free to retry and get a different
     outcome. Only 2xx + 4xx are cached.

## Header validation

  · `Idempotency-Key`: 16-200 ASCII chars; reject otherwise with
    `validation_error`. (Stripe's range; comfortable for UUIDs,
    ULIDs, KSUIDs, nanoids.)

## Wire shape

The response includes one of these headers on every Idempotency-Key
request:

  · `Idempotent-Replayed: false` — first time we've seen this key
    on this (method, path).
  · `Idempotent-Replayed: true` — cached response replayed.

## Hashing

The body hash is `sha256(method + "\\n" + path + "\\n" +
sorted_querystring + "\\n" + body_bytes).hexdigest()`. Sorted
querystring means `?a=1&b=2` matches `?b=2&a=1`. The body bytes are
the raw request payload before any framework decoding.

## Caveats

  · The middleware buffers the response body in memory before caching.
    Responses > `MAX_CACHED_RESPONSE_BYTES` (default 256 KiB) bypass
    the cache — they execute normally but no entry is stored.
  · The current implementation uses synchronous sqlite3 inside an
    async middleware. That's fine for our scale (low-write, single-
    process); a future async DB layer (M5+) will revisit.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from openrater.errors import (
    IdempotencyKeyConflictError,
    ValidationError,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MUTATING_METHODS: frozenset[str] = frozenset({"POST", "PUT", "PATCH", "DELETE"})
IDEMPOTENCY_HEADER: str = "Idempotency-Key"
REPLAYED_HEADER: str = "Idempotent-Replayed"
DEFAULT_TTL_HOURS: int = 24
MAX_CACHED_RESPONSE_BYTES: int = 256 * 1024  # 256 KiB
KEY_MIN_LEN: int = 16
KEY_MAX_LEN: int = 200


# ---------------------------------------------------------------------------
# Pure helpers (testable without HTTP)
# ---------------------------------------------------------------------------


def compute_request_hash(method: str, path: str, query: str, body: bytes) -> str:
    """SHA-256 hex digest of the canonicalized request.

    Querystring keys are sorted so `?a=1&b=2` and `?b=2&a=1` hash equal.
    Body is hashed verbatim.
    """
    canonical_query = _canonical_query(query)
    parts = [
        method.upper(),
        path,
        canonical_query,
    ]
    digest = hashlib.sha256()
    for p in parts:
        digest.update(p.encode("utf-8"))
        digest.update(b"\n")
    digest.update(body)
    return digest.hexdigest()


def _canonical_query(query: str) -> str:
    """Return the querystring with keys sorted (and same-key values stable)."""
    if not query:
        return ""
    pairs = [pair for pair in query.split("&") if pair]
    pairs.sort()
    return "&".join(pairs)


def _ttl_hours() -> int:
    raw = os.environ.get("RATER_IDEMPOTENCY_TTL_HOURS")
    if not raw:
        return DEFAULT_TTL_HOURS
    try:
        value = int(raw)
        return value if value > 0 else DEFAULT_TTL_HOURS
    except ValueError:
        return DEFAULT_TTL_HOURS


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _future_iso(hours: int) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")


def _validate_key(key: str) -> None:
    """Validate the Idempotency-Key shape. Raises `ValidationError` on bad input."""
    if not (KEY_MIN_LEN <= len(key) <= KEY_MAX_LEN):
        raise ValidationError(
            (
                f"Idempotency-Key must be between {KEY_MIN_LEN} and "
                f"{KEY_MAX_LEN} characters; got {len(key)}."
            ),
            code="idempotency_key_invalid_length",
            hint="Use a fresh UUID (36 chars) or ULID (26 chars).",
            param="Idempotency-Key",
        )
    # ASCII-only check — reject non-printable to keep DB content tame.
    try:
        key.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ValidationError(
            "Idempotency-Key must be ASCII.",
            code="idempotency_key_invalid_charset",
            hint="Strip non-ASCII characters; UUIDs/ULIDs are safe.",
            param="Idempotency-Key",
        ) from exc


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def lookup_cached_response(
    *,
    conn: sqlite3.Connection,
    idempotency_key: str,
    request_method: str,
    request_path: str,
) -> dict[str, Any] | None:
    """Look up a cached response. Returns the row dict, or None.

    Expired rows are deleted on lookup and treated as not-found.
    """
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        """
        SELECT idempotency_key, request_method, request_path, request_hash,
               response_status, response_body, response_headers,
               response_media_type, created_at, expires_at
        FROM idempotency_keys
        WHERE idempotency_key = ? AND request_method = ? AND request_path = ?
        """,
        (idempotency_key, request_method.upper(), request_path),
    ).fetchone()
    if row is None:
        return None

    if row["expires_at"] < _now_iso():
        # Expired — lazy-delete + report not-found.
        conn.execute(
            """
            DELETE FROM idempotency_keys
            WHERE idempotency_key = ? AND request_method = ? AND request_path = ?
            """,
            (idempotency_key, request_method.upper(), request_path),
        )
        conn.commit()
        return None

    return {
        "idempotency_key": row["idempotency_key"],
        "request_method": row["request_method"],
        "request_path": row["request_path"],
        "request_hash": row["request_hash"],
        "response_status": int(row["response_status"]),
        "response_body": row["response_body"],
        "response_headers": json.loads(row["response_headers"]),
        "response_media_type": row["response_media_type"],
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
    }


def store_cached_response(
    *,
    conn: sqlite3.Connection,
    idempotency_key: str,
    request_method: str,
    request_path: str,
    request_hash: str,
    response_status: int,
    response_body: bytes,
    response_headers: dict[str, str],
    response_media_type: str | None,
    ttl_hours: int | None = None,
) -> None:
    """Insert a cached response. Idempotent — re-inserts overwrite via REPLACE."""
    effective_ttl = ttl_hours if ttl_hours is not None else _ttl_hours()
    conn.execute(
        """
        INSERT OR REPLACE INTO idempotency_keys (
            idempotency_key, request_method, request_path, request_hash,
            response_status, response_body, response_headers,
            response_media_type, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            idempotency_key,
            request_method.upper(),
            request_path,
            request_hash,
            response_status,
            response_body.decode("utf-8", errors="replace"),
            json.dumps(response_headers, sort_keys=True),
            response_media_type,
            _now_iso(),
            _future_iso(effective_ttl),
        ),
    )
    conn.commit()


def prune_expired_keys(conn: sqlite3.Connection) -> int:
    """Delete every idempotency row whose TTL has passed. Returns the count.

    The middleware only lazy-deletes an expired row when its *exact* key is
    looked up again (`lookup_cached_response`). A key that is never re-used
    lingers forever, so on a long-lived box the table grows without bound —
    the "periodic cleanup task" the migration-003 header anticipated. Call
    this once at boot to sweep the backlog; the delete rides the
    `idx_idempotency_keys_expires_at` index. String comparison is correct
    because `expires_at` is a fixed-format ISO-8601 UTC timestamp (same
    ordering the lazy-delete path already relies on).
    """
    cursor = conn.execute(
        "DELETE FROM idempotency_keys WHERE expires_at < ?",
        (_now_iso(),),
    )
    conn.commit()
    return cursor.rowcount


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """Starlette middleware implementing Idempotency-Key replay.

    Wire into the app via `app.add_middleware(IdempotencyMiddleware)`.
    The middleware reads `app.state.db` to access the SQLite database.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        # Fast-path: methods we never cache.
        if request.method.upper() not in MUTATING_METHODS:
            return await call_next(request)

        key = request.headers.get(IDEMPOTENCY_HEADER)
        if not key:
            return await call_next(request)

        # Header present — validate shape. We can't `raise` from middleware
        # (Starlette's middleware doesn't go through FastAPI's exception
        # handlers), so we call `.to_response()` directly to produce the
        # structured envelope.
        try:
            _validate_key(key)
        except ValidationError as exc:
            return exc.to_response()

        # Hash request for conflict + dedupe detection. `request.body()` is
        # cached on the Request object after the first await, so downstream
        # handlers see the same bytes.
        body_bytes = await request.body()
        request_hash = compute_request_hash(
            request.method, request.url.path, request.url.query, body_bytes
        )

        # The DB lives on app.state per `main.create_app`.
        db = request.app.state.db

        with db.connection() as conn:
            cached = lookup_cached_response(
                conn=conn,
                idempotency_key=key,
                request_method=request.method,
                request_path=request.url.path,
            )

        if cached is not None:
            if cached["request_hash"] != request_hash:
                # Same key, different body — structured 409 envelope, built
                # directly here since middleware-raised exceptions bypass the
                # FastAPI exception handlers.
                return IdempotencyKeyConflictError(
                    (
                        "Idempotency-Key was reused with a different request "
                        "body."
                    ),
                    param="Idempotency-Key",
                    details={
                        "original_request_hash": cached["request_hash"][:16],
                        "current_request_hash": request_hash[:16],
                        "first_seen_at": cached["created_at"],
                    },
                ).to_response()
            # Replay — return cached response verbatim + replay header.
            replay_headers = dict(cached["response_headers"])
            replay_headers[REPLAYED_HEADER] = "true"
            return Response(
                content=cached["response_body"],
                status_code=cached["response_status"],
                headers=replay_headers,
                media_type=cached["response_media_type"],
            )

        # Cache miss — execute the route + capture the response body.
        response = await call_next(request)
        body_chunks: list[bytes] = []
        async for chunk in response.body_iterator:
            body_chunks.append(
                chunk if isinstance(chunk, bytes) else chunk.encode("utf-8")
            )
        full_body = b"".join(body_chunks)

        # Only cache 2xx + 4xx. 5xx is transient; client should retry fresh.
        should_cache = 200 <= response.status_code < 500 and len(full_body) <= MAX_CACHED_RESPONSE_BYTES

        if should_cache:
            # Normalize headers: lowercase keys; exclude only Content-Length
            # (Starlette recomputes it from the body bytes when we rebuild the
            # Response). Content-Encoding IS preserved — if gzip compressed the
            # body before we saw it, the cached bytes ARE the gzipped bytes,
            # and the replay must announce Content-Encoding: gzip so clients
            # decode correctly. Likewise for any custom headers the route set.
            cacheable_headers = {
                k.lower(): v
                for k, v in response.headers.items()
                if k.lower() != "content-length"
            }
            with db.connection() as conn:
                store_cached_response(
                    conn=conn,
                    idempotency_key=key,
                    request_method=request.method,
                    request_path=request.url.path,
                    request_hash=request_hash,
                    response_status=response.status_code,
                    response_body=full_body,
                    response_headers=cacheable_headers,
                    response_media_type=response.media_type,
                )

        # Rebuild the response (the body_iterator is now exhausted).
        new_headers = dict(response.headers)
        new_headers[REPLAYED_HEADER] = "false"
        return Response(
            content=full_body,
            status_code=response.status_code,
            headers=new_headers,
            media_type=response.media_type,
        )


__all__ = [
    "DEFAULT_TTL_HOURS",
    "IDEMPOTENCY_HEADER",
    "IdempotencyMiddleware",
    "KEY_MAX_LEN",
    "KEY_MIN_LEN",
    "MAX_CACHED_RESPONSE_BYTES",
    "MUTATING_METHODS",
    "REPLAYED_HEADER",
    "compute_request_hash",
    "lookup_cached_response",
    "prune_expired_keys",
    "store_cached_response",
]
