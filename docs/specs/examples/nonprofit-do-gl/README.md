# Canonical example bundle — Nonprofit 990 D&O + GL

The worked, committed example for
[`filing-transcription-spec.md`](../../filing-transcription-spec.md)
v1.0 — a complete, conformant workbook generated from the self-contained
synthetic D&O + GL reference design embedded in `generate_workbook.py`.
The factors and all 20 verification cases are illustrative, not carrier
or regulatory data. This is the bundle the ingester's golden test builds
and the artifact to open next to the spec when learning the format.

| File | What |
| --- | --- |
| `nonprofit_do_gl.workbook.xlsx` | The conformant workbook — 22 sheets: `plan` · `inputs` (7 fields, incl. two authored defaults) · `dimensions` (7) · `dimension_levels` (105 levels incl. 51 states) · 11 `ft.*` tables (3 with authored `__default__` unknown-loads) · `chains` (2 towers, 15 stages) · `gates` (6 rules incl. a 3-AND preferred rule) · `final_adjustments` (one package-level round — the engine's plan-tail rounder; registry r2 `per_coverage_rounding`) · `outputs` (tower renames + the tail round) · `test_cases` (20, with `expected_tier` + honest tolerances: 0.5 on per-coverage premiums, 1.0 on totals — 6 of 20 cases genuinely diverge between rounding orders) · `gaps_and_assumptions` (5 rows — every honest kind, including the rounding-order and boundary-case notes). |
| `generate_workbook.py` | The deterministic, **self-verifying** generator. The 20 synthetic cases live in the script, so it has no external inputs or missing paths. Before writing anything it re-derives every band and recomputes every expected premium + tier; a single mismatch aborts. From the repository root, regenerate both byte-identical copies with: `uv run --project server python docs/specs/examples/nonprofit-do-gl/generate_workbook.py` |

## What this example deliberately exercises

- **Authored defaults as the missing-data answer** (spec §4.2):
  `ntee_major → unknown_no_ntee` and `subsection_type → 501c_other`
  as input defaults; the authored "unknown" loads (1.10 / 1.10 / 1.15)
  as factor-table `__default__` rows. No runtime improvisation
  anywhere — every softening is explicit or recorded.
- **Compound eligibility** (spec §4.7): the Decline rule (2 AND-ed
  conditions) and the Preferred rule (3 — the platform's max), with
  OR expressed as separate Submit rows, first match wins.
- **The plan-tail round + honest tolerances** (spec §4.11, registry r2
  `per_coverage_rounding`): the synthetic reference cases round each tower before
  summing; the engine rounds the package total once. The workbook
  records the difference as a gaps row and carries tolerances
  (±$0.50 per coverage, ±$1 on totals — the generator PROVED 6 of 20
  cases diverge between the two rounding orders, then wrote the
  tolerance).
- **The gaps discipline** (spec §4.14): a `formula_stage`
  `unsupported` row (ratios arrive pre-computed), an inexpressible
  gate leg, a transcriber assumption, and an explicitly documented
  occupancy boundary case resolved by the stated binning rule.
- **A geographic dimension at state granularity** (51 levels,
  tier-flattened factors) — no `geo.*` sheet needed at this
  granularity.

Not exercised here (see the spec §9 mini-example and the BOP
profile): 2-D matrix tables, `exposure` stages, `geo.*` ZIP detail,
modifiers/endorsements/loadings sheets — this program simply doesn't
use them.
