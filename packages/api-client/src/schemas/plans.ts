/**
 * Zod schemas for the plans-author endpoint group.
 *
 * Mirrors `server/src/openrater/app/routes/plan_author_route.py`
 * (PlanSummary, PlanDetail, StageSummary, CreatePlanRequest, etc.).
 *
 * If the backend shape changes, this file updates first; consumers
 * read the inferred TypeScript types from here.
 */

import { z } from "zod";

// ---- Line of business + statuses ----

export const lineOfBusinessSchema = z.enum([
  "bop",
  "cgl",
  "wc",
  "auto",
  "umbrella",
]);
export type LineOfBusiness = z.infer<typeof lineOfBusinessSchema>;

export const planStatusSchema = z.enum([
  "draft",
  "proposed",
  "active",
  "archived",
]);
export type PlanStatus = z.infer<typeof planStatusSchema>;

// ---- Plan summary + detail ----

// Brief 84 D-F — the plan's CURRENT published version. Presence = LIVE:
// /quote serves exactly this version; the UI derives its headline status
// (Draft / Live / Archived) from it.
export const publishedVersionInfoSchema = z.object({
  snapshot_id: z.string(),
  display_name: z.string(),
  published_at: z.string(),
});
export type PublishedVersionInfo = z.infer<typeof publishedVersionInfoSchema>;

export const planSummarySchema = z.object({
  rating_plan_id: z.string(),
  display_name: z.string(),
  // ADR-0033: the product axis. Optional/nullable during the deprecation
  // window (older rows may predate it; the backend backfills).
  product: z.string().nullable().optional(),
  line_of_business: z.string(),
  jurisdiction: z.string().nullable(),
  effective_date: z.string(),
  status: z.string(),
  // Lineage fields stay in the database rather than this list-response wire.
  created_at: z.string().nullable(),
  // The creation note is serialized on both reads. Nullable for plans
  // created without a note and for older rows.
  description: z.string().nullable().optional(),
  template_id: z.string().nullable().optional(),
  coverages: z.array(z.string()).nullable().optional(),
  last_edited_at: z.string().nullable().optional(),
  content_hash: z.string().max(16).nullable().optional(),
  // Brief 84 D-F — the derived-status substrate. Optional on the wire:
  // stage-mutation responses omit it (the canonical GET refetch carries
  // truth), same precedent as draft_session_id.
  published_version: publishedVersionInfoSchema.nullable().optional(),
  diverged: z.boolean().optional(),
  live_integration_count: z.number().int().optional(),
});
export type PlanSummary = z.infer<typeof planSummarySchema>;

export const stageSummarySchema = z.object({
  stage_id: z.string(),
  sequence: z.number().int(),
  stage_kind: z.string(),
  display_name: z.string(),
  config_json: z.record(z.unknown()),
  citation_rule: z.string().nullable(),
  citation_page: z.string().nullable(),
  source_filing_id: z.string().nullable(),
});
export type StageSummary = z.infer<typeof stageSummarySchema>;

export const planDetailSchema = planSummarySchema.extend({
  stages: z.array(stageSummarySchema),
});
export type PlanDetail = z.infer<typeof planDetailSchema>;

// ---- Create ----

export const createPlanRequestSchema = z.object({
  display_name: z.string().min(1).max(200),
  // ADR-0033: `product` is the real axis (drives the slug). `line_of_business`
  // is the deprecated shim — now optional; the backend derives whichever is
  // missing. Send `product`.
  product: z.string().optional(),
  line_of_business: z.string().optional(),
  jurisdiction: z.string().max(4).nullable().optional(),
  // Brief 91 — optional: the create form no longer asks for a date; the
  // backend defaults it to the creation date. Shape still validated
  // when a caller supplies one.
  effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: "Use YYYY-MM-DD format.",
    })
    .optional(),
  template: z.string().optional(),
  description: z.string().max(2000).nullable().optional(),
});
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;

export const createPlanResponseSchema = z.object({
  rating_plan_id: z.string(),
  display_name: z.string(),
  product: z.string().nullable().optional(),
  line_of_business: z.string(),
  jurisdiction: z.string().nullable(),
  status: z.string(),
  template: z.string(),
  stage_count: z.number().int(),
});
export type CreatePlanResponse = z.infer<typeof createPlanResponseSchema>;

// ---- Add stage ----

export const stageInputSpecSchema = z.object({
  input_name: z.string().min(1).max(80),
  source_kind: z.string().min(1).max(40),
  source_path: z.string().max(200).default(""),
  required: z.boolean().optional(),
});
export type StageInputSpec = z.infer<typeof stageInputSpecSchema>;

export const stageOutputSpecSchema = z.object({
  output_name: z.string().min(1).max(80),
  data_type: z.string().min(1).max(40),
  description: z.string().nullable().optional(),
});
export type StageOutputSpec = z.infer<typeof stageOutputSpecSchema>;

export const addStageRequestSchema = z.object({
  stage_id: z.string().min(1).max(80),
  stage_kind: z.string(),
  display_name: z.string().min(1).max(120),
  config_json: z.record(z.unknown()).default({}),
  insert_after_stage_id: z.string().nullable().optional(),
  citation_rule: z.string().nullable().optional(),
  citation_page: z.string().nullable().optional(),
  inputs: z.array(stageInputSpecSchema).default([]),
  outputs: z.array(stageOutputSpecSchema).default([]),
  note: z.string().max(500).nullable().optional(),
});
export type AddStageRequest = z.infer<typeof addStageRequestSchema>;

export const addStageResponseSchema = z.object({
  draft_plan_id: z.string(),
  added_stage: stageSummarySchema,
  plan: planDetailSchema,
});
export type AddStageResponse = z.infer<typeof addStageResponseSchema>;

// ---- Patch stage config ----

export const stageConfigPatchSchema = z.object({
  stage_id: z.string().min(1).max(80),
  config_json: z.record(z.unknown()),
  // Brief 70.1 — renames ride the patch (they used to silently drop).
  display_name: z.string().min(1).max(200).optional(),
});
export type StageConfigPatch = z.infer<typeof stageConfigPatchSchema>;

export const patchDraftRequestSchema = z.object({
  stage_patches: z.array(stageConfigPatchSchema).min(1),
  note: z.string().max(500).nullable().optional(),
});
export type PatchDraftRequest = z.infer<typeof patchDraftRequestSchema>;

export const patchDraftResponseSchema = z.object({
  draft_plan_id: z.string(),
  patched_stage_count: z.number().int(),
  plan: planDetailSchema,
});
export type PatchDraftResponse = z.infer<typeof patchDraftResponseSchema>;

// ---- Remove stage ----

export const removeStageResponseSchema = z.object({
  draft_plan_id: z.string(),
  removed_stage_id: z.string(),
  removed_sequence: z.number().int(),
  plan: planDetailSchema,
});
export type RemoveStageResponse = z.infer<typeof removeStageResponseSchema>;

// ---- Discard (soft delete) + Hard delete ----
//
// Two-stage delete contract (mirrors the backend's plan lifecycle):
//
//   draft   → discard → archived       (DiscardResponse)
//   archived → hard-delete → gone      (HardDeleteResponse)
//
// `discard` is reversible (the row stays, status flips to 'archived'
// and rollback can restore it as the active plan of its LOB+jurisdiction).
// `hard_delete` is not — the row goes, FK-attached children cascade
// out, and only the audit_log keeps a soft-reference trace.

export const discardPlanResponseSchema = z.object({
  discarded_plan_id: z.string(),
  /** Always 'archived' — the backend only ever transitions draft → archived here. */
  new_status: z.string(),
});
export type DiscardPlanResponse = z.infer<typeof discardPlanResponseSchema>;

export const deletePlanResponseSchema = z.object({
  deleted_plan_id: z.string(),
});
export type DeletePlanResponse = z.infer<typeof deletePlanResponseSchema>;

// ---- List filter ----

export const listPlansFilterSchema = z.object({
  lob: z.string().optional(),
  jurisdiction: z.string().length(2).optional(),
  /** "all" widens to draft + proposed + active + archived. */
  status: z
    .union([planStatusSchema, z.literal("all")])
    .default("active")
    .optional(),
});
export type ListPlansFilter = z.infer<typeof listPlansFilterSchema>;
