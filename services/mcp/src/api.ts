// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * The OpenRater REST client + response shaping for the MCP tools.
 *
 * Design rules (Brief 2 §3):
 *  - Rule 2 — bulk data stays out of the chat context: files travel as
 *    PATHS, responses are SUMMARIES (counts, verdicts, artifact
 *    pointers), never row dumps.
 *  - Errors pass the platform's own refusal text through verbatim —
 *    the R-### and retired-arm messages are already human-grade.
 *
 * Pure shaping functions live here (vitest-covered, no I/O beyond
 * fetch, which tests stub).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
// Book-intake §2 — the SAME header pre-flight the app runs on upload.
import {
  cellDelta,
  compareFacts,
  pairTables,
  preflightBook,
  tableName,
  territoryVerdict,
  type CompareDimLike,
  type CompareStageLike,
  type CompareTableLike,
  type PreflightInput,
} from "@openrater/contracts";

export interface ApiConfig {
  /** The OpenRater server, e.g. http://127.0.0.1:8001 (RATER_API_URL). */
  readonly baseUrl: string;
  /** Where the review UI lives (RATER_APP_URL; defaults to baseUrl —
   *  the packaged runtime serves the SPA from the same origin). */
  readonly appUrl: string;
  /** Optional X-API-Key for quote calls (RATER_API_KEY). */
  readonly apiKey?: string | undefined;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const baseUrl = (env.RATER_API_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
  return {
    baseUrl,
    appUrl: (env.RATER_APP_URL ?? baseUrl).replace(/\/$/, ""),
    apiKey: env.RATER_API_KEY || undefined,
  };
}

/** A failed platform call, carrying the server's own message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request(
  config: ApiConfig,
  method: "GET" | "POST",
  path: string,
  opts: {
    body?: Uint8Array | string;
    contentType?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.contentType) headers["content-type"] = opts.contentType;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    init.body = opts.body as unknown as NonNullable<RequestInit["body"]>;
  }
  const res = await fetch(`${config.baseUrl}${path}`, init);
  if (!res.ok) {
    let message = `${method} ${path} → HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const parsed = (await res.json()) as {
        error?: { message?: string; code?: string };
        detail?: unknown;
      };
      if (parsed.error?.message) {
        message = parsed.error.message;
        code = parsed.error.code;
      } else if (parsed.detail) {
        message = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
      }
    } catch {
      // keep the generic message
    }
    throw new ApiError(message, res.status, code);
  }
  return res;
}

async function getJson(config: ApiConfig, path: string): Promise<unknown> {
  return (await request(config, "GET", path)).json();
}

// ── Starter kit + registry ───────────────────────────────────────────

export async function getTranscriptionSpec(config: ApiConfig): Promise<string> {
  return (await request(config, "GET", "/api/v1/plans/ingest/assets/spec")).text();
}

// ── FCA #29 (finding 52) — the spec reads in PIECES ─────────────────
//
// The whole spec (~87k chars) exceeds MCP output limits: the
// "mandatory first step of the transcribe-my-filing door" returned an
// overflow error instead of content. The spec is §-structured, so the
// tool serves a TABLE OF CONTENTS by default and any one section on
// request — never a truncated blob.

export interface SpecSection {
  /** The heading line, verbatim ("### 4.15 Sheets `geo.<slug>` …"). */
  readonly heading: string;
  /** The §-number-ish key to request it by ("4.15", "12", "intro"). */
  readonly key: string;
  readonly chars: number;
}

/** Split the spec markdown on its ##/### headings. The preamble
 *  before the first heading is section "intro". */
export function splitSpecSections(
  text: string,
): { readonly key: string; readonly heading: string; readonly body: string }[] {
  const lines = text.split("\n");
  const out: { key: string; heading: string; body: string[] }[] = [
    { key: "intro", heading: "(preamble)", body: [] },
  ];
  for (const line of lines) {
    const m = line.match(/^(#{2,3})\s+(.*)$/);
    if (m) {
      const title = m[2]!.trim();
      const num = title.match(/^([0-9]+(?:\.[0-9]+)?)\b/);
      const key = num
        ? num[1]!
        : title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40);
      out.push({ key, heading: line, body: [] });
    } else {
      out[out.length - 1]!.body.push(line);
    }
  }
  return out.map((s) => ({
    key: s.key,
    heading: s.heading,
    body: s.body.join("\n"),
  }));
}

export async function getTranscriptionSpecSectioned(
  config: ApiConfig,
  section?: string,
): Promise<unknown> {
  const text = await getTranscriptionSpec(config);
  const sections = splitSpecSections(text);
  if (section !== undefined && section !== "") {
    const want = section.trim();
    const hit = sections.filter(
      (s) =>
        s.key === want ||
        s.key.startsWith(`${want}.`) ||
        s.heading.toLowerCase().includes(want.toLowerCase()),
    );
    if (hit.length === 0) {
      return {
        error: `No spec section matches ${JSON.stringify(section)}.`,
        sections: sections.map((s) => s.key),
      };
    }
    return hit
      .map((s) => `${s.heading}\n${s.body}`)
      .join("\n\n")
      .trim();
  }
  // No section → the TOC + how to read on: content arrives sized for
  // one call, never a truncated blob.
  return {
    total_chars: text.length,
    note:
      "The full spec exceeds one tool call. Request a section with " +
      "`section` (e.g. \"4.15\", \"12\", or a heading fragment); " +
      "request several by prefix (\"4\" returns every §4.x).",
    sections: sections.map((s) => ({
      key: s.key,
      heading: s.heading.replace(/^#+\s*/, ""),
      chars: s.heading.length + s.body.length,
    })),
  };
}

export async function getCapabilityRegistry(config: ApiConfig): Promise<unknown> {
  return getJson(config, "/api/v1/plans/ingest/capability-registry");
}

/** MVP-023 (owner O1) — the workbook-back export: the EXACT bytes
 *  that built the plan, written to disk with the recorded hash. The
 *  chat answer to "export this plan" is this file path.
 *
 *  FCA #16 follow-up — `state: "current"` asks the server for the
 *  same container REWRITTEN to the live plan state (tracked
 *  factor-table cells + gates!value cells), so in-app repairs
 *  physically travel. The file gains a '-current' suffix, the hash is
 *  the content hash of what was served (never the build identity),
 *  and anything the rewriter could not place comes back NAMED in the
 *  warning. */
export async function exportPlanWorkbook(
  config: ApiConfig,
  planId: string,
  destDir: string,
  state: "build" | "current" = "build",
): Promise<{
  path: string;
  sha256: string;
  filename: string;
  state: "build" | "current";
  rewrites_applied?: number;
  warning?: string;
}> {
  const wantCurrent = state === "current";
  const res = await request(
    config,
    "GET",
    `/api/v1/plans/${encodeURIComponent(planId)}/workbook${
      wantCurrent ? "?current=true" : ""
    }`,
  );
  const bytes = new Uint8Array(await res.arrayBuffer());
  // The build export's hash is the recorded build identity; a current
  // export hashes the bytes actually served (X-Workbook-Sha256) and
  // never claims to be the build container.
  const hash = wantCurrent
    ? (res.headers.get("X-Workbook-Sha256") ??
      res.headers.get("X-Workbook-Hash") ??
      "")
    : (res.headers.get("X-Workbook-Hash") ?? "");
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const nameMatch = disposition.match(/filename="([^"]+)"/);
  const filename =
    nameMatch?.[1] ??
    `${planId}.workbook${wantCurrent ? "-current" : ""}.xlsx`;
  const dir = resolve(destDir);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, filename);
  await writeFile(dest, bytes);
  // FCA fca-2026-07-25 #16 — the divergence stamp. These are the
  // BUILD-TIME bytes; when the plan carries in-app edits made after
  // the build, a what-if built from this file silently resurrects
  // whatever those edits repaired. Say so, every time.
  const edited = res.headers.get("X-Edited-Since-Build") === "true";
  const editCount = Number(
    res.headers.get("X-Edits-Since-Build-Count") ?? "0",
  );
  if (!wantCurrent) {
    return {
      path: dest,
      sha256: hash,
      filename,
      state: "build",
      ...(edited
        ? {
            warning:
              `This export is the plan's BUILD-TIME workbook, and the ` +
              `plan has been edited in-app since (${
                Number.isFinite(editCount) && editCount > 0
                  ? `${editCount} tracked edit${editCount === 1 ? "" : "s"}`
                  : "changes detected"
              }). A plan built from this file will NOT include those ` +
              `edits — run reingest_diff against it to see exactly what ` +
              `would be lost, or re-export with state: "current" to ` +
              `carry the tracked edits in the file itself.`,
          }
        : {}),
    };
  }
  const rewriteCount = Number(
    res.headers.get("X-Current-Rewrite-Count") ?? "0",
  );
  const unappliedCount = Number(
    res.headers.get("X-Current-Unapplied-Count") ?? "0",
  );
  const unappliedNames = res.headers.get("X-Current-Unapplied") ?? "";
  const warnings: string[] = [];
  if (unappliedCount > 0) {
    // Honest degrade: what could not be written into the workbook's
    // structure is NAMED, never silently dropped.
    warnings.push(
      `${unappliedCount} in-app change${unappliedCount === 1 ? "" : "s"} ` +
        `could NOT be written into the workbook's structure and live ` +
        `ONLY in the app${unappliedNames ? `: ${unappliedNames}` : "."}`,
    );
  }
  if (rewriteCount > 0) {
    warnings.push(
      `This file reflects the LIVE plan (${rewriteCount} tracked ` +
        `cell${rewriteCount === 1 ? "" : "s"} rewritten), not the build ` +
        `identity — re-ingesting it registers as a plan REVISION, ` +
        `never as already_built.`,
    );
  }
  return {
    path: dest,
    sha256: hash,
    filename,
    state: "current",
    rewrites_applied: Number.isFinite(rewriteCount) ? rewriteCount : 0,
    ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
  };
}

export async function downloadWorkbookTemplate(
  config: ApiConfig,
  destDir: string,
): Promise<string> {
  const res = await request(config, "GET", "/api/v1/plans/ingest/assets/template");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dir = resolve(destDir);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, "openrater_workbook_template.xlsx");
  await writeFile(dest, bytes);
  return dest;
}

// ── Workbook check / build / report / re-ingest ──────────────────────

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function postWorkbook(
  config: ApiConfig,
  path: string,
  xlsxPath: string,
): Promise<unknown> {
  const bytes = await readFile(resolve(xlsxPath));
  const res = await request(config, "POST", path, {
    body: bytes,
    contentType: XLSX_MIME,
  });
  return res.json();
}

export async function checkWorkbook(
  config: ApiConfig,
  xlsxPath: string,
): Promise<unknown> {
  const name = encodeURIComponent(xlsxPath.split("/").pop() ?? "workbook.xlsx");
  return postWorkbook(config, `/api/v1/plans/ingest/check?filename=${name}`, xlsxPath);
}

export async function buildFromWorkbook(
  config: ApiConfig,
  xlsxPath: string,
): Promise<unknown> {
  // MVP-031a — the build report records the filename on this path
  // too (the check twin always did; builds said `filename: null`).
  const name = encodeURIComponent(xlsxPath.split("/").pop() ?? "workbook.xlsx");
  return postWorkbook(config, `/api/v1/plans/ingest?filename=${name}`, xlsxPath);
}

export async function getBuildReport(
  config: ApiConfig,
  planId: string,
): Promise<unknown> {
  return getJson(config, `/api/v1/plans/${encodeURIComponent(planId)}/build-report`);
}

export async function reingestCheck(
  config: ApiConfig,
  planId: string,
  xlsxPath: string,
): Promise<unknown> {
  return postWorkbook(
    config,
    `/api/v1/plans/${encodeURIComponent(planId)}/reingest/check`,
    xlsxPath,
  );
}

export async function reingestApply(
  config: ApiConfig,
  planId: string,
  xlsxPath: string,
  replaceEdits = false,
): Promise<unknown> {
  const qs = replaceEdits ? "?replace_edits=true" : "";
  return postWorkbook(
    config,
    `/api/v1/plans/${encodeURIComponent(planId)}/reingest${qs}`,
    xlsxPath,
  );
}

// ── Plans ────────────────────────────────────────────────────────────

export async function listPlans(
  config: ApiConfig,
  status: string = "all",
): Promise<unknown> {
  return getJson(config, `/api/v1/plans?status=${encodeURIComponent(status)}`);
}

export async function getPlan(config: ApiConfig, planId: string): Promise<unknown> {
  return getJson(config, `/api/v1/plans/${encodeURIComponent(planId)}`);
}

// ── FCA #24 (finding 75) — plan-to-plan compare, chat-side ──────────
//
// The audit's only structured diff was the re-ingest revision preview,
// which refuses any workbook naming a different plan — comparing two
// existing plans meant masquerading one under the other's id, fifty
// manual loops at portfolio scale. This tool answers "what changed
// between A and B" with the SAME @openrater/contracts arithmetic the
// app's Exhibits → Compare renders: membership reassignments
// first-class, dual-keyed counties deduplicated, coverage towers
// enumerated.

interface SideSubstrateWire {
  readonly dims: readonly CompareDimLike[];
  readonly tables: readonly CompareTableLike[];
  readonly stages: readonly CompareStageLike[];
  readonly displayName: string;
}

async function fetchCompareSide(
  config: ApiConfig,
  planId: string,
): Promise<SideSubstrateWire> {
  const [dimsRes, tablesRes, detailRes] = await Promise.all([
    getJson(config, `/api/v1/plans/${encodeURIComponent(planId)}/dimensions`),
    getJson(
      config,
      `/api/v1/plans/${encodeURIComponent(planId)}/factor-tables`,
    ),
    getJson(config, `/api/v1/plans/${encodeURIComponent(planId)}`),
  ]);
  const dims = (dimsRes as { dimensions?: unknown }).dimensions;
  const tables = (tablesRes as { factor_tables?: unknown }).factor_tables;
  const detail = detailRes as {
    stages?: unknown;
    display_name?: unknown;
  };
  return {
    dims: (Array.isArray(dims) ? dims : []) as readonly CompareDimLike[],
    tables: (Array.isArray(tables)
      ? tables
      : []) as readonly CompareTableLike[],
    stages: (Array.isArray(detail.stages)
      ? detail.stages
      : []) as readonly CompareStageLike[],
    displayName:
      typeof detail.display_name === "string" ? detail.display_name : planId,
  };
}

export async function comparePlans(
  config: ApiConfig,
  planA: string,
  planB: string,
): Promise<unknown> {
  const [a, b] = await Promise.all([
    fetchCompareSide(config, planA),
    fetchCompareSide(config, planB),
  ]);
  const facts = compareFacts(
    a.dims,
    a.tables,
    b.dims,
    b.tables,
    a.stages,
    b.stages,
  );

  // Per-changed-table cell deltas, one summary row each.
  const { pairs } = pairTables(a.tables, b.tables);
  const changedTables = pairs
    .map((pair) => ({ pair, delta: cellDelta(pair.a.cells, pair.b.cells) }))
    .filter(({ delta }) => delta.changed > 0)
    .map(({ pair, delta }) => ({
      table: tableName(pair.a),
      cells_changed: delta.changed,
      cells_total: delta.total,
      largest: delta.largest,
    }));

  // The member-level territory verdicts for paired geographic tables.
  const bDimBySlug = new Map(b.dims.map((d) => [d.slug, d]));
  const bTableByKey = new Map(
    b.tables.map((t) => [t.slug || t.table_id, t] as const),
  );
  const territory = a.dims
    .filter(
      (d) =>
        d.dimension_type === "geographic" &&
        (d.geo_territories?.length ?? 0) > 0,
    )
    .flatMap((aDim) => {
      const bDim = bDimBySlug.get(aDim.slug);
      if (bDim === undefined) return [];
      const aTable = a.tables.find((t) =>
        ((t as { key_dimensions?: readonly string[] }).key_dimensions ?? []).includes(
          aDim.slug,
        ),
      );
      const bTable =
        aTable === undefined
          ? undefined
          : bTableByKey.get(aTable.slug || aTable.table_id);
      if (aTable === undefined || bTable === undefined) return [];
      const v = territoryVerdict(aDim, aTable, bDim, bTable);
      if (v === null) return [];
      return [
        {
          dim: aDim.display_name ?? aDim.slug,
          shared_members: v.shared,
          identical: v.identical,
          cheaper_in_b: v.cheaperInB,
          costlier_in_b: v.costlierInB,
          reassigned: v.reassigned,
          largest_swing: v.largest,
        },
      ];
    });

  return {
    plan_a: { rating_plan_id: planA, display_name: a.displayName },
    plan_b: { rating_plan_id: planB, display_name: b.displayName },
    // FCA #28 (finding 80) — the visual twin of this answer, ready to
    // open or send: Exhibits renders the same compare at this URL.
    open_in_exhibits: exhibitsLink(config, planA, planB),
    summary: {
      shared_tables: facts.sharedTables,
      changed_tables: facts.changedTables,
      tables_only_in_a: facts.onlyATables,
      tables_only_in_b: facts.onlyBTables,
      inputs_only_in_a: facts.removedDims,
      inputs_only_in_b: facts.newDims,
      members_reassigned: facts.territoryReassignments.reduce(
        (sum, t) => sum + t.count,
        0,
      ),
      coverage_towers_only_in_a: facts.onlyACoverages,
      coverage_towers_only_in_b: facts.onlyBCoverages,
      biggest_cell_move: facts.biggest,
    },
    territory_reassignments: facts.territoryReassignments,
    territory_verdicts: territory,
    changed_tables: changedTables,
    levels: { added: facts.addedLevels, removed: facts.removedLevels },
    note:
      "Same arithmetic as the app's Exhibits → Compare. Counts are " +
      "canonical: dual-keyed geo members (county name + FIPS) collapse " +
      "to one. Present this as a reconstruction — the filed documents " +
      "govern.",
  };
}

export async function getInputSchema(
  config: ApiConfig,
  planId: string,
): Promise<unknown> {
  return getJson(
    config,
    `/api/v1/plans/${encodeURIComponent(planId)}/input-schema`,
  );
}

/** The plan detail is large; the tool returns the load-bearing subset. */
export function summarizePlan(detail: Record<string, unknown>): Record<string, unknown> {
  const keep = [
    "rating_plan_id",
    "display_name",
    "line_of_business",
    "product",
    "jurisdiction",
    "effective_date",
    "status",
    "content_hash",
    "note",
    "created_at",
    "last_edited_at",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (detail[k] !== undefined) out[k] = detail[k];
  const stages = detail.stages;
  if (Array.isArray(stages)) {
    out.stage_count = stages.length;
    const kinds: Record<string, number> = {};
    for (const s of stages as { stage_kind?: string }[]) {
      const kind = s.stage_kind ?? "unknown";
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    out.stage_kinds = kinds;
  }
  return out;
}

// ── Quote ────────────────────────────────────────────────────────────

export interface QuoteArgs {
  readonly planId: string;
  readonly inputs?: Record<string, unknown>;
  readonly locations?: Record<string, unknown>[];
  readonly policyInputs?: Record<string, unknown>;
  readonly asOf?: string;
  /** Quote the working draft (pre-publish review loop). */
  readonly draft?: boolean;
  /** MVP-026 — pin the quote to a frozen version. */
  readonly snapshotId?: string;
}

/** The trace kinds whose one-line explanations ARE the story a chat
 *  reader needs (mvp-tightness §5.4 / MVP-021): the chains (factor
 *  names × values), the gate verdict, geography, curves, and the
 *  tail. Inputs/constants restate the request; math.op is exposure
 *  arithmetic; output is the result already in `premium`. */
const TRACE_SUMMARY_KINDS = new Set([
  "eligibility.gate",
  "derive.territory",
  "interpolate",
  "chain.mult",
  "chain.add",
  "modifier.schedule",
  "endorsement.factor",
  "endorsement.additive",
  "clamp",
]);

/** Reduce a full node trace to the one-line-per-step chat summary.
 *  Dedupes repeated explanations (fan-out nodes repeat verbatim). */
export function summarizeTrace(
  trace: Record<string, unknown>,
): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const entry of Object.values(trace)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { kindId?: unknown; explanation?: unknown };
    if (!TRACE_SUMMARY_KINDS.has(String(e.kindId))) continue;
    const line = typeof e.explanation === "string" ? e.explanation.trim() : "";
    if (line === "" || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

export async function quoteRisk(config: ApiConfig, args: QuoteArgs): Promise<unknown> {
  const body: Record<string, unknown> = { trace: "summary" };
  if (args.inputs) body.inputs = args.inputs;
  if (args.locations) body.locations = args.locations;
  if (args.policyInputs) body.policy_inputs = args.policyInputs;
  if (args.asOf) body.as_of = args.asOf;
  const headers: Record<string, string> = {};
  if (config.apiKey) headers["X-API-Key"] = config.apiKey;
  const params = new URLSearchParams();
  if (args.draft) params.set("draft", "true");
  if (args.snapshotId) params.set("snapshot_id", args.snapshotId);
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  const res = await request(
    config,
    "POST",
    `/api/v1/plans/${encodeURIComponent(args.planId)}/quote${qs}`,
    { body: JSON.stringify(body), contentType: "application/json", headers },
  );
  const payload = (await res.json()) as Record<string, unknown>;
  // FCA #27 (finding 83) — the quote lands in the app's run history
  // now (the server records it and names the run); the review link is
  // the RUN's own drawer, not the bare plan page that used to read
  // "Not run yet" about a quote the user just watched happen.
  if (typeof payload.run_id === "string" && payload.run_id !== "") {
    payload.review_url =
      `${config.appUrl}/rate-lab/${encodeURIComponent(args.planId)}` +
      `/workspace/verify?run=${encodeURIComponent(payload.run_id)}`;
  }
  // MVP-021 — the chat answer carries the SUMMARY (one line per
  // step); the full node trace stays on the API for the review UI.
  if (payload.trace && typeof payload.trace === "object") {
    const { trace, ...rest } = payload;
    return {
      ...rest,
      trace_summary: summarizeTrace(trace as Record<string, unknown>),
    };
  }
  return payload;
}

export function planLink(config: ApiConfig, planId: string): string {
  return `${config.appUrl}/rate-lab/${encodeURIComponent(planId)}`;
}

/** FCA #28 (finding 80) — Exhibits is the app's visual plan surface
 *  (draw one plan, compare two), and nothing in chat ever named it.
 *  The link IS the state: ?a= exhibits a plan, ?b= arms the compare,
 *  so a configured compare can be bookmarked or sent to a colleague. */
export function exhibitsLink(
  config: ApiConfig,
  planA: string,
  planB?: string,
): string {
  const b = planB === undefined ? "" : `&b=${encodeURIComponent(planB)}`;
  return `${config.appUrl}/exhibits?a=${encodeURIComponent(planA)}${b}`;
}

// ── Two-run compare (FCA #28, finding 78) ───────────────────────────

/** Relay the server's run-compare arithmetic (ONE code path — the app
 *  drawer reads the same endpoint). Returns totals, counts, refusal
 *  changes, and the top movers, plus the drawer deep link. */
export async function compareRuns(
  config: ApiConfig,
  planId: string,
  runId: string,
  withRun: string,
  withPlan?: string,
): Promise<unknown> {
  const params = new URLSearchParams({ with_run: withRun });
  if (withPlan !== undefined) params.set("with_plan", withPlan);
  const cmp = (await getJson(
    config,
    `/api/v1/plans/${encodeURIComponent(planId)}/runs/${encodeURIComponent(
      runId,
    )}/compare?${params.toString()}`,
  )) as Record<string, unknown>;
  const vsPlan =
    withPlan === undefined || withPlan === planId
      ? ""
      : `&vsPlan=${encodeURIComponent(withPlan)}`;
  return {
    ...cmp,
    review_url:
      `${config.appUrl}/rate-lab/${encodeURIComponent(planId)}` +
      `/workspace/verify?run=${encodeURIComponent(runId)}` +
      `&vs=${encodeURIComponent(withRun)}${vsPlan}`,
  };
}

// ── Book re-rate (CSV → probe-kind run) ──────────────────────────────

/** Minimal RFC-4180-ish CSV parser (quoted fields, embedded commas,
 *  doubled quotes, CRLF). Books are simple; anything exotic should go
 *  through the UI's Inputs intake instead. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/** Header + rows → typed row objects: numeric-looking cells become
 *  numbers, true/false become booleans, empty cells are omitted. */
export function csvToRows(text: string): Record<string, unknown>[] {
  const parsed = parseCsv(text);
  if (parsed.length < 2) return [];
  const header = parsed[0]!.map((h) => h.trim());
  const out: Record<string, unknown>[] = [];
  for (const cells of parsed.slice(1)) {
    const rowObj: Record<string, unknown> = {};
    header.forEach((name, i) => {
      if (!name) return;
      const raw = (cells[i] ?? "").trim();
      if (raw === "") return;
      if (raw === "true" || raw === "false") {
        rowObj[name] = raw === "true";
        return;
      }
      const n = Number(raw.replace(/,/g, ""));
      rowObj[name] = Number.isFinite(n) && raw !== "" && /^[\d.,\-+eE]+$/.test(raw) ? n : raw;
    });
    if (Object.keys(rowObj).length > 0) out.push(rowObj);
  }
  return out;
}

export const MAX_BOOK_ROWS = 5000;

export interface RerateRowIssue {
  readonly row: number;
  readonly issue: string;
}

export interface RerateResult {
  readonly run_id: unknown;
  readonly status: unknown;
  readonly rows_submitted: number;
  readonly empty_rows_skipped?: number;
  /** ADR-0056 accounting from the run summary — counts, never rows. */
  readonly totals?: Record<string, unknown>;
  readonly row_count?: number;
  /** FCA #15 — book-level plausibility signals from the run summary
   *  ("one row is 99.8% of the written total"). */
  readonly warnings?: readonly string[];
  /** The first ≤3 problem rows, NAMED (book-intake §3). */
  readonly first_issues?: readonly RerateRowIssue[];
  /** Pre-flight leftovers worth knowing (ignored columns), when any. */
  readonly header_note?: string;
  /** The run detail — rows live here, not in the chat. */
  readonly run_detail_url: string;
  /** FCA #S2 — the whole run as one CSV (caller's source identifier
   *  columns included). Bulk data travels as files, never chat rows. */
  readonly rows_csv_url: string;
  readonly note: string;
}

const ROW_DUMP_KEYS = new Set(["rows", "row_results", "results"]);

/** The run record minus anything row-shaped (Rule 2). */
export function stripRowDumps(run: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(run)) {
    if (ROW_DUMP_KEYS.has(k) && Array.isArray(v)) {
      out[`${k}_count`] = v.length;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** The declared-input dictionary, shaped for the header pre-flight —
 *  plus the structure-consumed vocabulary (FCA #13: fields the
 *  runtime reads with no declaration — schedule hooks, predicate
 *  fields — must never be labeled 'ignored'). */
async function preflightInputsOf(
  config: ApiConfig,
  planId: string,
): Promise<{ inputs: PreflightInput[]; consumed: string[] }> {
  const schema = (await getJson(
    config,
    `/api/v1/plans/${encodeURIComponent(planId)}/input-schema`,
  )) as {
    inputs?: readonly Record<string, unknown>[];
    consumed_fields?: readonly unknown[];
  };
  return {
    inputs: (schema.inputs ?? []).map((e) => ({
      name: String(e.name ?? ""),
      display_name: typeof e.display_name === "string" ? e.display_name : null,
      // Derived inputs are produced by the plan, never demanded of the CSV.
      required: e.required === true && e.expected_from_caller !== false,
    })),
    consumed: (schema.consumed_fields ?? [])
      .filter((f): f is string => typeof f === "string" && f !== ""),
  };
}

export async function rerateBook(
  config: ApiConfig,
  planId: string,
  csvPath: string,
  asOf?: string,
): Promise<RerateResult> {
  const text = await readFile(resolve(csvPath), "utf8");

  // FCA #17 — an EMPTY file used to fall into the header preflight
  // and refuse as a header mismatch ('Missing: class_code, …'),
  // sending a non-engineer to fix a header that does not exist. Name
  // the actual disease first.
  if (text.trim() === "") {
    throw new ApiError(
      `${csvPath} is empty — export the book again (a header row + ` +
        `one risk row per line) and retry.`,
      400,
    );
  }

  // Book-intake §2 — the header meets the dictionary BEFORE any row
  // rates. Header problems refuse with the culprit named, never the
  // per-row lookup error. Same derivation the app runs on upload.
  const { inputs, consumed } = await preflightInputsOf(config, planId);
  const preflight = preflightBook(text, inputs, consumed);
  if (!preflight.ok) {
    throw new ApiError(
      `The book's header doesn't fit this plan. ${preflight.sentence ?? ""} ` +
        `Fix the CSV header, or map the columns in OpenRater → Inputs → ` +
        `Match columns, then retry.`,
      400,
    );
  }

  const rows = csvToRows(text);
  if (rows.length === 0) {
    throw new ApiError(`No data rows found in ${csvPath} (need a header row + at least one risk row).`, 400);
  }
  if (rows.length > MAX_BOOK_ROWS) {
    throw new ApiError(
      `${rows.length} rows exceeds the MCP re-rate cap (${MAX_BOOK_ROWS}). ` +
        `Use the OpenRater UI's Inputs intake for larger books.`,
      400,
    );
  }
  const parsedLines = parseCsv(text).length - 1;
  const emptySkipped = Math.max(0, parsedLines - rows.length);

  const createRes = await request(
    config,
    "POST",
    `/api/v1/plans/${encodeURIComponent(planId)}/runs`,
    {
      // Book-intake §3 — a caller's CSV is a real BOOK (it lands in
      // run history under the Book chip), never a probe.
      body: JSON.stringify({ kind: "book", rows, ...(asOf ? { as_of: asOf } : {}) }),
      contentType: "application/json",
    },
  );
  const run = (await createRes.json()) as Record<string, unknown>;
  const runId = String(run.run_id ?? run.id ?? "");

  // Poll to completion (bounded).
  let latest: Record<string, unknown> = run;
  const deadline = Date.now() + 120_000;
  let delay = 500;
  while (String(latest.status) === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 3000);
    latest = (await getJson(
      config,
      `/api/v1/plans/${encodeURIComponent(planId)}/runs/${encodeURIComponent(runId)}`,
    )) as Record<string, unknown>;
  }

  // The chat contract (book-intake §3): counts + totals + the first
  // three row issues, NAMED — the payload is BUILT, never a stripped
  // run record, so a row dump can't ride along in a nested field.
  const result =
    latest.result && typeof latest.result === "object"
      ? (latest.result as Record<string, unknown>)
      : {};
  const totals =
    result.totals && typeof result.totals === "object"
      ? (result.totals as Record<string, unknown>)
      : undefined;
  const resultRows = Array.isArray(result.rows)
    ? (result.rows as readonly Record<string, unknown>[])
    : [];
  const firstIssues: RerateRowIssue[] = [];
  for (let i = 0; i < resultRows.length && firstIssues.length < 3; i++) {
    const r = resultRows[i]!;
    const issue =
      typeof r.first_issue === "string"
        ? r.first_issue
        : r.row_status === "error"
          ? "cannot be rated"
          : null;
    if (issue !== null && (r.row_status === "error" || r.tier === "decline")) {
      firstIssues.push({ row: i + 1, issue });
    }
  }

  return {
    run_id: runId,
    status: latest.status,
    rows_submitted: rows.length,
    ...(emptySkipped > 0 ? { empty_rows_skipped: emptySkipped } : {}),
    ...(typeof result.row_count === "number"
      ? { row_count: result.row_count }
      : {}),
    ...(totals ? { totals } : {}),
    ...(Array.isArray(result.warnings) && result.warnings.length > 0
      ? {
          warnings: result.warnings.filter(
            (w): w is string => typeof w === "string",
          ),
        }
      : {}),
    ...(firstIssues.length > 0 ? { first_issues: firstIssues } : {}),
    ...(preflight.sentence ? { header_note: preflight.sentence } : {}),
    run_detail_url: `${config.appUrl}/rate-lab/${encodeURIComponent(planId)}/workspace/verify?run=${encodeURIComponent(runId)}`,
    rows_csv_url: `${config.baseUrl}/api/v1/plans/${encodeURIComponent(planId)}/runs/${encodeURIComponent(runId)}/rows.csv`,
    note:
      "Row-level results stay out of the chat — open the run detail " +
      "for the full row table, or download rows_csv_url for the " +
      "spreadsheet deliverable.",
  };
}
