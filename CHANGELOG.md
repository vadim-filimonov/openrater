# Changelog

All notable changes to OpenRater will be documented in this file,
following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

## [0.1.3] — 2026-07-29

Listing-metadata completeness on top of 0.1.2 (no engine or app
changes).

### Fixed

- The bundle manifest now declares all 18 tools — `compare_plans`
  and `compare_runs` (0.1.2's headline additions) were missing from
  the manifest's tool list, so directory listings under-advertised
  the surface. Runtime behavior was never affected; tools are
  discovered live.

## [0.1.2] — 2026-07-29

The 0.1.1 changes, released for real. 0.1.1 was tagged but never
released: its build pipeline reported success while Apple returned
`Invalid` on both macOS notarization submissions — the two script
lineages had been hardened in parallel, and the 0.1.1 port kept one
side's fixes while dropping the other's. Do not use artifacts from
the v0.1.1 tag build; they are not notarized.

### Fixed (release lane)

- Restored the Mach-O symlink materialization (zip packing orphans
  bundle-context signatures — the notarization rejection cause), the
  deepest-first whole-bundle signing sweep, and the stage forensics
  (signature spot-checks + a dlopen probe on the packed artifact).
- Restored the honest notary flow: submit without `--wait`, a
  transient-tolerant poll, a hard FAILURE on `Invalid`/`Rejected`
  with Apple's detailed findings printed, and keep-the-artifact on a
  queue timeout. `notarytool submit --wait` exits 0 on a rejection —
  the 0.1.1 build went green on exactly that.
- Restored the per-platform manifest declaration: each bundle now
  declares only the platform it was built on.
- Kept from the 0.1.1 lane: the committed comment-free JIT
  entitlements plist for the bundled Node runtime and the real-JS
  `verify-node-runtime` gate at build, post-sign, and on the exact
  shipped bytes.

Proof run at this lane: notarization `Accepted` on both macOS
architectures, all gates green.

## [0.1.1] — 2026-07-29

The trust release: every finding from an independent 35-problem
first-contact audit of 0.1.0, fixed. The audit's verdict on the
engine stood — "honest and exact" — and nearly everything around it
needed work. Highlights; the full story is in the port commit.

### Fixed — wrong numbers, presented as right

- Book rating skipped the minimum-premium floor that quoting applied
  — the same policy priced differently by path. One composition path
  now serves both.
- Yes/no eligibility rules never fired (a stored-answer vs compared-
  literal seam); pinned by a new conformance vector.
- Declared input defaults were honored nowhere; they now apply on
  every path, and a required eligibility-only input that is omitted
  refuses by name instead of rating.
- Plans with failed verification checks quoted bare; quotes now carry
  the plan's own health caveats.
- The workbook validator and the builder disagreed (an unchecked
  length limit refused spec-clean workbooks with no cell address).

### Fixed — the desktop extension

- 0.1.0's bundled Node runtime was signed without JIT entitlements,
  so the scoring sidecar died at launch on every macOS install — and
  `node --version` still succeeded, which is how it shipped. The
  runtime now signs with a committed, comment-free entitlements
  plist, a real-JS gate verifies the exact shipped bytes, and the
  release smoke fails loudly on a degraded boot.

### Added

- A two-run compare — "same book, what changed": per-row deltas
  joined on your own identifier column, totals, biggest movers, newly
  refused rows — in the app's run drawer and as the `compare_runs`
  tool.
- `compare_plans`: committee-shaped plan-to-plan differences with
  canonical territory-membership counts and an Exhibits deep link.
- Check-time detectors for silent workbook holes: a declared level
  with no factor row (R-174) and tolerance-less multi-coverage
  expectations (R-175).
- A documented schedule-rating door (form fields, input schema,
  book-template column), a current-state workbook export that carries
  in-app repairs, book-import transforms (`@times:` scaling,
  bare-number schedule judgments), and a sectioned transcription spec
  readable in pieces from chat.

### Changed

- Traces read like the manual: no float dust, no `NaN` arithmetic on
  refusals, no zero-seed sums, exact-anchor interpolation named as
  such, plain words instead of reserving jargon.
- Numbers format like money: authored precision on the Rating sheet,
  steady two-decimal report tables, uniform factor-grid precision,
  thousands separators on exposures.
- The muted-ink text tokens meet WCAG AA in both themes, enforced by
  a CI contrast gate; the recurring 8px horizontal scroll is gone.
- Run history is trustworthy: the Run tab no longer re-rates on its
  own, chat quotes land in history with a review deep link, and
  book-run rows survive a scoring-service restart.

## [0.1.0] — 2026-07-21

First public release: the full loop — filing PDF → transcribed
workbook → validated build → cited build report → quote with trace
→ book re-rate — in the browser, over MCP, and as a signed Claude
Desktop extension (macOS notarized, Windows Trusted Signing). See
[packaging/desktop/RELEASE-0.1.0.md](./packaging/desktop/RELEASE-0.1.0.md)
for artifacts and evidence.

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

### Fixed (release hardening)

- Zip packing materialized a symlinked framework binary and orphaned
  its signature — now materialized and flat-signed at build, with a
  dlopen probe gate.
- Re-signing stripped the bundled Node runtime's JIT entitlements
  (newer macOS kills V8 at startup for it) — entitlements restored,
  with a fail-hard entitlement check.
