/**
 * Plan-scoped input mapping client (D6.1 / ADR-0027).
 *
 * Three functions, one per endpoint under
 * `/api/v1/plans/{rating_plan_id}/inputs-mapping`:
 *
 *   - getInputMapping(planId)             GET    /
 *   - upsertInputMapping(planId, body)    PUT    /
 *   - deleteInputMapping(planId)          DELETE /
 *
 * `getInputMapping` returns `null` when the backend responds with
 * 404 `inputs_mapping_not_found` — this is the "first open" state,
 * not an error. All other failures propagate as `RaterApiError`.
 */

import { z } from "zod";
import { RaterApiError } from "./error";
import { request } from "./fetcher";
import {
  type InputMappingEnvelope,
  inputMappingEnvelopeSchema,
  type UpsertInputMappingRequest,
} from "./schemas/inputs-mapping";

function plansBase(ratingPlanId: string): string {
  return `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/inputs-mapping`;
}

/**
 * Fetch the plan's input mapping. Returns null when the plan exists
 * but no mapping has been authored yet (404 `inputs_mapping_not_found`).
 * Throws for any other error, including `plan_not_found`.
 */
export async function getInputMapping(
  ratingPlanId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<InputMappingEnvelope | null> {
  try {
    return await request({
      method: "GET",
      path: plansBase(ratingPlanId),
      schema: inputMappingEnvelopeSchema,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (
      err instanceof RaterApiError &&
      err.code === "inputs_mapping_not_found"
    ) {
      return null;
    }
    throw err;
  }
}

export async function upsertInputMapping(
  ratingPlanId: string,
  body: UpsertInputMappingRequest,
  opts: { ifMatch?: string } = {},
): Promise<InputMappingEnvelope> {
  return request({
    method: "PUT",
    path: plansBase(ratingPlanId),
    body,
    // v4 G14 — precondition on the last-seen content_hash.
    ...(opts.ifMatch !== undefined
      ? { headers: { "If-Match": opts.ifMatch } }
      : {}),
    schema: inputMappingEnvelopeSchema,
  });
}

export async function deleteInputMapping(
  ratingPlanId: string,
): Promise<void> {
  await request({
    method: "DELETE",
    path: plansBase(ratingPlanId),
    schema: z.void(),
  });
}
