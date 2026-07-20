# openrater-server

The FastAPI service ("API Lab") — plans, stages, entities, factor
tables, workbook ingestion, quotes + API keys, snapshots/publish, the
Portfolio book of record, and integration events. The web app and the
MCP server are both clients of this API; rating math itself lives in
`services/scoring` (the server delegates every quote and run there).

Part of [OpenRater](../README.md) — see the repo root for the product
story and quickstart.

## Install + run

From the **repo root**:

```sh
uv sync --project server
pnpm dev:server     # uvicorn on http://127.0.0.1:8001
```

Or standalone from this directory:

```sh
PYTHONPATH=src uv run uvicorn openrater.main:app --reload --port 8001
```

Then:

```sh
curl http://localhost:8001/health
# {"status":"ok","db":"ok"}
```

Tests: `uv run pytest` from this directory (pytest's `pythonpath` is
configured in `pyproject.toml`).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `RATER_DB_PATH` | `~/.openrater/openrater.db` | SQLite DB path |
| `RATER_SCORING_URL` | dev scoring sidecar | Base URL of the scoring service |
| `RATER_SEED_COLD_TEST` | `1` (deploy/desktop) | Seed the synthetic Meridian demo program on boot (`0` = ship empty, `reset` = restore each boot). Read by the deploy overlay + desktop runtime; the plain dev server does not seed — use `scripts/plan_fixture.py load` |
| `RATER_CORS_ORIGINS` | dev Vite hosts | Comma-separated CORS allowlist |
| `RATER_QUOTE_REQUIRE_KEY` | off | Require API keys on `/quote` |
| `RATER_LOG_FORMAT` / `RATER_LOG_LEVEL` | `pretty` / `INFO` | Structured logging |
| `RATER_DB_DIALECT` | `sqlite` | Forward-compat dialect switch |
| `RATER_IDEMPOTENCY_TTL_HOURS` | `24` | TTL for cached Idempotency-Key responses |

The full `RATER_*` surface is enumerated in the repo-root
[`.env.example`](../.env.example). Auth posture (unauthenticated by
default, `register_operator_resolver` integration hook) is documented
in [`SECURITY.md`](../SECURITY.md) and `src/openrater/auth.py`.

## API conventions

### Versioning

Every route lives under `/api/v{N}/...`. v1 is current. Breaking
changes ship as v2 with v1 retained for one release cycle.
Additive changes (new fields, new endpoints) stay within v1.

### Structured error envelope

Every non-2xx response uses:

```json
{
  "error": {
    "code": "plan_not_found",
    "message": "Plan not found: 'meridian.bop.ne.2026'",
    "hint": "Check the rating_plan_id; list plans with GET /api/v1/plans.",
    "param": "rating_plan_id",
    "details": { "...": "..." }
  }
}
```

Clients switch on `code` (snake_case, stable across minor versions —
changes are noted in the repo CHANGELOG). See `openrater.errors` for
the full taxonomy.

### Idempotency-Key

Mutating requests (POST/PUT/PATCH/DELETE) may carry an
`Idempotency-Key: <client-generated-id>` header. Behavior:

- **First request**: processed normally; response cached for 24h.
  Response carries `Idempotent-Replayed: false`.
- **Same key + same body within 24h**: cached response replayed
  verbatim — no side effects re-fire. Response carries
  `Idempotent-Replayed: true`.
- **Same key + different body**: returns `409 idempotency_key_conflict`.
- **No header**: request processed normally; no caching.

Key constraints: 16-200 ASCII chars. UUIDs (36 chars), ULIDs (26
chars), and nanoids all fit. Cache scope: (key, method, path).

Example:

```sh
curl -X POST http://localhost:8001/api/v1/plans \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"display_name":"Meridian Shopfront BOP","line_of_business":"bop","jurisdiction":"NE","effective_date":"2026-07-01"}'
```

## License

Apache 2.0 — see the LICENSE file at the repo root.
