/**
 * The quote endpoint client (Brief 76, v4 P4) — the Ship tab's try-it.
 *
 * A quote is UN-PERSISTED single-risk (or policy) rating against the
 * plan's version of record: the published snapshot by default,
 * `snapshotId` / `draft` on request. The response is the composed FILED
 * premium + the ADR-0056 tri-facet + WHICH version answered — the same
 * number the Run tab shows for the same risk on the same version.
 */

import { z } from "zod";
import { request } from "./fetcher";

export const quoteVersionSchema = z.object({
  kind: z.enum(["published", "snapshot", "draft"]),
  snapshot_id: z.string().nullable().default(null),
  content_hash: z.string().nullable().default(null),
});

export const quoteResponseSchema = z.object({
  premium: z.number().nullable(),
  tier: z.string().nullable().default(null),
  row_status: z.enum(["ok", "error"]),
  outputs: z.record(z.unknown()).default({}),
  composed: z.record(z.unknown()).nullable().default(null),
  row_issues: z.array(z.record(z.unknown())).nullable().default(null),
  plan_issues: z.array(z.record(z.unknown())).nullable().default(null),
  input_issues: z.record(z.unknown()).nullable().default(null),
  trace: z.record(z.unknown()).nullable().default(null),
  as_of: z.string().nullable().default(null),
  version: quoteVersionSchema,
  locations: z.array(z.record(z.unknown())).nullable().default(null),
  location_count: z.number().nullable().default(null),
  // FCA #27 (finding 83) — the run-history record this quote landed
  // as; null when ?record=false (ephemeral trace views) or on older
  // servers.
  run_id: z.string().nullable().default(null),
});
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

export interface QuoteRequestBody {
  readonly inputs?: Record<string, unknown>;
  readonly locations?: readonly Record<string, unknown>[];
  readonly policy_inputs?: Record<string, unknown>;
  readonly as_of?: string;
  readonly trace?: "none" | "summary" | "full";
}

export async function quotePlan(
  planId: string,
  body: QuoteRequestBody,
  opts: {
    snapshotId?: string;
    draft?: boolean;
    /** FCA #27 — false keeps an ephemeral quote (the drawer's
     *  row-Trace view) OUT of run history. Default true. */
    record?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<QuoteResponse> {
  const params = new URLSearchParams();
  if (opts.snapshotId !== undefined) params.set("snapshot_id", opts.snapshotId);
  if (opts.draft) params.set("draft", "true");
  if (opts.record === false) params.set("record", "false");
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  return request({
    method: "POST",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/quote${qs}`,
    body,
    schema: quoteResponseSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}
