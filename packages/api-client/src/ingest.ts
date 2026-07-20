/**
 * Workbook ingestion — Brief 92 (ADR-0065).
 *
 * Three calls, mirroring `plan_ingest_route.py`:
 *   - `checkWorkbook`     — POST /plans/ingest/check (raw bytes; pure)
 *   - `buildWorkbookPlan` — POST /plans/ingest (one transaction server-side)
 *   - `getBuildReport`    — GET  /plans/{id}/build-report
 *
 * The workbook travels as the raw request body (no multipart); a failed
 * check is an HTTP 200 whose `ok` is false — the report IS the resource.
 */

import { z } from "zod";
import { getApiBase } from "./config";
import { request } from "./fetcher";

/** The starter kit (Brief 94 §2) — plain download URLs for the format
 *  spec, the template workbook, and the worked example. The server sets
 *  `Content-Disposition: attachment`, so a bare `<a href>` saves the
 *  file (the `download` attribute being ignored cross-origin is fine). */
export type IngestAssetKind = "spec" | "template" | "example";

export function ingestAssetUrl(kind: IngestAssetKind): string {
  return `${getApiBase()}/api/v1/plans/ingest/assets/${kind}`;
}

/** Brief 95 D1 — the plan's book-template CSV: headers = declared
 *  inputs in stage order (derived inputs excluded — the platform
 *  computes those), plus one example row from the filing's own first
 *  test case when a build report carries them. Same plain-`<a href>`
 *  download contract as the starter kit. */
export function bookTemplateUrl(planId: string): string {
  return `${getApiBase()}/api/v1/plans/${encodeURIComponent(planId)}/book-template.csv`;
}

/** Brief 94.5 (T6) — the build envelope's verdict; optional so pre-94.5
 *  responses keep parsing. */
export const buildVerificationSchema = z
  .enum(["all_match", "near", "mismatches", "none", "unavailable"])
  .optional();

/** Brief 92.R (D2) — a clean check whose workbook revises an existing
 *  plan names it; offered beside building separately, never instead. */
export const revisionCandidateSchema = z.object({
  rating_plan_id: z.string(),
  display_name: z.string(),
  built_at: z.string(),
  version_from: z.string().nullable(),
  version_to: z.string().nullable(),
});
export type RevisionCandidate = z.infer<typeof revisionCandidateSchema>;

/** Brief 92.R (D6) — one check's measured move between builds. */
export const driftCaseSchema = z.object({
  case_id: z.string(),
  field: z.string(),
  was: z.union([z.number(), z.string()]).nullable(),
  now: z.union([z.number(), z.string()]).nullable(),
  pct: z.number().nullable(),
});
export const driftSummarySchema = z.object({
  compared: z.number(),
  median_pct: z.number().nullable(),
  max_pct: z.number().nullable(),
  expectations_revised: z.number(),
  cases: z.array(driftCaseSchema),
});
export type DriftSummary = z.infer<typeof driftSummarySchema>;

/** Brief 92.R (D3) — the construct diff, ADR-0017's five-state shape.
 *  `from`/`to` stay unknown (raw cell values); `pct` rides numeric moves. */
export const diffFieldChangeSchema = z.object({
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
  pct: z.number().nullable(),
});
export const diffItemSchema = z.object({
  state: z.enum(["added", "changed", "removed"]),
  key: z.string(),
  summary: z.string(),
  changes: z.array(diffFieldChangeSchema).default([]),
});
export const diffSectionSchema = z.object({
  section: z.string(),
  label: z.string(),
  added: z.number(),
  changed: z.number(),
  removed: z.number(),
  unchanged: z.number(),
  items: z.array(diffItemSchema),
});
export const workbookDiffSchema = z.object({
  totals: z.object({
    added: z.number(),
    changed: z.number(),
    removed: z.number(),
    sections_changed: z.number(),
  }),
  sections: z.array(diffSectionSchema),
  ignored: z.array(z.string()).default([]),
});
export type WorkbookDiff = z.infer<typeof workbookDiffSchema>;

export const checkIssueSchema = z.object({
  rule: z.string(),
  severity: z.enum(["error", "warning", "notice"]),
  sheet: z.string().nullable(),
  cell: z.string().nullable(),
  message: z.string(),
});
export type CheckIssue = z.infer<typeof checkIssueSchema>;

export const manifestCountsSchema = z.object({
  dimensions: z.number(),
  dimension_levels: z.number(),
  factor_tables: z.number(),
  factor_cells: z.number(),
  // Brief 94 (U5) — citation coverage; default 0 so build reports
  // persisted before the field existed still parse.
  factor_cells_cited: z.number().default(0),
  chains: z.number(),
  chain_stages: z.number(),
  gates: z.number(),
  modifier_categories: z.number(),
  endorsements: z.number(),
  loadings: z.number(),
  final_adjustments: z.number(),
  outputs: z.number(),
  inputs: z.number(),
  inputs_with_defaults: z.number(),
  test_cases: z.number(),
  geo_rows: z.number(),
  declared_gaps: z.number(),
});
export type ManifestCounts = z.infer<typeof manifestCountsSchema>;

export const manifestSchema = z.object({
  provenance: z.object({
    carrier: z.string().nullable(),
    product: z.string().nullable(),
    state: z.string().nullable(),
    effective_date: z.string().nullable(),
    serff_tracking_number: z.string().nullable(),
    display_name: z.string().nullable(),
    // Brief 92.R (D2) — the workbook's own identity + re-issue signal;
    // defaulted so pre-92R payloads keep parsing.
    rating_plan_id: z.string().nullable().default(null),
    version: z.string().nullable().default(null),
  }),
  counts: manifestCountsSchema,
  gap_kinds: z.record(z.string(), z.number()),
});
export type WorkbookManifest = z.infer<typeof manifestSchema>;

export const checkResultSchema = z.object({
  ok: z.boolean(),
  spec_version: z.string(),
  workbook_hash: z.string(),
  filename: z.string().nullable(),
  sheet_count: z.number(),
  errors: z.array(checkIssueSchema),
  warnings: z.array(checkIssueSchema),
  notices: z.array(checkIssueSchema),
  manifest: manifestSchema.nullable(),
  already_built: z
    .object({
      rating_plan_id: z.string(),
      report_id: z.string(),
      created_at: z.string(),
    })
    .nullable(),
  // Brief 92.R (D2) — optional + defaulted so pre-92R responses parse.
  revises: revisionCandidateSchema.nullable().default(null),
});
export type WorkbookCheckResult = z.infer<typeof checkResultSchema>;

export const vectorResultSchema = z.object({
  case_id: z.string(),
  name: z.string().nullable(),
  field: z.string(),
  expected: z.union([z.number(), z.string()]),
  actual: z.union([z.number(), z.string()]).nullable(),
  delta: z.number().nullable(),
  status: z.enum(["match", "near", "mismatch", "not_run", "error"]),
  detail: z.string().nullable(),
});
export type VectorResult = z.infer<typeof vectorResultSchema>;

/** Brief 95 D2 — one test case's INPUTS, persisted with the report so
 *  surfaces can replay a verified filed example (the Run zone seeds its
 *  sample risk from `cases[0]`). */
export const vectorCaseSchema = z.object({
  case_id: z.string(),
  name: z.string().nullable().default(null),
  inputs: z.record(z.string(), z.unknown()).default({}),
});
export type VectorCase = z.infer<typeof vectorCaseSchema>;

export const vectorsSummarySchema = z.object({
  status: z.enum(["ran", "unavailable", "none"]),
  detail: z.string().nullable(),
  total_cases: z.number(),
  checks: z.array(vectorResultSchema),
  // Brief 95 D2 — defaulted so pre-95.4 persisted reports keep parsing.
  cases: z.array(vectorCaseSchema).default([]),
  matched: z.number(),
  near: z.number(),
  mismatched: z.number(),
});
export type VectorsSummary = z.infer<typeof vectorsSummarySchema>;

export const buildReportSchema = z.object({
  report_id: z.string(),
  rating_plan_id: z.string(),
  workbook_hash: z.string(),
  filename: z.string().nullable(),
  spec_version: z.string(),
  workbook_plan_id: z.string().nullable(),
  // Brief 92.R — present on re-ingested rows; defaulted so older
  // persisted reports keep parsing.
  workbook_version: z.string().nullable().default(null),
  diff: workbookDiffSchema.nullable().default(null),
  drift: driftSummarySchema.nullable().default(null),
  manifest: manifestSchema,
  issues: z.array(checkIssueSchema),
  vectors: vectorsSummarySchema,
  gaps: z.array(z.record(z.string(), z.unknown())),
  created_at: z.string(),
});
export type BuildReport = z.infer<typeof buildReportSchema>;

export const buildWorkbookResponseSchema = z.object({
  rating_plan_id: z.string(),
  display_name: z.string(),
  verification: buildVerificationSchema,
  report: buildReportSchema,
});
export type BuildWorkbookResponse = z.infer<typeof buildWorkbookResponseSchema>;

/** The raw bytes of a workbook file, however the caller got them. */
export type WorkbookBytes = ArrayBuffer | Uint8Array | Blob;

/** Normalize to a fetch BodyInit (a generic `Uint8Array<ArrayBufferLike>`
 *  isn't assignable under TS 5.7's typed-array generics — copy it into a
 *  tight ArrayBuffer). */
function toBody(data: WorkbookBytes): BodyInit {
  if (data instanceof Uint8Array) {
    return data.slice().buffer;
  }
  return data;
}

export function checkWorkbook(
  data: WorkbookBytes,
  filename?: string,
): Promise<WorkbookCheckResult> {
  return request({
    method: "POST",
    path: "/api/v1/plans/ingest/check",
    query: { filename },
    rawBody: toBody(data),
    schema: checkResultSchema,
  });
}

export function buildWorkbookPlan(
  data: WorkbookBytes,
  filename?: string,
): Promise<BuildWorkbookResponse> {
  return request({
    method: "POST",
    path: "/api/v1/plans/ingest",
    query: { filename },
    rawBody: toBody(data),
    schema: buildWorkbookResponseSchema,
  });
}

/** In-app edits the live plan carries relative to its latest build. */
export const editsSinceBuildSchema = z.object({
  edited: z.boolean(),
  changes: z.array(
    z.object({
      table: z.string(),
      field: z.string(),
      workbook: z.unknown().nullable(),
      yours: z.unknown().nullable(),
    }),
  ),
  note: z.string().nullable(),
});
export type EditsSinceBuild = z.infer<typeof editsSinceBuildSchema>;

export function getEditsSinceBuild(
  ratingPlanId: string,
): Promise<EditsSinceBuild> {
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/edits-since-build`,
    schema: editsSinceBuildSchema,
  });
}

export function getBuildReport(ratingPlanId: string): Promise<BuildReport> {
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/build-report`,
    schema: buildReportSchema,
  });
}


/** Brief 92.R — the stateless revision check: the R-### report of the
 *  revised workbook + the construct diff against the workbook this
 *  plan was built from. Writes nothing. */
export const reingestCheckResultSchema = z.object({
  check: checkResultSchema,
  diff: workbookDiffSchema.nullable(),
  base: z
    .object({
      report_id: z.string(),
      workbook_version: z.string().nullable(),
      built_at: z.string(),
    })
    .nullable(),
  base_missing_reason: z.string().nullable(),
  hand_edited_since_build: z.boolean(),
  plan_content_hash: z.string().nullable(),
});
export type ReingestCheckResult = z.infer<typeof reingestCheckResultSchema>;

export function reingestCheck(
  ratingPlanId: string,
  data: WorkbookBytes,
  filename?: string,
): Promise<ReingestCheckResult> {
  return request({
    method: "POST",
    path: `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/reingest/check`,
    query: { filename },
    rawBody: toBody(data),
    schema: reingestCheckResultSchema,
  });
}

/** Apply the revision to the SAME plan (one transaction server-side).
 *  `ifMatch` is the plan_content_hash the review was computed against
 *  (G14 — a stale hash is a 412, nothing applied). */
export function reingestApply(
  ratingPlanId: string,
  data: WorkbookBytes,
  opts: { filename?: string; ifMatch?: string } = {},
): Promise<BuildWorkbookResponse> {
  return request({
    method: "POST",
    path: `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/reingest`,
    query: { filename: opts.filename },
    rawBody: toBody(data),
    schema: buildWorkbookResponseSchema,
    ...(opts.ifMatch ? { headers: { "If-Match": opts.ifMatch } } : {}),
  });
}

/** The plan's full build history, newest first (empty for hand-built
 *  plans — collection semantics, never a 404). */
export function listBuildReports(ratingPlanId: string): Promise<BuildReport[]> {
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/build-reports`,
    schema: z.array(buildReportSchema),
  });
}
