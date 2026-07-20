# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Auth shim — the integrator-overridable operator identity layer.

OpenRater ships unauthenticated by default. The audit log + every
mutating action wants to attribute itself to AN operator, so the
service layer reads `current_operator()` whenever it writes a row.
This module provides:

  1. **A default resolver** that returns the stub
     `\"operator@openrater.local\"` — fine for local dev, fine for the
     OSS conformance suite, NOT fine for a carrier integration.

  2. **A registration hook** carriers use to plug their own auth into
     `current_operator()` without forking the codebase.

## Usage from an integrator

::

    # In your app's startup module:
    from fastapi import Request
    from openrater.auth import register_operator_resolver

    async def my_jwt_resolver(request: Request) -> str:
        token = request.headers.get(\"Authorization\", \"\").removeprefix(\"Bearer \")
        claims = jwt.decode(token, key=JWKS, algorithms=[\"RS256\"])
        return claims[\"sub\"]  # e.g., \"alice@acmecorp.com\"

    register_operator_resolver(my_jwt_resolver)

The resolver is called by `OperatorBindingMiddleware` at the start of
every request. It can return a string (the operator id), raise
`UnauthorizedError` (the request gets a 401 envelope), or raise
`ForbiddenError` (403 envelope).

## How the service layer reads it

::

    # Inside any function called during a request:
    from openrater.auth import current_operator

    op = current_operator()  # e.g., \"alice@acmecorp.com\"
    write_audit_event(..., operator_id=op)

`current_operator()` reads a `ContextVar` that's set by the middleware
at request start. Outside a request (background tasks, scripts), it
returns the default stub.

## Why this pattern

  · **No magic.** A new contributor reads `auth.py` and knows where the
    operator id comes from in 60 seconds.
  · **No fork.** Carriers customize via `register_operator_resolver`;
    no need to patch service-layer files.
  · **Honest about scope.** This is an IDENTITY shim, not an
    authorization framework. Permissions / RBAC / policy live higher
    in the integrator's stack — not in API Lab.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from openrater.errors import RaterError

DEFAULT_OPERATOR_ID = "operator@openrater.local"
"""Stub identity when no auth is wired. Carriers MUST override via
`register_operator_resolver`."""


# Type aliases for the resolver. Sync + async both supported.
OperatorResolver = Callable[[Request], str | Awaitable[str]]


# Module-level state — the active resolver. Defaults to the stub.
async def _default_resolver(request: Request) -> str:  # noqa: ARG001 (request unused)
    return DEFAULT_OPERATOR_ID


_resolver: OperatorResolver = _default_resolver


# ContextVar tracking the current request's operator. Set by
# `OperatorBindingMiddleware` at request start; read by `current_operator`.
_operator_var: ContextVar[str] = ContextVar("operator", default=DEFAULT_OPERATOR_ID)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def register_operator_resolver(resolver: OperatorResolver) -> None:
    """Override the operator resolver. Call once at app startup.

    The resolver is invoked by `OperatorBindingMiddleware` at the start
    of every HTTP request, with the incoming `Request` object. Return
    the operator id (string); or raise `UnauthorizedError` / `ForbiddenError`
    from `openrater.errors` for auth failures.

    Sync and async resolvers are both supported.
    """
    global _resolver
    _resolver = resolver


def reset_operator_resolver() -> None:
    """Restore the default (stub) resolver. For tests + dev iteration."""
    global _resolver
    _resolver = _default_resolver


def current_operator() -> str:
    """Return the operator id for the current request.

    Outside a request context (background tasks, scripts), returns
    `DEFAULT_OPERATOR_ID`.
    """
    return _operator_var.get()


def is_operator_authenticated() -> bool:
    """True when a REAL (non-stub) operator resolved for this request — an
    integrator's auth is wired AND authenticated the caller. False in the
    OSS/dev default (the stub operator). The quote gate (Brief 76 P4.2)
    uses this to let the in-app try-it through without an API key."""
    return current_operator() != DEFAULT_OPERATOR_ID


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class OperatorBindingMiddleware(BaseHTTPMiddleware):
    """Call the registered resolver at request start; bind the operator
    id to the ContextVar for the duration of the request.

    Auth errors raised by the resolver flow through the envelope
    handler — we call `.to_response()` directly because middleware-
    raised exceptions bypass FastAPI's exception handlers (same pattern
    as `IdempotencyMiddleware`).
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        try:
            result = _resolver(request)
            operator_id = await result if asyncio.iscoroutine(result) else result
        except RaterError as exc:
            return exc.to_response()

        token = _operator_var.set(operator_id)
        try:
            # Stash on request.state for handlers that want it explicitly.
            request.state.operator_id = operator_id
            return await call_next(request)
        finally:
            _operator_var.reset(token)


__all__ = [
    "DEFAULT_OPERATOR_ID",
    "OperatorBindingMiddleware",
    "OperatorResolver",
    "current_operator",
    "register_operator_resolver",
    "reset_operator_resolver",
]
