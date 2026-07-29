# OpenRater — Filing Transcription Spec

| Field | Value |
| --- | --- |
| **Version** | **1.0 — LOCKED** (2026-07-14) |
| **Status** | Normative. The reference the linter (`R-###` rules, §8) and the ingester implement. Changes follow the §10 versioning policy. |
| **Supersedes** | `INPUT_XLSX_FORMAT_SPEC.md` (draft, 2026-07; that file is now a pointer stub). All 13 of the draft's open questions are resolved in §10.1. |
| **Brief** | Brief 92 — "Build from workbook" (validated 2026-07-14; in the project's pre-detachment design archive — the normative content is in this document). |
| **Companions** | `transcription-capability-registry.json` (machine-readable capability boundary, §6) · `transcription-profiles/` (per-product cookbooks) · `plan-format-v1.md` (the Plan the workbook becomes). |
| **Audience** | (1) **The transcriber** — any AI (or person) handed this document plus a rate filing, producing the workbook. (2) **The ingester** — the deterministic platform code that reads the workbook. The same text binds both. |
| **License** | CC BY 4.0 — this document is meant to be copied out of the repo and handed around. |

---

## 0. How to use this document

**If you are an AI that has been handed this spec and a rate filing:**
your job is to produce **one `.xlsx` workbook** that passes every
`R-###` rule in §8. Read §1 (what the workbook is), §2 (global
conventions), §3–§4 (the sheets and their columns), §6 (what the
platform cannot express — record those in `gaps_and_assumptions`
instead of improvising), §7 (the transcription procedure, ambiguity
handling, and anti-patterns), and §12 (the engine's execution
semantics — compute your `test_cases` expectations from it, never
from guessed rounding). The worked example in §9 is a complete
conformant workbook in miniature. You never guess: anything
the filing doesn't state, anything ambiguous, and anything §6
excludes goes into the `gaps_and_assumptions` sheet as a written
record. The filing's own worked rating examples go into `test_cases`
— they are how a human verifies your work.

**You can check your work before any human reviews it.** The same
deterministic checker that gates the build is available three ways:
the platform's *Build from a workbook* panel (drop the file — checking
writes nothing), the stateless endpoint
`POST /api/v1/plans/ingest/check`, and the CLI
`python -m openrater.rates.ingest check <file>`. The loop is: produce →
check → fix every reported `sheet!cell` → re-check, until zero errors.
A workbook that has never been checked is a draft, not a deliverable.

**This document is self-contained.** Everything normative is in this
file. Parenthetical references to repository paths (e.g.
`dimension-types.ts`) are *informative annotations* for platform
developers tracing a rule to its enforcing code — a transcriber needs
none of them.

**If you are implementing the reader:** the ingester is deterministic
— no model calls, no fuzzy matching, no repair. It parses, validates
against §8, and either reports errors by `sheet!cell` + rule id or
builds the plan exactly as written. Same workbook in, same plan out,
every time.

---

## 1. Purpose and pipeline

### 1.1 What problem this solves

A filed rating manual (an ISO Businessowners program, a carrier's
independent GL filing, a personal-lines rate schedule) is hundreds of
pages of prose, rate tables, territory definitions, classification
tables, and a step-by-step rating order. Turning that into a runnable
rating plan by hand takes days and invites transcription drift.

Going straight from PDF to the platform's Plan (a typed DAG of nodes
and wires) is a bad hand-off: the DAG is verbose, hard for a human to
eyeball against a manual, and easy to get subtly wrong. There is no
natural place for a **reviewer** to sit between "something read the
manual" and "the engine rated a policy."

So the pipeline puts a **workbook** in the middle:

```
┌──────────────┐  transcription   ┌─────────────────┐   check + build   ┌────────────────┐  compile + run  ┌─────────┐
│ Rate filing  │  (the user's AI, │  the workbook   │  (deterministic   │  Rating plan   │                 │ Engine  │
│ (PDF, e.g.   │──following THIS──▶  (.xlsx — THIS  │───platform code,──▶  (plan-format- │────────────────▶│ (trace, │
│ from SERFF)  │      spec)       │  spec defines)  │     zero AI)      │   v1 substrate)│                 │ premium)│
└──────────────┘                  └─────────────────┘                   └────────────────┘                 └─────────┘
        ▲                                  ▲                                     │
        │            HUMAN REVIEW happens HERE: open the workbook in             │
        └──────────── Excel next to the filing, check every cited factor  ◀─────┘
                      against the page it came from, fix cells, re-check.
```

The two halves have opposite characters, **by design**:

- **Left of the workbook** — probabilistic. An AI reads a scanned
  PDF, interprets prose, makes judgment calls. Its output is fully
  auditable because it is *tabular, cited, and diffable against the
  filing*.
- **Right of the workbook** — deterministic. The platform checks the
  workbook against this spec's rules and builds the plan through the
  same substrate the authoring UI uses. It reads the workbook exactly
  as written — **no AI, no guessing, no silent repair**. A workbook
  the platform can't read as written is refused with the cell cited;
  it is never quietly "fixed."

The workbook is the only artifact in the chain a non-engineer can
read and correct. That is its entire reason to exist.

### 1.2 Scope boundary

| In scope | Out of scope |
| --- | --- |
| The workbook's sheets, columns, types, enums, and rules (`R-###`). | The filing analysis itself — acquiring the PDF, reading SERFF, choosing what to transcribe. That is the transcriber's work, guided by §7 and the product profiles. |
| How each platform concept (inputs, dimensions, factor tables, chains, gates, loadings, outputs) is expressed in cells. | The ingester's implementation (Brief 92 Part 2; this spec is its read contract). |
| The capability boundary (§6) and how to record what the platform can't express. | The Plan Format itself (owned by `plan-format-v1.md`; this spec serializes a subset of it). |
| Citation / provenance columns and the two honesty sheets. | Model-backed factors, Data Lab, integrations. |

> **Relationship to ADR-0017 (CSV import/export).** This spec is the
> XLSX import direction ADR-0017 deferred to "Phase C / V2." It
> reuses ADR-0017's conventions wholesale: UTF-8 text, `snake_case`
> headers, `citation_rule` + `citation_page`, deterministic ordering,
> no silent imports.

---

## 2. Workbook conventions (apply to every sheet)

Global rules; per-sheet specs in §4 assume them. Machine-checkable
statements carry rule ids — the same ids the checker reports.

### 2.1 File + cell format

- One workbook = **one plan**, for **one carrier + product + state +
  effective date** (one filing). State families are N workbooks.
- File extension `.xlsx` (OOXML). **[R-001]** The file must be a
  readable OOXML workbook. (A CSV-bundle equivalent exists — §11.)
- **Cell values are strings, numbers, or booleans. No formulas.**
  **[R-004]** A formula-bearing cell is an error — the transcriber
  writes literal computed values, never `=A1*B1` (Anti-Pattern AP-7).
- **No merged cells in data sheets.** **[R-002]** A merged range makes
  every cell but its top-left read as blank — the reader refuses
  (citing the range) rather than mis-read. Merging is fine on ignored
  prose sheets (README etc., R-203).
- **Numbers are numbers, not text.** **[R-005]** Decimal separator
  `.`; no thousands separators; no currency symbols in numeric cells
  (write `600`, never `"$600"`).
- **Booleans** are Excel `TRUE`/`FALSE` or the strings `true`/`false`
  (normalized case-insensitively).
- **Empty vs zero.** An empty cell means "not supplied" (the column's
  documented default applies). `0` means the literal number zero.
  Never write `0` to mean "absent" (AP-6).
- **Open intervals.** Write the literal strings `-inf` / `+inf` in
  `min`/`max` cells; the reader maps them to open interval ends.

### 2.2 Header row + column order

- Every data sheet has **exactly one header row** (row 1) using the
  canonical `snake_case` column names in §4. **[R-003]** A missing
  required column is an error; unknown extra trailing columns are a
  warning and are preserved. **[R-202]**
- A sheet MAY carry a trailing `notes` free-text column — never
  load-bearing, always preserved.
- **Documentation sheets are allowed and ignored.** Any sheet whose
  name is not a recognized data sheet (§3) is skipped with a notice
  **[R-203]**. The transcriber SHOULD emit a `README` sheet
  summarizing the filing and what was built.

### 2.3 Identifiers (slugs)

- All ids/slugs match `^[a-z0-9][a-z0-9_-]{0,79}$` — lowercase,
  `snake_case`, ≤ 80 chars. **[R-006]**
- An id is **stable**: it is what other sheets reference. The
  `display_name`/`label` is free text and may change without breaking
  references.
- Slugs are unique within their namespace **[R-007]** (dimension
  slugs within the plan; level ids within their dimension; table ids
  within the plan; stage ids within their coverage; etc. — restated
  per sheet).
- **Reserved id:** `__default__` (factor-table fallback row, gate
  default rule). Never a real level. **[R-008]**

### 2.4 Citation columns (provenance)

Every row that carries a *filed value* (a factor, base rate, LCM,
territory factor, gate threshold, default) reserves two columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `citation_rule` | string | The rule/section/table reference in the filing, e.g. `Rule 5, Table 5.A.1`. |
| `citation_page` | string | Page (or range) in the source PDF, e.g. `p.47` or `pp.112-114`. |

- Both are free text and round-trip unmodified.
- These two names are reserved product-wide.
- **A filed-value row with no citation is a warning** **[R-201]** —
  it rides into the build report so the reviewer sees which values
  can't be traced to a page. For carrier-set values with no filed
  source (an LCM the carrier chooses), write `(carrier-set)`.

### 2.5 The source-PDF provenance trio (optional, encouraged)

Where a sheet supports them (§4), the transcriber SHOULD fill:

| Column | Allowed values | Meaning |
| --- | --- | --- |
| `source_pdf_url` | string (path/URL) | The document this row was extracted from. |
| `source_page` | integer (1-indexed) | Machine-readable page for jump-to-page UIs. |
| `draft_status` | `extracted` \| `reviewed` \| `committed` | Lifecycle. The transcriber emits `extracted`; the human reviewer promotes. Default `committed` when absent. |

`citation_page` (prints on a filing) and `source_page` (drives a UI)
coexist on purpose.

---

## 3. Workbook structure (the sheet set)

A conformant workbook contains these sheets. **The sheet name is the
contract** — the reader dispatches on it.

| # | Sheet name | Cardinality | Role |
| - | --- | --- | --- |
| 1 | `plan` | **exactly 1** **[R-021]** | Plan metadata + the provenance block (carrier, product, state, SERFF, effective, spec_version). |
| 2 | `inputs` | **exactly 1** **[R-020]** | Every field the plan reads from a risk row — name, type, required, allowed values, **default value**. |
| 3 | `dimensions` | **exactly 1** **[R-022]** | One row per rating variable / structural axis. |
| 4 | `dimension_levels` | 0 or 1 (required when any dimension has levels) | The levels/bands/territories of every non-trivial dimension (long-format). |
| 5 | `ft.<slug>` | 0 or many | **One sheet per factor table** — 1-D key→factor or 2-D matrix. Banded 1-D tables are also how curves (ILFs, deductible factors) are expressed. |
| 6 | `chains` | **exactly 1** **[R-023]** | The rating tower(s): per coverage, an ordered list of stages (base → lookups → exposure → LCM). |
| 7 | `gates` | 0 or 1 | Eligibility rules (ordered, first match wins). |
| 8 | `modifiers` | 0 or 1 | Schedule rating / IRPM structure (categories + caps). |
| 9 | `endorsements` | 0 or 1 | Extensions priced as factor / additive / sublimit. |
| 10 | `loadings` | 0 or 1 | Expense / profit / contingency flat factors. |
| 11 | `final_adjustments` | 0 or 1 | Min premium, rounding, clamps after the tower. |
| 12 | `outputs` | **exactly 1** **[R-024]** | The plan's declared output fields. |
| 13 | `test_cases` | **exactly 1, ≥ 1 row** **[R-025]** **[R-145]** | Sample risks + expected premiums. Use the filing's own worked examples; they become the build report's verification vectors. Aim for ≥ 5. |
| 14 | `gaps_and_assumptions` | **exactly 1 (rows may be zero)** **[R-026]** | The transcriber's written record of gaps, assumptions, and unsupported constructs. The sheet must exist even when empty — declaring "none" is a conscious act. |
| 15 | `geo.<slug>` | 0 or many | ZIP/county → territory detail for a geographic dimension. |

The required set is therefore: `plan`, `inputs`, `dimensions`,
`chains`, `outputs`, `test_cases`, `gaps_and_assumptions` — plus
`dimension_levels` whenever any declared dimension needs levels
(which is nearly always).

**How sheets map onto the plan-builder's section spine** (informative):

| Workbook sheet | Plan section(s) |
| --- | --- |
| `plan` | plan metadata |
| `inputs` | Risk Inputs |
| `dimensions` + `dimension_levels` + `geo.*` | Dimensions · Territories (geographic) · Classification (classification dims) |
| `ft.*` | Factor Tables (banded 1-D tables are the curve form) |
| `chains` | Rating Chains |
| `gates` | Eligibility |
| `modifiers` | Modifiers |
| `endorsements` | Endorsements |
| `loadings` | Loadings |
| `final_adjustments` | Final Adjustments |
| `outputs` | Outputs |
| `test_cases` | Rate Against Sample |
| `gaps_and_assumptions` | (the build report; not a section) |

---

## 4. Per-sheet column specifications

### 4.1 Sheet `plan` (key-value)

Two columns: `field`, `value`. One row per field. Read as a
dictionary. **[R-027]** missing required field · **[R-028]** unknown
`product` · **[R-029]** malformed `state` · **[R-030]** malformed
`effective_date` · **[R-031]** empty `coverages` · **[R-032]**
missing/unknown `spec_version`.

| `field` | Required | Type | Allowed values / format |
| --- | --- | --- | --- |
| `spec_version` | yes | string | The spec version this workbook targets. `1.0` for this document. |
| `rating_plan_id` | yes | slug | e.g. `meridian-bop-ks-2025`. Convention: `{carrier}-{product}-{state}-{effective-year}`. **This becomes the built plan's id** (same workbook → same plan id on any box). Building against a taken id refuses: identical bytes ⇒ "already built"; different bytes ⇒ the re-ingest door (`POST /plans/{id}/reingest/check`) or a new id — never a silent duplicate. |
| `display_name` | yes | string | 1–200 chars, e.g. `Meridian BOP — Kansas — 2025`. |
| `version` | yes | string | Workbook revision, semver, e.g. `1.0.0`. Bump when re-issuing a corrected workbook. |
| `carrier` | yes | string | The filing carrier's name as filed, e.g. `Meridian Mutual Insurance`. |
| `product` | yes | enum | One of the platform product codes: `bop` \| `cgl` \| `do` \| `eo` \| `wc` \| `auto` \| `umbrella` \| `excess` \| `marine` \| `inland_marine` \| `homeowners` \| `dwelling` \| `other`. `homeowners` = HO forms; `dwelling` = dwelling fire (DP forms). Other personal lines (renters-only programs etc.) use `other` with the line named in `description`. |
| `jurisdiction_country` | yes | string | ISO country, e.g. `US`. |
| `state` | no | string | 2-letter state code, e.g. `KS`. Empty = multistate/countrywide. |
| `effective_date` | yes | date | `YYYY-MM-DD` — the filing's rate effective date. |
| `coverages` | yes | string (CSV) | The coverage ids the plan rates, e.g. `building,bpp,liability`. Each becomes a chain block (§4.6). A trailing `?` marks a coverage **electable** (`building?,bpp?,liability`): a risk with an **explicit 0** exposure on that coverage elects it out — its tower contributes $0 with a "not elected" trace line — while an absent exposure still withholds (§12.4). At least one coverage must stay required, and an electable coverage's chain needs an exposure stage **[R-048]**. Every other consumer of coverage names (chains `coverage`, `applies_to`, endorsements) uses the id WITHOUT the marker. |
| `serff_tracking_number` | no | string | e.g. `CNNA-134648356`. Strongly encouraged when the source is a SERFF filing. |
| `filing_type` | no | enum | `new` \| `revision` \| `adoption` \| `other`. `adoption` = a bureau (e.g. ISO) base adopted with carrier deviations — see §7.3 "flatten, don't layer." |
| `source_documents` | no | string (CSV) | Every source document consumed, e.g. `manual.pdf,rate_pages.pdf,exception_pages.pdf`. |
| `source_pdf_url` | no | string | Primary source path/URL (kept for single-document filings). |
| `description` | no | string | Free text. |

> **LCM and base rates are NOT on this sheet** — they belong to
> specific chains (each coverage can have its own). A plan-wide LCM
> MAY be written once here as `lcm` and is used by chains that don't
> override it. An `lcm` chain row can also reference it explicitly —
> `input_binding: context.lcm` (§4.6) — when the block should carry
> its own citation without copying the number.

**Example:**

| field | value |
| --- | --- |
| spec_version | 1.0 |
| rating_plan_id | meridian-bop-ks-2025 |
| display_name | Meridian BOP — Kansas — 2025 |
| version | 1.0.0 |
| carrier | Meridian Mutual Insurance |
| product | bop |
| jurisdiction_country | US |
| state | KS |
| effective_date | 2025-07-01 |
| coverages | building,bpp,liability |
| serff_tracking_number | CNNA-134648356 |
| filing_type | adoption |
| source_documents | meridian_bop_manual.pdf,mmi_exception_pages.pdf |

### 4.2 Sheet `inputs` (one row per risk-input field) — REQUIRED

Declares **every field the plan reads from a risk row** — what a
quote request, a CSV column, or a test case supplies. This sheet is
where defaults for missing data get *authored*: a default here is a
deliberate, cited decision, visible in every trace — never a runtime
guess. An input that is `required` with no `default_value` causes the
plan to **refuse** (premium withheld, loudly) when the field is
absent at runtime; that refusal posture is the platform's law and
this sheet is the only sanctioned way to soften it.

**[R-040]** duplicate input name · **[R-041]** invalid `data_type` ·
**[R-042]** `data_type=enum` requires `allowed_values` · **[R-043]**
`default_value` not within `allowed_values`/bounds · **[R-044]**
a field consumed anywhere (chains `form_input.*`, gates `variable`,
test-case input columns) that is not declared here · **[R-045]**
`derived_from` grammar/operand violations · **[R-046]** a derived
input declared `required` or given a `default_value` · **[R-047]**
a derived input used outside lookup axes.

| Column | Required | Type | Meaning |
| --- | --- | --- | --- |
| `name` | yes | slug | The field key, e.g. `tiv`, `class_code`, `sprinklered`. Referenced as `form_input.<name>`. |
| `label` | yes | string | Human name, e.g. `Total insured value`. |
| `data_type` | yes | enum | `string` \| `number` \| `currency` \| `boolean` \| `enum` |
| `required` | yes | boolean | `true` = the plan cannot rate without it (unless `default_value` is set). |
| `allowed_values` | conditionally | string (CSV) | Closed domain; required when `data_type=enum`. Level ids or literal values. |
| `default_value` | no | varies | **The authored default** used when the field is absent at runtime. Its presence makes a `required` field satisfiable-by-default; runs report how many rows used it. |
| `unit` | no | string | e.g. `USD`, `years`. |
| `min` / `max` | no | number | Validation bounds for numeric inputs. |
| `maps_to_dimension` | no | slug | The dimension this input feeds, when 1:1 (e.g. `construction_class`). Informative for mapping UIs. |
| `derived_from` | no | expr | **The platform computes this input** — today `sum(<input>,<input>,…)` over ≥2 declared numeric (`number`/`currency`) non-derived inputs (e.g. `total_property_limit` = `sum(building_limit,bpp_limit)`). A derived input is never row-supplied: declare `required=false`, no `default_value` **[R-046]**, and drop its column from `test_cases` (supplied values are ignored — R-047 warns). It may key factor-table lookups (via `maps_to_dimension` or a same-named dimension) but cannot drive chain `input_binding`s, predicates, or gate variables **[R-047]** — the value exists inside the rating graph, not on the row. `div(…)` is recognized and named-deferred to class-conditional exposure (registry `class_conditional_exposure`). **[R-045]** |
| `description` | no | string | Free text. |
| `citation_rule` / `citation_page` | no | string | Cite the filing language that defines the field and any default. |

**Example:**

| name | label | data_type | required | allowed_values | default_value | unit | citation_rule | citation_page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tiv | Total insured value | currency | TRUE | | | USD | Rule 2.B | p.9 |
| class_code | Class code | string | TRUE | | | | Rule 3 | p.12 |
| construction_class | Construction class | enum | TRUE | frame,joisted_masonry,fire_resistive | | | Table 5.A | p.51 |
| sprinklered | Sprinklered | boolean | FALSE | | false | | Rule 5.D | p.55 |
| credit_factor | Credit factor | number | FALSE | | 1.00 | | (assumption — see gaps) | |

### 4.3 Sheet `dimensions` (one row per dimension)

Declares the *header* of each dimension; levels live in
`dimension_levels`. **[R-060]** duplicate slug · **[R-061]** invalid
`shape`/`role`/`data_type` · **[R-064]** `shape=geographic` without
`geo_granularity`+`geo_scope` · **[R-065]** invalid composite `axes`
· **[R-066]** `data_type=enum` or `shape=banded` with no levels.

| Column | Required | Type | Allowed values |
| --- | --- | --- | --- |
| `slug` | yes | slug | unique within plan |
| `display_name` | yes | string | |
| `shape` | yes | enum | `categorical` \| `banded` \| `geographic` \| `composite` |
| `role` | yes | enum | `rating-input` \| `structural` \| `both` |
| `data_type` | yes | enum | `string` \| `number` \| `currency` \| `boolean` \| `enum` |
| `dimension_type` | no | enum | `standard` (default) \| `geographic` \| `classification` |
| `geo_granularity` | iff geographic | enum | `state` \| `county` \| `zip` |
| `geo_scope` | iff geographic | string | `national`, or `subset:KS,MO,NE` |
| `axes` | iff composite | string (CSV) | 2–3 slugs of *non-composite* dimensions declared in this sheet; no nesting |
| `class_library_id` | iff classification | slug | |
| `description` | no | string | |
| `source_page` | no | integer | provenance |

**Example:**

| slug | display_name | shape | role | data_type | dimension_type | geo_granularity | geo_scope | axes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| construction_class | Construction class | categorical | both | enum | standard | | | |
| building_age | Building age (yrs) | banded | rating-input | number | standard | | | |
| territory | Territory | geographic | rating-input | string | geographic | zip | subset:KS | |
| class_code | Class code | categorical | rating-input | string | classification | | | |
| constr_x_class | Construction × Class | composite | structural | string | standard | | | construction_class,class_code |

> **A territory list alone is not geographic.** Many manuals rate by
> territory codes without ever defining them geographically. That
> dimension is a **plain categorical** — `shape=categorical`,
> `dimension_type=standard`, the codes as its levels. Declare
> `geographic` only when the filing defines territories by a
> geographic **indicator** (ZIP or county today; census tract when
> the platform grows the grain) — the indicator is what arms the
> geographic machinery: member resolution at quote time, scope
> coverage (R-083), the territory map. **[R-086]** flags a
> `geographic` dimension carrying no indicator (AP-11).

### 4.4 Sheet `dimension_levels` (long-format; one row per level)

The `kind` column discriminates. Rows group by `dimension_slug`.
**[R-067]** duplicate `level_id` within a dimension · **[R-068]**
`dimension_slug` not declared in `dimensions` · **[R-062]** banded
levels overlap or leave gaps · **[R-063]** interior `±inf` ·
**[R-069]** non-positive band width.

| Column | Required | Type | Applies to `kind` |
| --- | --- | --- | --- |
| `dimension_slug` | yes | slug | all (FK → `dimensions.slug`) |
| `kind` | yes | enum | `categorical` \| `banded` \| `geographic` |
| `level_id` | yes | slug | all — stable; factor-table keys reference it |
| `label` | yes | string | all |
| `aliases` | no | string (CSV) | categorical — input strings that resolve to this level (put the filing's numeric codes here) |
| `min` | iff banded | number or `-inf` | band lower bound (inclusive) |
| `max` | iff banded | number or `+inf` | band upper bound (exclusive) |
| `territory_ref` | iff geographic | string | the territory code |
| `territory_members` | no | string (CSV) | geographic grouping members |
| `citation_rule` / `citation_page` | no | string | provenance |

**Banded conventions (critical):** intervals are half-open
`[min, max)`; bands are contiguous, sorted, gap-free
(`band[i].max == band[i+1].min`); the first band may open at `-inf`,
the last may close at `+inf`; no interior infinities; every band has
positive width.

**Examples:**

| dimension_slug | kind | level_id | label | aliases | min | max |
| --- | --- | --- | --- | --- | --- | --- |
| construction_class | categorical | frame | Frame (ISO 1) | frame,wood,iso1,1 | | |
| construction_class | categorical | fire_resistive | Fire-resistive (ISO 6) | fr,iso6,6 | | |
| building_age | banded | age_0_15 | 0–15 yrs | | 0 | 15 |
| building_age | banded | age_15_plus | 15+ yrs | | 15 | +inf |

| dimension_slug | kind | level_id | label | territory_ref | territory_members |
| --- | --- | --- | --- | --- | --- |
| territory | geographic | t1 | Territory 1 | T1 | |
| territory | geographic | t2 | Territory 2 | T2 | |

> **ZIP→territory detail does not go here** (AP-10). One row per
> *territory* here; the ZIP detail goes in a `geo.<slug>` sheet
> (§4.15).

### 4.5 Sheets `ft.<slug>` (one sheet per factor table)

Sheet name = `ft.` + table slug. **The first rows are a 2-column
metadata block, then one blank row, then the grid.**
**[R-100]** missing required meta key · **[R-101]** `table_id` ≠
sheet-name slug · **[R-102]** invalid `dimensionality` /
`lookup_method` / `interpolation` · **[R-103]** unknown
`row_dimension`/`col_dimension` · **[R-109]** empty grid.

| meta key | Required | Meaning |
| --- | --- | --- |
| `table_id` | yes | slug; equals the sheet-name suffix |
| `display_name` | yes | |
| `dimensionality` | yes | `1d` \| `2d` |
| `row_dimension` | yes | slug of the dimension indexing the rows |
| `col_dimension` | `2d` only | slug of the dimension indexing the columns |
| `lookup_method` | yes | `direct` \| `binned` \| `bracketed` \| `classification` |
| `interpolation` | no | `stepped` (default) \| `linear`. For banded tables discretizing a curve (ILFs): `stepped` applies the band's factor flat; `linear` interpolates between breakpoints = band **lower bounds**, clamped ends (§12.3 — **both** table shapes since Brief 95 C5: 2-D along the row axis, 1-D banded as a curve). The check emits a notice **[R-111]** naming each interpolating table. Compute `test_cases` expectations interpolated. |
| `default_value` | no | factor used when a key misses. **Omit it to keep the refuse-on-unknown posture** (recommended unless the filing itself publishes an "all other" row). The reserved row key `__default__` is the row-form equivalent. |
| `citation_rule` / `citation_page` | no | table-level citation (rows may override) |
| `citation_note` | no | free text for cell-level exceptions a matrix can't cite individually |

#### 4.5.1 1-D layout

After the metadata block + blank row:

| `level_id` | `factor` | `citation_rule` | `citation_page` |
| --- | --- | --- | --- |

- Every `level_id` is a declared level of `row_dimension` (or
  `__default__`). **[R-104]**
- The inverse checks too: a **declared** level with no factor row is
  named at check time (both axes of a matrix) — a notice when the
  miss refuses honestly at runtime, a **warning** when a
  `__default__` row would silently price it. Geographic dimensions
  are exempt (territory tables key by group). **[R-174]**
- `factor` is finite and `> 0`. **[R-107]**
- Keys unique **[R-106]**; at most one `__default__` **[R-108]**.
- A **banded** 1-D table (over a `banded` dimension) is the curve
  form: band boundaries live on the dimension; this grid carries one
  factor per band id. Write the filing's own breakpoints — never
  invent finer ones.

#### 4.5.2 2-D layout (the matrix)

After the metadata block + blank row: `row_dimension` level ids down
the first column, `col_dimension` level ids across the header, factor
per cell; top-left cell holds the literal `row\col`. Row labels must
be levels of `row_dimension`, column labels levels of `col_dimension`
**[R-105]**. A blank cell means "use `default_value` (or refuse when
none)" — never `0`. Citations are table-level.

**Example — `ft.constr_x_protection`:**

```
table_id          constr_x_protection
display_name      Construction × Protection-class factor
dimensionality    2d
row_dimension     construction_class
col_dimension     protection_class
lookup_method     direct
citation_rule     Table 5.C
citation_page     p.53
(blank row)
```

| row\col | pc_1_4 | pc_5_8 | pc_9_10 |
| --- | --- | --- | --- |
| frame | 0.90 | 1.00 | 1.25 |
| fire_resistive | 0.70 | 0.80 | 0.95 |

> **3+ axes:** cap sheets at 2-D. Fuse two axes into a `composite`
> dimension and table against the composite (row labels are the
> composite level ids `levelA·levelB`).

### 4.6 Sheet `chains` (the rating tower)

One block per coverage; within a block, ordered stages. The tower
reads top to bottom: `base` → each `lookup.*`/`flat_factor`
multiplies → `exposure` divides → `lcm` multiplies last.
**[R-120]** `coverage` not in `plan.coverages` · **[R-121]** lookup
row references a `ft.*` sheet that doesn't exist · **[R-122]**
unknown `dimension` · **[R-123]** a coverage block with no `base` ·
**[R-124]** `lcm`/`exposure`/`base` row missing its value/binding ·
**[R-125]** invalid `stage_kind` · **[R-126]** duplicate `stage_id`
within a coverage · **[R-127]** malformed `input_binding` (the three
forms in the column table; `context.lcm` on `lcm` rows only, and the
plan sheet must carry a numeric `lcm` to resolve it) · **[R-128]**
malformed `predicate` (§4.6.1).

| Column | Required | Type | Meaning |
| --- | --- | --- | --- |
| `coverage` | yes | string | a value from `plan.coverages` |
| `coverage_value` | no | string | sub-tower split within the coverage (e.g. a peril or side: `side_a`), when the filing rates sub-components separately. Blank = the coverage's single tower. |
| `order` | yes | integer | ascending within the (coverage, coverage_value) block |
| `stage_kind` | yes | enum | see table below |
| `stage_id` | yes | slug | unique within the coverage |
| `factor_table` | iff lookup | slug | the `ft.<slug>` this stage reads |
| `dimension` | iff lookup | slug | the dimension whose value keys the lookup |
| `input_binding` | conditionally | string | for `base`/`exposure`/`lcm`: value source — `form_input.<name>` (a declared input, read per risk), `literal:<number>` (the filed number itself, e.g. a fixed exposure base), or `context.lcm` (`lcm` rows only: the plan sheet's `lcm` value, resolved into the stage at build time so the block cites one plan-level number without copying it) **[R-127]** |
| `value` | conditionally | number | literal for `base`/`lcm`/`flat_factor` |
| `exposure_divisor` | iff exposure | number | e.g. `100` for per-$100 |
| `predicate` | no | string | stage applies only when true (§4.6.1). **Operators beyond `==` are registry-`unsupported` here** (r4 `predicate_beyond_equality` — the platform's factor gate tests equality only): use a banded/yes-no table, or record in gaps. |
| `description` | no | string | actuary-language trace line |
| `citation_rule` / `citation_page` | no | string | provenance |

| `stage_kind` | Role | Needs |
| --- | --- | --- |
| `base` | Base rate / loss cost. First stage of a block. | `value` or `input_binding` |
| `lookup.classification` | Class-code → factor. | `factor_table`, `dimension` |
| `lookup.direct` | Categorical key → factor. | `factor_table`, `dimension` |
| `lookup.range` | Banded numeric → factor (the curve form). | `factor_table`, `dimension` |
| `lookup.multi` | 2-D matrix lookup. | `factor_table` (2d), `dimension` (row dim) |
| `lookup.territory` | Geographic → territory factor. | `factor_table` or geo dim, `dimension` |
| `flat_factor` | Constant multiplier. **Registry-`unsupported` in chains** (r3 `chain_flat_factor` — the engine cannot key an unkeyed constant): use a 1-D table over a yes/no dimension, or a loading. | `value` |
| `exposure` | Divide by exposure units. | `input_binding`, `exposure_divisor` |
| `lcm` | Loss-cost multiplier, last factor. | `value` or `input_binding` |

#### 4.6.1 Predicate grammar (locked)

A predicate is one comparison; multiple conditions on one row are not
supported (split into stages or record in gaps).

```
predicate  = path SP op SP value
path       = namespace "." slug          ; namespace = "form_input" | "dim"
op         = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in"
value      = number | boolean | string | list
list       = "[" value ("," SP? value)* "]"
```

Examples: `form_input.sprinklered == true` ·
`dim.construction_class in [frame, joisted_masonry]` ·
`form_input.tiv >= 500000`. Strings are unquoted level ids/literals;
numbers per §2.1. The same grammar serves `chains.predicate`,
`loadings.predicate`, and `endorsements.trigger`.

> The grammar is shared; expressibility is not. `endorsements.trigger`
> executes the full operator set. On `chains.predicate` and
> `loadings.predicate` the platform's factor gate is equality-only —
> operators beyond `==` are registry-`unsupported` (r4
> `predicate_beyond_equality`, **[R-190]**) until the domain predicate
> widens. Express a threshold or set condition as a 1-D table over a
> banded/yes-no dimension of the same input, or record it in gaps.

### 4.7 Sheet `gates` (eligibility)

Ordered, first match wins, tier verdict. A rule carries **one to
three AND-ed conditions** (matching the platform's gate builder);
express OR by writing separate rows with the same `tier` — first
match wins gives OR-of-ANDs, the standard filed-eligibility shape.
**[R-160]** no `__default__` row · **[R-161]** invalid `op` ·
**[R-162]** invalid `tier` · **[R-163]** duplicate `rule_id` ·
**[R-169]** a `_2`/`_3` condition present but incomplete (all three
of `variable_N`/`op_N`/`value_N` or none) · **[R-044]** applies
(every `variable*` must be a declared input) · **[R-171]** warning
when a `value*` literal can never match the bound input's declared
`data_type` (a type-impossible literal doesn't error at runtime —
the rule is silently disarmed) · **[R-172]** warning when an
`eq`/`ne`/`in`/`nin` literal (including each `in`/`nin` CSV entry)
bound to an `enum` input is not among that input's `allowed_values`
(the runtime value never leaves the closed set, so the rule is
silently disarmed the same way; ordering ops are exempt — a numeric
threshold need not be a member).

| Column | Required | Type | Allowed values |
| --- | --- | --- | --- |
| `order` | yes | integer | ascending |
| `rule_id` | yes | slug | unique; `__default__` reserved for the required default row |
| `variable` | yes | string | a declared input name |
| `op` | yes | enum | `eq` \| `ne` \| `lt` \| `le` \| `gt` \| `ge` \| `in` \| `nin` |
| `value` | yes | string/number | RHS; CSV list for `in`/`nin` |
| `variable_2` / `op_2` / `value_2` | no | as above | second AND-ed condition |
| `variable_3` / `op_3` / `value_3` | no | as above | third AND-ed condition (the platform's max) |
| `tier` | yes | enum | `preferred` \| `standard` \| `submit` \| `decline` |
| `reasoning` | yes | string | verbatim into the trace |
| `citation_rule` / `citation_page` | no | string | provenance |

> Conditions beyond three-way AND (nested boolean logic, tests for a
> *missing* field) are not expressible — record them in
> `gaps_and_assumptions` per §6.

### 4.8 Sheet `modifiers` (schedule rating / IRPM)

Filed structure only (categories + caps); per-risk applications are
runtime inputs. **[R-164]** duplicate `category_id` within a schedule
· **[R-165]** `range_pct < 0` or `total_cap_pct <= 0`.

| Column | Required | Type | Meaning |
| --- | --- | --- | --- |
| `schedule_id` / `schedule_name` | yes | slug / string | the schedule (repeat per row) |
| `scope` | yes | enum | `per_coverage` \| `package` |
| `total_cap_pct` | yes | number | filed total cap ±% |
| `category_id` / `category_name` | yes | slug / string | unique within schedule |
| `range_pct` | yes | number ≥ 0 | per-category cap ±% |
| `tier_filter` | no | string (CSV) | tiers this category applies to; empty = all |
| `citation_rule` / `citation_page` | no | string | provenance |

### 4.9 Sheet `endorsements`

**[R-166]** conditional fields by `kind` (factor ⇒ `factor > 0`;
additive ⇒ `amount`; sublimit ⇒ `coverage` + `sublimit > 0`) ·
`trigger` follows §4.6.1.

| Column | Required | Type | Allowed values |
| --- | --- | --- | --- |
| `endorsement_id` | yes | slug | unique |
| `kind` | yes | enum | `factor` \| `additive` \| `sublimit`. **`additive` is registry-`unsupported` on multi-coverage plans** (r3 `endorsement_additive_multi_coverage` — a once-per-policy amount has no single tower to attach to until package-level layering ships); factor endorsements work everywhere. |
| `form_number` | yes | string | e.g. `BP 04 17` |
| `display_name` | yes | string | |
| `factor` / `amount` / `coverage` + `sublimit` | conditionally | | per `kind` |
| `trigger` | no | string | auto-attach predicate; empty = always |
| `citation_rule` / `citation_page` | no | string | provenance |

### 4.10 Sheet `loadings`

**[R-167]** `applies_to` names unknown coverages.

| Column | Required | Type | Meaning |
| --- | --- | --- | --- |
| `loading_id` | yes | slug | unique |
| `factor_kind` | yes | string | `expense`, `profit`, `contingency`, … |
| `display_name` | yes | string | |
| `factor` | yes | number > 0 | e.g. `1.18` for an 18% load |
| `applies_to` | no | string (CSV) | coverages this loading multiplies; **empty = the package total**. This is how a filing's per-coverage loads are targeted. |
| `predicate` | no | string | §4.6.1 grammar; empty = always. Equality only — operators beyond `==` are registry-refused (r4 `predicate_beyond_equality`). |
| `citation_rule` / `citation_page` | no | string | provenance |

### 4.11 Sheet `final_adjustments`

**[R-168]** conditional fields by `kind` (clamp ⇒ `min_value` and/or
`max_value`; round ⇒ `round_increment`) · **[R-170]** `applies_to`
names only declared coverages.

| Column | Required | Type | Meaning |
| --- | --- | --- | --- |
| `adjustment_id` | yes | slug | unique |
| `kind` | yes | enum | `clamp` \| `round` |
| `order` | yes | integer | ascending |
| `applies_to` | no | string (CSV) | coverages this adjustment applies to; **empty = the package total**. **Clamps only** — the engine's `round` is the plan-tail total-rounder (sum → floor → round, once), so a `round` row with `applies_to` (or a second `round` row) fails the check per registry r2 `per_coverage_rounding`. Keep filed per-coverage premiums in `test_cases` with `tolerance_<field> = 0.5` and record the source's rounding order in `gaps_and_assumptions`. |
| `min_value` / `max_value` | clamp | number | floor / cap |
| `round_increment` | round | number | e.g. `1` = whole dollars |
| `round_min` | round | number | post-round floor |
| `citation_rule` / `citation_page` | no | string | provenance |

### 4.12 Sheet `outputs`

**[R-141]** `source` references an unknown stage/adjustment id ·
**[R-142]** duplicate `output_id`/`field_name` · **[R-146]**
`source = coverage:total` with no `round` row in `final_adjustments`.

| Column | Required | Type | Meaning |
| --- | --- | --- | --- |
| `output_id` | yes | slug | unique |
| `field_name` | yes | slug | key in the run result |
| `display_name` | yes | string | |
| `source` | yes | string | the stage/adjustment id (or `coverage:total`) that feeds it. `coverage:total` is produced by the plan-tail `round`, so it requires a package-level `round` row in `final_adjustments` **[R-146]**. |
| `description` | no | string | |

### 4.13 Sheet `test_cases` — REQUIRED, ≥ 1 row

The filing's own worked rating examples, transcribed with their
stated expected premiums. **These are the highest-value rows in the
workbook** — after the build, every row runs through the production
engine and the report shows expected vs actual to the cent.
**[R-140]** non-numeric `expected_*` · **[R-143]** a case omits a
required input that has no default · **[R-144]** an `expected_*`
column names an unknown output · **[R-145]** fewer than 1 row.

Layout: `case_id`, optional `name`, one column per input key, then
`expected_<field_name>` per output, then optional
`tolerance_<field_name>` (absolute; default = cent-exact, 0.005).
When the filing rounds **each coverage** before summing, exact
expectations cannot reproduce — the engine rounds ONCE, at the
package level (registry: `per_coverage_rounding`). Two or more
`expected_*` columns with no `tolerance_*` columns therefore draw a
notice quoting the registry's recipe (`tolerance_<field>` = 0.5 and
a `gaps_and_assumptions` row). **[R-175]**
When the workbook has a `gates` sheet, the reserved column
**`expected_tier`** (a tier enum value) additionally checks the gate
verdict per case.

> **Computing expectations:** §12 states the engine's exact execution
> semantics (rounding order and placement, interpolation anchors,
> withholding rules). Compute `expected_*` from §12; when the filing's
> own printed example follows a different rounding order, keep the
> filed number, add `tolerance_<field>`, and record the difference in
> `gaps_and_assumptions`.

| case_id | name | class_code | construction_class | building_age | tiv | expected_total_premium |
| --- | --- | --- | --- | --- | --- | --- |
| TC-001 | Filing example 1 (p.88) | 71641 | frame | 8 | 350000 | 1834.00 |

### 4.14 Sheet `gaps_and_assumptions` — REQUIRED (rows may be zero)

The transcriber's honesty ledger. One row per gap, ambiguity, assumed
default, or construct the platform can't express. Rows flow
**verbatim** into the build report, so nothing flagged upstream is
lost. An empty sheet asserts "the filing transcribed completely, with
no assumptions" — a strong claim; make it deliberately.
**[R-180]** invalid `kind` · **[R-173]** warning when a gap row declares a construct out of reach (kind `gap`/`unsupported`, or inability wording) that the capability registry marks supported — the ledger and the registry must not tell opposite stories.

| Column | Required | Type | Meaning |
| --- | --- | --- | --- |
| `kind` | yes | enum | `gap` (the filing has it, the workbook doesn't — e.g. an illegible table) \| `assumption` (the transcriber supplied a value the filing doesn't state — e.g. a default) \| `unsupported` (the filing has it, the platform can't express it — see §6) |
| `description` | yes | string | What, precisely. Name the table/rule. |
| `citation_rule` / `citation_page` | no | string | Where in the filing. |
| `impact` | yes | string | What rating behavior results (e.g. "quotes asking for wind/hail deductible will refuse"). |
| `related` | no | string | Sheet/slug this row concerns, e.g. `inputs!credit_factor`. |

**Example:**

| kind | description | citation_page | impact | related |
| --- | --- | --- | --- | --- |
| assumption | Credit factor defaulted to 1.00 — filing references credit tiering but publishes no table. | p.12 | Premiums unchanged for risks without credit data; default visible in every trace. | inputs!credit_factor |
| gap | Wind/hail deductible factor table illegible in the PDF scan — omitted. | p.34 | Quotes with a wind/hail deductible refuse rather than guess. | |
| unsupported | Filing rates multi-building schedules per building; platform rates one risk unit per row. | pp.61-63 | Multi-building policies must be decomposed to one row per building. | |

### 4.15 Sheets `geo.<slug>` (ZIP/county → territory detail)

One sheet per geographic dimension needing sub-state detail; name =
`geo.` + the dimension slug. Flat columns (the ADR-0017 territory-CSV
shape): `zip` (or `county`), `territory_code`, `citation_rule`,
`citation_page`. **Key vocabulary (FCA #25):** the platform joins
geography by Census codes — `zip` keys are 5-digit ZCTA codes and
`county` keys are 5-digit Census FIPS codes. Filings name counties;
to make the manual's own vocabulary quotable, add an ALIAS row per
county (the name, same `territory_code`) beside its FIPS row — the
dual-key convention. Alias rows are recognized (they don't flag as
typo suspects) as long as their territory group carries an
in-universe key. Per-geography **factors never live on this sheet** —
they live in `ft.*` tables keyed by the geographic dimension's levels
(one mechanism, not two; when the filing prices per ZIP, the ZIP *is*
the territory — one level per ZIP with an identity mapping here).
**[R-080]** sheet without a matching geographic dimension ·
**[R-081]** duplicate `zip` · **[R-082]** `territory_code` not among
the dimension's `territory_ref`s.

The sheet is also checked against the **Census geographic universe**
(the packaged `geo-universe.json` — 2024 Gazetteer ZCTAs by SCF
range + counties, public domain): **[R-083]** (notice; WARNING when
0% of the declared scope is mapped — a sheet that maps nothing
almost always keys the wrong vocabulary, and every quote will
refuse) in-scope keys the sheet never maps — they refuse at rating
time; a partial program is legitimate, a transcription hole is not,
and the notice names the counts either way · **[R-084]** (warning)
keys outside the declared `geo_scope` (a typo, or the wrong scope) ·
**[R-085]** (notice) keys the universe doesn't know (PO-box ZIPs
have no ZCTA; typos look like this too) — dual-key ALIAS rows are
exempt: a name-shaped key whose territory group carries an
in-universe key is the sanctioned convention, never a suspect.

---

## 5. Platform-concept → workbook mapping (master table)

| Platform concept | Where in the workbook |
| --- | --- |
| Plan metadata + provenance | `plan` |
| Declared risk inputs (+ authored defaults) | `inputs` |
| Dimension (categorical / banded / geographic / composite) | `dimensions` + `dimension_levels` (+ `geo.*`) |
| Factor table (1-D, 2-D) | `ft.<slug>` |
| Curve (ILF, deductible factor) | a **banded 1-D `ft.*`** at the filing's breakpoints (+ `interpolation` flag) |
| The rating tower per coverage | `chains` (base → lookups → exposure → LCM) |
| Sub-towers within a coverage | `chains.coverage_value` |
| Eligibility | `gates` |
| Schedule rating / IRPM structure | `modifiers` |
| Endorsements | `endorsements` |
| Expense/profit loads (package or per-coverage) | `loadings` (+ `applies_to`) |
| Min premium / rounding / caps | `final_adjustments` |
| Output fields | `outputs` |
| Verification vectors | `test_cases` |
| Gaps, assumptions, unsupported constructs | `gaps_and_assumptions` |

Aggregation across coverages into package totals is synthesized by
the ingester from `plan.coverages` + `outputs` — the transcriber
never authors it.

---

## 6. The capability boundary (what the platform cannot express)

The machine-readable source of truth is
**`transcription-capability-registry.json`**, versioned with the
platform; the check reads it directly, so this section can never
silently drift from enforcement. **[R-190]** a workbook declaring an
`unsupported` construct fails the check with the registry's message ·
**[R-191]** a `partial` construct passes with a warning that rides
into the build report.

Summary as of registry r2 (2026-07-14):

| Construct | Status | What the transcriber does |
| --- | --- | --- |
| Linear interpolation between table breakpoints | **supported** | Set `interpolation=linear`. Both shapes interpolate (ADR-0063 + Brief 95 C5): 2-D along the row dimension's axis, 1-D banded as a curve — breakpoints at band lower bounds, clamped ends. The R-111 notice names each interpolating table. |
| Per-coverage rounding (round each tower, then sum) | **unsupported** | One package-level `round` row; per-coverage filed premiums carry `tolerance_<field> = 0.5` in `test_cases`; record the source's rounding order in gaps. Per-coverage **clamps** still work. |
| Multi-location policies | **partial** | The platform rates one risk unit per row and aggregates locations at the policy seam. Transcribe per-location rating normally; note policy-level combination rules in gaps. |
| Per-vehicle / per-driver rating (personal & commercial auto) | **unsupported** | Record in gaps (`unsupported`). Decompose to one row per vehicle where the book allows; driver-assignment algorithms cannot be expressed. |
| Cross-product packages (one policy, multiple products, package credits across them) | **unsupported** | One product per workbook/plan; record package interactions in gaps. |
| Arbitrary DAG topologies (fan-out, diamond joins) | **unsupported** | The workbook expresses linear towers per coverage. Most filed manuals are linear; anything else goes in gaps. |
| N-way conditional branching (`case` logic) | **unsupported** | Simple conditions ride `predicate` columns; true branching goes in gaps. |
| Free-form formula stages | **unsupported (v1)** | Express formulas as banded tables at the filing's breakpoints; cite the formula. |
| Sub-plan composition / stacking (per-state amendments layered on a base) | **unsupported** | Flatten (§7.3): transcribe the *effective* algorithm; citations preserve the layering. |
| Model-backed factors (GLM scores etc.) | **unsupported by definition** | Filed tables only; models live elsewhere. |
| Class-conditional exposure bases (different divisor per class) | **unsupported (v1)** | Single divisor per chain; record exceptions in gaps. |
| Experience mods, filed as external indices (WC ex-mod) | **supported as an input** | Declare an `inputs` row (the bureau computes it; the plan consumes it). |
| Premium capping vs prior term | **supported if prior premium is an input** | Declare `prior_premium` in `inputs`; express the cap in `final_adjustments`/chains. |

When in doubt whether a construct fits: **record it in
`gaps_and_assumptions` and keep going.** A gap the reviewer can see
beats an approximation nobody can.

---

## 7. The transcription procedure

This section instructs the transcriber. Treat it as a procedure, not
advice. Product-specific guidance (how BOP/GL/etc. constructs map)
lives in `transcription-profiles/`; the procedure below is universal.

### 7.1 Naming + id conventions

- **Slugs derive from meaning, not the filing's table numbers.**
  `construction_class`, not `table_5a`. The slug is permanent; the
  filing's numbering is not.
- **Levels get semantic ids.** `frame` / `fire_resistive`, not `1` /
  `6` — put the filed numeric codes in `aliases` so either resolves.
- **One concept, one slug.** If the filing uses "occupancy" and
  "occupancy class" interchangeably, pick one slug; note the synonym
  in `description`.
- `__default__` is reserved (§2.3).
- Factor-table sheets are `ft.<slug>`; geo detail sheets are
  `geo.<slug>` — exactly those prefixes.

### 7.2 How to chunk a large filing

Build the workbook **incrementally, sheet by sheet, in dependency
order** (a factor table cannot precede its dimension):

1. **Skeleton.** Read the table of contents + the "how to rate" /
   rating-order section. Emit `plan`, a first-cut `inputs`, and a
   *stub* `chains` capturing the order of operations — the spine
   everything hangs off.
2. **Dimensions.** For each variable the rating order references,
   emit its `dimensions` row + `dimension_levels`. Classification and
   territory chapters chunk separately.
3. **Factor tables.** One filed table per `ft.*` sheet, one chunk at
   a time. Cross-check every key against pass-2 levels — a missing
   key means a missed level; go back and add it.
4. **Gates / modifiers / endorsements / loadings / final
   adjustments.** Usually their own filing sections.
5. **Test cases.** Transcribe the filing's worked examples with their
   stated premiums, verbatim.
6. **Honesty pass.** Fill `gaps_and_assumptions` — every ambiguity,
   every assumed default, every §6 exclusion you encountered.
7. **Validate.** Run the §7.5 checklist; fix referential breaks (they
   reveal missed levels/tables).

Assemble incrementally — keep the workbook open across chunks; when a
later chunk reveals an earlier omission, go back and fix it rather
than papering over with a `__default__`.

### 7.3 Handling ambiguity, ranges, footnotes, adoptions

- **Ambiguity → breadcrumb, never a silent guess.** Default to the
  filing's stated arithmetic; when silent, multiplicative is the
  norm for factor application — and the uncertainty goes in `notes` +
  `draft_status=extracted` + a `gaps_and_assumptions` row.
- **Missing value → empty cell + gaps row.** Never write `1.0` to
  mean "the filing didn't say" (AP-6).
- **Ranges** become banded levels + a 1-D table keyed on band ids —
  never one row per integer (AP-4).
- **A formula over a continuous variable** ("ILF = …") becomes a
  banded table at the filing's stated breakpoints, `interpolation`
  set per the filing's method, the formula cited in `citation_rule`.
- **Footnotes** that condition a factor become `predicate`s; ones
  that add an alternative table become another `ft.*` selected by a
  predicate; purely explanatory ones go in `notes`. Never bury a
  conditional inside another factor's value (AP-1).
- **Adoptions (bureau base + carrier exceptions): flatten.**
  Transcribe the *effective* algorithm — the base with every
  exception applied — as one self-contained workbook. Citations point
  at both documents (`source_documents` lists them), which preserves
  the layering for audit without a layering mechanism.
- **State exceptions in a multistate manual:** when the plan is
  single-state (`state` set), encode that state's effective values.
  Do not hand-merge a state exception into a national factor without
  citing both pages.

### 7.4 Referential integrity (the hard rules)

The reader rejects a workbook that violates any of these; each is a
`R-###` in §8: chains reference existing tables + dimensions
(R-121/R-122) · factor-table keys are declared levels (R-104/R-105) ·
bands are contiguous, gap-free, half-open (R-062/R-063/R-069) ·
geographic scope is covered and territory refs resolve (R-082–R-085) ·
composites reference 2–3 existing non-composite dimensions (R-065) ·
factors finite and positive (R-107) · keys unique, one `__default__`
max (R-106/R-108) · gates have exactly one default and valid
enums (R-160–R-163) · outputs' sources exist (R-141) and
`coverage:total` has its producing round row (R-146) · every consumed
input is declared (R-044) · every slug is well-formed (R-006) · test
cases cover required inputs and name real outputs (R-143/R-144).

### 7.5 Pre-flight checklist (run before declaring the workbook done)

- [ ] All seven required sheets present (`plan`, `inputs`,
      `dimensions`, `chains`, `outputs`, `test_cases`,
      `gaps_and_assumptions`); `dimension_levels` present if any
      dimension has levels.
- [ ] `plan`: every required field, valid `product`, `spec_version`
      = `1.0`, non-empty `coverages`; SERFF number when the source is
      a SERFF filing.
- [ ] `inputs`: every field consumed anywhere is declared; enums have
      `allowed_values`; every authored `default_value` has a
      `gaps_and_assumptions` row when the filing doesn't state it.
- [ ] Dimensions/levels: enums valid; geo dims carry granularity +
      scope; bands contiguous/sorted/gap-free with only edge
      infinities.
- [ ] Factor tables: metadata blocks complete; every key a declared
      level; factors finite + positive; keys unique; ≤ one
      `__default__`; matrices label-valid; `interpolation` set where
      the filing interpolates.
- [ ] Chains: every coverage in `plan.coverages` has a block starting
      with `base`; lookups reference real tables + dimensions;
      `exposure`/`lcm` rows carry their values.
- [ ] Citations on every filed value (or `(carrier-set)`);
      `source_documents` lists every PDF consumed.
- [ ] `test_cases`: ≥ 1 (aim ≥ 5); the filing's worked examples
      verbatim with stated premiums.
- [ ] `gaps_and_assumptions` complete — every guess, gap, and §6
      exclusion recorded. Empty only if genuinely none.
- [ ] No formulas, no currency symbols, no thousands separators, no
      `0`-for-absent, no invented values (AP-9).
- [ ] **The check ran and reported zero errors** (§0: the drop panel,
      `POST /api/v1/plans/ingest/check`, or
      `python -m openrater.rates.ingest check <file>`). Warnings are
      allowed — they ride into the build report — but review them.

### 7.6 Anti-patterns (explicitly forbidden)

| # | Anti-pattern | Do instead |
| --- | --- | --- |
| AP-1 | Pre-computing a combined factor (one column already `class × construction`). | One filed table per `ft.*`; the engine multiplies. Anything else destroys the trace. |
| AP-2 | Free text where an enum is required (`tier = "preferred risk"`). | The exact token; prose goes in `reasoning`/`description`. |
| AP-3 | Merging two variables into one dimension. | One dimension per variable; one table per filed table. |
| AP-4 | One row per integer of a continuous variable. | Banded levels with `min`/`max`. |
| AP-5 | Renaming a slug to fix a label typo. | Fix `display_name`/`label`; never touch the slug. |
| AP-6 | Writing `1.0`/`0` to mean "not stated." | Empty cell + `gaps_and_assumptions` row. |
| AP-7 | Excel formulas instead of literal values. | Write the computed number. |
| AP-8 | Silently resolving ambiguity. | `notes` + `draft_status=extracted` + a gaps row. |
| AP-9 | Inventing factors the filing doesn't state. | Leave blank + flag; human judgment gets its own citation. |
| AP-10 | ZIP-level detail in `dimension_levels`. | `geo.<slug>` sheet; levels stay at territory granularity. |
| AP-11 | Declaring `geographic` for a bare territory list (codes only, no ZIP/county detail). | A plain categorical dimension; geography engages only when the filing defines territories by a geographic indicator. |
| AP-11 | Leaving filed rules in prose (eligibility never reaching `gates`). | Every filed rule/category/loading gets a row in its sheet. |
| AP-12 | Approximating a §6-unsupported construct into the nearest expressible shape without saying so. | Record it in `gaps_and_assumptions` (`unsupported`) per the registry's guidance — visible beats plausible. |

---

## 8. The rule table (the check's contract)

Every machine-checkable statement above, by id. **Severity `error`
blocks the build; `warning` rides into the build report.** The
checker implements exactly this list; a workbook "conforms to spec
v1.0" iff it triggers zero errors.

| Rule | Severity | Statement |
| --- | --- | --- |
| R-001 | error | File is a readable `.xlsx` (OOXML) workbook. |
| R-002 | error | No merged cells in data sheets (every cell but a merged range's top-left reads as blank); the error cites the range. Ignored sheets (R-203) are exempt. |
| R-003 | error | Every data sheet has the canonical header row; required columns present. |
| R-004 | error | No formula-bearing cells in data sheets. |
| R-005 | error | Numeric cells are numbers (no text numbers, currency symbols, thousands separators). |
| R-006 | error | Every id/slug matches `^[a-z0-9][a-z0-9_-]{0,79}$`. |
| R-007 | error | Slugs unique within their namespace. |
| R-008 | error | `__default__` never used as a real level id. |
| R-020 | error | Required sheet `inputs` present. |
| R-021 | error | Required sheet `plan` present. |
| R-022 | error | Required sheet `dimensions` present. |
| R-023 | error | Required sheet `chains` present. |
| R-024 | error | Required sheet `outputs` present. |
| R-025 | error | Required sheet `test_cases` present. |
| R-026 | error | Required sheet `gaps_and_assumptions` present. |
| R-027 | error | `plan` carries every required field (§4.1). |
| R-028 | error | `plan.product` is a valid product code. |
| R-029 | error | `plan.state`, when set, is a 2-letter code. |
| R-030 | error | `plan.effective_date` is `YYYY-MM-DD`. |
| R-031 | error | `plan.coverages` non-empty. |
| R-032 | error | `plan.spec_version` present and known to the reader. |
| R-040 | error | `inputs.name` unique. |
| R-041 | error | `inputs.data_type` in its enum. |
| R-042 | error | `data_type=enum` ⇒ `allowed_values` non-empty. |
| R-043 | error | `default_value` within `allowed_values` / `min`..`max` when both present. |
| R-044 | error | Every field consumed by `chains`/`gates`/`test_cases` is declared in `inputs`. |
| R-045 | error | `derived_from` parses as `sum(…)` over ≥ 2 declared, non-derived, numeric operands; the derived input itself is numeric. `div(…)` is named-deferred (registry `class_conditional_exposure`). |
| R-046 | error | A derived input is never row-supplied: `required=false`, no `default_value`. |
| R-047 | error | A derived input keys lookups only — not chain `input_binding`s, predicates, or gate variables. (Warning: a `test_cases` column supplying one is ignored.) |
| R-048 | error | Coverage election (§4.1 `?`): at least one coverage stays required; an electable coverage's chain carries an exposure stage (election reads the exposure). |
| R-060 | error | `dimensions.slug` unique. |
| R-061 | error | `shape`/`role`/`data_type` in their enums. |
| R-062 | error | Banded levels contiguous and non-overlapping (sorted, `max[i] == min[i+1]`). |
| R-063 | error | No interior `±inf` (first `min` / last `max` only). |
| R-064 | error | Geographic dims carry `geo_granularity` + `geo_scope`. |
| R-065 | error | Composite `axes` = 2–3 existing non-composite dimensions, no duplicates. |
| R-066 | error | `data_type=enum` / `shape=banded` dims have ≥ 1 level of the right kind. |
| R-067 | error | `level_id` unique within its dimension. |
| R-068 | error | `dimension_levels.dimension_slug` declared in `dimensions`. |
| R-069 | error | Every band has positive width (`min < max`). |
| R-080 | error | Every `geo.<slug>` sheet matches a declared geographic dimension. |
| R-081 | error | `geo.*` keys (`zip`/`county`) unique within the sheet. |
| R-082 | error | Every `geo.*.territory_code` matches a level's `territory_ref`. |
| R-083 | notice / warning | In-scope Census keys the `geo.*` sheet never maps (they refuse at rating time — a consequence, not a defect; partial programs are legitimate). Escalates to a WARNING at 0% mapped coverage — a sheet mapping nothing almost always keys the wrong vocabulary (FCA #25). |
| R-084 | warning | `geo.*` keys outside the declared `geo_scope` (typo or wrong scope). |
| R-085 | notice | `geo.*` keys unknown to the Census universe (PO-box ZIPs have no ZCTA; typos look like this). Dual-key ALIAS rows are exempt: a name-shaped key whose territory group carries an in-universe key is the sanctioned convention (FCA #25). |
| R-086 | warning | `geographic` declared with no geographic indicator (no `geo.*` sheet, no `territory_members`) — a bare territory list is categorical (AP-11). |
| R-100 | error | `ft.*` metadata block carries every required key. |
| R-101 | error | `table_id` equals the sheet-name suffix. |
| R-102 | error | `dimensionality`/`lookup_method`/`interpolation` in their enums. |
| R-103 | error | `row_dimension`/`col_dimension` are declared dimensions. |
| R-104 | error | Every 1-D key (and 2-D row label) is a declared level of `row_dimension` (or `__default__`). |
| R-105 | error | Every 2-D column label is a declared level of `col_dimension`. |
| R-106 | error | Keys unique within a table. |
| R-107 | error | Every factor finite and `> 0`. |
| R-108 | error | At most one `__default__` per table. |
| R-109 | error | The grid has ≥ 1 factor row/cell. |
| R-111 | notice | `interpolation=linear` — the table interpolates (both shapes, ADR-0063 + Brief 95 C5): breakpoints at band lower bounds, clamped ends; named per table and announced in the build report. |
| R-120 | error | `chains.coverage` ∈ `plan.coverages`. |
| R-121 | error | Lookup rows reference an existing `ft.*` sheet. |
| R-122 | error | Lookup rows reference a declared dimension. |
| R-123 | error | Every (coverage, coverage_value) block starts with a `base`. |
| R-124 | error | `base`/`exposure`/`lcm` rows carry their value/binding/divisor. |
| R-125 | error | `stage_kind` in its enum. |
| R-126 | error | `stage_id` unique within its coverage. |
| R-127 | error | `input_binding` parses: `form_input.<name>` / `literal:<number>` / `context.lcm` (the last on `lcm` rows only, with a numeric plan-sheet `lcm` to resolve from). |
| R-128 | error | Predicates parse per the §4.6.1 grammar. |
| R-140 | error | `expected_*` cells are numeric. |
| R-141 | error | `outputs.source` references an existing stage/adjustment. |
| R-142 | error | `output_id`/`field_name` unique. |
| R-143 | error | Every test case supplies (or defaults) every required input. |
| R-144 | error | Every `expected_*` column names a declared output (or is the reserved `expected_tier` when a `gates` sheet exists). |
| R-145 | error | `test_cases` has ≥ 1 row. |
| R-146 | error | `source = coverage:total` requires a package-level `round` row in `final_adjustments` (the plan-tail round is what produces the total). |
| R-160 | error | `gates` has exactly one `__default__` row. |
| R-161 | error | `gates.op` in its enum. |
| R-162 | error | `gates.tier` in its enum. |
| R-163 | error | `gates.rule_id` unique. |
| R-164 | error | `modifiers.category_id` unique within a schedule. |
| R-165 | error | `range_pct ≥ 0`; `total_cap_pct > 0`. |
| R-166 | error | Endorsement conditional fields present + valid per `kind`. |
| R-167 | error | `loadings.applies_to` names only declared coverages. |
| R-168 | error | Final-adjustment conditional fields present per `kind`. |
| R-169 | error | Gate `_2`/`_3` conditions are complete triples (`variable_N` + `op_N` + `value_N`) or absent. |
| R-170 | error | `final_adjustments.applies_to` names only declared coverages. |
| R-171 | warning | A gate `value*` literal that can never match its bound input's declared `data_type` (e.g. `banana` against a `boolean`, non-numeric text against a `number`/`currency`) — the runtime comparator never equates the two, so the rule is silently disarmed (eq/in) or fires on every risk (ne/nin). |
| R-172 | warning | A gate `eq`/`ne`/`in`/`nin` literal (including each `in`/`nin` CSV entry) bound to an `enum` input that is not among the input's `allowed_values` — the runtime value never leaves the closed set, so the rule is silently disarmed exactly as in R-171. Ordering ops (`lt`/`le`/`gt`/`ge`) are exempt: they compare numerically and a threshold need not be a member. |
| R-180 | error | `gaps_and_assumptions.kind` in its enum; `description` + `impact` non-empty. |
| R-173 | warning | A `gaps_and_assumptions` row that claims a capability is out of reach (kind `gap`/`unsupported`, or inability wording such as “unsupported”/“cannot”) while the capability registry marks the named construct supported (or partially supported) — the registry’s guidance is quoted so the transcriber re-checks before shipping a false gap. |
| R-174 | notice / warning | The inverse of R-104: a **declared** level has no row in a factor table keyed by its dimension (both axes of a matrix). A notice when the miss refuses honestly at runtime; a **warning** when the table carries a `__default__` row, which silently prices the missing level instead. Geographic dimensions are exempt — territory tables key by group, with member levels riding under them. |
| R-175 | notice | `test_cases` carries two or more `expected_*` columns and no `tolerance_*` columns. If the filing rounds per coverage before summing, exact matches miss by cents — the engine rounds once, at the package level (registry: `per_coverage_rounding`) — so the notice quotes the registry's tolerance recipe before ingestion instead of after failing vectors. |
| R-190 | error | No `unsupported` registry construct is declared/required by the workbook (message from the registry, with the gaps-sheet convention). |
| R-191 | warning | **Umbrella:** every machine-detectable `partial` registry construct passes with the registry's warning — via a construct-specific rule id where one exists; R-191 itself fires for any detectable partial construct that has no dedicated rule. A checker self-test enforces the coverage (vacuously satisfied while no detectable partial construct exists — `linear_interpolation` graduated to supported in r9). |
| R-201 | warning | Filed-value rows without `citation_rule` (provenance recommended). |
| R-202 | warning | Unknown trailing columns (preserved, surfaced). |
| R-203 | notice | Unrecognized sheets ignored (README etc.). |

---

## 9. Worked mini-example (a complete conformant workbook)

One categorical + one banded dimension, one 1-D and one 2-D factor
table, a 5-stage chain, and all seven required sheets. Markdown
tables = literal cell layout.

**`plan`**

| field | value |
| --- | --- |
| spec_version | 1.0 |
| rating_plan_id | mini-bop-demo-il-2026 |
| display_name | Mini BOP demo — Illinois — 2026 |
| version | 1.0.0 |
| carrier | Demo Mutual |
| product | bop |
| jurisdiction_country | US |
| state | IL |
| effective_date | 2026-01-01 |
| coverages | building |
| filing_type | new |
| source_documents | mini_bop_manual.pdf |

**`inputs`**

| name | label | data_type | required | allowed_values | default_value | unit |
| --- | --- | --- | --- | --- | --- | --- |
| tiv | Total insured value | currency | TRUE | | | USD |
| construction_class | Construction class | enum | TRUE | frame,fire_resistive | | |
| building_age | Building age | number | TRUE | | | years |

**`dimensions`**

| slug | display_name | shape | role | data_type | dimension_type |
| --- | --- | --- | --- | --- | --- |
| construction_class | Construction class | categorical | both | enum | standard |
| building_age | Building age (yrs) | banded | rating-input | number | standard |

**`dimension_levels`**

| dimension_slug | kind | level_id | label | aliases | min | max |
| --- | --- | --- | --- | --- | --- | --- |
| construction_class | categorical | frame | Frame (ISO 1) | frame,wood,iso1 | | |
| construction_class | categorical | fire_resistive | Fire-resistive (ISO 6) | fr,iso6 | | |
| building_age | banded | age_0_25 | 0–25 yrs | | 0 | 25 |
| building_age | banded | age_25_plus | 25+ yrs | | 25 | +inf |

**`ft.construction_class`** — metadata block, blank row, grid:

| field | value |
| --- | --- |
| table_id | construction_class |
| display_name | Construction factor |
| dimensionality | 1d |
| row_dimension | construction_class |
| lookup_method | direct |
| citation_rule | Table 5.A |
| citation_page | p.51 |

| level_id | factor | citation_rule | citation_page |
| --- | --- | --- | --- |
| frame | 1.00 | Table 5.A | p.51 |
| fire_resistive | 0.78 | Table 5.A | p.51 |

**`ft.constr_x_age`** — metadata block, blank row, matrix:

| field | value |
| --- | --- |
| table_id | constr_x_age |
| display_name | Construction × Age factor |
| dimensionality | 2d |
| row_dimension | construction_class |
| col_dimension | building_age |
| lookup_method | direct |
| citation_rule | Table 5.B |
| citation_page | p.52 |

| row\col | age_0_25 | age_25_plus |
| --- | --- | --- |
| frame | 1.00 | 1.20 |
| fire_resistive | 0.95 | 1.05 |

**`chains`**

| coverage | order | stage_kind | stage_id | factor_table | dimension | input_binding | value | exposure_divisor | citation_rule | citation_page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| building | 0 | base | bld_base | | | literal:0.150 | 0.150 | | Table 4.A | p.40 |
| building | 1 | lookup.direct | bld_constr | ft.construction_class | construction_class | | | | Table 5.A | p.51 |
| building | 2 | lookup.multi | bld_constr_age | ft.constr_x_age | construction_class | | | | Table 5.B | p.52 |
| building | 3 | exposure | bld_exposure | | | form_input.tiv | | 100 | | |
| building | 4 | lcm | bld_lcm | | | | 1.30 | | (carrier-set) | |

**`outputs`**

| output_id | field_name | display_name | source |
| --- | --- | --- | --- |
| out_building | building_premium | Building premium | bld_exposure |

**`test_cases`**

| case_id | name | construction_class | building_age | tiv | expected_building_premium |
| --- | --- | --- | --- | --- | --- |
| TC-1 | Frame, 10 yrs, $200k | frame | 10 | 200000 | 390.00 |

**`gaps_and_assumptions`** — header row only (this tiny manual
transcribed completely):

| kind | description | citation_rule | citation_page | impact | related |
| --- | --- | --- | --- | --- | --- |

**How the engine reads TC-1:** base `0.150` × construction (frame)
`1.00` × constr×age (frame, age_0_25) `1.00` = `0.150` per $100;
× TIV `200000 / 100` = `300`; × LCM `1.30` = **`390.00`**. Matches
`expected_building_premium`; the build report shows the vector green.

---

## 10. Resolved decisions + versioning

### 10.1 The draft's open questions, resolved (locked 2026-07-14)

| OQ | Resolution |
| --- | --- |
| OQ-1 multi-plan workbooks | One plan per workbook. One filing = one workbook = one plan. |
| OQ-2 level layout | Single long-format `dimension_levels`. |
| OQ-3 factors on dimension sheets | Separate `ft.*` sheets; dimensions never carry factors. |
| OQ-4 coverage axis | Factors varying by coverage = a 2-D `dim × coverage` table (or separate 1-D tables when the filing prints them separately; profiles advise per product). |
| OQ-5 LCM placement | Per-chain, optional plan-wide `lcm` default. |
| OQ-6 geo detail | `geo.<slug>` sheets; `dimension_levels` stays at territory granularity. |
| OQ-7 2-D citations | Table-level + free-text `citation_note` for exceptions. |
| OQ-8 3-D+ tables | Capped at 2-D; composites fuse axes. |
| OQ-9 curves | Banded 1-D tables at the filing's breakpoints + the `interpolation` flag (`linear` interpolates — supported since registry r9). |
| OQ-10 `ft.*` metadata | In-sheet block above the grid (self-contained, auditable sheets). |
| OQ-11 inputs | Explicit `inputs` sheet, REQUIRED — the home of authored defaults. |
| OQ-12 predicates | §4.6.1 grammar locked. |
| OQ-13 machine-checkable schema | Yes — the §8 rule table IS the linter's contract (Brief 92 Part 2). |

Beyond the draft: `gaps_and_assumptions` + `test_cases` required
(the honesty sheets); the `plan` provenance block (carrier, product
per the platform's 11-code axis — the draft's `lines_of_business`
vocabulary was retired with the product-axis cleanup); `coverage_value`
on chains; up-to-3-AND conditions on gates (the platform's gate
builder shape — single-condition rules couldn't express real filed
eligibility); `applies_to` on loadings AND final adjustments
(per-coverage rounding is how filed programs actually round); the
reserved `expected_tier` test-case column; `interpolation` on tables;
the capability registry + R-190/R-191.

### 10.2 Versioning policy

- Workbooks pin `spec_version`; readers reject unknown versions
  (R-032) rather than guessing.
- **Minor bumps (1.1, 1.2)** are additive: new optional columns,
  sheets, or registry entries. A 1.0 workbook always passes a 1.x
  reader.
- **Major bumps (2.0)** may change semantics; readers state which
  majors they accept.
- The registry (`transcription-capability-registry.json`) versions
  independently (r1, r2, …) — constructs move `unsupported →
  partial → supported` as the platform grows, without spec churn.

### 10.3 Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-07-14 | 1.0 | Locked. Supersedes the `INPUT_XLSX_FORMAT_SPEC.md` draft per Brief 92 §1: OQ-1..13 resolved; `inputs` + `gaps_and_assumptions` required; provenance block; product-axis vocabulary; predicate grammar; `interpolation` / `coverage_value` / `applies_to`; the R-### rule table; the capability registry + profiles split; CSV-bundle appendix. |
| 2026-07-14 | 1.0 (registry r2) | Live-run finding (92.3): the engine's `round` is the plan-tail total-rounder — per-coverage rounding is registry-`unsupported` (`per_coverage_rounding`); §4.11 `applies_to` narrowed to clamps. The spec text is unchanged in shape — this is the registry mechanism working as designed. |
| 2026-07-14 | 1.0 (registry r3) | All-constructs live run (92.5): `chain_flat_factor` unsupported (the projector cannot key an unkeyed constant — use a 1-D yes/no table or a loading) and `endorsement_additive_multi_coverage` unsupported (a once-per-policy amount has no single tower until package-level layering ships). Factor endorsements now apply per tower tip in the engine (the shared-node bug fixed alongside). |
| 2026-07-15 | 1.0 (registry r4) | Filing-digitization review finding: the check accepted the full §4.6.1 operator set on `chains.predicate`/`loadings.predicate` while the platform's factor gate is equality-only, so the build refused workbooks the check passed. `predicate_beyond_equality` is registry-`unsupported` there (R-190). `endorsements.trigger` now executes real `in`/`not-in` (the builder previously mis-built them as `==` — silent wrong semantics); an inexpressible trigger operator is refused, never rewritten. Builder refusals surface as structured 422 `ingest_unbuildable` with the builder's message, never a generic 500. |
| 2026-07-16 | 1.0 (registry r5) | Brief 94.1 truth pass. `linear_interpolation`'s message stated a pre-ADR-0063 world ("the engine applies stepped bands until table interpolation ships") — since 2026-07-13, 2-D tables DO interpolate along the row dimension's axis; only 1-D banded curves still step. r5 states the split; §4.5/§6/R-111 follow the registry. R-191 documented as the umbrella rule for `partial` constructs (R-111 is `linear_interpolation`'s specific id; a checker self-test enforces that every machine-detectable partial construct warns). §0 + §7.5 now name the self-check loop (drop panel / `POST /plans/ingest/check` / CLI). §4.1 records the personal-lines interim (`other` + `description`) pending phase 94.6. |
| 2026-07-16 | 1.0 | Brief 94.5 hardening. NEW **R-002** (§2.1): merged cells in data sheets are refused with the range cited — openpyxl reads every cell but a merged range's top-left as blank, which previously became silent absences. The gates `__default__` row's citation now lands (`default_citation` on the gate config — it was silently dropped). The build response gains an envelope-level `verification` verdict (`all_match` \| `near` \| `mismatches` \| `none` \| `unavailable`) so API callers need not dig into the report. |
| 2026-07-16 | 1.0 | Brief 94.6 (owner-gated, confirmed). The product axis gains personal lines: `homeowners` (HO forms) + `dwelling` (dwelling fire, DP forms) join §4.1's enum — ADR-0033 §0's "one entry + one SQL CHECK value" exercised end to end (ProductCode, migration 048, `@openrater/contracts`, this spec). The 94.1 interim (`other` + `description`) retires for these two lines; an HO transcription profile follows with its first proven program (Brief 92's profile rule). |
| 2026-07-15 | 1.0 | The last check=build parity gap closed: **[R-146]** — `outputs.source = coverage:total` with no package-level `round` row in `final_adjustments` now refuses check-side (the plan-tail round is what produces the total; this workbook was never buildable, so no passing workbook changes status). The builder's raise stays as the backstop. |
| 2026-07-16 | 1.0 | Brief 95.1 truth pass (C1). NEW **§12** — the engine-execution-semantics appendix (rounding order and placement, the LCM outside the rounded chain product, interpolation anchors at band lower bounds with clamped ends per ADR-0063, zero/absent-exposure withholding, blank-cell refusal, gate triage, the test-case recipe). Until now transcribers recovered these from platform source; the WI BOP acceptance builds (40/40 ×3) pinned every statement live. §0 and §4.13 point at it. Additive — no grammar change. |
| 2026-07-16 | 1.0 | Brief 95.1 truth pass (C6). §4.15's optional `factor` column REMOVED — the builder never consumed it (per-geography factors live in `ft.*` tables keyed by the geographic dimension, as every shipped example and the WI Risk Analyzer plan do). One mechanism, not two; a workbook still carrying the column gets the R-202 unknown-trailing-column warning and the value is preserved, never rated. |
| 2026-07-17 | 1.0 (registry r6) | Brief 95.2 (A2) — **the workbook's `rating_plan_id` IS the built plan's id** (previously the platform minted `bop_wi_blank_<uuid8>`-style slugs and the workbook id was capture-only). Same workbook → same plan id on any box, which is what lets seeded reference plans recognize their own revisions. A taken id refuses (409): identical bytes ⇒ `ingest_already_built`; different bytes ⇒ `ingest_plan_id_taken` pointing at the re-ingest door — never a silent duplicate. Registry r6 records `workbook_pinned_plan_id` as supported. Additive per §10.2: no workbook grammar change. |
| 2026-07-17 | 1.0 (registry r7) | Brief 95.4 (C2) — NEW `inputs.derived_from` column: `sum(<input>,…)` makes an input **platform-computed** instead of submitter-supplied (the WI convention "supply building + BPP as total_property_limit" retired — the derived input keys the deductible-band lookup while books and quote requests carry only the operands). **[R-045]** grammar + operand contract, **[R-046]** never row-supplied, **[R-047]** lookup-axes-only. `div(…)` recognized and named-deferred to `class_conditional_exposure`. Registry r7 records `derived_input` as supported. Additive per §10.2: workbooks without the column are untouched. Alongside (D1/D2, platform-side): per-plan `GET /plans/{id}/book-template.csv` (headers = declared inputs, derived excluded, one verified example row) and test-case inputs persisted on the build report (`vectors.cases`) so the Run zone replays a verified filed example. |
| 2026-07-17 | 1.0 (registry r8) | Brief 95.5 (C4) — **coverage election**: a trailing `?` on a §4.1 `coverages` entry marks it electable. A risk with an **explicit 0** exposure on an electable coverage elects it out — the tower's nodes skip (its factor-axis inputs are not demanded), it contributes **$0**, and the trace says "not elected". Absence still withholds; an explicit 0 on a required coverage prices the arithmetic and warns (`zero_exposure_required`). **[R-048]**: ≥1 coverage stays required; an electable coverage's chain carries an exposure stage. §12.4 corrected en route: the earlier "absent — or ZERO — ⇒ withheld" line overstated zero (the engine has always priced an explicit zero; the audited KS oracle's TV-28 floors a zero-limit tower's book to the $500 minimum — refusing would contradict it). Unblocks tenant/BPP-only and building-only risks on the WI plans (their gaps row retires). Registry r8 records `coverage_election` as supported. Additive per §10.2: unmarked coverage lists behave exactly as before. |
| 2026-07-17 | 1.0 (registry r9) | Brief 95.6 (C5) — **1-D banded curves interpolate**: the remaining half of ADR-0063 (engine gap F14). A 1-D table flagged `interpolation=linear` now reads the RAW value through the engine's `interpolate` kind — breakpoints at band LOWER bounds, clamped ends, on-anchor values byte-exact — the same anchors the 2-D `interpolateOn` has used since r5. `linear_interpolation` graduates partial → **supported**; **R-111 downgrades warning → notice** (an FYI naming each interpolating table, no longer a caveat); the R-191 umbrella self-test rests vacuously until the next partial construct. §4.5/§6/§12.3 updated. The WI BPP LOI curve becomes filed-exact (mid-band values previously overstated ≤ ~4%; its gaps row retires — a deliberate, filed-correct rate improvement on mid-band risks). Unflagged tables step, byte-stable. |

---

## 11. Appendix — the CSV-bundle serialization

`.xlsx` is canonical (the reviewer audits in Excel). The loss-free
equivalent, for git-diffing and toolchains without xlsx support, is a
**directory (or `.zip`) of CSV files**, one per sheet, named exactly
as the sheet (`plan.csv`, `inputs.csv`, `ft.construction_class.csv`,
`geo.territory.csv`, …):

- Each CSV is UTF-8, comma-separated, quoted per RFC 4180, header row
  first — identical rows/columns to the sheet it mirrors.
- `ft.*` metadata blocks serialize as leading `field,value` rows,
  then one empty line, then the grid — the same layout as the sheet.
- Booleans as `true`/`false`; open intervals as `-inf`/`+inf`;
  everything else per §2.1.
- The bundle and the workbook are interconvertible without loss; the
  reader treats them identically. (The v1 ingester ships xlsx-first;
  the CSV-bundle reader follows on the same internal model.)

---

## 12. Appendix — engine execution semantics (compute `test_cases` from this)

The `test_cases` sheet is only as good as the arithmetic behind its
`expected_*` values. This appendix states, in one place, exactly how
the engine executes a built plan — so a transcriber can compute
expectations without reading platform source. **Normative for
computing `test_cases`.** When platform capability changes, the change
rides the capability registry and this spec's changelog, never a
silent drift. (Enforcing code, informative: `kinds/interpolate.ts`,
`kinds/lookup-multi.ts`, the projector's exposure mode; ADR-0063;
ADR-0056. Every behavior below was pinned by live golden runs —
Brief 92.5 and the 2026-07-16 WI acceptance builds.)

Throughout: **ROUND_HALF_UP** (0.0005 → 0.001, 0.5 → 1) — never
banker's rounding. `r3(x)` = ROUND_HALF_UP to 3 decimals; `r0(x)` = to
whole dollars.

### 12.1 The tower

Each `chains` coverage block executes as:

```
rate          = r3( base × Π(fired factors) )      -- ONE rounding, at the end
tower_premium = r0( rate × (exposure_input / exposure_divisor) × LCM )
```

- The chain product takes the base and every *fired* factor with **no
  intermediate rounding**; the 3-decimal rounding happens once, on the
  product (the filed "round the final rate to three decimals" step).
- **The LCM sits outside the rounded product.** The engine computes
  `r3(base × factors) × exposure × LCM`. Adoption manuals often state
  the other order (apply the LCM to the loss cost first, or round
  after the LCM). Multiplication commutes; the *rounding placement*
  does not: with `lcm = 1.000` the two orders are identical, with
  `lcm ≠ 1` they can differ by up to 0.0005 in rate (× exposure units
  in premium). When reproducing a filed example computed the other
  way, keep the filed number and use `tolerance_<field>` (§4.13) — do
  not bend a factor to force a match (AP-9).
- Exposure multiplies by `exposure_input / exposure_divisor` (per $100
  ⇒ divisor 100). Each tower's premium rounds to **whole dollars
  independently**.

### 12.2 The package total

The plan-tail `round` row (§4.11) executes **once per policy**:

```
total = r0( max( Σ tower_premiums, round_min ) )   -- rounded to round_increment
```

`Σ` is over every money output; `round_min` (when present) floors the
sum *before* rounding. There is no per-coverage rounding pass beyond
the towers' own `r0` (registry: `per_coverage_rounding`,
unsupported). `outputs.source = coverage:total` names this round's
output.

### 12.3 Interpolation (ADR-0063, both halves)

For a table with `interpolation = linear` — 2-D **and** 1-D banded
(Brief 95 C5 closed the split):

- **The breakpoints are each banded level's lower bound** (`min`); the
  factor "sits at" its band's lower bound. The raw numeric input feeds
  the axis: a value exactly on a breakpoint returns that band's factor
  byte-exact; a value between two breakpoints interpolates linearly; a
  value beyond either end **clamps** to the end band's factor. Example
  (ISO Rule 23.A.2.d shape): bands `[300k,325k) → 0.840` and
  `[325k,350k) → 0.812` give `f(310k) = 0.840 − (10/25)(0.028) =
  0.8288` — entering the chain product unrounded (12.1 rounds the
  product, not the factor).
- A **2-D table** interpolates along its flagged (row) axis; the other
  axis keys discretely. A **1-D banded curve** interpolates the whole
  table the same way. The R-111 **notice** names each interpolating
  table.
- Without the flag, every banded table steps, bands half-open
  `[min, max)`.

### 12.4 Absence, zero, election, and refusal (ADR-0056 + Brief 95 C4)

- A **required input with no `default_value`, absent at runtime** ⇒
  the row refuses (premium withheld, loudly).
- An **exposure input that is ABSENT** ⇒ that tower is **withheld**,
  and any withheld tower withholds the plan total. Absence is never an
  election — you can't tell "didn't buy" from "didn't fill in".
- An **exposure input that is EXPLICITLY 0**:
  - on a coverage marked **electable** (§4.1 `building?`) ⇒ the
    coverage is **elected out**: its tower's nodes skip, it
    contributes **$0**, and the trace says "not elected". The tower's
    other inputs (factor axes) are NOT demanded — a tenant risk
    legitimately omits the building axis columns.
  - on a **required** coverage ⇒ the arithmetic prices the $0 tower
    (the audited filed behavior — e.g. a zero-limit tower floored to
    the book minimum) and a **warning** (`zero_exposure_required`)
    names the ambiguity: if "no coverage" was meant, mark the
    coverage electable.
- An **unknown lookup key** — including a **blank 2-D cell** — refuses,
  naming the table and the missed key, unless the table carries
  `default_value` / `__default__`.
- A **predicated lookup whose predicate is false** is skipped: it
  multiplies nothing (×1), it does not refuse.

### 12.5 Gates and tiers

Gate rules evaluate per row, first match wins, `__default__` last. The
verdict is *triage*: it is reported (`expected_tier` checks it) and
**does not block rating** — a `decline` row still carries its computed
premium.

### 12.6 Value resolution

Enum/categorical inputs resolve by **level id or any alias**; booleans
resolve to the `true` / `false` level ids; numbers per §2.1 (no
formats). Geographic inputs resolve through the dimension's territory
grouping (a `geo.*` ZIP resolves to its territory's level).

### 12.7 The recipe

Compute every `expected_*` by mirroring 12.1–12.5 with decimal
ROUND_HALF_UP arithmetic (float `round()` half-to-even will drift on
exact halves). Pin at least one case per: band edge (exactly on a
breakpoint), interpolated mid-band value, predicated factor firing AND
not firing, each exposure base in use, each gate tier reachable, and —
when a floor exists — one case where it binds. When the filing's own
printed example cannot reproduce cent-exact under this order, keep the
filed number verbatim, add `tolerance_<field>`, and record the
rounding-order difference in `gaps_and_assumptions` — the reviewer
decides, never the transcriber's arithmetic.
