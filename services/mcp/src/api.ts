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
 * Design rules:
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
// Use the same header preflight that the app runs on upload.
import { preflightBook, type PreflightInput } from "@openrater/contracts";

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

export async function getCapabilityRegistry(config: ApiConfig): Promise<unknown> {
  return getJson(config, "/api/v1/plans/ingest/capability-registry");
}

/** Workbook-back export: the EXACT bytes that built the plan, written
 *  to disk with the recorded hash. The
 *  chat answer to "export this plan" is this file path. */
export async function exportPlanWorkbook(
  config: ApiConfig,
  planId: string,
  destDir: string,
): Promise<{ path: string; sha256: string; filename: string }> {
  const res = await request(
    config,
    "GET",
    `/api/v1/plans/${encodeURIComponent(planId)}/workbook`,
  );
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hash = res.headers.get("X-Workbook-Hash") ?? "";
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const nameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = nameMatch?.[1] ?? `${planId}.workbook.xlsx`;
  const dir = resolve(destDir);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, filename);
  await writeFile(dest, bytes);
  return { path: dest, sha256: hash, filename };
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
  // The build report records the filename on this path too, matching
  // the check endpoint.
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
  /** Pin the quote to a frozen version. */
  readonly snapshotId?: string;
}

/** The trace kinds whose one-line explanations are the story a chat
 *  reader needs: the chains (factor
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
  // The chat answer carries the summary, one line per step; the full
  // node trace stays on the API for the review UI.
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
  /** The first ≤3 problem rows, named for diagnosis. */
  readonly first_issues?: readonly RerateRowIssue[];
  /** Pre-flight leftovers worth knowing (ignored columns), when any. */
  readonly header_note?: string;
  /** The run detail — rows live here, not in the chat. */
  readonly run_detail_url: string;
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

/** The declared-input dictionary, shaped for the header pre-flight. */
async function preflightInputsOf(
  config: ApiConfig,
  planId: string,
): Promise<PreflightInput[]> {
  const schema = (await getJson(
    config,
    `/api/v1/plans/${encodeURIComponent(planId)}/input-schema`,
  )) as { inputs?: readonly Record<string, unknown>[] };
  return (schema.inputs ?? []).map((e) => ({
    name: String(e.name ?? ""),
    display_name: typeof e.display_name === "string" ? e.display_name : null,
    // Derived inputs are produced by the plan, never demanded of the CSV.
    required: e.required === true && e.expected_from_caller !== false,
  }));
}

export async function rerateBook(
  config: ApiConfig,
  planId: string,
  csvPath: string,
  asOf?: string,
): Promise<RerateResult> {
  const text = await readFile(resolve(csvPath), "utf8");

  // The header meets the dictionary BEFORE any row
  // rates. Header problems refuse with the culprit named, never the
  // per-row lookup error. Same derivation the app runs on upload.
  const inputs = await preflightInputsOf(config, planId);
  const preflight = preflightBook(text, inputs);
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
      // A caller's CSV is a real BOOK (it lands in
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

  // The chat contract returns counts, totals, and the first
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
    ...(firstIssues.length > 0 ? { first_issues: firstIssues } : {}),
    ...(preflight.sentence ? { header_note: preflight.sentence } : {}),
    run_detail_url: `${config.appUrl}/rate-lab/${encodeURIComponent(planId)}/workspace/verify?run=${encodeURIComponent(runId)}`,
    note:
      "Row-level results stay out of the chat — open the run detail " +
      "for the full row table.",
  };
}
