# Limitations

Honesty is a feature of this platform: an unsupported construct is
**recorded as a gap, never silently approximated**. This page is the
prose version of the machine-readable truth in
[`docs/specs/transcription-capability-registry.json`](./docs/specs/transcription-capability-registry.json)
(r9) — the registry agents actually consult, enforced at build time by
the R-190/R-191 rules. When they disagree, the registry wins.

## Limits by design (these will not change)

- **The platform never calls an AI.** Transcription happens outside
  the trust boundary, in your agent. Everything from workbook
  validation onward is deterministic — same inputs, same premium,
  every time.
- **No model-executed factors.** GLM/ML scores are not evaluated
  inside a plan. External scores enter as plain typed inputs (e.g. a
  tier you computed elsewhere), so the executed algorithm stays fully
  inspectable.
- **Refuse, never improvise.** An input the plan can't rate produces
  a structured error — not a neutral factor, not a guessed premium.
  See the refusal semantics in
  [`docs/specs/engine-contract.md`](./docs/specs/engine-contract.md).
- **No SERFF automation.** You download the documents you're entitled
  to use, yourself. The platform and its docs will never fetch
  filings for you (the SERFF Filing Access agreement prohibits
  automated downloads).
- **Only synthetic content ships.** Demo plans, books, and test
  fixtures are invented, with provenance recorded in
  [`docs/fixtures/FIXTURE_PROVENANCE.md`](./docs/fixtures/FIXTURE_PROVENANCE.md).

## Line-of-business coverage

- **Transcription profiles exist for BOP (Businessowners) and
  General Liability.** The pipeline is validated end-to-end on a
  synthetic BOP program (Meridian Shopfront BOP — the seeded demo).
- The substrate is built LOB-agnostic (a CI gate keeps rating code
  free of LOB-specific branches), but "the spec has a profile for it"
  and "we've proven it end-to-end" are different claims. Treat
  non-BOP lines as **substrate-ready, not yet validated**.

## Rating semantics — current boundary

**One risk unit per row.** The engine rates one risk unit at a time
and aggregates at the policy scoring seam. Multi-location policies
(status: *partial*): per-location rating transcribes normally and
locations sum at the policy level; combination rules beyond summation
(per-policy minimums across locations, location interdependencies)
are not expressible — record them in `gaps_and_assumptions`.

**Unsupported constructs** (status: *unsupported* in r9 — the
registry entry tells your agent what to record and what to do
instead):

| Area | Not expressible today |
|---|---|
| Topology | Arbitrary DAGs (fan-out/diamond joins), N-way case branching, free-form formula stages, sub-plan stacking / stacked per-state amendments |
| Chain stages | Constant (unkeyed) flat factors as chain stages; predicates beyond equality |
| Endorsements | Additive endorsements on multi-coverage plans |
| Rounding | Per-coverage rounding in final adjustments |
| Products | Per-vehicle / per-driver rating with assignment algorithms; cross-product packages |
| Exposure | Class-conditional exposure bases (different divisor per class) |

**Supported nuances worth knowing:** linear interpolation between
factor-table breakpoints; externally computed indices (experience
mods, credit tiers) as typed inputs; premium capping vs prior term;
coverage election (optional coverages skip cleanly); platform-derived
inputs.

## Platform limits

- **SQLite, single node.** The default (and only tested) store is a
  local SQLite file. A dialect seam exists for Postgres; it has not
  shipped.
- **Unauthenticated by default.** Identity is an integration seam,
  not a built-in — see [SECURITY.md](./SECURITY.md) before any shared
  deployment.
- **Pre-1.0.** No release has been tagged; contracts may still move
  (changes land in [CHANGELOG.md](./CHANGELOG.md)).
- **Desktop extension maturity.** The `.mcpb` builds and runs the
  full loop on macOS; the Windows build is wired in CI but younger.
  Signed builds arrive with the first public release.

## The disclaimer that governs everything

OpenRater outputs are **reconstructions for analysis**. The carrier's
filed and approved rates govern. Verify results against the source
document — the workbook's `test_cases` sheet (the filing's own worked
examples) exists for exactly this, and the build report shows every
factor's citation so you can check any number against its page.
OpenRater has no affiliation with NAIC, SERFF, ISO/Verisk, AAIS,
NCCI, or any insurer.
