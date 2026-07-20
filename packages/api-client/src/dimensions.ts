/**
 * Plan-scoped dimensions client (D6.2 / ADR-0027).
 *
 * Five functions, one per endpoint under
 * `/api/v1/plans/{rating_plan_id}/dimensions`:
 *
 *   - listDimensions(planId)               GET    /
 *   - upsertDimension(planId, body)        POST   /  | PUT /{dim_id}
 *   - deleteDimension(planId, dimId)       DELETE /{dim_id}
 *   - bulkUpsertDimensions(planId, dims)   POST   /bulk
 *
 * `upsertDimension` defaults to PUT (idempotent on `dim_id`) — the
 * server treats POST + PUT identically, so we collapse to one function
 * for clearer call-sites. The bulk endpoint is the one-shot migration
 * path for the legacy `openrater:dimensions:v1:<planId>` localStorage
 * cache.
 */

import { z } from "zod";
import { request } from "./fetcher";
import {
  type BulkUpsertDimensionsRequest,
  type ListDimensionsResponse,
  listDimensionsResponseSchema,
  type PlanDimension,
  planDimensionSchema,
  type UpsertDimensionRequest,
} from "./schemas/dimensions";

function plansBase(ratingPlanId: string): string {
  return `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/dimensions`;
}

export async function listDimensions(
  ratingPlanId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ListDimensionsResponse> {
  return request({
    method: "GET",
    path: plansBase(ratingPlanId),
    schema: listDimensionsResponseSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

/**
 * Upsert a single dimension. Uses PUT under the hood so the call is
 * idempotent on `dim_id` — re-running the same request never duplicates
 * the row.
 */
export async function upsertDimension(
  ratingPlanId: string,
  body: UpsertDimensionRequest,
): Promise<PlanDimension> {
  return request({
    method: "PUT",
    path: `${plansBase(ratingPlanId)}/${encodeURIComponent(body.dim_id)}`,
    body,
    schema: planDimensionSchema,
  });
}

export async function deleteDimension(
  ratingPlanId: string,
  dimId: string,
): Promise<void> {
  // 204 No Content — fetcher returns `schema.parse(undefined)`, so we
  // pass z.void() and ignore the resolved value.
  await request({
    method: "DELETE",
    path: `${plansBase(ratingPlanId)}/${encodeURIComponent(dimId)}`,
    schema: z.void(),
  });
}

/**
 * Replace ALL dims for the plan with the supplied set, atomically.
 * Used by the one-shot localStorage → API migration on first plan open
 * (ADR-0027 §3). Also the seeding path for `/from-template` once D6.4
 * lands.
 */
export async function bulkUpsertDimensions(
  ratingPlanId: string,
  body: BulkUpsertDimensionsRequest,
  opts: { ifMatch?: string } = {},
): Promise<ListDimensionsResponse> {
  return request({
    method: "POST",
    path: `${plansBase(ratingPlanId)}/bulk`,
    body,
    schema: listDimensionsResponseSchema,
    // v4 G14 — precondition the replace-all on the last-seen
    // collection_hash so a second writer's changes 412 instead of
    // being silently clobbered.
    ...(opts.ifMatch !== undefined
      ? { headers: { "If-Match": opts.ifMatch } }
      : {}),
  });
}
