# Contributing to OpenRater

Thanks for helping make rating algorithms executable. Contributions we
especially welcome:

- **Synthetic fixtures** — invented rating programs, demo books,
  conformance vectors (see the content rules below — this is the one
  hard boundary in the project).
- **Transcription profiles + spec extensions** — new lines of
  business, new constructs for the capability registry, R-### rule
  clarifications.
- **Bug reports with reproducers** — a failing workbook, a plan JSON,
  a curl command.
- **Code** — engine, server, UI, MCP server, packaging.

## Content rules (read this first)

OpenRater ships **only synthetic rating content**, and its history
must stay that way. Concretely:

1. **No bureau-derived material.** Factor tables, loss costs, rating
   rules, or class tables derived from ISO/Verisk, AAIS, NCCI, or any
   advisory organization are not accepted — even though filings are
   public records, the underlying content is licensed and asserted as
   copyrighted. "I found it in SERFF" does not make it contributable.
2. **No carrier-filed content.** The same applies to any insurer's
   filed manual or rate pages. Users transcribe documents they are
   entitled to use, **privately** — that content never lands in this
   repo.
3. **Every shipped fixture is provably synthetic.** Invented values,
   invented programs, fictional carriers (screened against the NAIC
   company directory — no real insurer names). Each fixture ships
   with a committed generator or authoring note in
   [`docs/fixtures/FIXTURE_PROVENANCE.md`](./docs/fixtures/FIXTURE_PROVENANCE.md).
   A PR adding an `.xlsx`/`.csv`/`.json` fixture without a provenance
   entry will be asked to add one.
4. **No SERFF automation.** The SERFF Filing Access use agreement
   prohibits automated downloads. Scrapers, auto-fetch features, or
   docs encouraging them are out of scope by design, permanently.
5. **Nominative references are fine.** Prose may *name* real
   standards and organizations ("adopts an ISO base with deviations",
   "ISO construction class 1", NAICS/NCCI code systems) — that is
   description, not content. Reproducing their tables is not.

**Takedown posture:** if a rights holder identifies infringing
content, we remove first and discuss second. The provenance manifest
exists so "everything here is invented" is provable in an afternoon.

## Developer Certificate of Origin

Contributions are accepted under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/)
(inbound = outbound, Apache-2.0). Sign off each commit:

```sh
git commit -s   # adds "Signed-off-by: Your Name <you@example.com>"
```

By signing off you certify you wrote the change (or have the right to
submit it) under the project license — for fixtures, that includes
certifying the content rules above.

## Local development

### Prerequisites

- Node.js ≥ 20, pnpm ≥ 9
- Python ≥ 3.12, [uv](https://docs.astral.sh/uv/)
- macOS or Linux are the primary dev platforms. On Windows, develop
  under WSL2; the Desktop-extension build runs natively in CI
  (`.github/workflows/desktop-build.yml`).

### Install + run

```sh
pnpm install
uv sync --project server

pnpm dev    # all three services, colour-tagged:
            #   server  — FastAPI on :8001
            #   scoring — the rating engine sidecar
            #   app     — the web app (Vite)
```

Or individually: `pnpm dev:server`, `pnpm dev:scoring`, `pnpm dev:app`.

The packaged runtime and the Docker deploy seed the synthetic
Meridian demo program on boot (`RATER_SEED_COLD_TEST`); the plain dev
server starts empty — load the demo with
`python3 scripts/plan_fixture.py load meridian-shopfront-bop-ne-2026 docs/fixtures/meridian-shopfront-bop-ne-2026.plan.json --db ~/.openrater/openrater.db`.
Data lives at `~/.openrater/openrater.db`; override with:

```sh
RATER_DB_PATH=/tmp/throwaway.db pnpm dev:server
```

Sanity check:

```sh
curl http://localhost:8001/health
# {"status":"ok","db":"ok"}
curl -s http://localhost:8001/openapi.json | jq -r '.info.title'
# OpenRater · API Lab
```

See [`.env.example`](./.env.example) for the full `RATER_*`
environment surface, and [`AGENTS.md`](./AGENTS.md) to drive the loop
from an MCP client.

### Tests + gates

```sh
pnpm typecheck            # all TS workspaces
pnpm test                 # vitest across packages/, frontend/, services/
cd server && uv run pytest    # server suite (pythonpath is configured)
pnpm design:check         # design-system gates (tokens, palette, buttons,
                          #   color domains, LOB-agnostic rating code)
pnpm lint
```

All of these must be green before a PR; CI runs the same set plus the
repository's identity, synthetic-content, public-surface, and
fixture-provenance gates.

## Repo layout

```
openrater/
├── frontend/            # Vite + React review and authoring app
├── server/              # FastAPI service: plans, ingestion, quotes, and runs
├── services/
│   ├── scoring/         # headless wrapper around the deterministic engine
│   └── mcp/             # Claude Desktop / MCP server (stdio)
├── skills/              # transcribe-filing: the agent runbook
├── packages/            # contracts · ui · design-system · api-client · hooks
├── packaging/desktop/   # the Claude Desktop extension (.mcpb) build
├── deploy/              # Docker Compose kit + upgrade/backup scripts
└── docs/
    ├── specs/           # normative contracts, profiles, and examples
    └── fixtures/        # synthetic seeds + their provenance manifest
```

## Reading the code comments

Comments throughout the codebase cite design documents by id —
`Brief NN`, `ADR-NNNN`, `R-###`, and audit finding numbers. The
`R-###` rules are public (they're the transcription spec's own rule
table, served by `get_transcription_spec`); the briefs and ADRs are
the maintainer's private design history and are **not** part of this
repository. Treat those citations as provenance markers — the
sentence around each one states the actual constraint, and the public
contracts live in [`docs/specs/`](./docs/specs). You never need a
cited document to understand or change the code; if a comment doesn't
stand on its own, that's a bug worth filing.

## Development discipline

### User-facing verification

Pull requests that change a user-facing surface should describe the
intended behavior and include screenshots or another clear manual
verification note where appropriate.

### Design-system conventions

- BEM CSS (`.v2-ds-{component}__{element}--{modifier}`) over the
  `--rater-*` token set. No inline styles, no raw palette values —
  `pnpm design:check` enforces this.
- SVG icons from `lucide-react`, not Unicode glyphs.
- Motion 120–360 ms, honoring `prefers-reduced-motion`; visible focus
  states on every interactive element.
- Verify light AND dark modes in the browser before calling UI work
  done.

### The contracts are normative

- [`docs/specs/engine-contract.md`](./docs/specs/engine-contract.md)
  — what the runtime guarantees (determinism, tracing, refusal
  semantics). Changes to the public surface, reproducibility, or
  error categories need a version bump + changelog entry. The
  conformance suite (`packages/contracts/src/__tests__/conformance/`)
  is the executable proof and must stay green; vectors are
  append-only in spirit — changing a pinned expectation needs the
  reasoning in the PR.
- [`docs/specs/filing-transcription-spec.md`](./docs/specs/filing-transcription-spec.md)
  + [`transcription-capability-registry.json`](./docs/specs/transcription-capability-registry.json)
  — the workbook contract. New constructs follow the spec's own
  process: registry entry → profile note → conformance fixture, in
  one PR. Issue + R-### codes are append-only.

## Integrating with the server

Two integrator hooks beyond the documented HTTP contract:

**Operator identity.** OpenRater ships unauthenticated by default;
every mutating action attributes to `current_operator()` (stub:
`operator@openrater.local`). Deployments register a real resolver at
startup via `openrater.auth.register_operator_resolver(...)` — see
the docstring in [`server/src/openrater/auth.py`](./server/src/openrater/auth.py)
for a JWT example, and [SECURITY.md](./SECURITY.md) for the deploy
posture.

**Correlation IDs.** Every response carries `X-Request-Id`; the JSON
log stream (`RATER_LOG_FORMAT=json|pretty`, `RATER_LOG_LEVEL=...`)
includes `request_id` on every line. Echo the header on outbound
calls and filter your aggregator by it.

## Commit + PR conventions

- Imperative mood, one-line subject ≤ 70 chars; body explains *why*.
- Group related work; don't fragment.
- Sign off every commit (`git commit -s` — the DCO above).
- For fixture PRs: include the provenance entry in the same commit.
- PRs describe what changed, why, and how it was verified (tests run,
  browser checked). The PR template walks through it.

## License

Apache-2.0. By contributing, you agree your contributions are
licensed under the same — see the DCO section above.
