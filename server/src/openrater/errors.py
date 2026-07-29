# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""openrater.errors — structured error envelope + exception handlers.

Every error response the API returns follows the same shape:

    {
      "error": {
        "code": "plan_not_draft",
        "message": "Plan is not in draft status; cannot add stage.",
        "hint": "Fork the plan first to create a new draft.",
        "param": "rating_plan_id",
        "doc_url": "https://openrater.dev/docs/errors/plan_not_draft",
        "details": {...}   // optional, error-specific payload
      }
    }

This is the contract clients integrate against. The `code` is stable
(documented in CHANGELOG); the `message` may shift between releases;
`hint` is the actuary-readable next step; `param` names the bad
input when applicable; `details` carries structured per-error data
(e.g., the list of stages blocking a delete).

Per Stripe / Plaid conventions: codes are snake_case + stable across
minor versions. The envelope is what an integrator builds error
handling against.

## Adding a new error

1. Subclass `RaterError` with a unique `code`, a default `status_code`,
   and a `hint` if there's a non-obvious next step.
2. Document the code in `docs/api/errors.md` (TBD — M3.5.4 OSS scaffolding).
3. Add at least one test asserting the envelope shape.

## Mapping legacy errors

Errors raised inside the service layer (e.g., `PlanNotFoundError`
from `rates.plans.author`) extend `RaterError` directly, so the
exception handler catches them transparently. No try/except wrap
needed in the route layer.
"""

from __future__ import annotations

import math
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from openrater.observability import get_logger

_log = get_logger("openrater.errors")

# ---------------------------------------------------------------------------
# Envelope shape (wire contract)
# ---------------------------------------------------------------------------


class ErrorEnvelope(BaseModel):
    """The serialized error body, wrapped under `{"error": ...}`."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(
        description=(
            "Stable, snake_case error identifier. Clients should switch on "
            "this, not on `message`. Documented in CHANGELOG; semver-gated."
        ),
        examples=["plan_not_found", "validation_error"],
    )
    message: str = Field(
        description=(
            "Human-readable error description in actuary language. May "
            "change between releases; don't switch on the text."
        ),
        examples=["Plan not found: 'iso.bop.wi.2026'"],
    )
    hint: str | None = Field(
        default=None,
        description=(
            "Actionable next step the actuary / integrator can take. "
            "Omitted when the message is self-explanatory."
        ),
        examples=["Fork the plan first to create a new draft."],
    )
    param: str | None = Field(
        default=None,
        description=(
            "When the error pinpoints a specific request field, the field "
            "name. Maps to OpenAPI parameter / body property name."
        ),
        examples=["rating_plan_id", "line_of_business"],
    )
    doc_url: str | None = Field(
        default=None,
        description="Link to per-code documentation. Omitted until docs exist.",
        examples=["https://openrater.dev/docs/errors/plan_not_found"],
    )
    details: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Optional structured payload specific to this error code "
            "(e.g., the list of consumers blocking a delete)."
        ),
    )


# ---------------------------------------------------------------------------
# RaterError base class
# ---------------------------------------------------------------------------


class RaterError(Exception):
    """Base class for every error that maps to a structured HTTP response.

    Subclasses set class-level `code`, `default_status_code`, and
    optionally `default_hint` / `default_doc_url`. Instances can
    override these per-raise plus attach `param` / `details`.
    """

    code: str = "internal_error"
    default_status_code: int = 500
    default_hint: str | None = None
    default_doc_url: str | None = None

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        hint: str | None = None,
        param: str | None = None,
        doc_url: str | None = None,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        # Per-instance `code` overrides the class-level `code` — useful when
        # raising a generic subclass (e.g., `BadRequestError`) and pinpointing
        # a more specific code at the call site (e.g., "unknown_line_of_business").
        self._instance_code: str | None = code
        self.hint = hint if hint is not None else self.default_hint
        self.param = param
        self.doc_url = doc_url if doc_url is not None else self.default_doc_url
        self.details = details
        self.status_code = status_code if status_code is not None else self.default_status_code

    @property
    def effective_code(self) -> str:
        """Per-instance code if set; otherwise the class-level code."""
        return self._instance_code if self._instance_code is not None else self.code

    def to_envelope(self) -> ErrorEnvelope:
        return ErrorEnvelope(
            code=self.effective_code,
            message=self.message,
            hint=self.hint,
            param=self.param,
            doc_url=self.doc_url,
            details=self.details,
        )

    def to_response(self) -> JSONResponse:
        return JSONResponse(
            status_code=self.status_code,
            content={"error": self.to_envelope().model_dump(exclude_none=True)},
        )


# ---------------------------------------------------------------------------
# Generic subclasses for common HTTP shapes
# ---------------------------------------------------------------------------


class NotFoundError(RaterError):
    """4xx — the resource doesn't exist or isn't visible to the caller."""

    code = "not_found"
    default_status_code = 404


class ConflictError(RaterError):
    """4xx — the request can't proceed in the current resource state."""

    code = "conflict"
    default_status_code = 409


class StaleWriteError(RaterError):
    """412 — the caller's If-Match no longer matches the stored content:
    another writer (a second tab, another caller) changed the resource
    since the caller last read it. The write was refused, nothing was
    clobbered; `details.current_hash` carries the hash to reload against
    (v4 G14)."""

    code = "stale_write"
    default_status_code = 412


class ValidationError(RaterError):
    """4xx — the request body or query failed validation."""

    code = "validation_error"
    default_status_code = 422


class BadRequestError(RaterError):
    """4xx — malformed request the framework couldn't catch."""

    code = "bad_request"
    default_status_code = 400


class UnauthorizedError(RaterError):
    """401 — caller is not authenticated."""

    code = "unauthorized"
    default_status_code = 401


class ForbiddenError(RaterError):
    """403 — caller is authenticated but lacks permission."""

    code = "forbidden"
    default_status_code = 403


class IdempotencyKeyConflictError(ConflictError):
    """409 — same Idempotency-Key reused with a different request body."""

    code = "idempotency_key_conflict"
    default_hint = (
        "Generate a fresh Idempotency-Key for the new request, or replay "
        "the original request body verbatim."
    )


# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------


async def _rater_error_handler(request: Request, exc: RaterError) -> JSONResponse:
    """Convert any `RaterError` into the structured envelope."""
    _ = request
    return exc.to_response()


def _json_safe(value: Any) -> Any:
    """Make a pydantic-error payload safe for Starlette's JSON encoder,
    which rejects non-finite floats (`allow_nan=False`). A failed
    `allow_inf_nan=False` field echoes the raw `-inf`/`nan` in `input`;
    without this the error handler itself 500s. Also stringifies ctx
    Exceptions. Recurses into dicts/lists so a nested bad value is safe."""
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)  # "inf" / "-inf" / "nan" — informative + serializable
    if isinstance(value, Exception):
        return str(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


async def _validation_error_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """Convert FastAPI's request-shape validation error into our envelope.

    FastAPI's default response is `{ "detail": [...] }`. We rewrap as
    `{ "error": { "code": "validation_error", "details": { "errors": [...] } } }`
    so clients have one error shape to switch on.

    Pydantic v2's `.errors()` can embed raw exception instances inside
    `ctx.error` for `value_error` types (e.g. ValueError raised from a
    `@model_validator`). Those aren't JSON-serializable. We stringify
    any non-primitive `ctx` payload to keep the response stable.
    """
    _ = request
    raw = exc.errors()
    # `_json_safe` scrubs values that Starlette's JSON encoder rejects:
    # a non-finite float (the `input` echo of a failed allow_inf_nan=False
    # field carried the raw `-inf`/`nan`, which crashed json.dumps →
    # turned a clean 422 into a 500; audit A-2026-07-12 P1-03/P1-12) and a
    # ctx Exception. Recurses so a nested bad value in `input` is safe too.
    sanitized: list[dict[str, Any]] = [_json_safe(dict(err)) for err in raw]

    first_param = None
    if sanitized and isinstance(sanitized[0].get("loc"), (list, tuple)) and sanitized[0]["loc"]:
        # loc is like ("body", "line_of_business") — take the last segment
        first_param = str(sanitized[0]["loc"][-1])

    envelope = ErrorEnvelope(
        code="validation_error",
        message="Request body failed schema validation.",
        hint="Inspect `details.errors` for the specific fields that failed.",
        param=first_param,
        details={"errors": sanitized},
    )
    return JSONResponse(
        status_code=422,
        content={"error": envelope.model_dump(exclude_none=True)},
    )


async def _unhandled_exception_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    """Last-resort: catch anything not a RaterError. Logs the full traceback
    server-side, then returns a 500 carrying the safe `internal_error`
    envelope — never the raw traceback, which could leak internals to the
    caller."""
    _log.error(
        "unhandled_exception",
        exc_info=exc,
        path=request.url.path,
        method=request.method,
    )
    envelope = ErrorEnvelope(
        code="internal_error",
        message=(
            "The server hit an unexpected error. The team has been notified; "
            "this should be safe to retry."
        ),
    )
    return JSONResponse(
        status_code=500,
        content={"error": envelope.model_dump(exclude_none=True)},
    )


class UnhandledExceptionMiddleware:
    """Turn any exception escaping a route/service into the `internal_error`
    envelope — from INSIDE the CORS layer, so the 500 carries CORS headers.

    Why a middleware and not just the registered `Exception` handler:
    Starlette hands the catch-all `Exception`/500 handler to its OUTERMOST
    `ServerErrorMiddleware`, which sits ABOVE `CORSMiddleware`. A response
    built there never flows back through CORS, so a browser sees a
    header-less 500 and the fetch fails as an opaque "CORS error" — masking
    the real fault. Catching one layer BELOW CORS (this middleware is mounted
    inner of it in `create_app`) lets the envelope response pass back out
    through CORS and pick up `Access-Control-Allow-Origin`. The registered
    handler stays as the net for failures in the outer middlewares
    themselves. Both share `_unhandled_exception_handler`, so the envelope
    and the traceback log are identical whichever layer catches.

    Why pure-ASGI and NOT `BaseHTTPMiddleware`: a `BaseHTTPMiddleware`
    re-emits every response through an async generator, dropping the
    Content-Length and turning fixed-size responses into streamed ones. Mounted
    inside `GZipMiddleware`, that re-streaming changes how the outer
    middlewares see the body — it corrupted `IdempotencyMiddleware`'s stored
    gzip bytes on replay. A pure ASGI middleware is fully transparent on the
    success path: it forwards the ASGI messages untouched and only synthesizes
    a response when the app raises BEFORE the response has started."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def _send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception as exc:  # noqa: BLE001 — deliberate catch-all net
            if response_started:
                # Headers are already on the wire; we can't swap in the
                # envelope. Re-raise for the outer ServerErrorMiddleware.
                raise
            request = Request(scope, receive)
            response = await _unhandled_exception_handler(request, exc)
            await response(scope, receive, send)


_HTTP_ERROR_CODES = {
    404: "not_found",
    405: "method_not_allowed",
    406: "not_acceptable",
    415: "unsupported_media_type",
}


async def _http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    """Framework HTTPExceptions — a 404 on an unmatched/mistyped path, a
    405 method-not-allowed — bypass the RaterError envelope and return
    Starlette's raw `{"detail": ...}`. Remap them into the ONE uniform
    `{"error": {"code", "message"}}` shape so an OSS integrator can switch
    on `error.code` for every error, not just the ones raised by a route
    handler (audit A-2026-07-12 P1-12). Route-level 404s already use
    RaterError and are unaffected."""
    _ = request
    code = _HTTP_ERROR_CODES.get(exc.status_code, "http_error")
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    envelope = ErrorEnvelope(code=code, message=message)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": envelope.model_dump(exclude_none=True)},
        headers=getattr(exc, "headers", None),
    )


def register_error_handlers(app: FastAPI) -> None:
    """Wire all error handlers onto the app. Call once in `create_app`."""
    app.add_exception_handler(RaterError, _rater_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)  # type: ignore[arg-type]
    # Catch-all for non-RaterError exceptions: scrub the traceback from the
    # response (returning the `internal_error` envelope) while logging it
    # server-side. Starlette routes this to its OUTERMOST ServerErrorMiddleware
    # (above CORS), so it's the last-resort net for faults in the outer
    # middlewares; the common case — a route/service blowing up — is caught
    # by `UnhandledExceptionMiddleware`, mounted inner of CORS in create_app,
    # which returns the SAME envelope but WITH CORS headers so browser
    # clients see the real error instead of a masked "CORS failure".
    app.add_exception_handler(Exception, _unhandled_exception_handler)  # type: ignore[arg-type]


__all__ = [
    "BadRequestError",
    "ConflictError",
    "ErrorEnvelope",
    "ForbiddenError",
    "IdempotencyKeyConflictError",
    "RaterError",
    "NotFoundError",
    "UnauthorizedError",
    "UnhandledExceptionMiddleware",
    "ValidationError",
    "register_error_handlers",
]
