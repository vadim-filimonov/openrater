/**
 * Plan runs — Brief 75 (v4 P3, the Run zone).
 *
 * A run is a durable, server-scored record of one execution (sample
 * rate or book score), persisted append-only in api-lab and computed
 * by the scoring service (never a client-posted number). `result` is
 * passed through loosely typed — the ledger narrows the ADR-0056
 * fields (row_status, rowIssues, composed) at the consumption site so
 * new response fields need no client bump.
 */

import { z } from "zod";
import { request } from "./fetcher";

export const planRunSummarySchema = z.object({
  run_id: z.string(),
  rating_plan_id: z.string(),
  kind: z.enum(["sample", "book", "probe"]),
  status: z.enum(["running", "done", "error"]),
  created_at: z.string(),
  finished_at: z.string().nullable(),
  as_of: z.string().nullable(),
  snapshot_id: z.string().nullable(),
  plan_content_hash: z.string().nullable(),
  book_content_hash: z.string().nullable(),
  // ADR-0064 — the client-attested scoring fingerprint captured when
  // the run was requested (stages + dims + factor-table cells + tail).
  // Staleness compares it before falling back to plan_content_hash,
  // which (ADR-0015) can't see factor-table cells. `nullish` (not
  // `nullable`) so parses survive a backend that predates the column.
  scoring_fingerprint: z.string().nullish(),
  headline: z.record(z.unknown()).default({}),
});
export type PlanRunSummary = z.infer<typeof planRunSummarySchema>;

export const planRunSchema = planRunSummarySchema
  .omit({ headline: true })
  .extend({
    job_id: z.string().nullable(),
    request: z.record(z.unknown()).default({}),
    result: z.record(z.unknown()).nullable(),
    error_message: z.string().nullable(),
  });
export type PlanRun = z.infer<typeof planRunSchema>;

const planRunListSchema = z.object({
  runs: z.array(planRunSummarySchema),
});
export type PlanRunList = z.infer<typeof planRunListSchema>;

export interface CreatePlanRunRequest {
  readonly kind: "sample" | "book" | "probe";
  readonly inputs?: Record<string, unknown>;
  /** Probe runs only (Brief 89 §3.2 B3) — the client-built sweep of
   *  the plan's own variable space, scored through the book path. */
  readonly rows?: readonly Record<string, unknown>[];
  readonly as_of?: string;
  readonly snapshot_id?: string;
  /** ADR-0064 — the scoring fingerprint of the substrate the client
   *  sees at request time (`computeScoringFingerprint`); pinned to the
   *  run so staleness can see factor-table cell edits. Optional —
   *  omitted runs fall back to the content-hash grammar. */
  readonly scoring_fingerprint?: string;
}

export async function createPlanRun(
  planId: string,
  body: CreatePlanRunRequest,
  opts: { signal?: AbortSignal } = {},
): Promise<PlanRun> {
  return request({
    method: "POST",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/runs`,
    body,
    schema: planRunSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

export async function listPlanRuns(
  planId: string,
  opts: {
    limit?: number;
    kind?: "sample" | "book" | "probe";
    status?: "running" | "done" | "error";
    signal?: AbortSignal;
  } = {},
): Promise<PlanRunList> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.kind !== undefined) params.set("kind", opts.kind);
  if (opts.status !== undefined) params.set("status", opts.status);
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/runs${qs}`,
    schema: planRunListSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

/** One stored row of a DONE book run — the exhibits' substrate
 *  (projected inputs + outputs + verdict), Brief 75 phase 4. */
export const planRunRowSchema = z.object({
  inputs: z.record(z.unknown()).default({}),
  outputs: z.record(z.unknown()).default({}),
  views: z.record(z.unknown()).optional(),
  row_status: z.enum(["ok", "error"]).optional(),
  eligibility_tier: z.string().optional(),
  rowIssues: z.array(z.record(z.unknown())).optional(),
  // FCA #26 (finding 61) — the caller's RAW source row (PolicyNbr and
  // kin), stored by the worker since the run-export wave; the drawer
  // shows the identifier column so refusals name policies, not row
  // numbers.
  source: z.record(z.unknown()).optional(),
});
export type PlanRunRow = z.infer<typeof planRunRowSchema>;

const planRunRowsPageSchema = z.object({
  rows: z.array(planRunRowSchema),
  total: z.number(),
  offset: z.number(),
  next_offset: z.number().nullable(),
});
export type PlanRunRowsPage = z.infer<typeof planRunRowsPageSchema>;

export async function getPlanRunRows(
  planId: string,
  runId: string,
  opts: { offset?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<PlanRunRowsPage> {
  const params = new URLSearchParams();
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/runs/${encodeURIComponent(runId)}/rows${qs}`,
    schema: planRunRowsPageSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

export async function getPlanRun(
  planId: string,
  runId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PlanRun> {
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/runs/${encodeURIComponent(runId)}`,
    schema: planRunSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

// ── The two-run compare (FCA #28, finding 78) ───────────────────────
// Server-owned arithmetic — the drawer renders these numbers verbatim
// (the chat tool reads the same endpoint; one code path).

const keyedCountSchema = z.object({
  count: z.number(),
  examples: z.array(z.string()).default([]),
});

export const runCompareSchema = z.object({
  a: z.object({
    rating_plan_id: z.string(),
    run_id: z.string(),
    kind: z.string(),
    created_at: z.string(),
    book_content_hash: z.string().nullable(),
  }),
  b: z.object({
    rating_plan_id: z.string(),
    run_id: z.string(),
    kind: z.string(),
    created_at: z.string(),
    book_content_hash: z.string().nullable(),
  }),
  joined_by_column: z.string().nullable(),
  counts: z.object({
    rows_a: z.number(),
    rows_b: z.number(),
    matched: z.number(),
    only_a: keyedCountSchema,
    only_b: keyedCountSchema,
    rated_both: z.number(),
    changed: z.number(),
    unchanged: z.number(),
  }),
  totals: z.object({
    premium_a: z.number(),
    premium_b: z.number(),
    delta: z.number(),
    pct: z.number().nullable(),
  }),
  status_changes: z.object({
    rated_to_refused: keyedCountSchema,
    refused_to_rated: keyedCountSchema,
    tier_changed: keyedCountSchema,
  }),
  movers: z
    .array(
      z.object({
        key: z.string(),
        premium_a: z.number(),
        premium_b: z.number(),
        delta: z.number(),
        pct: z.number().nullable(),
        tier_a: z.string().nullable(),
        tier_b: z.string().nullable(),
      }),
    )
    .default([]),
  caveats: z.array(z.string()).default([]),
});
export type RunCompare = z.infer<typeof runCompareSchema>;

export async function getPlanRunCompare(
  planId: string,
  runId: string,
  opts: { withRun: string; withPlan?: string; signal?: AbortSignal },
): Promise<RunCompare> {
  const params = new URLSearchParams({ with_run: opts.withRun });
  if (opts.withPlan !== undefined) params.set("with_plan", opts.withPlan);
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/runs/${encodeURIComponent(runId)}/compare?${params.toString()}`,
    schema: runCompareSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}
