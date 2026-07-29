# OpenRater — agent guide

OpenRater turns rate filings and rating manuals into executable,
auditable rating engines. **The division of labor is absolute: the AI
transcribes; the deterministic platform validates, builds, and rates.
Nothing probabilistic executes at rating time.**

## The loop

```
filing PDF ──(you transcribe, following the spec)──▶ workbook (.xlsx)
   ──(validate_workbook: R-### rules, zero AI)──▶ fix cells, repeat
   ──(build_plan_from_workbook)──▶ plan + build report (citations, gaps, vectors)
   ──(quote_risk / rerate_book)──▶ premiums with traces
```

## Connect the MCP server

```sh
# dev (this repo; server on :8001):
claude mcp add openrater -- npx tsx services/mcp/src/main.ts
# env: RATER_API_URL (default http://127.0.0.1:8001) · RATER_APP_URL · RATER_API_KEY
```

Tools: `get_transcription_spec` (sectioned — no argument returns the
table of contents) · `get_workbook_template` ·
`get_capability_registry` · `list_plans` · `get_plan` ·
`get_plan_input_schema` · `validate_workbook` ·
`build_plan_from_workbook` · `get_build_report` ·
`export_plan_workbook` (build or current state) · `reingest_diff` ·
`apply_reingest` · `quote_risk` · `rerate_book` · `compare_plans`
(what changed between two plans, with an Exhibits deep link) ·
`compare_runs` (same book through two runs: totals, movers, newly
refused rows) · `open_in_openrater` · `runtime_status` (the doctor —
health, next actions, and `sample`: the seeded reference plan +
bundled sample filing/demo-book paths).

## Rules you must follow

1. **Review stops.** Do not proceed past (a) a completed workbook,
   (b) a failed check, (c) the `gaps_and_assumptions` sheet, or (d) a
   failed `test_cases` vector without showing the human the artifact
   and asking. Share the `open_in_openrater` link at every stop.
2. **Bulk data stays out of the chat.** Books travel as file paths;
   report counts and summaries, never row dumps.
3. **Never work around a refusal.** R-### errors and "not supported"
   messages are the platform speaking precisely; fix the workbook or
   record the gap — don't approximate.
4. **You fetch documents; never automate SERFF.** The user supplies
   the filing PDF themselves.
5. **Filed rates govern.** Outputs are reconstructions; tell the user
   to verify against the filing's own worked examples (`test_cases`).

## Where things live

- The transcription procedure: `skills/transcribe-filing/SKILL.md`
  (canonical agent runbook) and the spec via `get_transcription_spec`.
- Repo layout: `frontend/` (review UI) · `server/` (FastAPI) ·
  `services/scoring/` (the engine) · `services/mcp/` (this server) ·
  `docs/specs/` (the contracts).
- Dev: `pnpm install`; `pnpm dev:server` (:8001) + `pnpm dev:scoring`
  + `pnpm dev:app`; server tests `cd server && uv run pytest`;
  JS `pnpm test`; design gates `pnpm design:check`.
