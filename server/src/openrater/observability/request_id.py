# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Request ID middleware — correlates logs to client-side traces.

The middleware:

  1. **Generates or accepts a request ID.** If the incoming request
     carries `X-Request-Id`, we use it (clients can pre-tag requests
     for distributed tracing). Else we generate a UUID4.

  2. **Binds it to the structlog context.** Every log line emitted
     during the request includes `request_id=<id>` automatically —
     no manual passing through function args.

  3. **Returns it in the response.** Clients log the
     `X-Request-Id` header on their side and can hand it to support
     when reporting a bad response.

  4. **Logs request start + end** with method, path, status, duration.
     This is the access log; uvicorn's default access log is silenced
     because it doesn't have the request ID.

## Constraints

  · The `X-Request-Id` header from the client is validated as a UUID
    or a 16-200 char ASCII string. Invalid IDs are dropped + replaced
    with a generated UUID (a noisy client can't tamper with our logs).
"""

from __future__ import annotations

import re
import time
import uuid
from contextvars import ContextVar

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

REQUEST_ID_HEADER = "X-Request-Id"

# ContextVar tracks the current request's ID across async boundaries.
# Default is None — outside a request context, `get_request_id()`
# returns None (callers shouldn't depend on it during background tasks).
_request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


# Validation for client-supplied IDs: UUID or 16-200 char ASCII (letters,
# digits, hyphens, underscores).
_VALID_ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,200}$")


def _is_valid_client_id(candidate: str) -> bool:
    """Tighter than UUID — but accepts UUIDs, ULIDs, KSUIDs, nanoids."""
    return bool(_VALID_ID_RE.match(candidate))


def bind_request_id(request_id: str) -> None:
    """Bind the request ID to the structlog context + ContextVar.

    Public so non-HTTP entrypoints (worker tasks, scripts) can adopt the
    same correlation pattern.
    """
    _request_id_var.set(request_id)
    structlog.contextvars.bind_contextvars(request_id=request_id)


def get_request_id() -> str | None:
    """Return the current request's ID, or None outside a request."""
    return _request_id_var.get()


# ---------------------------------------------------------------------------
# The middleware
# ---------------------------------------------------------------------------


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Generate or accept `X-Request-Id`; bind to log context; emit
    access log lines with the ID + method + path + status + duration.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        log = structlog.get_logger("openrater.access")

        # Resolve request ID — accept client header if valid, else generate.
        client_id = request.headers.get(REQUEST_ID_HEADER)
        if client_id and _is_valid_client_id(client_id):
            request_id = client_id
        else:
            request_id = str(uuid.uuid4())

        # Bind for the duration of this request. The structlog
        # contextvar pattern is automatically reset at request end
        # by Starlette's task isolation.
        bind_request_id(request_id)
        structlog.contextvars.bind_contextvars(
            http_method=request.method,
            http_path=request.url.path,
        )

        # Stash on request.state for handlers that want it explicitly
        # (e.g., to include in error envelopes, audit log rows).
        request.state.request_id = request_id

        log.info("request_started")

        start = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.monotonic() - start) * 1000
            log.exception(
                "request_failed_unhandled",
                duration_ms=round(duration_ms, 2),
            )
            # Re-raise so the global error handler can produce the envelope.
            raise

        duration_ms = (time.monotonic() - start) * 1000
        log.info(
            "request_completed",
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2),
        )

        # Echo the request ID back to the client.
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


__all__ = [
    "REQUEST_ID_HEADER",
    "RequestIdMiddleware",
    "bind_request_id",
    "get_request_id",
]
