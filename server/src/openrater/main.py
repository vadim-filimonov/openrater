# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""openrater.main — FastAPI app entry point.

Run locally with:

    cd server
    uv venv && uv sync
    uv run uvicorn openrater.main:app --reload --port 8001

Routes:

    GET  /health                        — liveness probe; confirms DB is reachable.
    /api/v1/...                         — versioned OpenRater REST API.

API versioning policy
=====================

Every endpoint lives under `/api/v{N}/...`. v1 is current; breaking
changes ship as v2 with v1 retained for one release cycle (see
CHANGELOG). Additive changes (new fields, new endpoints, new error
codes) stay within v1.

Error responses follow the structured envelope documented in
`openrater.errors`:

    { "error": { "code": "...", "message": "...", "hint": "...",
                 "param": "...", "details": {...} } }

Idempotency
===========

Mutating requests (POST/PUT/PATCH/DELETE) may carry an
`Idempotency-Key: <client-id>` header. Per Stripe convention:

  · Same key + same body within 24h → cached response replayed
    (no side effects re-fire); response carries
    `Idempotent-Replayed: true`.
  · Same key + different body → 409 `idempotency_key_conflict`.
  · No header → request processed normally; no caching.

See `openrater.middleware.idempotency` for the full contract.

Observability
=============

Every response carries an `X-Request-Id` header. Clients log it on
their side; support tickets that quote it map 1:1 to the backend's
JSON log stream. Logs go to stderr; `RATER_LOG_FORMAT=json|pretty`
chooses output (default: TTY-detect). `RATER_LOG_LEVEL` overrides
verbosity (default: INFO).

See `openrater.observability` for the structlog config + middleware.

Auth shim
=========

OpenRater ships unauthenticated by default; `current_operator()`
returns `operator@openrater.local`. Integrators override via
`openrater.auth.register_operator_resolver(callable)` — the resolver
is called per-request with the `Request`; return the operator id
(or raise `UnauthorizedError` / `ForbiddenError`).

See `openrater.auth` for the registration API + ContextVar pattern.

"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from openrater.app.routes.api_keys_route import (
    router as api_keys_router,
)
from openrater.app.routes.connectors_route import router as connectors_router
from openrater.app.routes.integrations_route import (
    router as integrations_router,
)
from openrater.app.routes.plan_author_route import router as plan_author_router
from openrater.app.routes.plan_class_codes_route import (
    router as plan_class_codes_router,
)
from openrater.app.routes.plan_dimensions_route import (
    router as plan_dimensions_router,
)
from openrater.app.routes.plan_factor_tables_route import (
    router as plan_factor_tables_router,
)
from openrater.app.routes.plan_input_schema_route import (
    router as plan_input_schema_router,
)
from openrater.app.routes.plan_ingest_route import (
    router as plan_ingest_router,
)
from openrater.app.routes.plan_input_mapping_route import (
    router as plan_input_mapping_router,
)
from openrater.app.routes.plan_policy_tail_route import (
    router as plan_policy_tail_router,
)
from openrater.app.routes.plan_runs_route import (
    router as plan_runs_router,
)
from openrater.app.routes.plan_snapshots_route import (
    router as plan_snapshots_router,
)
from openrater.app.routes.plan_templates_route import (
    router as plan_templates_router,
)
from openrater.app.routes.quotes_route import (
    router as quotes_router,
)
from openrater.app.routes.routes_route import router as routes_router
from openrater.auth import OperatorBindingMiddleware
from openrater.errors import UnhandledExceptionMiddleware, register_error_handlers
from openrater.middleware import IdempotencyMiddleware, prune_expired_keys
from openrater.observability import (
    RequestIdMiddleware,
    configure_logging,
    get_logger,
)
from openrater.persistence import Database
from openrater.rates.templates import seed_bundled_templates

# Common local Vite origins. Read from env so production deployments can
# restrict this list without code changes.
_DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
    "http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,"
    "http://localhost:5199,http://127.0.0.1:5199"
)


def _resolve_db_path() -> Path:
    """Resolve the SQLite DB path from env or default to a dev location.

    Env override: `RATER_DB_PATH`. Default: `~/.openrater/openrater.db`.
    """
    env_path = os.environ.get("RATER_DB_PATH")
    if env_path:
        return Path(env_path).expanduser()
    return Path.home() / ".openrater" / "openrater.db"


def _load_local_env() -> None:
    """Load `.env` for local dev so connector secrets (e.g.
    `RATER_GOOGLE_MAPS_API_KEY`) are available. No-op in prod, where the platform
    injects env vars; existing env always wins (`override=False`)."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(override=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the DB + logging on startup; nothing special on shutdown."""
    _load_local_env()
    configure_logging()
    log = get_logger("openrater.lifespan")
    db_path = _resolve_db_path()
    db = Database(db_path)
    # Touch the connection to run migrations + verify the file is writable.
    with db.connection() as conn:
        conn.execute("SELECT 1")
    app.state.db = db
    # D6.4 — seed bundled templates (recipes/*.json) into plan_templates.
    # Idempotent: every restart upserts whatever is in the recipes dir
    # so a dev edit to a JSON file lands on next boot.
    seeded_count = seed_bundled_templates(db=db)
    # Maintenance sweep — drop idempotency-replay rows whose 24h TTL has
    # passed. The middleware only lazy-deletes on same-key re-lookup, so
    # untouched keys accumulate forever on a long-lived box; this bounds the
    # table on every boot. SQLite backups and scoring job artifacts can be
    # swept independently by host cron.
    with db.connection() as conn:
        pruned_idempotency = prune_expired_keys(conn)
    log.info(
        "startup_complete",
        db_path=str(db_path),
        seeded_templates=seeded_count,
        pruned_idempotency_keys=pruned_idempotency,
    )
    yield
    log.info("shutdown")


def create_app() -> FastAPI:
    """Factory for the FastAPI app. Exposed for tests + uvicorn alike."""
    app = FastAPI(
        title="OpenRater · API Lab",
        version="0.1.0",
        description=(
            "FastAPI service hosting the entity registry that Rate Lab "
            "consumes. Part of OpenRater."
        ),
        lifespan=lifespan,
    )

    # Unhandled-exception net, mounted INNER of CORS. Middleware added
    # earlier wraps closer to the routes, so adding this BEFORE CORSMiddleware
    # is what puts it inside the CORS layer — a 500 it builds then flows back
    # out through CORS and carries `Access-Control-Allow-Origin`. Order is
    # load-bearing: added after CORS, its response would bypass CORS and a
    # browser would see the failure as an opaque "CORS error" (see
    # UnhandledExceptionMiddleware's docstring).
    app.add_middleware(UnhandledExceptionMiddleware)

    origins = [
        o.strip()
        for o in os.environ.get("RATER_CORS_ORIGINS", _DEFAULT_CORS_ORIGINS).split(",")
        if o.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    # Idempotency-Key replay (POST/PUT/PATCH/DELETE only). See
    # `openrater.middleware.idempotency` for the contract.
    app.add_middleware(IdempotencyMiddleware)

    # Operator identity. Default resolver returns the stub
    # `operator@openrater.local`; integrators override via
    # `openrater.auth.register_operator_resolver`.
    app.add_middleware(OperatorBindingMiddleware)

    # Request correlation. Generates / accepts `X-Request-Id`, binds it
    # to the structlog context for the duration of the request, emits
    # access log lines, returns the ID in the response headers. Should be
    # the OUTERMOST middleware (last added) so every log line — including
    # ones from the other middlewares — carries the request ID.
    app.add_middleware(RequestIdMiddleware)

    # Structured error envelope — every `RaterError` (and every error
    # subclass under `rates.plans.{author,plan_signoff,errors}`) flows
    # through the handler in `openrater.errors` and produces a body of
    # `{"error": {"code": ..., "message": ..., ...}}`. Per Stripe / Plaid
    # convention; the `code` is the stable contract clients switch on.
    register_error_handlers(app)

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        """Liveness probe. Confirms the app is up + the DB is reachable."""
        with app.state.db.connection() as conn:
            row = conn.execute("SELECT 1 AS ok").fetchone()
            return {"status": "ok", "db": "ok" if row and row[0] == 1 else "fail"}

    # Route registrations. Each router module declares its own paths
    # WITHOUT a version prefix; the prefix is applied here so the
    # versioning policy is owned centrally and lifecycles like a v2
    # bump-up touch one line.
    app.include_router(plan_author_router, prefix="/api/v1")
    # D6.2 / ADR-0027 — plan-scoped dimensions registry.
    app.include_router(plan_dimensions_router, prefix="/api/v1")
    # Brief 51 — per-plan writable class-code registry.
    app.include_router(plan_class_codes_router, prefix="/api/v1")
    # D6.3 / ADR-0027 — plan-scoped factor tables + cells registry.
    app.include_router(plan_factor_tables_router, prefix="/api/v1")
    # Brief 92 / ADR-0065 — deterministic workbook ingestion (check).
    app.include_router(plan_ingest_router, prefix="/api/v1")
    app.include_router(plan_input_schema_router, prefix="/api/v1")
    # D6.1 / ADR-0027 — plan-scoped input mapping singleton.
    app.include_router(plan_input_mapping_router, prefix="/api/v1")
    # ADR-0055 (v4.0 P1) — plan-scoped policy tail singleton.
    app.include_router(plan_policy_tail_router, prefix="/api/v1")
    app.include_router(plan_runs_router, prefix="/api/v1")
    app.include_router(quotes_router, prefix="/api/v1")
    # ADR-0058 — the passive quote ledger's forensic read surface.
    app.include_router(api_keys_router, prefix="/api/v1")
    # D6.4 / ADR-0027 — plan templates registry + /from-template.
    app.include_router(plan_templates_router, prefix="/api/v1")
    # Brief 43 / PR 43.1 — plan snapshots (Analytics workspace versioning).
    app.include_router(plan_snapshots_router, prefix="/api/v1")
    # Brief 47 — API Lab enrichment connectors.
    app.include_router(connectors_router, prefix="/api/v1")
    app.include_router(routes_router, prefix="/api/v1")
    # ADR-0057 / Brief 77 — the integration seam (pairing + descriptor; L1).
    app.include_router(integrations_router, prefix="/api/v1")

    return app


app = create_app()
