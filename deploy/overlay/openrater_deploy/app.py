"""Deploy entrypoint — `uvicorn openrater_deploy.app:app`.

Composes the unchanged OSS core app with:
  - a Cloudflare Access operator resolver (verifies the Access JWT and
    maps the authenticated email -> operator id), and
  - static serving of the built Rate Lab SPA with client-side-routing
    fallback, so the SPA and the API live behind one origin.

Environment:
  RATER_AUTH_MODE             "cloudflare" (default) | "none" (local testing).
  RATER_CF_ACCESS_TEAM_DOMAIN your team domain, e.g. "acme.cloudflareaccess.com".
  RATER_CF_ACCESS_AUD         the Access application's Audience (AUD) tag.
  RATER_OPERATOR_ALLOWLIST    optional, comma-separated emails (defense-in-depth
                             on top of the Cloudflare Access policy).
  RATER_SPA_DIR               directory holding the built SPA (default /app/spa).

All other config (DB path, CORS, logging) is read by the OSS core from its
own env vars — see docs/AWS_DEPLOYMENT_PLAN.md / deploy/.env.example.
"""

from __future__ import annotations

import contextlib
import os
from pathlib import Path

from fastapi import Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from openrater.auth import register_operator_resolver
from openrater.errors import ForbiddenError, UnauthorizedError
from openrater.main import create_app
from openrater.observability.logging import get_logger
from openrater_deploy.seed import maybe_seed_cold_test
from openrater_deploy.wire import is_integration_wire

_log = get_logger("openrater_deploy.app")

# The unchanged OSS core app.
app = create_app()

# ---------------------------------------------------------------------------
# The shipped reference plan (RATER_SEED_COLD_TEST — default ON in compose).
# Wrap the core lifespan so the seed runs AFTER migrations + the core's own
# seeding, then hand control back. Keeping this in the overlay preserves the
# core's "no auto-seed" stance (ADR-0053) — the DEPLOY opts in by default;
# set SEED_COLD_TEST=0 to ship empty. See openrater_deploy.seed.
# ---------------------------------------------------------------------------
_core_lifespan = app.router.lifespan_context


@contextlib.asynccontextmanager
async def _lifespan_with_seed(app):  # noqa: ANN001 — Starlette lifespan signature
    async with _core_lifespan(app):
        try:
            maybe_seed_cold_test(app.state.db)
        except Exception:  # best-effort: never block boot on a seed hiccup
            _log.exception("cold_test_seed_failed")
        yield


app.router.lifespan_context = _lifespan_with_seed

# ---------------------------------------------------------------------------
# Operator identity — Cloudflare Access.
# ---------------------------------------------------------------------------
_MODE = os.environ.get("RATER_AUTH_MODE", "cloudflare").strip().lower()
_TEAM = os.environ.get("RATER_CF_ACCESS_TEAM_DOMAIN", "").strip()
_AUD = os.environ.get("RATER_CF_ACCESS_AUD", "").strip()
_ALLOW = {
    e.strip().lower()
    for e in os.environ.get("RATER_OPERATOR_ALLOWLIST", "").split(",")
    if e.strip()
}

_jwk_client = None
if _MODE == "cloudflare":
    if not (_TEAM and _AUD):
        raise RuntimeError(
            "RATER_AUTH_MODE=cloudflare requires RATER_CF_ACCESS_TEAM_DOMAIN and "
            "RATER_CF_ACCESS_AUD to be set. (Set RATER_AUTH_MODE=none for local "
            "testing without Cloudflare.)"
        )
    import jwt  # PyJWT[crypto] — overlay-only dependency.

    # PyJWKClient fetches + caches the Access signing keys (RS256) from the
    # team certs endpoint. One client, reused across requests.
    _jwk_client = jwt.PyJWKClient(f"https://{_TEAM}/cdn-cgi/access/certs")


async def _resolver(request) -> str:
    """Return the operator id (email) for the current request.

    Called by the core's OperatorBindingMiddleware on every request.
    """
    # The container's own health probe hits /health directly (no Cloudflare
    # headers); let it through. Cloudflare never needs to call /health.
    if request.url.path == "/health":
        return "healthcheck@openrater.local"

    # The integration seam's machine endpoints authenticate themselves
    # (single-use pairing code / X-OpenRater-Integration-Key) and arrive from the
    # peer platform's SERVER — no Access session exists to present. Stand
    # aside for exactly those five; every operator endpoint below keeps
    # demanding the JWT. See openrater_deploy.wire + runbook Part A (the matching
    # edge Bypass).
    if is_integration_wire(request.method, request.url.path):
        return "integration-wire@openrater.local"

    # Local-testing escape hatch: no Cloudflare in front.
    if _MODE == "none":
        return "demo@local"

    import jwt

    # Cloudflare injects the Access JWT on every proxied request after the
    # user authenticates. It is ALSO available as the CF_Authorization cookie.
    token = request.headers.get("Cf-Access-Jwt-Assertion") or request.cookies.get(
        "CF_Authorization"
    )
    if not token:
        raise UnauthorizedError("missing Cloudflare Access token")
    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=_AUD,
        )
    except Exception as exc:  # jwt.PyJWTError + key-fetch failures
        raise UnauthorizedError(f"invalid Cloudflare Access token: {exc}")

    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise UnauthorizedError("Cloudflare Access token has no email claim")

    # Optional second gate, independent of the Cloudflare policy.
    if _ALLOW and email not in _ALLOW:
        raise ForbiddenError(f"operator {email} is not on the allowlist")

    return email


register_operator_resolver(_resolver)


# ---------------------------------------------------------------------------
# Serve the built SPA (mounted LAST so the API routers + /health win).
# ---------------------------------------------------------------------------
_SPA_DIR = os.environ.get("RATER_SPA_DIR", "/app/spa")


class _SPAStaticFiles(StaticFiles):
    """StaticFiles that falls back to index.html for unknown paths.

    The Rate Lab SPA uses BrowserRouter (real path routes), so a deep link
    or hard refresh to /rate-lab or /rate-lab/abc must return index.html,
    not a 404. Starlette signals a missing file by RAISING
    HTTPException(404) — it does not return a 404 response — so the
    fallback must catch, not inspect a status code.

    Two carve-outs keep honest 404s honest:
      - api/    an unknown API path stays a JSON 404 for machine callers;
      - assets/ a missing hashed bundle must fail as a 404 (serving
                index.html as "JavaScript" would mask a stale-cache or
                broken-deploy problem behind a MIME-type error).
    """

    async def get_response(self, path: str, scope: Scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path.startswith(("api/", "assets/")):
                raise
            return await super().get_response("index.html", scope)


if Path(_SPA_DIR).is_dir():
    # Added after create_app()'s routers, so /api/v1/* and /health match
    # first; this mount catches everything else (the SPA + its assets).
    app.mount("/", _SPAStaticFiles(directory=_SPA_DIR, html=True), name="spa")
