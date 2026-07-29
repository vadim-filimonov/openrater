# @openrater/scoring — backend scoring service

Server-side rating for OpenRater. It **reuses the one TypeScript rating
engine** (`@openrater/contracts`) — it does not re-implement or port it — so
server scoring is **byte-identical** to the Rate Lab canvas and inherits
the same projector (including the E13 completion: exposure÷divisor, ISO
roundings, banded→`lookup.range`, dual-input→`lookup.multi`, the plan
tail). A conformance-parity test pins this against the 40 canonical
vectors.

It exists because of finding **E15**: `compilePlan`/`runPlan`/
`executePlanBatch` ran only in the browser, so book-scale scoring
(2,000-policy cold-test books) and headless / scheduled re-rating (the
Brief 62 Portfolio side) were impossible server-side.

Design + rationale + the "Switch to AWS" checklist:
[`docs/adr/0045-backend-scoring-service.md`](../../docs/adr/0045-backend-scoring-service.md).

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
pnpm --filter @openrater/scoring test        # parity (40 vectors) + batch lifecycle
pnpm --filter @openrater/scoring typecheck
pnpm --filter @openrater/scoring bench        # 2,000-row ISO BOP benchmark (add --smoke for 50)
```

## Endpoints

### `POST /score` — single risk (ms)

Body (discriminated on `source`):

```jsonc
{
  "source": "plan",            // "plan" | "plan_stages" | "plan_id"
  "plan": { /* runtime Plan: nodes + edges (conformance shape) */ },
  "inputs": { "tiv": 500000, "class_code": "73912" },
  "options": { "as_of": "2025-07-01", "classLibraryEntries": [] },
  "views":   { "premiumField": "indicated_premium" },
  "trace":   "summary"          // "none" | "summary" | "full"
}
```

Response:

```jsonc
{
  "outputs": { "premium": 1504.8 },
  "views":   { "premium": 1504.8, "perCoverage": { "premium": 1504.8 }, "tier": null },
  "as_of":   "2025-07-01",
  "durationMs": 1,
  "trace":   { /* per-node, when trace != "none" */ }
}
```

- `source: "plan_stages"` — send authored `stages` + `dimensions` +
  `factorTables` + `factorTableCells` (the cell sidecar as
  `{ tableId: { cellKey: factor } }`); the service projects them via the
  reused `stagesToRuntimePlan`.
- `source: "plan_id"` — resolve stages from API Lab over HTTP. **Not yet
  wired** (returns 501); documented follow-up in ADR-0045 §3.
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
| `API_LAB_BASE` | `http://127.0.0.1:8001` | API Lab base (for `plan_id`, follow-up) |
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
| Plan source | `resolvePlan` | `plan` / `plan_stages` | `plan_id` via API Lab (follow-up) |
| Compute | `buildApp()` | docker-compose | ECS/Fargate or Lambda (`dist/lambda.mjs`) |

Switching to AWS swaps adapter classes + the deploy target — the core,
the engine, the parity test, and the request contract are unchanged. See
the **"Switch to AWS" checklist** in ADR-0045.

## Benchmark (2,000-row ISO BOP)

Run `pnpm --filter @openrater/scoring bench` (add `--smoke` for 50 rows in
CI). Plan: V49 exposure-rated-tower (ISO BOP, 15 nodes — exercises the
E13 exposure÷divisor + lookups + ISO rounding). Latest local run, 2,000
rows, `node --max-old-space-size=512`:

| mode | rows | total ms | per-row ms | rows/sec | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| single (`executePlan`, the `/score` path) | 2000 | 15.3 | 0.008 | ~130,000 | 0.006 | 0.016 | 0.027 |
| batch (`executePlanBatch`, compile once) | 2000 | 9.3 | 0.005 | ~215,000 | — | — | — |
| chunked (worker, 200/chunk) | 2000 | 11.0 | 0.006 | ~181,000 | — | — | — |

Peak **rss 112 MB · heapUsed 27.5 MB** — comfortably inside a small
container / Lambda. A 2,000-policy book scores in ~10 ms, far under the
cold-test bar (1,000 rows ≤ 30 s). Numbers vary by host; re-run `bench`
to refresh. (Engine reuse means these are the engine's own throughput —
no server-side overhead beyond HTTP + persistence.)

## Frontend integration

Client-side scoring stays for live single-risk preview. The server is an
**option** for book-scale + headless re-rating, behind `VITE_SCORING_URL`
(additive; nothing is ripped out).
