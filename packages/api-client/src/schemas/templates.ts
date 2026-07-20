/**
 * Zod schemas for the plan templates endpoint group (D6.4 / ADR-0027).
 *
 * Mirrors the Pydantic models in
 * server/src/openrater/rates/templates/models.py. The recipe is opaque to the API layer —
 * the backend stores + walks it; the client just hands it back on
 * preview / display. Each substrate inside the recipe matches its
 * own typed shape (DimensionUpsertRequest, FactorTableUpsertRequest,
 * PlanInputMapping) but typing the recipe field strictly here would
 * tie templates to those module's specific zod schemas + force a
 * coordinated bump whenever any substrate evolves. Loose typing on
 * `recipe` lets templates stay an orchestration concern.
 */

import { z } from "zod";

export const planTemplateSummarySchema = z.object({
  template_id: z.string().min(1).max(80),
  display_name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  line_of_business: z.string().min(1).max(40),
  coverages: z.array(z.string()).default([]),
  dim_count: z.number().int().nonnegative().default(0),
  factor_table_count: z.number().int().nonnegative().default(0),
  chain_stage_count: z.number().int().nonnegative().default(0),
  has_input_mapping: z.boolean().default(false),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});
export type PlanTemplateSummary = z.infer<typeof planTemplateSummarySchema>;

export const planTemplateSchema = planTemplateSummarySchema.extend({
  recipe: z.record(z.unknown()),
});
export type PlanTemplate = z.infer<typeof planTemplateSchema>;

export const listTemplatesResponseSchema = z.object({
  templates: z.array(planTemplateSummarySchema),
});
export type ListTemplatesResponse = z.infer<
  typeof listTemplatesResponseSchema
>;

// ---- /from-template request + response ----

export const fromTemplateRequestSchema = z.object({
  template_id: z.string().min(1).max(80),
  display_name: z.string().min(1).max(200),
  jurisdiction: z.string().max(4).nullable().optional(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Use YYYY-MM-DD format.",
  }),
  description: z.string().max(2000).nullable().optional(),
});
export type FromTemplateRequest = z.infer<typeof fromTemplateRequestSchema>;

export const materializedCountsSchema = z.object({
  dimensions: z.number().int().nonnegative().default(0),
  factor_tables: z.number().int().nonnegative().default(0),
  chain_stages: z.number().int().nonnegative().default(0),
  has_input_mapping: z.boolean().default(false),
});
export type MaterializedCounts = z.infer<typeof materializedCountsSchema>;

export const fromTemplateResponseSchema = z.object({
  rating_plan_id: z.string(),
  template_id: z.string(),
  materialized: materializedCountsSchema,
});
export type FromTemplateResponse = z.infer<
  typeof fromTemplateResponseSchema
>;
