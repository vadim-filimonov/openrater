#!/usr/bin/env node
// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * @openrater/mcp — the OpenRater MCP server (Brief 2 §4, stdio).
 *
 * Lets any MCP client drive the deterministic rating platform:
 * spec/template/registry → validate → build → report → quote →
 * re-rate. The platform never calls an AI; the AI calls the platform.
 *
 * Connect (dev):   claude mcp add openrater -- npx tsx services/mcp/src/main.ts
 * Env:             RATER_API_URL (default http://127.0.0.1:8001)
 *                  RATER_APP_URL (review-UI base; defaults to RATER_API_URL)
 *                  RATER_API_KEY (optional, for gated /quote)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  ApiError,
  buildFromWorkbook,
  checkWorkbook,
  comparePlans,
  compareRuns,
  configFromEnv,
  downloadWorkbookTemplate,
  exportPlanWorkbook,
  getBuildReport,
  getCapabilityRegistry,
  getInputSchema,
  getPlan,
  getTranscriptionSpecSectioned,
  listPlans,
  planLink,
  quoteRisk,
  rerateBook,
  reingestApply,
  reingestCheck,
  summarizePlan,
} from "./api.js";
import { ensureRuntime, runtimeStatus } from "./runtime.js";

const config = configFromEnv();

/** The model-facing orientation. This is the ONE channel that reaches
 *  the assistant in every MCP client at session start (the initialize
 *  handshake) — SKILL.md rides the bundle for clients that load
 *  skills, but Claude Desktop reads only this. Keep it compact; it
 *  lands in every conversation's context. */
export const INSTRUCTIONS = `OpenRater turns a rate filing or rating manual (a PDF) into a working,
auditable rating engine on the user's machine. It is two things at
once: this chat, and a real app in their browser. You drive; the app
shows. You are the transcriber, NEVER the calculator — the platform
computes every number deterministically and cites its sources.

FIRST MOVE: on the user's first substantive OpenRater message of a
conversation — including "what is this?" or "show me" — call
runtime_status BEFORE answering. It boots the local engine, and on a
fresh install the app opens itself in their browser (tell them to keep
that window beside the chat; runtime_status returns app_url as the
fallback link). If the user asks about returning to the app later, or
the app link seems dead, relay runtime_status's app_lifecycle
verbatim — in the managed runtime the app lives only while the chat
host runs, and a message in the chat is what relights it; never let a
dead bookmarked link go unexplained. Then offer, once, the three
doors:
1. "See it work" — a ~3-minute guided tour on the bundled synthetic
   sample (runtime_status.sample has the filing PDF and demo-book
   paths; the seeded plan quotes with draft:true; worked example
   mv_01 prices at exactly $1,898).
2. "Transcribe my filing" — they drop in their PDF; you fill out the
   spec'd Excel workbook (get_transcription_spec first); they review
   it; the platform validates and builds the plan.
3. "Just rate risks" — quote one risk in chat, or rate a whole CSV
   (one row per risk, one column per declared input — offer to list
   the names via get_plan_input_schema and to write a starter CSV).

Hard rules, always: STOP for human review at the finished workbook,
any check failure, the gaps ledger, and any failed test vector. Never
work around a refusal — quote it verbatim and name the next action.
Bulk data travels as file paths, never rows in chat. Never fetch from
SERFF or any filing portal. Present results as reconstructions — the
carrier's filed and approved rates govern. The plan is the user's to
open and CHANGE in the app (Rating and Eligibility tabs); share
open_in_openrater links at every artifact. The app's Exhibits tab
draws any plan and compares two visually — compare_plans returns its
deep link (open_in_exhibits; the URL carries the whole compare, so it
can be bookmarked or sent to a colleague), and compare_runs answers
"same book, what changed" across two runs. First-time users will see
a permission prompt per tool — tell them "Always allow" handles each
once, and nothing leaves their machine.`;

const server = new McpServer(
  {
    name: "openrater",
    version: "0.1.3",
  },
  { instructions: INSTRUCTIONS },
);

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(payload: unknown): ToolResult {
  const text =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text", text }] };
}

function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  // In managed mode the first call boots the packaged runtime (and
  // repoints `config` at its port) before any tool body runs; in
  // external mode this resolves immediately.
  return ensureRuntime(config)
    .then(() => fn())
    .then(ok, (err: unknown) => {
      const message =
        err instanceof ApiError
          ? `OpenRater refused: ${err.message}` +
            (err.code ? ` (code: ${err.code})` : "")
          : err instanceof Error
            ? err.message
            : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    });
}

// ── The starter kit ─────────────────────────────────────────────────

server.registerTool(
  "get_transcription_spec",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Read the transcription spec",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "The filing-transcription spec (markdown) — the contract an AI " +
      "follows to transcribe a rate filing or rating manual into the " +
      "workbook. Read it BEFORE transcribing; cite sheet/column rules " +
      "by their R-### ids when fixing check failures. The full spec " +
      "exceeds one call (FCA #29): call with NO section for the table " +
      "of contents, then request sections by number (\"4.15\"), " +
      "prefix (\"4\" = every §4.x), or heading fragment.",
    inputSchema: { section: z.string().optional() },
  },
  ({ section }) =>
    run(() => getTranscriptionSpecSectioned(config, section)),
);

server.registerTool(
  "get_workbook_template",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Download the workbook template",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Download the blank workbook template (.xlsx) into dest_dir and " +
      "return its path. Start every transcription from this template — " +
      "its sheets, headers, and conventions are what the check enforces.",
    inputSchema: {
      dest_dir: z
        .string()
        .describe("Directory to write openrater_workbook_template.xlsx into"),
    },
  },
  ({ dest_dir }) => run(() => downloadWorkbookTemplate(config, dest_dir)),
);

server.registerTool(
  "get_capability_registry",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Read the capability registry",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "The capability registry — what the platform cannot express " +
      "(unsupported/partial constructs, R-190/R-191). When a filing " +
      "uses an unsupported construct: record it in gaps_and_assumptions " +
      "and keep going. Never approximate silently.",
    inputSchema: {},
  },
  () => run(() => getCapabilityRegistry(config)),
);

// ── Plans ───────────────────────────────────────────────────────────

server.registerTool(
  "list_plans",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "List plans",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: "List rating plans (status: active | draft | archived | all).",
    inputSchema: {
      status: z.enum(["active", "draft", "archived", "all"]).default("all"),
    },
  },
  ({ status }) => run(() => listPlans(config, status)),
);

server.registerTool(
  "get_plan",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Read a plan",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "A plan's summary: identity, status, effective date, stage-kind " +
      "counts, content hash. For the full build provenance use " +
      "get_build_report; to see it visually use open_in_openrater.",
    inputSchema: { plan_id: z.string() },
  },
  ({ plan_id }) =>
    run(async () =>
      summarizePlan((await getPlan(config, plan_id)) as Record<string, unknown>),
    ),
);

server.registerTool(
  "compare_plans",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Compare two plans",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "What changed between two plans (FCA #24) — the same arithmetic " +
      "the app's Exhibits → Compare renders: changed tables with their " +
      "largest cell moves, inputs/tables/coverage towers present on one " +
      "side only, and territory MEMBERSHIP reassignments (moved " +
      "counties/ZIPs, dual-keyed members counted once, names leading). " +
      "Use for committee-shaped 'what changed' questions; no plan-id " +
      "masquerade needed. Present results as a reconstruction — the " +
      "filed documents govern.",
    inputSchema: { plan_a: z.string(), plan_b: z.string() },
  },
  ({ plan_a, plan_b }) => run(() => comparePlans(config, plan_a, plan_b)),
);

server.registerTool(
  "compare_runs",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Compare two book runs",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Row-by-row deltas between two DONE book runs (FCA #28) — the " +
      "rate-committee artifact: totals with the % move, the top " +
      "movers by dollar swing, rows newly refused or newly rated, " +
      "and rows present on one side only. Rows join on the caller's " +
      "own identifier column (PolicyNbr-style) when both runs carry " +
      "one; otherwise by position, disclosed in caveats. Use after " +
      "rerate_book on two plans (pass with_plan) or two runs of one " +
      "plan. The same arithmetic renders in the app at review_url.",
    inputSchema: {
      plan_id: z.string(),
      run_id: z.string(),
      with_run: z.string().describe("the run to compare against"),
      with_plan: z
        .string()
        .optional()
        .describe("with_run's plan when it lives on another plan"),
    },
  },
  ({ plan_id, run_id, with_run, with_plan }) =>
    run(() => compareRuns(config, plan_id, run_id, with_run, with_plan)),
);

server.registerTool(
  "get_plan_input_schema",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Read a plan's inputs",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "The plan's declared inputs (name, type, required, allowed values, " +
      "units). Call this BEFORE quote_risk so you send exactly what the " +
      "plan declares; entries with expected_from_caller=false are " +
      "computed by the plan itself.",
    inputSchema: { plan_id: z.string() },
  },
  ({ plan_id }) => run(() => getInputSchema(config, plan_id)),
);

// ── Workbook → plan ─────────────────────────────────────────────────

server.registerTool(
  "validate_workbook",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Check a workbook (no build)",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Validate a transcription workbook (.xlsx at xlsx_path) against " +
      "the spec — stateless, no build. Returns R-### errors/warnings " +
      "cited by sheet!cell, plus the dry-run manifest when clean. " +
      "REVIEW STOP: if there are errors, show them to the human and fix " +
      "the workbook cells before building; never work around a refusal.",
    inputSchema: { xlsx_path: z.string() },
  },
  ({ xlsx_path }) => run(() => checkWorkbook(config, xlsx_path)),
);

server.registerTool(
  "build_plan_from_workbook",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Build a plan from a workbook",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      "Build a rating plan from a clean workbook (deterministic, zero " +
      "AI). Returns the plan id + build report summary (citations, gaps " +
      "ledger, test-vector results). REVIEW STOP: present the gaps " +
      "ledger and any failed vectors to the human before using the plan.",
    inputSchema: { xlsx_path: z.string() },
  },
  ({ xlsx_path }) => run(() => buildFromWorkbook(config, xlsx_path)),
);

server.registerTool(
  "get_build_report",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Read a build report",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "The persisted build report for a workbook-built plan: per-cell " +
      "citations, the gaps_and_assumptions ledger, test-vector verdicts, " +
      "and the workbook hash. This is the trust artifact — read it " +
      "with the human.",
    inputSchema: { plan_id: z.string() },
  },
  ({ plan_id }) => run(() => getBuildReport(config, plan_id)),
);

server.registerTool(
  "export_plan_workbook",
  {
    annotations: {
      title: "Export a plan's workbook",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Export a plan: writes the EXACT workbook bytes that built it " +
      "(sha256-stamped) to dest_dir and returns the file path — the " +
      "canonical container comes back out. Re-ingesting the export " +
      "answers 'already built' (it IS the source). Refuses BY NAME " +
      "when the plan wasn't built from a workbook. When the plan has " +
      "in-app edits made AFTER the build, the result carries a " +
      "warning: those edits are NOT in the exported bytes, so a plan " +
      "built from this file will not include them. Pass state: " +
      "'current' for the same container REWRITTEN to the live plan " +
      "state (tracked factor-table cells + gates!value cells carry " +
      "the in-app edits; untouched sheets stay byte-identical; the " +
      "filename gains a '-current' suffix). A current export is NOT " +
      "the build identity — re-ingesting it registers as a revision — " +
      "and any in-app change the rewriter could not place in the " +
      "workbook comes back NAMED in the warning.",
    inputSchema: {
      plan_id: z.string(),
      dest_dir: z
        .string()
        .describe("Directory to write the .xlsx into (created if absent)."),
      state: z
        .enum(["build", "current"])
        .optional()
        .describe(
          "'build' (default): the exact build-time bytes. 'current': " +
            "the live plan state written into the tracked cells.",
        ),
    },
  },
  ({ plan_id, dest_dir, state }) =>
    run(() => exportPlanWorkbook(config, plan_id, dest_dir, state ?? "build")),
);

server.registerTool(
  "reingest_diff",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Preview a re-ingest diff",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Preview re-ingesting a REVISED workbook into an existing plan: " +
      "returns the cell-grain diff (adds/changes/removes) WITHOUT " +
      "applying, plus edits_since_build — the in-app edits the plan " +
      "carries that an apply would REPLACE (rendered as your-value -> " +
      "workbook-value). REVIEW STOP: show the human the diff AND any " +
      "edits_since_build before calling apply_reingest.",
    inputSchema: { plan_id: z.string(), xlsx_path: z.string() },
  },
  ({ plan_id, xlsx_path }) => run(() => reingestCheck(config, plan_id, xlsx_path)),
);

server.registerTool(
  "apply_reingest",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Apply a re-ingest",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      "Apply a revised workbook to an existing plan (the diff previewed " +
      "by reingest_diff). Separate tool = separate consent: only call " +
      "after the human approved the diff. If the plan carries in-app " +
      "edits since its build (reingest_diff lists them under " +
      "edits_since_build), applying REPLACES them: show the human those " +
      "edits and pass replace_edits=true only after they approve — a " +
      "pre-apply version is saved automatically.",
    inputSchema: {
      plan_id: z.string(),
      xlsx_path: z.string(),
      replace_edits: z.boolean().optional(),
    },
  },
  ({ plan_id, xlsx_path, replace_edits }) =>
    run(() => reingestApply(config, plan_id, xlsx_path, replace_edits ?? false)),
);

// ── Rate ────────────────────────────────────────────────────────────

server.registerTool(
  "quote_risk",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Quote a risk",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Rate one risk (inputs) or one multi-location policy (locations + " +
      "policy_inputs) against a plan. Returns the premium, the row " +
      "status, NAMED missing/unknown inputs (the engine refuses " +
      "honestly — it never guesses), and a trace summary. Includes a " +
      "review-UI link for the full walk.",
    inputSchema: {
      plan_id: z.string(),
      inputs: z.record(z.unknown()).optional(),
      locations: z.array(z.record(z.unknown())).optional(),
      policy_inputs: z.record(z.unknown()).optional(),
      as_of: z.string().optional().describe("YYYY-MM-DD"),
      draft: z
        .boolean()
        .default(false)
        .describe(
          "Quote the working DRAFT (the build-review loop, before " +
            "publishing). Published plans quote without this.",
        ),
      snapshot_id: z
        .string()
        .optional()
        .describe(
          "Pin the quote to a frozen version (Exhibits compares " +
            "plan@snapshot; this is the same pin).",
        ),
    },
  },
  ({ plan_id, inputs, locations, policy_inputs, as_of, draft, snapshot_id }) =>
    run(async () => {
      const quote = (await quoteRisk(config, {
        planId: plan_id,
        ...(inputs ? { inputs } : {}),
        ...(locations ? { locations } : {}),
        ...(policy_inputs ? { policyInputs: policy_inputs } : {}),
        ...(as_of ? { asOf: as_of } : {}),
        ...(draft ? { draft } : {}),
        ...(snapshot_id ? { snapshotId: snapshot_id } : {}),
      })) as Record<string, unknown>;
      return { ...quote, open_in_openrater: planLink(config, plan_id) };
    }),
);

server.registerTool(
  "rerate_book",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Re-rate a book",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      "Re-rate a book: a CSV at csv_path (header row = the plan's " +
      "declared input names; one risk per row) scored through the book " +
      "path. The header is pre-flighted against the plan's input " +
      "dictionary first — a missing/misspelled column or a foreign " +
      "delimiter refuses WITH THE CULPRIT NAMED; relay that refusal " +
      "verbatim. Returns counts + totals + the first three problem " +
      "rows (named) + the run-detail link — row-level results stay " +
      "out of the chat (open the link). Cap: 5,000 rows.",
    inputSchema: {
      plan_id: z.string(),
      csv_path: z.string(),
      as_of: z.string().optional().describe("YYYY-MM-DD"),
    },
  },
  ({ plan_id, csv_path, as_of }) =>
    run(async () => {
      const result = await rerateBook(config, plan_id, csv_path, as_of);
      return { ...result, open_in_openrater: planLink(config, plan_id) };
    }),
);

server.registerTool(
  "open_in_openrater",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Get a review-UI link",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "The review-UI link for a plan (the human's eyes: build report, " +
      "PlanReport walk, diff review). Share it at every review stop.",
    inputSchema: { plan_id: z.string() },
  },
  ({ plan_id }) => run(async () => ({ url: planLink(config, plan_id) })),
);

server.registerTool(
  "runtime_status",
  {
    // Permission-prompt hints (MCP tool annotations): clients use
    // these to soften/group consent for read-only, closed-world tools.
    annotations: {
      title: "Check engine health",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "The doctor AND the ignition: call this FIRST on the user's " +
      "first OpenRater message of a conversation. It boots the local " +
      "engine (on a fresh install the app opens itself in their " +
      "browser), and reports runtime mode, engine health, ports, data " +
      "directory, `app_url`, and — when something is wrong — the next " +
      "action in plain language (a failed boot becomes the diagnosis, " +
      "never an error). Also returns `sample`: the seeded reference " +
      "plan's id + the on-disk paths of the bundled sample filing PDF " +
      "and demo book (the guided tour's content). Re-run it whenever " +
      "any tool fails with a connection error.",
    inputSchema: {},
  },
  // Deliberately NOT wrapped in run(): the doctor must answer even
  // when the managed boot itself is the thing that's broken — it
  // attempts the boot ITSELF and reports failure as content, not as
  // a tool error.
  async () => ok(await runtimeStatus(config)),
);

// ── main ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
