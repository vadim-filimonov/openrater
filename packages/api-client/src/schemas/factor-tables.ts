/**
 * Zod schemas for the plan-scoped factor tables endpoint group (D6.3 /
 * ADR-0027).
 *
 * Mirrors the Pydantic models in
 * server/src/openrater/rates/factor_tables/models.py. Cells are inlined on the parent
 * factor table as `cells: Record<string, number>` — the storage layer
 * splits them into a sidecar table, but the API contract hides that.
 *
 * If the backend shape changes, this file updates first.
 */

import { z } from "zod";

// ---- Enum ----

export const draftStatusSchema = z.enum([
  "extracted",
  "reviewed",
  "committed",
]);
export type DraftStatus = z.infer<typeof draftStatusSchema>;

// ---- Interpolation (ADR-0063) ----

/**
 * Flags a numeric key axis of a factor table for linear interpolation
 * between adjacent banded levels, instead of the default stepping. The
 * `axis` is the slug of a banded key dimension; the runtime builds
 * breakpoints from that dimension's level `lo` bounds and interpolates
 * the raw numeric input across them, clamped at the ends.
 */
export const factorTableInterpolationSchema = z.object({
  mode: z.literal("linear"),
  axis: z.string().min(1).max(80),
});
export type FactorTableInterpolation = z.infer<
  typeof factorTableInterpolationSchema
>;

// ---- The factor table (storage shape + GET response item) ----

export const planFactorTableSchema = z.object({
  rating_plan_id: z.string().min(1).max(80),
  table_id: z.string().min(1).max(80),
  display_name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80),
  description: z.string().max(2000).nullable().optional(),
  key_dimensions: z.array(z.string()).default([]),
  draft_status: draftStatusSchema.nullable().optional(),
  source_pdf_url: z.string().max(2000).nullable().optional(),
  source_page: z.number().int().min(1).nullable().optional(),
  /** Inline cell map; key encoding is client-side (e.g.
   * "dim_a=lvl_x|dim_b=lvl_y"). */
  cells: z.record(z.number()).default({}),
  /** ADR-0063 — when present, the named banded key axis interpolates
   * linearly at runtime instead of stepping. Null/absent = step (default). */
  interpolation: factorTableInterpolationSchema.nullable().optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  content_hash: z.string().max(16).nullable().optional(),
});
export type PlanFactorTable = z.infer<typeof planFactorTableSchema>;

// ---- Request / response envelopes ----

export const upsertFactorTableRequestSchema = z.object({
  table_id: z.string().min(1).max(80),
  display_name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80),
  description: z.string().max(2000).nullable().optional(),
  key_dimensions: z.array(z.string()).default([]),
  draft_status: draftStatusSchema.nullable().optional(),
  source_pdf_url: z.string().max(2000).nullable().optional(),
  source_page: z.number().int().min(1).nullable().optional(),
  /** `undefined` (or absent) → leave existing cells alone.
   * `{}` → explicitly clear all cells.
   * `{...}` → replace cells with the supplied map. */
  cells: z.record(z.number()).optional(),
  /** ADR-0063 — `undefined`/absent leaves the stored flag untouched;
   * `null` clears it (back to stepping); an object sets linear interp. */
  interpolation: factorTableInterpolationSchema.nullable().optional(),
});
export type UpsertFactorTableRequest = z.infer<
  typeof upsertFactorTableRequestSchema
>;

export const upsertFactorTableCellsRequestSchema = z.object({
  cells: z.record(z.number()),
});
export type UpsertFactorTableCellsRequest = z.infer<
  typeof upsertFactorTableCellsRequestSchema
>;

export const listFactorTablesResponseSchema = z.object({
  rating_plan_id: z.string(),
  factor_tables: z.array(planFactorTableSchema),
  /** v4 G14 — echo back as If-Match on the bulk replace-all. */
  collection_hash: z.string().nullable().optional(),
});
export type ListFactorTablesResponse = z.infer<
  typeof listFactorTablesResponseSchema
>;

export const bulkUpsertFactorTablesRequestSchema = z.object({
  factor_tables: z.array(upsertFactorTableRequestSchema),
});
export type BulkUpsertFactorTablesRequest = z.infer<
  typeof bulkUpsertFactorTablesRequestSchema
>;
