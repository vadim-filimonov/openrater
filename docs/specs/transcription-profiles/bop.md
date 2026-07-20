# Transcription profile — Businessowners (BOP)

**Status:** informative cookbook (never normative — the grammar is
[`filing-transcription-spec.md`](../filing-transcription-spec.md);
this profile teaches how BOP filings map onto it). Registry: r5.
Exercised end to end with the fictional Meridian Shopfront BOP
reference program and its deterministic worked examples.

## What a BOP filing looks like

Usually an **ISO adoption**: the carrier files ISO's countrywide BOP
manual + state rate pages + a loss-cost multiplier (LCM) + exception
pages. Sometimes an independent program with the same bones. The
rating order ("how to rate a risk") is printed early in the manual —
transcribe that section into the `chains` stub first (spec §7.2 pass
1), because everything else hangs off it.

Set `plan.product = bop`, `filing_type = adoption` for ISO adoptions,
and list every PDF consumed in `source_documents` (manual + rate
pages + exceptions). **Flatten** per spec §7.3 — the workbook carries
the *effective* algorithm; citations point at whichever document each
value actually came from.

## Construct map

| In the filing | In the workbook |
| --- | --- |
| Coverages: Building / Business Personal Property / Liability (+ optional BI) | `plan.coverages = building,bpp,liability` — one `chains` block each. |
| Class table (hundreds of BOP classes → base rates or class factors) | A `classification` dimension (`dimension_type=classification`) + `ft.class_*` tables (`lookup_method=classification`). Class codes are level ids; put filed alternates in `aliases`. |
| Base loss costs per $100 of TIV | `base` stage (`value` or per-class via a classification lookup) + an `exposure` stage with `exposure_divisor = 100`, `input_binding = form_input.tiv`. |
| Construction class, protection class, sprinkler | Categorical dimensions + 1-D `ft.*` tables; matrices in the filing (construction × protection) become one 2-D table. |
| Territory pages (ZIP → territory → factor) | A `geographic` dimension (`geo_granularity=zip`), territory levels in `dimension_levels`, the ZIP detail in `geo.<slug>` (never one level per ZIP — AP-10), factors in a `ft.*` keyed by territory. |
| Territory pages that only NAME territories (codes, no ZIP/county list) | A **plain categorical** dimension — the codes as levels, factors in a `ft.*` keyed by them. Geography engages only with a geographic indicator (AP-11, R-086). |
| ILFs / limit factors, deductible credits | **Banded 1-D tables at the filing's breakpoints.** Set `interpolation` per the filing's stated method. With `linear`, a 2-D table interpolates along its declared banded axis and a 1-D banded table interpolates between lower-bound breakpoints; ends clamp. Compute test-vector expectations using those semantics. R-111 names each interpolating table. |
| LCM | The `lcm` stage on each chain (or one plan-wide `lcm` field). Cite `(carrier-set)` when the carrier chooses it. |
| Eligibility section ("do not write…", "refer…") | `gates` rows, first match wins; up to 3 AND-ed conditions per rule. |
| IRPM / schedule rating table | `modifiers` — categories + per-category range + total cap. Structure only; per-risk credits are runtime inputs. |
| Optional endorsements priced in the filing | `endorsements` (factor / additive / sublimit + `trigger`). |
| Taxes, expense loads | `loadings` (use `applies_to` when a load hits one coverage only). |
| Minimum premium, whole-dollar rounding | `final_adjustments` — **one package-level `round` row** (the engine's round sums the towers, floors at the minimum, and rounds once; per-coverage rounding is registry-`unsupported`, r2 `per_coverage_rounding`). When the filing rounds each coverage before summing, keep the filed per-coverage premiums in `test_cases` with `tolerance_<field> = 0.5` and record the rounding-order difference in gaps — totals can differ by $1 on half-cent splits. Per-coverage minimum premiums are `clamp` rows with `applies_to`, which do work. |
| The filing's worked rating examples | `test_cases`, verbatim, with the filing's stated premiums. These pages are gold — transcribe every one. |

## BOP-specific traps

1. **Multi-building schedules.** Filings rate per building; the
   platform rates one risk unit per row. Decompose to one row per
   building and record the policy-level combination in
   `gaps_and_assumptions` (registry: `multi_location_policy`,
   partial).
2. **Wind/hail or per-peril deductibles** often live in dense
   appendix tables that scan badly. If a table is illegible, omit it
   and record a `gap` — quotes that need it will refuse rather than
   guess. Never reconstruct factors from an unreadable scan (AP-9).
3. **"All other classes" rows** in filed tables are real filed
   defaults — transcribe them as the table's `__default__` row. Do
   not invent a `__default__` the filing doesn't publish.
4. **Interpolated limit tables** — see the ILF row above. Set
   `interpolation=linear` only when the filing calls for interpolation;
   both supported table shapes then interpolate and R-111 names the table.
5. **Per-coverage LCMs.** Carriers sometimes file different LCMs for
   property vs liability. One `lcm` stage per chain handles it; don't
   average them.
6. **Class-conditional exposure** (a handful of classes rated per
   $1,000 of receipts instead of TIV) is registry-`unsupported`:
   split those classes into their own coverage/tower if material,
   otherwise record in gaps.

## Suggested slugs (keep them semantic)

`class_code`, `construction_class`, `protection_class`,
`sprinklered`, `territory`, `building_limit_band`, `deductible_band`,
`bop_tenure_band`. Never `table_5a` (§7.1).

## Recipe: verifying against two-column filing PDFs

Many rating manuals print in two columns; `pdftotext -layout`
interleaves them, so **line numbers are not stable anchors** — a
table's rows can share line numbers with unrelated text from the
other column, and page footers shift everything a page later.
Recommended pattern:

1. Extract layout-preserving text once; treat it as the transcription
   source of record alongside the PDF.
2. **Anchor verification windows on section-title lines** (each
   rule page may repeat its title, e.g. `RATE NUMBER RELATIVITIES`), a
   window running to the next *different* title — multi-page tables
   concatenate naturally and pagination drift cannot clip a table.
3. **Machine-diff every hand-typed literal against its window** before
   declaring the workbook done — key set AND values, not spot checks.
   A verifier script that exits non-zero belongs next to the
   generator.
4. For `citation_page` when the extraction has no form feeds, count
   per-page footer lines (e.g. `Edition MM-YY` in company packets)
   to derive source PDF page numbers.

## Recipe: one filing family, several plans

Some filings yield **sibling plans** — e.g. a territory-based program
plus its ISO Risk Analyzer ZIP-level alternative, identical except
for the base loss-cost source. One workbook = one plan stands (§10.1
OQ-1); the pattern is:

- one **shared data module** (relativity stacks, band tables, class
  data) + one self-verifying generator per plan;
- one **fidelity gate per source document**, not per plan — siblings
  re-verify the same packet windows;
- keep the shared stack **byte-identical across siblings** so rating
  one risk through both is a true base-source comparison (state the
  pairing in each plan's `description` and docs);
- cite the same source pages from both workbooks; never fork a shared
  table's values silently.

## Recipe: class-conditional liability exposure (interim)

BOP occupant liability rates per $100 of LOI **or** per $1,000 of
sales **or** per $1,000 of payroll depending on the class (plus the
lessors basis per Rule 23.B.5) — and a chain has ONE exposure divisor
(registry: `class_conditional_exposure`). Until derived inputs /
class-conditional exposure ships, the supported interim shape is
**one liability tower**:

- a categorical `liab_exposure_base` dimension
  (`occ_loi,sales,payroll,lessors_loi`) fed by an input;
- the base loss costs and the class-group relativities as **2-D
  tables** keyed `(territory-or-zip × liab_exposure_base)` and
  `(liab_class_group × liab_exposure_base)` — blank cells where a
  combination is unfiled (they refuse, honestly);
- one `liab_exposure_units` input, **pre-divided** by the submitter
  (sales/1,000 · payroll/1,000 · occupant LOI = BPP limit /100 ·
  lessors LOI = building limit /100), exposure divisor `1`;
- the arithmetic spelled out in the input's `label`, a
  `gaps_and_assumptions` row citing the registry construct, and one
  test case per base.

Two cautions: exposure `0` is **not** an elect-out (spec §12.4 — a
zero-exposure tower withholds the whole row), and never transform the
filed per-unit loss costs to fake a uniform divisor (AP-9).
