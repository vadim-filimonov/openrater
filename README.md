# OpenRater

**Turn a rate filing into a working rating engine — with a citation for
every number.**

Insurance prices are defined by rating manuals: hundreds of pages of
factor tables, classification rules, territory definitions, and a
rating order, filed as PDFs. OpenRater makes them executable. An AI
(Claude, or any MCP-capable agent) transcribes the document into a
spec'd Excel workbook; OpenRater's deterministic compiler validates it
and builds an executable plan; analytics let you walk any risk through
the algorithm step by step; then serve it as a quote API or re-rate a
whole book from CSV.

> **The AI is a transcriber, never a calculator.** Nothing
> probabilistic executes at rating time. The platform itself never
> calls an AI — your agent calls the platform.

```
filing PDF ──(AI transcribes, following the spec)──▶ workbook (.xlsx, cited, reviewable in Excel)
            ──(deterministic check + build, zero AI)──▶ executable plan + build report
            ──(analytics: walk a risk, rate cards, gates)──▶ understanding
            ──(quote API / batch CSV re-rate)──▶ production use
```

## Why trust it

- **Every number has a citation.** The build report carries page-level
  provenance for every factor; re-ingesting a revised workbook shows a
  cell-grain diff before anything is applied.
- **The filing's own worked examples become acceptance tests.** The
  workbook's `test_cases` sheet pins correctness against the source
  document, not against our opinion.
- **Refuse, never improvise.** An input the plan can't rate is a
  structured, visible error — never a silent neutral factor, never a
  plausible-but-wrong premium. Unsupported constructs are recorded in
  a `gaps_and_assumptions` sheet, not approximated.
- **A human reviewer has a natural seat.** The workbook in the middle
  of the pipeline is an ordinary Excel file an actuary can open,
  audit, and correct.

## Three ways to use it

| You are | You use | You get |
|---|---|---|
| An actuary (no terminal required) | Claude Desktop + the OpenRater extension (a one-file `.mcpb`) | The full loop in chat: transcribe → validate → build → review → quote → re-rate, with the review UI one click away |
| A technical actuary / engineer | Claude Code (or any MCP client) + `@openrater/mcp` | The same loop, scriptable — see [`AGENTS.md`](./AGENTS.md) |
| An integrator | This repo, self-hosted | The REST API, the scoring engine, the integration-events ledger — headless |

Build the Desktop extension locally with
[`packaging/desktop/build-mcpb.sh`](./packaging/desktop/build-mcpb.sh).
The release workflow produces platform-specific artifacts; macOS
artifacts are signed and notarized before release. See the
[release test](./packaging/desktop/TESTING.md) and
[signing runbook](./packaging/desktop/SIGNING.md).

## Quickstart (development)

Prerequisites: Node ≥ 20 + pnpm ≥ 9, Python ≥ 3.12 +
[uv](https://docs.astral.sh/uv/).

```sh
pnpm install
uv sync --project server

pnpm dev   # server :8001 · scoring engine · web app (Vite)
```

The Desktop extension and the Docker deploy come pre-seeded with a
fully synthetic demo program — **Meridian Mutual Insurance, Shopfront
BOP** (see [`docs/fixtures/`](./docs/fixtures)) — so you can quote a
risk and walk its trace immediately. In the dev flow, load it with:

```sh
python3 scripts/plan_fixture.py load meridian-shopfront-bop-ne-2026 \
  docs/fixtures/meridian-shopfront-bop-ne-2026.plan.json \
  --db ~/.openrater/openrater.db
```

To drive the loop from an agent:

```sh
claude mcp add openrater -- npx tsx services/mcp/src/main.ts
```

Self-hosting: `deploy/` has a Docker Compose kit (SQLite on a host
volume, optional Litestream backup, optional Cloudflare tunnel) —
copy `deploy/.env.example` and run
`docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`.

## What's in the box

```
frontend/            the web app (Rate Lab authoring + analytics, Exhibits, Integrations)
server/              FastAPI service: plans, ingestion, quotes, integration events
services/scoring/    the ONE deterministic rating engine (TypeScript)
services/mcp/        @openrater/mcp — 16 tools exposing the loop to any MCP client
skills/              the transcription skill (the agent runbook for filings)
packaging/desktop/   the Claude Desktop extension (.mcpb) build
docs/specs/          the contracts: filing-transcription spec, plan format, engine
                     contract, integration contract, capability registry, conformance
docs/fixtures/       synthetic seed content + FIXTURE_PROVENANCE.md
deploy/              Docker Compose kit
```

The spec set is the heart of the project: the
[filing-transcription spec](./docs/specs/filing-transcription-spec.md)
defines the workbook any AI transcribes into, and the
[capability registry](./docs/specs/transcription-capability-registry.json)
declares — machine-readably — what the platform can and cannot
express, so agents record gaps instead of approximating.

## Status

The full loop — filing PDF →
transcribed workbook → validated build → cited build report → quote
with trace → book re-rate — runs today, in the browser, over MCP, and
from the packaged Desktop extension. Transcription profiles cover
Businessowners (BOP) and General Liability; see
[LIMITATIONS.md](./LIMITATIONS.md) for the supported boundary. OpenRater
is still in the 0.x series, so interfaces may change between releases.

## Content policy (please read before contributing)

This repository ships **only synthetic rating content**. Every bundled
fixture is invented and traceable to a committed generator — see
[`docs/fixtures/FIXTURE_PROVENANCE.md`](./docs/fixtures/FIXTURE_PROVENANCE.md).
Bureau-derived material (ISO/Verisk, AAIS, NCCI) and carriers' filed
rate content are **not accepted**, in any form — see
[CONTRIBUTING.md](./CONTRIBUTING.md). You bring the documents you are
entitled to use; OpenRater never fetches filings for you, and SERFF
automation is out of scope by design.

> **Disclaimer.** OpenRater outputs are reconstructions for analysis.
> The carrier's filed and approved rates govern; verify results
> against the source document (the `test_cases` sheet exists for
> exactly this). OpenRater is an independent project with no
> affiliation to NAIC, SERFF, ISO/Verisk, AAIS, NCCI, or any insurer.

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
Contributions are accepted under the
[Developer Certificate of Origin](./CONTRIBUTING.md#developer-certificate-of-origin).
