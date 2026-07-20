# Transcription profile — General Liability (and GL-shaped casualty)

**Status:** informative cookbook (never normative — the grammar is
[`filing-transcription-spec.md`](../filing-transcription-spec.md)).
Registry: r5. The canonical example bundle
(`docs/specs/examples/` — a nonprofit D&O + GL program) is GL-shaped
and exercises everything below end-to-end.

## What a GL filing looks like

Class-driven, **exposure-based** rating: a class table (ISO's 5-digit
GL classes or a program's own classes) maps each class to a base rate
*per exposure unit* (per $1,000 of payroll, gross sales, or another
basis stated per class), then limit factors (ILFs), deductible
credits, schedule rating, and expense loads. Premises/operations and
products/completed-ops are often rated separately.

Set `plan.product = cgl` (or `do`/`eo` for those forms when the
filing is a package — pick the lead line and say so in
`description`).

## Construct map

| In the filing | In the workbook |
| --- | --- |
| Premises/ops vs products/completed-ops | Two coverages (`plan.coverages = premises_ops,products_ops`), one `chains` block each — or `coverage_value` sub-towers when the filing prices sub-components inside one coverage. |
| Class table with per-class base rates + exposure basis | A `classification` dimension + `ft.class_rate_*` (`lookup_method=classification`). The class's base rate is the lookup; the shared basis divides in the `exposure` stage (`exposure_divisor = 1000` for per-$1,000). A **class-conditional basis** (payroll for some classes, receipts for others) is registry-`unsupported` — split towers or record in gaps. |
| Increased-limit factors (occurrence/aggregate pairs) | If the filing prints one ILF per limit *pair*: a categorical `limit_pair` dimension + a 1-D table. If it prints a matrix (occurrence × aggregate): a 2-D table. For interpolated ILFs, use a banded table at the filed breakpoints with `interpolation=linear`; 2-D tables interpolate along the declared banded axis and 1-D banded tables interpolate between lower-bound breakpoints. R-111 names each interpolating table. |
| Deductible credits | Banded 1-D table over a `deductible` dimension. |
| Per-account (flat) programs — small-business, nonprofit D&O/GL packages | No `exposure` stage at all: `base` is a per-account constant and every factor multiplies it. The canonical example works exactly this way (D&O `$600 × …`, GL `$300 × …`). |
| Derived underwriting ratios (expense-to-revenue "stress", occupancy intensity) | The workbook cannot compute derivations (registry: `formula_stage`, unsupported). **Declare the ratio itself as an input** (`expense_ratio`), band it with a `banded` dimension, and record the derivation formula in `gaps_and_assumptions` so data preparation knows what to supply. |
| Experience/schedule mods | Experience mod = an `inputs` row (externally computed; registry-`supported`). Schedule rating = `modifiers`. |
| State/territory relativities | Geographic dimension; when the filing tiers states (T1–T5 → factor), transcribe the **per-state effective factors** — flatten the tier indirection, cite the tier table. |
| Eligibility ("decline if…", "refer if…") | `gates`, first match wins, up to 3 AND-ed conditions; OR = separate rows with the same tier. A rule that tests for a *missing* field is not expressible — record it in gaps (the table's `__default__` row usually carries the filed "unknown" load instead). |
| Unknown/unclassified loads ("unknown class: 1.50") | Real levels (e.g. `unknown_unclassified`) when the filing names them — plus an `inputs.default_value` pointing at that level when the filing says missing data maps there. That is the authored-default mechanism working as filed. |

## GL-specific traps

1. **Don't invent exposure audits.** Filed GL rates assume audited
   exposures; the plan rates what the row supplies. Note audit
   provisions in `gaps_and_assumptions` if the filing has them.
2. **Aggregate caps and per-claim vs per-occurrence language** are
   contract terms, not rating math — transcribe only what changes
   premium; note the rest in gaps if it affects interpretation.
3. **Products-completed-ops exclusions by class** (classes rated
   premises-only): express as the class simply not appearing in the
   products tower's table — with the filed "no products coverage"
   note in `citation_note`, not as a factor of 0 (AP-6: zero is a
   number, not an absence).
4. **Package credits across products** (GL + property bundle credit)
   are registry-`unsupported` (`cross_product_package`) — gaps row.
5. **Rounding order matters**: many programs round per coverage
   before summing (use `final_adjustments.applies_to`), some round
   only the total. The filing's worked examples settle it — match
   them to the cent before declaring the workbook done.
