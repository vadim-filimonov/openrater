# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Tests for the structured error envelope.

Covers:
  · `RaterError` instances produce the documented envelope shape.
  · Subclass-level `code` / `default_status_code` / `default_hint`
    propagate to the response.
  · `details` from specific errors (PlanValidationError.report,
    StageHasDownstreamConsumersError.consumers, etc.) round-trip into
    the response under `error.details`.
  · FastAPI's `RequestValidationError` (a 422 from schema parsing)
    converts to the envelope rather than the legacy `{detail: [...]}`.
  · The RaterError handler is registered on `create_app()`.

Wired against an in-memory SQLite DB so the tests run end-to-end
through the route layer.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from openrater.errors import (
    BadRequestError,
    ConflictError,
    ErrorEnvelope,
    IdempotencyKeyConflictError,
    RaterError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
)

# ---------------------------------------------------------------------------
# Pure-Python envelope shape tests
# ---------------------------------------------------------------------------


class TestErrorEnvelopeShape:
    """Pure-Python tests on `RaterError` + `ErrorEnvelope` — no FastAPI."""

    def test_base_envelope_has_code_and_message(self) -> None:
        envelope = RaterError("Something went wrong").to_envelope()
        assert envelope.code == "internal_error"
        assert envelope.message == "Something went wrong"
        assert envelope.hint is None
        assert envelope.param is None
        assert envelope.details is None

    def test_subclass_overrides_code(self) -> None:
        envelope = NotFoundError("Plan not found", param="rating_plan_id").to_envelope()
        assert envelope.code == "not_found"
        assert envelope.param == "rating_plan_id"

    def test_subclass_default_status_code_is_set_on_instance(self) -> None:
        assert NotFoundError("x").status_code == 404
        assert ConflictError("x").status_code == 409
        assert ValidationError("x").status_code == 422
        assert BadRequestError("x").status_code == 400
        assert UnauthorizedError("x").status_code == 401

    def test_status_code_override_at_init(self) -> None:
        err = RaterError("custom", status_code=418)
        assert err.status_code == 418

    def test_default_hint_propagates(self) -> None:
        envelope = IdempotencyKeyConflictError("Replay mismatch").to_envelope()
        assert envelope.hint is not None
        assert "Idempotency-Key" in envelope.hint

    def test_details_passthrough(self) -> None:
        envelope = NotFoundError(
            "Missing stage",
            details={"available_stage_ids": ["a", "b", "c"]},
        ).to_envelope()
        assert envelope.details == {"available_stage_ids": ["a", "b", "c"]}

    def test_to_response_returns_status_and_envelope(self) -> None:
        response = NotFoundError("Plan not found").to_response()
        assert response.status_code == 404
        # FastAPI JSONResponse stores the body bytes; assert via decoding
        import json

        body = json.loads(response.body)
        assert body == {"error": {"code": "not_found", "message": "Plan not found"}}

    def test_excludes_none_fields_from_response(self) -> None:
        """None-valued envelope fields don't bloat the wire response."""
        import json

        response = NotFoundError("Missing").to_response()
        body = json.loads(response.body)
        assert "hint" not in body["error"]
        assert "param" not in body["error"]
        assert "details" not in body["error"]
        assert "doc_url" not in body["error"]

    def test_envelope_forbids_extra_fields(self) -> None:
        """The envelope is a closed contract — clients can't add fields."""
        with pytest.raises(Exception):  # noqa: B017 (Pydantic ValidationError varies)
            ErrorEnvelope(code="x", message="x", surprise="forbidden")  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# End-to-end envelope tests through the route layer
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
        # Clean up adjacent SQLite WAL/SHM files
        for ext in ("-wal", "-shm"):
            sidecar = db_path.with_suffix(db_path.suffix + ext)
            if sidecar.exists():
                sidecar.unlink()
        os.environ.pop("RATER_DB_PATH", None)


class TestEnvelopeThroughRoutes:
    """End-to-end: routes raise typed errors → handler builds envelope."""

    def test_get_nonexistent_plan_returns_404_envelope(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans/does-not-exist")
        assert response.status_code == 404
        body = response.json()
        assert "error" in body
        assert body["error"]["code"] == "plan_not_found"
        assert "does-not-exist" in body["error"]["message"]
        assert body["error"]["param"] == "rating_plan_id"

    def test_bad_line_of_business_returns_structured_envelope(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans?lob=spaceship")
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "unknown_line_of_business"
        assert body["error"]["param"] == "lob"
        assert body["error"]["hint"] is not None
        # The hint should enumerate valid values
        assert "bop" in body["error"]["hint"]

    def test_bad_status_returns_structured_envelope(self, client: TestClient) -> None:
        response = client.get("/api/v1/plans?status=zombie")
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "unknown_plan_status"
        assert body["error"]["param"] == "status"

    def test_request_validation_error_uses_envelope(self, client: TestClient) -> None:
        """A 422 from Pydantic body parsing also produces the envelope shape."""
        # POST a plan without display_name — the one pydantic-required
        # field left on CreatePlanRequest (Brief 91 made effective_date
        # optional; missing product is a route-level 400, not a 422).
        response = client.post(
            "/api/v1/plans",
            json={},
        )
        assert response.status_code == 422
        body = response.json()
        assert "error" in body
        assert body["error"]["code"] == "validation_error"
        # The legacy `{"detail": [...]}` shape should NOT appear
        assert "detail" not in body
        # The original Pydantic errors should still be available under details
        assert "errors" in body["error"]["details"]
        assert len(body["error"]["details"]["errors"]) > 0

    def test_health_check_still_works(self, client: TestClient) -> None:
        """Sanity: the envelope refactor didn't break unrelated routes."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "db": "ok"}

    def test_unknown_event_kind_in_audit_returns_envelope(self, client: TestClient) -> None:
        # First create a real plan so the route gets past the plan-not-found check
        create_resp = client.post(
            "/api/v1/plans",
            json={
                "display_name": "Envelope Test Plan",
                "line_of_business": "bop",
                "effective_date": "2026-01-01",
                "jurisdiction": "WI",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        plan_id = create_resp.json()["rating_plan_id"]

        response = client.get(
            f"/api/v1/plans/{plan_id}/audit?event_kind=fabricated",
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "unknown_event_kind"
        assert body["error"]["param"] == "event_kind"


class TestUnhandledExceptionEnvelope:
    """A non-RaterError exception escaping a route must NOT leak a bare
    Starlette plain-text 500. `UnhandledExceptionMiddleware` (mounted inner of
    CORS) turns it into the `internal_error` envelope AND — because it catches
    one layer below the CORS middleware — the 500 carries CORS headers, so a
    browser sees the real error instead of a masked "CORS failure"."""

    def test_injected_exception_returns_envelope_with_cors_headers(self) -> None:
        from openrater.main import create_app

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = Path(f.name)
        os.environ["RATER_DB_PATH"] = str(db_path)
        try:
            app = create_app()

            @app.get("/api/v1/_test/unhandled-boom")
            def _boom() -> None:
                raise RuntimeError("injected for the unhandled-exception test")

            origin = "http://localhost:5173"  # an allowed CORS origin
            with TestClient(app, raise_server_exceptions=False) as c:
                resp = c.get(
                    "/api/v1/_test/unhandled-boom", headers={"origin": origin}
                )

            assert resp.status_code == 500
            body = resp.json()
            # The structured envelope, not Starlette's "Internal Server Error".
            assert body == {
                "error": {
                    "code": "internal_error",
                    "message": (
                        "The server hit an unexpected error. The team has been "
                        "notified; this should be safe to retry."
                    ),
                }
            }
            # The raw traceback never reaches the caller.
            assert "Traceback" not in resp.text
            assert "RuntimeError" not in resp.text
            # The fix's point: CORS headers ride the 500, so the browser sees
            # the envelope rather than reporting an opaque CORS failure.
            assert resp.headers.get("access-control-allow-origin") == origin
        finally:
            for ext in ("", "-wal", "-shm"):
                sidecar = Path(str(db_path) + ext)
                if sidecar.exists():
                    sidecar.unlink()
            os.environ.pop("RATER_DB_PATH", None)

    def test_exception_handler_is_registered_on_app(self) -> None:
        """`register_error_handlers` wires the catch-all `Exception` handler
        (the outer safety net for faults in the outer middlewares)."""
        from openrater.errors import _unhandled_exception_handler
        from openrater.main import create_app

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = Path(f.name)
        os.environ["RATER_DB_PATH"] = str(db_path)
        try:
            app = create_app()
            assert app.exception_handlers.get(Exception) is _unhandled_exception_handler
        finally:
            if db_path.exists():
                db_path.unlink()
            os.environ.pop("RATER_DB_PATH", None)

    def test_handler_scrubs_traceback_and_logs_it(self) -> None:
        """The handler logs the exception server-side (event + `exc_info`, from
        which structlog renders the full traceback) but returns only the safe
        envelope to the caller — the internal detail never rides the wire.

        Uses structlog's own `capture_logs` rather than a pytest capture
        fixture: structlog's PrintLogger binds the stderr stream at configure
        time, so capsys/capfd don't reliably intercept its output."""
        import asyncio
        import json as _json

        from starlette.requests import Request
        from structlog.testing import capture_logs

        from openrater.errors import _unhandled_exception_handler

        request = Request(
            {"type": "http", "method": "GET", "path": "/api/v1/whatever", "headers": []}
        )
        exc = RuntimeError("boom-secret-internal-detail")
        with capture_logs() as logs:
            response = asyncio.run(_unhandled_exception_handler(request, exc))

        assert response.status_code == 500
        payload = _json.loads(response.body)
        assert payload["error"]["code"] == "internal_error"
        # The wire response never leaks the internal detail…
        assert "boom-secret-internal-detail" not in response.body.decode()
        # …but the server-side log carries the exception (→ rendered traceback)
        # plus the request context.
        entry = next(e for e in logs if e["event"] == "unhandled_exception")
        assert entry["exc_info"] is exc
        assert entry["path"] == "/api/v1/whatever"
        assert entry["method"] == "GET"


class TestErrorCodesAreSnakeCase:
    """Every code in our public taxonomy is snake_case (Stripe convention)."""

    def test_base_codes_are_snake_case(self) -> None:
        for cls in (
            RaterError,
            NotFoundError,
            ConflictError,
            ValidationError,
            BadRequestError,
            UnauthorizedError,
            IdempotencyKeyConflictError,
        ):
            assert cls.code.islower(), f"{cls.__name__}.code = {cls.code!r}"
            assert " " not in cls.code
            assert "-" not in cls.code

    def test_plan_author_error_codes_are_snake_case(self) -> None:
        from openrater.rates.plans.author import (
            DuplicateIONameError,
            DuplicateStageIdError,
            IllegalStateTransitionError,
            InvalidSequenceError,
            NoArchivedSiblingError,
            OutputHasDownstreamConsumersError,
            PlanAuthorError,
            PlanNotForkableError,
            PlanNotFoundError,
            PlanValidationError,
            StageHasDownstreamConsumersError,
            StageInsertPositionError,
            StageNotFoundError,
            StageReorderBreaksDagError,
            UnknownTemplateError,
            WireCycleError,
            WireInputNameConflictError,
            WireNotFoundError,
            WireOutputNotFoundError,
        )

        for cls in (
            PlanAuthorError,
            PlanNotFoundError,
            PlanNotForkableError,
            IllegalStateTransitionError,
            PlanValidationError,
            UnknownTemplateError,
            DuplicateStageIdError,
            StageInsertPositionError,
            StageNotFoundError,
            StageHasDownstreamConsumersError,
            InvalidSequenceError,
            StageReorderBreaksDagError,
            DuplicateIONameError,
            OutputHasDownstreamConsumersError,
            NoArchivedSiblingError,
            WireCycleError,
            WireNotFoundError,
            WireOutputNotFoundError,
            WireInputNameConflictError,
        ):
            assert cls.code.islower(), f"{cls.__name__}.code = {cls.code!r}"
            assert " " not in cls.code
            assert "-" not in cls.code

    def test_plan_signoff_error_codes_are_snake_case(self) -> None:
        from openrater.rates.plans.plan_signoff import (
            AlreadySignedOffError,
            FilingNotReadyError,
            NotSignedOffError,
            PlanLockedError,
            PlanNotFoundError,
            PlanSignoffError,
        )

        for cls in (
            PlanSignoffError,
            PlanNotFoundError,
            FilingNotReadyError,
            AlreadySignedOffError,
            NotSignedOffError,
            PlanLockedError,
        ):
            assert cls.code.islower(), f"{cls.__name__}.code = {cls.code!r}"


class TestSpecificErrorCodes:
    """Catalog test: every documented code maps to one class."""

    def test_author_codes_are_unique(self) -> None:
        from openrater.rates.plans.author import (
            DuplicateIONameError,
            DuplicateStageIdError,
            IllegalStateTransitionError,
            InvalidSequenceError,
            NoArchivedSiblingError,
            OutputHasDownstreamConsumersError,
            PlanNotForkableError,
            PlanNotFoundError,
            PlanValidationError,
            StageHasDownstreamConsumersError,
            StageInsertPositionError,
            StageNotFoundError,
            StageReorderBreaksDagError,
            UnknownTemplateError,
            WireCycleError,
            WireInputNameConflictError,
            WireNotFoundError,
            WireOutputNotFoundError,
        )

        codes = [
            PlanNotFoundError.code,
            PlanNotForkableError.code,
            IllegalStateTransitionError.code,
            PlanValidationError.code,
            UnknownTemplateError.code,
            DuplicateStageIdError.code,
            StageInsertPositionError.code,
            StageNotFoundError.code,
            StageHasDownstreamConsumersError.code,
            InvalidSequenceError.code,
            StageReorderBreaksDagError.code,
            DuplicateIONameError.code,
            OutputHasDownstreamConsumersError.code,
            NoArchivedSiblingError.code,
            WireCycleError.code,
            WireNotFoundError.code,
            WireOutputNotFoundError.code,
            WireInputNameConflictError.code,
        ]
        assert len(codes) == len(set(codes)), f"Duplicate codes: {codes}"


class TestFrameworkErrorsAreEnveloped:
    """audit A-2026-07-12 P1-12: framework HTTPExceptions (404 on an
    unmatched path, 405 method-not-allowed) used to bypass the RaterError
    envelope and return Starlette's raw `{"detail": ...}`, so an OSS
    integrator switching on `error.code` broke on any of them. They now
    carry the same `{"error": {"code", "message"}}` shape."""

    def test_unmatched_path_404_is_enveloped(self, client: TestClient) -> None:
        r = client.get("/api/v1/nonexistent-xyz")
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "not_found"

    def test_method_not_allowed_405_is_enveloped(
        self, client: TestClient
    ) -> None:
        # the build-report read is GET-only
        r = client.post("/api/v1/plans/x/build-report")
        assert r.status_code == 405
        assert r.json()["error"]["code"] == "method_not_allowed"
