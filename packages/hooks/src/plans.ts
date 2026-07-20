/**
 * Plans hooks — TanStack Query wrappers around @openrater/api-client/plans.
 *
 * Query keys live here so cache invalidation has one definition. After
 * a mutation (createPlan), `plansQueryKeys.list()` invalidates so the
 * list view re-fetches and the new plan appears without a hard reload.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addStage,
  createPlan,
  deletePlan,
  discardPlan,
  getPlan,
  listPlans,
  patchStageConfig,
  removeStage,
  type AddStageRequest,
  type AddStageResponse,
  type CreatePlanRequest,
  type CreatePlanResponse,
  type DeletePlanResponse,
  type DiscardPlanResponse,
  type ListPlansFilter,
  type PatchDraftRequest,
  type PatchDraftResponse,
  type PlanDetail,
  type PlanSummary,
  type RemoveStageResponse,
} from "@openrater/api-client";

export const plansQueryKeys = {
  all: ["plans"] as const,
  lists: () => [...plansQueryKeys.all, "list"] as const,
  list: (filter: ListPlansFilter) =>
    [...plansQueryKeys.lists(), filter] as const,
  details: () => [...plansQueryKeys.all, "detail"] as const,
  detail: (id: string) => [...plansQueryKeys.details(), id] as const,
};

export function usePlansList(filter: ListPlansFilter = { status: "all" }) {
  return useQuery<PlanSummary[]>({
    queryKey: plansQueryKeys.list(filter),
    queryFn: ({ signal }) => listPlans(filter, { signal }),
  });
}

export function usePlanDetail(ratingPlanId: string | undefined) {
  return useQuery<PlanDetail>({
    queryKey: ratingPlanId
      ? plansQueryKeys.detail(ratingPlanId)
      : plansQueryKeys.detail("__missing__"),
    queryFn: ({ signal }) => {
      if (!ratingPlanId) {
        throw new Error("usePlanDetail: ratingPlanId is required");
      }
      return getPlan(ratingPlanId, { signal });
    },
    enabled: Boolean(ratingPlanId),
  });
}

export interface UseCreatePlanResult {
  data: CreatePlanResponse;
}

export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation<CreatePlanResponse, Error, CreatePlanRequest>({
    mutationFn: (body) => createPlan(body),
    // Brief 58 — PlanNewRoute renders its own top-of-form error banner;
    // opt out of the global surface so a failure shows once, in place.
    meta: { localErrorSurface: true },
    onSuccess: () => {
      // Refetch every plan list (any filter combination) so the new
      // plan appears wherever a list is mounted.
      queryClient.invalidateQueries({ queryKey: plansQueryKeys.lists() });
    },
  });
}

/**
 * Adds a stage to a draft plan. Invalidates the plan-detail query so
 * the spine re-renders with the new stage chip after success.
 */
export function useAddStage(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<AddStageResponse, Error, AddStageRequest>({
    mutationFn: (body) => addStage(ratingPlanId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: plansQueryKeys.detail(ratingPlanId),
      });
    },
  });
}

/**
 * Patch one or more stage configs on a draft plan. The backend's
 * endpoint is batch-shaped; callers editing a single stage pass a
 * one-element `stage_patches` array.
 */
export function usePatchStageConfig(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<PatchDraftResponse, Error, PatchDraftRequest>({
    mutationFn: (body) => patchStageConfig(ratingPlanId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: plansQueryKeys.detail(ratingPlanId),
      });
    },
  });
}

/**
 * Remove a single stage from a draft plan. May return 409 if the stage
 * has downstream consumers; the caller surfaces the message verbatim.
 */
export function useRemoveStage(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<RemoveStageResponse, Error, { stageId: string }>({
    mutationFn: ({ stageId }) => removeStage(ratingPlanId, stageId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: plansQueryKeys.detail(ratingPlanId),
      });
    },
  });
}

/**
 * Soft-delete a draft plan (DELETE /api/v1/drafts/{id}). The row stays
 * — its status flips to 'archived' so rollback can later restore it as
 * the active plan of its LOB+jurisdiction. After success we invalidate
 * BOTH the list queries (so the archived row drops out of the default
 * "show actives" view) and the detail query for that plan (so the
 * status reads back as 'archived' on a re-mount).
 *
 * The hook is parameterized by the plan id at mutation-call time, not
 * at hook-bind time — the same hook instance can discard any plan
 * passed via `mutate({ planId, note? })`. Keeps PlansListRoute's
 * kebab-menu wiring single-instance instead of one-hook-per-row.
 */
export function useDiscardPlan() {
  const queryClient = useQueryClient();
  return useMutation<
    DiscardPlanResponse,
    Error,
    { planId: string; note?: string }
  >({
    mutationFn: ({ planId, note }) =>
      discardPlan(planId, note !== undefined ? { note } : {}),
    // Brief 58 — the delete/discard dialog surfaces its own inline error
    // (PlansListRoute `setDeleteError`); opt out of the global surface.
    meta: { localErrorSurface: true },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: plansQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: plansQueryKeys.detail(variables.planId),
      });
    },
  });
}

/**
 * Permanently delete an archived plan (DELETE /api/v1/plans/{id}). The
 * row + all FK-attached children (dimensions, factor tables, stages,
 * input mappings, snapshots) go via CASCADE. Audit-log rows survive
 * (soft reference, migration 012) so compliance queries still work.
 *
 * 409 `plan_not_archived` if the plan isn't already in 'archived'
 * status — the data-loss prevention rail. Drafts must be discarded
 * first.
 *
 * After success we invalidate the list query (the row is gone) and
 * REMOVE the per-plan detail cache entry (any background subscriber
 * pointing at it would 404 anyway). The list invalidate also catches
 * any "show archived" toggle the consumer might have open.
 */
export function useDeletePlan() {
  const queryClient = useQueryClient();
  return useMutation<
    DeletePlanResponse,
    Error,
    { planId: string; note?: string }
  >({
    mutationFn: ({ planId, note }) =>
      deletePlan(planId, note !== undefined ? { note } : {}),
    // Brief 58 — same dialog surfaces its own inline error; opt out.
    meta: { localErrorSurface: true },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: plansQueryKeys.lists() });
      queryClient.removeQueries({
        queryKey: plansQueryKeys.detail(variables.planId),
      });
    },
  });
}
