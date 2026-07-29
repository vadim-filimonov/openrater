# Canonical example bundle — Nonprofit 990 D&O + GL

The worked, committed example for
[`filing-transcription-spec.md`](../../filing-transcription-spec.md)
v1.0 — a complete, conformant workbook transcribed from the in-repo
synthetic program
(`docs/rating-algorithms/nonprofit_990_do_gl_rating_v1.xlsx`, a
pre-filing D&O + GL design for IRS-990 nonprofits; heuristic factors,
IP-clean). This is the bundle the ingester's golden test builds
(Brief 92 Phase 92.3) and the artifact to open next to the spec when
learning the format.

| File | What |
| --- | --- |
| `nonprofit_do_gl.workbook.xlsx` | The conformant workbook — 22 sheets: `plan` · `inputs` (7 fields, incl. two authored defaults) · `dimensions` (7) · `dimension_levels` (105 levels incl. 51 states) · 11 `ft.*` tables (3 with filed `__default__` unknown-loads) · `chains` (2 towers, 15 stages) · `gates` (6 rules incl. a 3-AND preferred rule) · `final_adjustments` (one package-level round — the engine's plan-tail rounder; registry r2 `per_coverage_rounding`) · `outputs` (tower renames + the tail round) · `test_cases` (20, with `expected_tier` + honest tolerances: 0.5 on per-coverage premiums, 1.0 on totals — 6 of 20 cases genuinely diverge between rounding orders) · `gaps_and_assumptions` (5 rows — every honest kind, incl. a real source discrepancy and the rounding-order boundary). |
| `generate_workbook.py` | The deterministic, **self-verifying** generator. Before writing anything it re-derives every band and recomputes all 20 expected premiums + tiers from `docs/rating-algorithms/nonprofit_990_test_cases.csv` and asserts them against the source's prebinned CSV and stated expectations — a single mismatch aborts. Regenerate with: `cd api-lab/backend && uv run --with openpyxl python ../../docs/specs/examples/nonprofit-do-gl/generate_workbook.py` |

## What this example deliberately exercises

- **Authored defaults as the missing-data answer** (spec §4.2):
  `ntee_major → unknown_no_ntee` and `subsection_type → 501c_other`
  as input defaults; the filed "unknown" loads (1.10 / 1.10 / 1.15)
  as factor-table `__default__` rows. No runtime improvisation
  anywhere — every softening is filed or recorded.
- **Compound eligibility** (spec §4.7): the Decline rule (2 AND-ed
  conditions) and the Preferred rule (3 — the platform's max), with
  OR expressed as separate Submit rows, first match wins.
- **The plan-tail round + honest tolerances** (spec §4.11, registry r2
  `per_coverage_rounding`): the source rounds each tower before
  summing; the engine rounds the package total once. The workbook
  records the difference as a gaps row and carries tolerances
  (±$0.50 per coverage, ±$1 on totals — the generator PROVED 6 of 20
  cases diverge between the two rounding orders, then wrote the
  tolerance).
- **The gaps discipline** (spec §4.14): a `formula_stage`
  `unsupported` row (ratios arrive pre-computed), an inexpressible
  gate leg, a transcriber assumption, and a genuine **source
  discrepancy** (the source's Worked Examples vs Test Cases disagree
  on one occupancy bin; the binning rule decides, and the gaps row
  says so).
- **A geographic dimension at state granularity** (51 levels,
  tier-flattened factors) — no `geo.*` sheet needed at this
  granularity.

Not exercised here (see the spec §9 mini-example and the BOP
profile): 2-D matrix tables, `exposure` stages, `geo.*` ZIP detail,
modifiers/endorsements/loadings sheets — this program simply doesn't
file them.
