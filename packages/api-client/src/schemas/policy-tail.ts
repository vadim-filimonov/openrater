/**
 * Zod schemas for the plan-scoped policy-tail endpoint group
 * (ADR-0055 Option A).
 *
 * The tail is intentionally opaque at the API layer — the backend
 * stores + returns the ordered JSON array verbatim; the frontend's
 * `PolicyAdjustment` discriminated union (contracts) is the canonical
 * per-item contract, enforced with `isPolicyAdjustment` at the
 * consumption site. Validating items as `Record<string, unknown>`
 * here means future adjustment kinds don't require an api-client
 * release (same convention as the input-mapping envelope).
 */

import { z } from "zod";

export const policyTailEnvelopeSchema = z.object({
  rating_plan_id: z.string().min(1).max(80),
  /** The full ordered PolicyAdjustment[]; opaque to the API layer. */
  tail: z.array(z.record(z.unknown())),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  content_hash: z.string().max(16).nullable().optional(),
});
export type PolicyTailEnvelope = z.infer<typeof policyTailEnvelopeSchema>;

export const upsertPolicyTailRequestSchema = z.object({
  tail: z.array(z.record(z.unknown())),
});
export type UpsertPolicyTailRequest = z.infer<
  typeof upsertPolicyTailRequestSchema
>;
