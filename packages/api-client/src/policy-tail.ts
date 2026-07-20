/**
 * Plan-scoped policy-tail client (ADR-0055 Option A).
 *
 * Three functions, one per endpoint under
 * `/api/v1/plans/{rating_plan_id}/policy-tail`:
 *
 *   - getPolicyTail(planId)             GET    /
 *   - upsertPolicyTail(planId, body)    PUT    /
 *   - deletePolicyTail(planId)          DELETE /
 *
 * `getPolicyTail` returns `null` when the backend responds with 404
 * `policy_tail_not_found` — the "no tail authored yet" state, not an
 * error. All other failures propagate as `RaterApiError` (including
 * the 409 a non-DRAFT plan's PUT/DELETE raises via
 * `assert_plan_writable`).
 */

import { z } from "zod";
import { RaterApiError } from "./error";
import { request } from "./fetcher";
import {
  type PolicyTailEnvelope,
  policyTailEnvelopeSchema,
  type UpsertPolicyTailRequest,
} from "./schemas/policy-tail";

function plansBase(ratingPlanId: string): string {
  return `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/policy-tail`;
}

/**
 * Fetch the plan's policy tail. Returns null when the plan exists but
 * no tail has been authored yet (404 `policy_tail_not_found`). Throws
 * for any other error, including `plan_not_found`.
 */
export async function getPolicyTail(
  ratingPlanId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PolicyTailEnvelope | null> {
  try {
    return await request({
      method: "GET",
      path: plansBase(ratingPlanId),
      schema: policyTailEnvelopeSchema,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (err instanceof RaterApiError && err.code === "policy_tail_not_found") {
      return null;
    }
    throw err;
  }
}

export async function upsertPolicyTail(
  ratingPlanId: string,
  body: UpsertPolicyTailRequest,
  opts: { ifMatch?: string } = {},
): Promise<PolicyTailEnvelope> {
  return request({
    method: "PUT",
    path: plansBase(ratingPlanId),
    body,
    // v4 G14 — precondition on the last-seen content_hash.
    ...(opts.ifMatch !== undefined
      ? { headers: { "If-Match": opts.ifMatch } }
      : {}),
    schema: policyTailEnvelopeSchema,
  });
}

export async function deletePolicyTail(ratingPlanId: string): Promise<void> {
  await request({
    method: "DELETE",
    path: plansBase(ratingPlanId),
    schema: z.void(),
  });
}
