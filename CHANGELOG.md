# Changelog

All notable changes to OpenRater will be documented in this file,
following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### The platform

- **Filing-transcription pipeline**: the transcription spec + the
  machine-readable capability registry (r9) + BOP and GL profiles; a
  deterministic workbook checker (R-### rules) and builder that
  produce an executable plan with a **citation-carrying build
  report**; re-ingest as a reviewable cell-grain diff.
- **The rating engine** (`services/scoring`): deterministic
  execution with a full per-premium trace, structured refusal
  semantics (error ≠ decline ≠ $0), and a published conformance
  suite.
- **Analytics**: PlanReport (walked risk, rate cards, premium swing,
  gates, verified filing examples), probe analytics, build-report
  drawer.
- **Serving**: per-plan `/quote` endpoint behind optional API keys,
  quote ledger, batch book re-rate over CSV with coverage roll-ups,
  plan snapshots/publish.
- **Exhibits**: the plan shelf — plans drawn, compared, and priced
  against a book of risks, with integration events retained as an
  audit ledger.
- **The Claude seam**: `@openrater/mcp` (16 tools driving the full
  loop, including the `runtime_status` doctor), the
  `transcribe-filing` skill with hard review stops, a first-run
  experience (three-door menu, a ~3-minute guided tour on the bundled
  sample filing, plain-language failure recovery), `AGENTS.md`, and a
  packaged Claude Desktop extension (`.mcpb`) whose runtime binds
  loopback-only and stores data in `~/.openrater/`.
- **Content**: fully synthetic seeded demo program (Meridian Mutual
  "Shopfront BOP", with generator + provenance manifest), a 17-page
  synthetic reference filing PDF, demo book, and a transcription
  eval harness v0.
- **Deploy**: Docker Compose kit with SQLite persistence, optional
  Litestream backup and Cloudflare tunnel/Access overlay, upgrade
  script with pre-flight integrity sweep.
