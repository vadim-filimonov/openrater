# syntax=docker/dockerfile:1
#
# OpenRater scoring service — multi-stage build.
#
# IMPORTANT: the build context MUST be the repo ROOT (the service's
# workspace deps — @openrater/contracts, @openrater/ui — are bundled by
# esbuild from source):
#
#   docker build -f services/scoring/Dockerfile -t rater-scoring .
#
# or use services/scoring/docker-compose.yml (it sets the context).
# The runtime image is just `node + dist/` because esbuild inlines the
# workspace TS + npm deps into a single ESM bundle (ADR-0045 §7).

# ── build ───────────────────────────────────────────────────────────
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openrater/scoring build

# ── runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/services/scoring/dist ./dist
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
# "Lift the container" to ECS/Fargate unchanged (ADR-0045 "Switch to AWS").
CMD ["node", "dist/server.mjs"]
