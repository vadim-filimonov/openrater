# @openrater/scoring — backend scoring service

Server-side rating for OpenRater. It **reuses the one TypeScript rating
engine** (`@openrater/contracts`) — it does not re-implement or port it — so
server scoring is **byte-identical** to the Rate Lab canvas and inherits
the same projector: exposure divisors, explicit rounding, banded
lookups, multi-input lookups, and the policy tail. A parity test runs
the shared conformance-vector manifest through this service.

The service supports single-risk scoring, asynchronous book scoring,
and headless or scheduled re-rating without a browser.

The runtime guarantees are documented in the
[engine contract](../../docs/specs/engine-contract.md).

## Run locally

```sh
# from the repo root
pnpm install
pnpm --filter @openrater/scoring dev      # tsx watch, http://localhost:8080
# or the container (same artifact you lift to ECS/Fargate):
docker compose -f services/scoring/docker-compose.yml up --build
# Redis-backed queue instead of in-memory:
QUEUE_DRIVER=redis docker compose -f services/scoring/docker-compose.yml --profile redis up --build
```

Tests + typecheck:

```sh
pnpm --filter @openrater/scoring test        # conformance parity + batch lifecycle
pnpm --filter @openrater/scoring typecheck
pnpm --filter @openrater/scoring bench        # 2,000-row synthetic BOP benchmark (add --smoke for 50)
```

## Endpoints

### `POST /score` — single risk (ms)

Body (discriminated on `source`):

```jsonc
{
  "source": "plan",            // "plan" | "plan_stages" | "plan_id"
  "plan": { /* runtime Plan: nodes + edges (conformance shape) */ },
  "inputs": { "tiv": 500000, "class_code": "c101" },
  "options": { "as_of": "2025-07-01", "classLibraryEntries": [] },
  "views":   { "premiumField": "indicated_premium" },
  "trace":   "summary"          // "none" | "summary" | "full"
}
```

Response:

```jsonc
{
  "outputs": { "premium": 1320 },
  "views":   { "premium": 1320, "perCoverage": { "premium": 1320 }, "tier": null },
  "as_of":   "2025-07-01",
  "durationMs": 1,
  "trace":   { /* per-node, when trace != "none" */ }
}
```

- `source: "plan_stages"` — send authored `stages` + `dimensions` +
  `factorTables` + `factorTableCells` (the cell sidecar as
  `{ tableId: { cellKey: factor } }`); the service projects them via the
  reused `stagesToRuntimePlan`.
- `source: "plan_id"` — resolve a frozen plan snapshot from the
  OpenRater API over HTTP. This requires `API_LAB_BASE`; without it,
  the service returns a clear 501 instead of guessing.
- `views` is config-driven because there is **no canonical premium
  field** — `outputs` is keyed by each `output` node's author-chosen
  name. `tier` defaults to the engine's own eligibility projection.

### `POST /score-batch` — a book (async job)

```jsonc
{ "source": "plan", "plan": { ... }, "rows": [ { ... }, { ... } ], "chunkSize": 200 }
```

→ `202 { "jobId", "status": "queued", "total" }`. Then:

- `GET /score-batch/:id` → `{ status, progress: { done, total }, ... }`
- `GET /score-batch/:id/result?offset=0&limit=1000` → a page of per-row
  results + a durable `location` (`file://` locally, `s3://` on AWS) so
  big books never travel inline.

A **scheduled portfolio re-rate** is just a `POST /score-batch` (e.g. a
cron container now, EventBridge → Lambda later) — same path, no special
casing.

### `GET /health`
Liveness + readiness — probes the configured queue + store (503 if a
dependency is down, so a green health check never hides silent job loss).

## Configuration (12-factor — env only)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP bind host |
| `QUEUE_DRIVER` | `memory` | `memory` \| `redis` \| `sqs` (sqs = stub) |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection (when `redis`) |
| `SQS_QUEUE_URL` | — | reserved for the AWS adapter |
| `STORE_DRIVER` | `fs` | `fs` \| `s3` (s3 = stub) |
| `STORE_DIR` | `./.scoring-data` | filesystem store root (when `fs`) |
| `S3_BUCKET` | — | reserved for the AWS adapter |
| `API_LAB_BASE` | `http://127.0.0.1:8001` | OpenRater API base for `plan_id` snapshot resolution |
| `MAX_BATCH_ROWS` | `50000` | reject larger books |
| `CHUNK_SIZE` | `200` | rows per chunk (yield + progress + append) |
| `WORKER_CONCURRENCY` | `1` | in-process worker loops (0 = HTTP only) |

## Ports & adapters (local now → AWS by config)

The scoring **core** (`src/core/`) is deployment-agnostic. Infra sits
behind interfaces with local adapters now and AWS adapters later:

| Port | Interface | Local | AWS (later) |
| --- | --- | --- | --- |
| Job queue | `JobQueue` | `InMemoryJobQueue`, `RedisJobQueue` | `SqsJobQueue` (stub) |
| Result store | `ResultStore` | `FilesystemResultStore` (NDJSON) | `S3ResultStore` (stub) |
| Plan source | `resolvePlan` | `plan` / `plan_stages` | `plan_id` via the OpenRater API |
| Compute | `buildApp()` | docker-compose | ECS/Fargate or Lambda (`dist/lambda.mjs`) |

Switching infrastructure swaps adapter classes and the deploy target;
the core, engine, parity test, and request contract stay unchanged.

## Benchmark (2,000-row synthetic BOP)

Run `pnpm --filter @openrater/scoring bench` (add `--smoke` for 50 rows in
CI). It uses the synthetic V49 exposure-rated-tower vector and reports
single-risk latency, compile-once batch throughput, chunked-worker
throughput, and peak memory for the current machine. Re-run the command
instead of relying on checked-in timing claims.

## Frontend integration

Client-side scoring remains available for live single-risk preview.
The OpenRater API delegates quotes and book runs to this service through
`RATER_SCORING_URL` (default `http://127.0.0.1:8080`).
