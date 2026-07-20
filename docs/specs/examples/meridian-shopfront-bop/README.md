# The Meridian reference bundle — Shopfront BOP (fictional)

The platform's reference program AND its regression net: a
**fictional** carrier ("Meridian Mutual Insurance Company", Nebraska)
that exercises every spec-v1.0 construct the
[nonprofit bundle](../nonprofit-do-gl/) can't. Every factor is
invented; the ZIP codes are real public geography, the grouping and
pricing are not. This bundle exists so the ingestion pipeline's
hardest paths stay green in CI **without any licensed rating content
in the repo**. Private filings can be checked through the local-only
acceptance gate (`RATER_ACCEPTANCE_WORKBOOK`) and are never committed.

The bundle is also **the reference filing**: the
same program rendered as a realistic 17-page rate filing PDF — the
document the transcription cold-test, the tutorial, the demo
screencast, and the eval harness all read. The filing and the
workbook share one source of truth (the program constants +
engine-mirrored `price()` in `generate_workbook.py`), and the
workbook's `citation_rule` / `citation_page` columns point at the
filing's REAL rule ids and page numbers — so a build report's
citations resolve to pages you can actually open.

| File | What |
| --- | --- |
| `meridian_shopfront_bop_filing.pdf` | The 17-page synthetic filing (`MMI-NE-2026-BOP-001`): cover, TOC, general rules (incl. the two application-default conventions the workbook records as gaps), rating order, rounding/minimums, IRPM schedule, all factor tables (the building-limit relativities state their LINEAR INTERPOLATION rule), territory definitions (36 ZIPs → 6 territories), the 40-class table, both endorsements, and all 8 worked examples with full arithmetic. Every page footer states the carrier is fictional. |
| `meridian_filing_pages.json` | The citation sidecar: `{section → rule id + page}`, written by the filing generator, read by the workbook generator. |
| `generate_filing.py` | Deterministic (reportlab invariant mode — byte-stable, no timestamps). Two-pass render for real TOC page numbers. Regenerate: `uv run --with reportlab --with openpyxl python generate_filing.py`. |
| `meridian_shopfront_bop.workbook.xlsx` | 23 sheets: three **exposure-rated coverage towers** (per $100 of limit / per $1,000 of sales — the engine's own tower rounding), a **2-D matrix** (construction × protection, `row::col` cells), a **geographic dimension with `geo.*` ZIP detail** (36 ZIPs → 6 territories), an **interpolation=linear table** (R-111 notice; the engine interpolates, registry r9), **endorsements** (a factor that fires + a factor whose trigger never fires), a **modifier schedule** (neutral without per-risk applications), a **loading via `applies_to`**, a **per-coverage clamp** (liability minimum), the **floored package round** ($500, applied at the composition seam), and **compound gates** (2- and 3-condition rows). |
| `generate_workbook.py` | Deterministic + self-verifying: computes all 8 vectors' expected premiums by **mirroring the engine's documented semantics** and asserts every intended behavior fires (the endorsement, the clamp, the floor, all four tiers) before writing a sheet. Regenerate the FILING first (it writes the citation sidecar): `uv run --with openpyxl python generate_workbook.py`. |
| `generate_demo_book.py` | Emits the committed 20-row demo book (`docs/fixtures/meridian-demo-book.csv`): the 8 worked examples + 12 book-texture rows, `expected_tier`/`expected_total` computed by the same engine-mirrored math. |

The built plan is also captured as the repo's **seed fixture**
(`docs/fixtures/meridian-shopfront-bop-ne-2026.plan.json`) — the blob a
fresh deploy boots with, guarded in CI by
`frontend/src/integrations/meridianSeedFixture.verify.test.ts`. See
[`docs/fixtures/FIXTURE_PROVENANCE.md`](../../../fixtures/FIXTURE_PROVENANCE.md).

## What this bundle verifies

The bundle guards against a multi-coverage failure mode where one
endorsement/model node is incorrectly shared across multiple tower tips,
causing every coverage to return the first tower's premium. It requires
per-tip factor instances and a structured
`endorsement_additive_multi_tower` refusal for once-per-policy amounts. It
also verifies the floor's true home:
`round_min` applies once per policy at the composition seam
(`views.premium` / `composed.final`), not on the raw plan output.

Not exercised here: constructs the registry marks unsupported
(per-coverage rounding, additive endorsements on multi-coverage
plans, chain-level flat factors, class-conditional exposure) — the
check refuses those by design.
