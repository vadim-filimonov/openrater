/**
 * Zod schemas for the plan-scoped input mapping endpoint group
 * (D6.1 / ADR-0027).
 *
 * The mapping envelope is intentionally opaque at the API layer —
 * the backend stores + returns the JSON verbatim, the frontend's
 * `PlanInputMapping` shape (csv | webhook discriminated union +
 * column_map + optional extras) is the canonical contract. We
 * validate it here as `Record<string, unknown>` so future shape
 * additions on the frontend don't require an api-client release.
 */

import { z } from "zod";

export const inputMappingEnvelopeSchema = z.object({
  rating_plan_id: z.string().min(1).max(80),
  /** The full PlanInputMapping payload; opaque to the API layer. */
  mapping: z.record(z.unknown()),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  content_hash: z.string().max(16).nullable().optional(),
});
export type InputMappingEnvelope = z.infer<typeof inputMappingEnvelopeSchema>;

export const upsertInputMappingRequestSchema = z.object({
  mapping: z.record(z.unknown()),
});
export type UpsertInputMappingRequest = z.infer<
  typeof upsertInputMappingRequestSchema
>;
