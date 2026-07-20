# OpenRater — demo deployment image.
#
# Single image that serves BOTH the Rate Lab SPA (static files) and the
# OpenRater server (FastAPI) on one port, behind a Cloudflare Access gate.
# Built + run by deploy/docker-compose.yml on an AWS Lightsail box.
#
# This image imports the OSS core unchanged (openrater.main:create_app) and
# only adds a thin deploy overlay (deploy/overlay/openrater_deploy) for static
# serving + the Cloudflare-Access operator resolver. No core edits.
#
# Build context = repo root (see docker-compose.yml `context: ..`).

# ---------------------------------------------------------------------------
# Stage 1 — build the Rate Lab SPA (pnpm workspace build).
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# The SPA bakes the API base URL at build time (fetcher uses `new URL`,
# which needs an ABSOLUTE base). Set it to the public demo URL — the app
# is served from that same origin, so every call is same-origin.
ARG VITE_API_BASE
ENV VITE_API_BASE=${VITE_API_BASE}
# Give Node more heap headroom so the bundle builds on a small box
# (Lightsail 2GB RAM + swap).
ENV NODE_OPTIONS=--max-old-space-size=3072
# Build the shared packages, then bundle the SPA with vite directly.
# We intentionally skip rate-lab's `tsc --noEmit` typecheck here: it is a
# CI quality gate (already enforced on every PR), it is NOT needed to
# produce the deployable bundle, and it is the dominant memory consumer
# that OOM-killed the build on a 2GB box.
RUN pnpm -r --filter='./packages/*' build \
 && pnpm --filter @openrater/app exec vite build
# Output: /repo/frontend/dist

# ---------------------------------------------------------------------------
# Stage 2 — runtime: FastAPI backend + the built SPA + the deploy overlay.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir uv

WORKDIR /app/backend
# Install the OpenRater server + its deps from the committed lockfile.
COPY server/pyproject.toml server/uv.lock server/README.md ./
COPY server/src ./src
RUN uv sync --frozen --no-dev

# Activate the project venv for subsequent installs + the run command.
ENV VIRTUAL_ENV=/app/backend/.venv
ENV PATH=/app/backend/.venv/bin:$PATH
# Overlay-only dependencies — deliberately NOT in server/pyproject.toml (keeps
# the OSS core dependency-light per SECURITY.md):
#   pyjwt[crypto] — verify the Cloudflare Access token.
RUN uv pip install "pyjwt[crypto]>=2.8"

# The deploy overlay (entrypoint + Cloudflare resolver + SPA static serving).
COPY deploy/overlay /app/overlay
# The built SPA from stage 1.
COPY --from=frontend /repo/frontend/dist /app/spa

ENV PYTHONPATH=/app/backend/src:/app/overlay
ENV RATER_SPA_DIR=/app/spa
ENV RATER_LOG_FORMAT=json

# The bundled synthetic demo plans: every *.plan.json in docs/fixtures/ is
# seeded on boot by default (RATER_SEED_COLD_TEST, see openrater_deploy/
# seed.py). The seeder no-ops cleanly when the directory contains no plans.
# The env points at the DIRECTORY; the seeder loads every *.plan.json.
COPY docs/fixtures/ /app/fixtures/
ENV RATER_COLD_TEST_FIXTURE=/app/fixtures


EXPOSE 8001
# One worker: a single SQLite-backed process. Move to a shared database before
# scaling to multiple workers or instances.
CMD ["uvicorn", "openrater_deploy.app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
