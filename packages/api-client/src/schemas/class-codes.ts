/**
 * Zod schemas for the `GET /api/v1/class-codes` endpoint.
 *
 * Mirrors the `ClassRecord` + `ListClassesFilter` shapes from
 * `@openrater/contracts`. The schema is the wire-validation gate: if the
 * backend returns a row that fails this schema, the client throws
 * `schema_mismatch` (per the standard fetcher error envelope) so the
 * problem surfaces immediately instead of silently corrupting state.
 *
 * Slice 3 of the API Lab port adds the matching backend endpoint
 * (per `docs/API_LAB_SCOPING_M3_4.md`). Until then, consumers use
 * fixture mode (`@openrater/api-client` setFixture) to satisfy the
 * `listClassCodes()` call.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Sub-shapes (kept local — line code + exposure shapes mirror @openrater/contracts)
// ---------------------------------------------------------------------------

const exposureBaseCodeSchema = z.enum([
  "sales",
  "payroll",
  "area",
  "receipts",
  "units",
  "other",
]);

const exposureBaseDeclarationSchema = z.object({
  code: exposureBaseCodeSchema,
  custom_label: z.string().optional(),
  coverage_tags: z.array(z.string()).optional(),
  citation: z.string().optional(),
});

// ---------------------------------------------------------------------------
// ClassRecord
// ---------------------------------------------------------------------------

export const classRecordSchema = z.object({
  class_code: z.string().min(1),
  display_name: z.string().min(1),
  family: z.string().min(1),
  description: z.string().optional(),
  naics_code: z.string().optional(),
  // Brief 21 crosswalk target; not used by the engine.
  sic_code: z.string().optional(),
  // Opaque product/coverage tags (ADR-0033 §0 — re-keyed off the closed
  // LineCode vocabulary; validated as plain strings, never branched on).
  eligible_for: z.array(z.string()),
  exposure_bases: z.array(exposureBaseDeclarationSchema),
  // Brief 51 / ADR-0035 — derived rating attributes (opaque string keys).
  attributes: z.record(z.string(), z.string()).optional(),
  // Brief 8 Q3 — provenance badge.
  source: z.enum(["iso", "custom"]).optional(),
  citation_rule: z.string().optional(),
  citation_page: z.string().optional(),
  note: z.string().optional(),
});

export type ClassRecord = z.infer<typeof classRecordSchema>;

export const listClassesFilterSchema = z.object({
  q: z.string().optional(),
  family: z.string().optional(),
  eligible_for: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().min(0).optional(),
});

export type ListClassesFilter = z.infer<typeof listClassesFilterSchema>;

// ---------------------------------------------------------------------------
// Brief 51 — the per-plan writable registry (plan-scoped endpoints).
//
// `PlanClassCode` is the wire shape from
// `/api/v1/plans/{id}/class-codes` (adds rating_plan_id + timestamps +
// content_hash on top of ClassRecord). `UpsertClassCodeRequest` is the
// write body. Mirrors api-lab/backend rates/class_codes/models.py.
// ---------------------------------------------------------------------------

export const planClassCodeSchema = z.object({
  rating_plan_id: z.string().min(1),
  class_code: z.string().min(1),
  display_name: z.string().min(1),
  family: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  naics_code: z.string().nullable().optional(),
  sic_code: z.string().nullable().optional(),
  eligible_for: z.array(z.string()),
  exposure_bases: z.array(exposureBaseDeclarationSchema),
  attributes: z.record(z.string(), z.string()),
  source: z.enum(["iso", "custom"]),
  note: z.string().nullable().optional(),
  citation_rule: z.string().nullable().optional(),
  citation_page: z.string().nullable().optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  content_hash: z.string().nullable().optional(),
});
export type PlanClassCode = z.infer<typeof planClassCodeSchema>;

export const upsertClassCodeRequestSchema = z.object({
  class_code: z.string().min(1).max(40),
  display_name: z.string().min(1).max(200),
  family: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  naics_code: z.string().nullable().optional(),
  sic_code: z.string().nullable().optional(),
  eligible_for: z.array(z.string()).default([]),
  exposure_bases: z.array(exposureBaseDeclarationSchema).default([]),
  attributes: z.record(z.string(), z.string()).default({}),
  source: z.enum(["iso", "custom"]).default("custom"),
  note: z.string().nullable().optional(),
  citation_rule: z.string().nullable().optional(),
  citation_page: z.string().nullable().optional(),
});
export type UpsertClassCodeRequest = z.infer<
  typeof upsertClassCodeRequestSchema
>;

export const listClassCodesResponseSchema = z.object({
  rating_plan_id: z.string(),
  class_codes: z.array(planClassCodeSchema),
});
export type ListClassCodesResponse = z.infer<
  typeof listClassCodesResponseSchema
>;

export const bulkImportClassCodesRequestSchema = z.object({
  classes: z.array(upsertClassCodeRequestSchema),
  mode: z.enum(["merge", "replace"]).default("merge"),
});
export type BulkImportClassCodesRequest = z.infer<
  typeof bulkImportClassCodesRequestSchema
>;

export const bulkImportClassCodesResponseSchema = z.object({
  rating_plan_id: z.string(),
  imported: z.number().int(),
  mode: z.enum(["merge", "replace"]),
  class_codes: z.array(planClassCodeSchema),
});
export type BulkImportClassCodesResponse = z.infer<
  typeof bulkImportClassCodesResponseSchema
>;
