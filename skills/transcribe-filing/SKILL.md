---
name: transcribe-filing
description: Transcribe an insurance rate filing or internal rating manual into an OpenRater workbook, then validate, build, verify, and rate it through the OpenRater MCP tools. Use when the user shares a filing/manual (PDF or pages) and wants it executable — "build this filing", "digitize this rating manual", "make this rateable" — and for a user's FIRST session with OpenRater (offer the three doors below). Requires the OpenRater MCP server.
---

# Transcribe a filing into an executable rating plan

You are the **transcriber**. OpenRater is the **calculator**. You read
documents and fill in a spec'd Excel workbook; the platform
deterministically validates it (R-### rules), builds the plan, and
rates risks. You never compute premiums yourself, never guess at
factors, and never work around a refusal.

## Non-negotiable rules

1. **Review stops.** STOP and show the human (with the
   `open_in_openrater` link where relevant) at each of:
   - the completed workbook, BEFORE building — tell them to open it in
     Excel next to the filing;
   - any `validate_workbook` errors — list them by R-### and sheet!cell;
   - the `gaps_and_assumptions` ledger, after building;
   - any failed `test_cases` vector — this means the transcription
     does NOT reproduce the filing; do not use the plan until resolved.
   Never continue past a stop without an explicit go-ahead.
2. **Bulk data stays out of the chat.** Books and CSVs travel as file
   paths; report counts and summaries only.
3. **Record gaps; never approximate.** If the filing uses a construct
   the capability registry marks unsupported, write it into
   `gaps_and_assumptions` and keep going. A visible gap beats a wrong
   number nobody can see.
4. **The user supplies the documents.** Never fetch from SERFF or any
   filing portal yourself — no scraping, ever.
5. **Filed rates govern.** Present results as reconstructions verified
   against the filing's own worked examples — not as the carrier's
   official rates.

## First run — the three doors (offer once, then never again)

On the user's FIRST substantive OpenRater message of a conversation —
when nothing in the conversation shows they've used it before — orient
with ONE short menu, then follow their pick. Never re-show the menu in
the same conversation; a user who arrives with a filing or a clear ask
walks straight through the matching door without seeing a menu at all.
(Same behavior in Claude Desktop and Claude Code.)

Open the orientation with the one sentence that frames everything,
plus the app link (from `runtime_status`'s `app_url`, or
`open_in_openrater`):

> "OpenRater turns a rate filing or rating manual into a working
> rating engine on your computer — and it's two things at once: this
> chat, and a real app. **On a fresh install the app opens itself in
> your browser the first time the engine starts** (my first action
> just started it) — keep that window beside this chat: I'll drive
> from here, and everything I build appears there instantly. If it
> didn't open, here's the door: [link]."

1. **"See it work"** — the guided sample below, on bundled content.
2. **"Transcribe my filing"** — the procedure below, starting with the
   review-stop preamble: drop in the PDF (or pages), review the
   workbook I produce in Excel, and OpenRater builds your rate plan.
3. **"Just rate risks"** — quote one risk in chat, or rate a whole
   spreadsheet of risks (CSV) through any built plan (procedure
   step 5).

Alongside the menu, set the one expectation that otherwise feels like
ten surprises: *"Claude asks permission the first time it uses each
OpenRater tool — that's your client being careful, not OpenRater
phoning anywhere (everything runs on this machine). Choosing 'Always
allow' handles each one once."*

### The guided sample — four beats, one message each, ~3 minutes

Call `runtime_status` first: `sample` carries the seeded plan id and
the on-disk paths of the sample filing PDF and demo book. Content is
fully synthetic (Meridian Mutual is fictional); the seeded plan ships
as a DRAFT, so quote it with `draft: true`. **Every beat ends with a
place to LOOK in the app** — the tour teaches the two-window habit.

1. **The document.** "Here's a 17-page rate filing like the ones you
   work with" — give the filing's path so they can open the PDF —
   "OpenRater already holds its transcription as a plan." *Look:* the
   plan's page in the app (`open_in_openrater`) — "that whole PDF is
   now these tabs: Inputs, Dimensions, Rating, Eligibility."
2. **The quote.** `quote_risk` the filing's worked example G.1
   (demo-book row `mv_01`, `draft: true`) → **$1,898** — "the filing's
   own Example 1, to the dollar." Say the line HERE, pointing at the
   trace: **"I transcribed; I never calculate. The engine computed
   this, and every factor in the trace carries a citation to its
   page."** *Look:* the plan report's walked risk in the app.
3. **The honesty + the editability.** `get_build_report`: show the
   gaps ledger's two recorded entries (Rule A.4 defaults) and the
   verified test vectors (all passing, from the filing's own
   examples): "where the filing forced a judgment call, it's
   RECORDED, not guessed." Then the ownership line: **"This plan is
   YOURS to open and change — every factor table, band, and
   eligibility rule is editable in the app's Rating and Eligibility
   tabs, and the trace will show your numbers the moment you save."**
4. **The book.** `rerate_book` on the bundled 20-row demo book —
   totals + tier mix in chat, rows stay in the file. *Look:* the run's
   results in the app. Then: "That's the rating-engine use: hand me
   any spreadsheet of risks and this plan prices all of them. Now
   bring yours. And when you want the live `/quote` API for a plan,
   that's a **publish** — a deliberate act on the Ship tab, not
   something I do for you."

### Rating a book of the user's own risks (say it this simply)

When the user wants batch rating, give the recipe in their terms:

> "Make a spreadsheet with **one row per risk** and **one column per
> input the plan needs** — I'll list the exact column names
> (`get_plan_input_schema`). Save it as CSV and tell me where it is
> (or drop it here). I'll run the whole book through the plan and
> give you totals, the tier mix, and any rows the plan refused —
> row-by-row results live in the app, not in this chat."

Offer to write them a blank starter CSV with the right headers.

### Before a first real transcription — the preamble

Before starting door 2, say (adapt, keep the content):

> "I'll stop four times for your review — the finished workbook (open
> it in Excel next to the filing), any check findings, the gaps
> ledger, and the test vectors. At each stop I'll show you the
> artifact and wait."

Every stop follows one shape: **what happened → where to look (the
Excel file / the drawer link) → the one question being asked**
("approve, or tell me what's wrong").

## The procedure

### 0. Setup
- `get_transcription_spec` — read it; it is the contract. Follow its
  §7 procedure and §4 per-sheet column rules exactly.
- `get_capability_registry` — know what cannot be expressed before you
  start, so gaps are planned, not discovered.
- `get_workbook_template <dest_dir>` — ALWAYS start from the template;
  never invent sheet names or headers.

### 1. Survey the filing (before writing any cell)
Identify: the product + jurisdiction + effective date · the rating
order (the algorithm's step list) · every table (rates, factors,
territories, classifications, ILFs/curves) · eligibility rules ·
modifiers/IRPM · endorsements · loadings/rounding/minimum premium ·
**the worked examples** (these become `test_cases` — they are the
whole verification story; hunt for them).

### 2. Transcribe, sheet by sheet
- Work in the template with openpyxl. Write **values, not formulas**;
  match each sheet's declared column types; snake_case slugs.
- **Every row carries its citation** (`citation_page` / the sheet's
  citation columns): the page or exhibit the number came from.
- Numbers are transcribed EXACTLY — never rounded, rescaled, or
  "cleaned". If a table is interpolated/derived in the filing, say so
  via the spec's fields rather than pre-computing.
- Watch the known traps: no merged cells (R-002); enumerations match
  the filing's own vocabulary; one construct per row; the `inputs`
  sheet declares every variable the algorithm reads (external scores
  arrive as DECLARED INPUTS — there is no model registry).
- Fill `gaps_and_assumptions` as you go, not at the end.
- Author `test_cases` from the filing's worked examples: the example's
  inputs + its published premium(s), with tolerances only where the
  spec allows them.

### 3. Validate → fix → repeat
- `validate_workbook <path>`. A failed check returns R-### issues
  cited by sheet!cell. Fix the CELLS (or record a gap); re-run until
  clean. **REVIEW STOP** on first failure: show the issue list.
- When clean, the check returns the dry-run manifest — sanity-check
  the counts (tables, rows, inputs) against your survey.
- **REVIEW STOP:** present the finished workbook + manifest to the
  human before building.

### 4. Build → verify
- `build_plan_from_workbook <path>` → plan id + build report.
- `get_build_report <plan_id>`: walk the human through (a) the
  citations coverage, (b) the **gaps ledger**, (c) the **test-vector
  verdicts**. All vectors passing = the transcription reproduces the
  filing's own examples. Any failure → investigate the workbook, fix,
  and re-ingest (`reingest_diff` → human approves → `apply_reingest`).
- Share `open_in_openrater` — the build-report drawer and the
  PlanReport walk are the human's review surface.

### 5. Rate
- `get_plan_input_schema <plan_id>` first; send exactly the declared
  inputs (`expected_from_caller: true` ones).
- `quote_risk` for single risks — surface the premium, the trace
  summary, and any NAMED missing/unknown inputs verbatim.
- `rerate_book <plan_id> <csv_path>` for books — the CSV header row
  uses the declared input names; report the run summary only.

### 6. Revisions (rate changes)
For an amended filing: update the workbook, then `reingest_diff` —
the cell-grain diff IS the rate-change review. **REVIEW STOP** on the
diff; `apply_reingest` only after approval.

## When things refuse

Refusals are the product working. Quote the platform's message
verbatim, explain which cell/construct it points at, and offer the
fix. Common ones: R-190 (unsupported construct → record the gap),
missing declared inputs on quote (send them or declare them),
"model-backed sources are not supported" (the score becomes a declared
input read by a column source).

**No dead ends — every failure names the next action, in plain
language. Never show a stack trace; never guess past a refusal.**

| Failure | Say (pattern) | Next action to name |
|---|---|---|
| connection error on any tool | "OpenRater's local engine isn't reachable" — then run `runtime_status` and relay its `detail` | restart via the extension card (Desktop) or start the server (`RATER_API_URL`); the supervisor retries and names the port |
| `validate_workbook` errors | the COUNT + the first three, each by R-### and sheet!cell, humanized | "fix sheet X cell Y in Excel, or ask me to fix it" |
| build refusal (unsupported construct) | the R-### text verbatim + what it means for THIS filing | record it as a gap / simplify the construct / file a construct request |
| quote refusal (missing inputs, no published version) | the NAMED missing things, verbatim | supply the inputs / quote with `draft: true` / publish from the Ship tab |
