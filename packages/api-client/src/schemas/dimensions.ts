/**
 * Zod schemas for the plan-scoped dimensions endpoint group (D6.2 /
 * ADR-0027).
 *
 * Mirrors the Pydantic models in api-lab/backend's
 * rates/dimensions/models.py. Levels are a polymorphic JSON array;
 * the backend stores + returns verbatim, the frontend discriminates
 * via `kind` per ADR-0026 §1. We type the level array as
 * `Record<string, unknown>[]` so callers narrow at the consumption
 * site (the existing labs-ui `DimensionRow` type is the canonical
 * narrowing target).
 *
 * If the backend shape changes, this file updates first.
 */

import { z } from "zod";

// ---- Enums ----

export const dimDataTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "date",
]);
export type DimDataType = z.infer<typeof dimDataTypeSchema>;

export const dimShapeSchema = z.enum([
  "categorical",
  "banded",
  "geographic",
  "composite",
]);
export type DimShape = z.infer<typeof dimShapeSchema>;

export const dimensionTypeSchema = z.enum([
  "standard",
  "geographic",
  "classification",
]);
export type DimensionType = z.infer<typeof dimensionTypeSchema>;

// ---- Brief 44 — Geographic substrate (PR 44.1) ----

/**
 * Granularity of a geographic dim. Locked at creation per Brief 44 Q1.
 * NULL when `dimension_type !== 'geographic'`.
 */
export const geoGranularitySchema = z.enum(["state", "county", "zip"]);
export type GeoGranularity = z.infer<typeof geoGranularitySchema>;

/**
 * Scope of a geographic dim — either whole-country (`national`) or an
 * explicit subset of states (USPS 2-letter codes). NULL for non-geo dims.
 */
export const geoScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("national") }),
  z.object({
    kind: z.literal("subset"),
    states: z.array(z.string()).min(1),
  }),
]);
export type GeoScope = z.infer<typeof geoScopeSchema>;

/**
 * Brief 44 §3.1 — one named territory grouping members of a geo dim.
 * Empty `members` array is valid (newly created bucket, not yet
 * populated). Members are level ids of the parent geo dim.
 */
export const geoTerritorySchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  members: z.array(z.string()).default([]),
});
export type GeoTerritory = z.infer<typeof geoTerritorySchema>;

// ---- Brief 51 / ADR-0035 — class-derived structural dim marker ----

/**
 * Marks a `structural` dim whose value is DERIVED from a classification
 * dim's class attribute (e.g. `prop_rate_number` from `class_code`).
 * NULL for non-derived dims. The projector inserts a
 * `derive.class_attribute` node from this.
 */
export const derivedFromSchema = z.object({
  source_dim: z.string().min(1).max(80),
  attribute: z.string().min(1).max(80),
  // Brief 83 / TV-19 — optional DECLARED override: the submission field
  // whose non-empty value supersedes the class-derived attribute (ISO
  // BOP's `liab_exposure_basis_override`). Nullable-additive. z.object
  // STRIPS unknown keys on parse, so omitting it here silently clobbered
  // the field on every GET→state→PUT dimension round-trip.
  override_field: z.string().min(1).max(120).nullable().optional(),
});
export type DerivedFrom = z.infer<typeof derivedFromSchema>;

// ---- Brief 66 §3.2 — the last two round-trip gaps (migration 025) ----

/**
 * One proprietary-input → canonical-class mapping rule on a
 * classification dim. Mirrors DimensionRow.classification_mapping.
 */
export const classificationMappingRuleSchema = z.object({
  input_pattern: z.string().min(1).max(200),
  canonical_class_code: z.string().min(1).max(80),
  // The backend echoes unset notes as null (Pydantic model_dump).
  notes: z.string().max(2000).nullable().optional(),
});
export type ClassificationMappingRule = z.infer<
  typeof classificationMappingRuleSchema
>;

// ---- The dimension row (storage shape + GET response item) ----

export const planDimensionSchema = z.object({
  rating_plan_id: z.string().min(1).max(80),
  dim_id: z.string().min(1).max(80),
  display_name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80),
  data_type: dimDataTypeSchema,
  role: z.string().min(1).max(80),
  dimension_type: dimensionTypeSchema.nullable().optional(),
  shape: dimShapeSchema.nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  /** Polymorphic level array. Narrow via `kind` at the consumption site. */
  levels: z.array(z.record(z.unknown())).default([]),
  /** ADR-0025 composite dims only. List of source dim slugs. */
  axes: z.array(z.string()).nullable().optional(),
  source_field: z.string().max(200).nullable().optional(),
  /** Brief 44 — granularity of a geo dim; NULL for non-geo dims. */
  geo_granularity: geoGranularitySchema.nullable().optional(),
  /** Brief 44 — scope (national | subset). NULL for non-geo dims. */
  geo_scope: geoScopeSchema.nullable().optional(),
  /** Brief 44 — territory grouping list. NULL for non-geo dims;
   * empty array means "no grouping, rate the levels directly." */
  geo_territories: z.array(geoTerritorySchema).nullable().optional(),
  /** Brief 51 — class registry a classification dim binds to (per-plan). */
  class_library_id: z.string().max(80).nullable().optional(),
  /** Brief 51 / ADR-0035 — class-derived structural dim marker. */
  derived_from: derivedFromSchema.nullable().optional(),
  /** Brief 66 §3.2 — classification mapping rules; NULL when unused. */
  classification_mapping: z
    .array(classificationMappingRuleSchema)
    .nullable()
    .optional(),
  /** Brief 66 §3.2 — enum dims' valid options; NULL when unused. */
  options: z.array(z.string()).nullable().optional(),
  /** Brief 66 §3.2 — banded factor-direction expectation. */
  monotonicity_expected: z
    .union([z.string(), z.boolean()])
    .nullable()
    .optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  content_hash: z.string().max(16).nullable().optional(),
});
export type PlanDimension = z.infer<typeof planDimensionSchema>;

// ---- Request / response envelopes ----

export const upsertDimensionRequestSchema = z.object({
  dim_id: z.string().min(1).max(80),
  display_name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80),
  data_type: dimDataTypeSchema,
  role: z.string().min(1).max(80),
  dimension_type: dimensionTypeSchema.nullable().optional(),
  shape: dimShapeSchema.nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  levels: z.array(z.record(z.unknown())).default([]),
  axes: z.array(z.string()).nullable().optional(),
  source_field: z.string().max(200).nullable().optional(),
  /** Brief 44 — see PlanDimension comments above. */
  geo_granularity: geoGranularitySchema.nullable().optional(),
  geo_scope: geoScopeSchema.nullable().optional(),
  geo_territories: z.array(geoTerritorySchema).nullable().optional(),
  // Brief 51 / ADR-0035 — classification + class-derived fields.
  class_library_id: z.string().max(80).nullable().optional(),
  derived_from: derivedFromSchema.nullable().optional(),
  // Brief 66 §3.2 — the last two round-trip gaps (migration 025).
  classification_mapping: z
    .array(classificationMappingRuleSchema)
    .nullable()
    .optional(),
  options: z.array(z.string()).nullable().optional(),
  monotonicity_expected: z
    .union([z.string(), z.boolean()])
    .nullable()
    .optional(),
});
export type UpsertDimensionRequest = z.infer<
  typeof upsertDimensionRequestSchema
>;

export const listDimensionsResponseSchema = z.object({
  rating_plan_id: z.string(),
  dimensions: z.array(planDimensionSchema),
  /** v4 G14 — echo back as If-Match on the bulk replace-all. */
  collection_hash: z.string().nullable().optional(),
});
export type ListDimensionsResponse = z.infer<
  typeof listDimensionsResponseSchema
>;

export const bulkUpsertDimensionsRequestSchema = z.object({
  dimensions: z.array(upsertDimensionRequestSchema),
});
export type BulkUpsertDimensionsRequest = z.infer<
  typeof bulkUpsertDimensionsRequestSchema
>;
