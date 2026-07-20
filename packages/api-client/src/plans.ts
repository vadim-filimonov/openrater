/**
 * Plans entity client — wraps slice-2 API endpoints with typed
 * function signatures + Zod-validated responses.
 *
 * Endpoints covered today:
 *   - listPlans(filters)       GET    /api/v1/plans
 *   - getPlan(id)              GET    /api/v1/plans/{id}
 *   - createPlan(req)          POST   /api/v1/plans
 *
 * Slice-2 has 22 endpoints total; the rest (fork / patch / promote /
 * audit / signoff / etc.) land here as the Plan Author UI grows. Each
 * gets its own pure function in this file; @openrater/hooks wraps in
 * TanStack Query.
 */

import { z } from "zod";
import { request } from "./fetcher";
import {
  type AddStageRequest,
  type AddStageResponse,
  addStageResponseSchema,
  type CreatePlanRequest,
  createPlanResponseSchema,
  type CreatePlanResponse,
  type DeletePlanResponse,
  deletePlanResponseSchema,
  type DiscardPlanResponse,
  discardPlanResponseSchema,
  type ListPlansFilter,
  type PatchDraftRequest,
  type PatchDraftResponse,
  patchDraftResponseSchema,
  type PlanDetail,
  planDetailSchema,
  type PlanSummary,
  planSummarySchema,
  type RemoveStageResponse,
  removeStageResponseSchema,
} from "./schemas/plans";

export async function listPlans(
  filters: ListPlansFilter = {},
  opts: { signal?: AbortSignal } = {},
): Promise<PlanSummary[]> {
  return request({
    method: "GET",
    path: "/api/v1/plans",
    query: {
      lob: filters.lob,
      jurisdiction: filters.jurisdiction,
      status: filters.status,
    },
    schema: z.array(planSummarySchema),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

export async function getPlan(
  ratingPlanId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PlanDetail> {
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(ratingPlanId)}`,
    schema: planDetailSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

export async function createPlan(
  body: CreatePlanRequest,
): Promise<CreatePlanResponse> {
  return request({
    method: "POST",
    path: "/api/v1/plans",
    body,
    schema: createPlanResponseSchema,
  });
}

export const duplicatePlanResponseSchema = z.object({
  new_plan_id: z.string().min(1),
  source_plan_id: z.string().min(1),
  display_name: z.string().min(1),
  operator_id: z.string().min(1),
});
export type DuplicatePlanResponse = z.infer<typeof duplicatePlanResponseSchema>;

/**
 * Copy a plan (any status) into a fresh, independent draft — ONE
 * server-side transaction carrying the whole substrate (stages + IO,
 * dimensions with class_library_id re-pointed, factor tables + cells,
 * class registry, input mapping, policy tail). Replaces the client-side
 * replay that half-built on failure and dropped the last three (v4 G22).
 */
export async function duplicatePlan(
  ratingPlanId: string,
  body: { new_display_name?: string } = {},
): Promise<DuplicatePlanResponse> {
  return request({
    method: "POST",
    path: `/api/v1/plans/${encodeURIComponent(ratingPlanId)}/duplicate`,
    body,
    schema: duplicatePlanResponseSchema,
  });
}

export async function addStage(
  ratingPlanId: string,
  body: AddStageRequest,
): Promise<AddStageResponse> {
  return request({
    method: "POST",
    path: `/api/v1/drafts/${encodeURIComponent(ratingPlanId)}/stages`,
    body,
    schema: addStageResponseSchema,
  });
}

/**
 * Apply a batch of stage-config patches to a draft. For a single-stage
 * edit, pass a one-element `stage_patches` array — the backend's batch
 * endpoint is intentionally uniform across the 1-N case so callers
 * don't have to branch.
 */
export async function patchStageConfig(
  ratingPlanId: string,
  body: PatchDraftRequest,
): Promise<PatchDraftResponse> {
  return request({
    method: "PATCH",
    path: `/api/v1/drafts/${encodeURIComponent(ratingPlanId)}`,
    body,
    schema: patchDraftResponseSchema,
  });
}

export async function removeStage(
  ratingPlanId: string,
  stageId: string,
): Promise<RemoveStageResponse> {
  return request({
    method: "DELETE",
    path: `/api/v1/drafts/${encodeURIComponent(ratingPlanId)}/stages/${encodeURIComponent(stageId)}`,
    schema: removeStageResponseSchema,
  });
}

/**
 * Soft-delete a draft plan: status flips draft → archived. The row
 * stays; rollback can restore it as the active plan of its
 * LOB+jurisdiction. Use this for "I'm done with this draft for now"
 * intent. Pair with {@link deletePlan} for permanent removal.
 *
 * Server contract: `DELETE /api/v1/drafts/{id}` with optional `note`.
 * 409 `illegal_state_transition` if the plan isn't a draft.
 */
export async function discardPlan(
  ratingPlanId: string,
  opts: { note?: string } = {},
): Promise<DiscardPlanResponse> {
  return request({
    method: "DELETE",
    path: `/api/v1/drafts/${encodeURIComponent(ratingPlanId)}`,
    ...(opts.note !== undefined ? { query: { note: opts.note } } : {}),
    schema: discardPlanResponseSchema,
  });
}

/**
 * Permanently delete an archived plan and all FK-attached children
 * (dimensions, factor tables + cells, stages + I/O, input mappings,
 * snapshots). Audit-log rows survive (FK-less soft reference, migration
 * 012) so compliance queries still work post-deletion.
 *
 * Gated on `status === 'archived'`. The plan lifecycle is:
 *
 *   draft   → discard → archived → delete → gone
 *
 * Drafts and active plans must transition through `archived` first —
 * the server returns 409 `plan_not_archived` otherwise. This is the
 * data-loss prevention rail.
 *
 * Server contract: `DELETE /api/v1/plans/{id}` with optional `note`.
 */
export async function deletePlan(
  ratingPlanId: string,
  opts: { note?: string } = {},
): Promise<DeletePlanResponse> {
  return request({
    method: "DELETE",
    path: `/api/v1/plans/${encodeURIComponent(ratingPlanId)}`,
    ...(opts.note !== undefined ? { query: { note: opts.note } } : {}),
    schema: deletePlanResponseSchema,
  });
}
