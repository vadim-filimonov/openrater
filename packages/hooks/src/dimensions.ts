/**
 * Dimensions hooks — TanStack Query wrappers around
 * @openrater/api-client/dimensions. (D6.2 / ADR-0027.)
 *
 * Query keys live here so cache invalidation has one definition.
 * Mutations invalidate `dimensionsQueryKeys.list(planId)` so the table
 * re-renders without a hard reload.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkUpsertDimensions,
  deleteDimension,
  listDimensions,
  upsertDimension,
  type BulkUpsertDimensionsRequest,
  type ListDimensionsResponse,
  type PlanDimension,
  type UpsertDimensionRequest,
} from "@openrater/api-client";

export const dimensionsQueryKeys = {
  all: ["dimensions"] as const,
  lists: () => [...dimensionsQueryKeys.all, "list"] as const,
  list: (ratingPlanId: string) =>
    [...dimensionsQueryKeys.lists(), ratingPlanId] as const,
};

/**
 * Fetch all dimensions for a plan. Returns the full envelope
 * `{ rating_plan_id, dimensions }` so callers that need both can
 * destructure; most just read `.dimensions`.
 *
 * Pass `undefined` to disable the query (e.g. before the plan id is
 * known); the query won't fire until a real id is supplied.
 */
export function useDimensionsList(ratingPlanId: string | undefined) {
  return useQuery<ListDimensionsResponse>({
    queryKey: ratingPlanId
      ? dimensionsQueryKeys.list(ratingPlanId)
      : dimensionsQueryKeys.list("__missing__"),
    queryFn: ({ signal }) => {
      if (!ratingPlanId) {
        throw new Error("useDimensionsList: ratingPlanId is required");
      }
      return listDimensions(ratingPlanId, { signal });
    },
    enabled: Boolean(ratingPlanId),
  });
}

/**
 * Upsert a single dimension. PUT under the hood, idempotent on
 * `dim_id`. Invalidates the per-plan list on success.
 */
export function useUpsertDimension(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlanDimension, Error, UpsertDimensionRequest>({
    mutationFn: (body) => upsertDimension(ratingPlanId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: dimensionsQueryKeys.list(ratingPlanId),
      });
    },
  });
}

/**
 * Delete a dimension by id. Returns void on success (204). Invalidates
 * the per-plan list so the row disappears from the table.
 */
export function useDeleteDimension(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { dimId: string }>({
    mutationFn: ({ dimId }) => deleteDimension(ratingPlanId, dimId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: dimensionsQueryKeys.list(ratingPlanId),
      });
    },
  });
}

/**
 * Atomic replace-all. Used by the localStorage → API one-shot migration
 * on first plan open (ADR-0027 §3). Returns the full materialized list
 * (same shape as `useDimensionsList`).
 */
export function useBulkUpsertDimensions(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    ListDimensionsResponse,
    Error,
    BulkUpsertDimensionsRequest & { ifMatch?: string }
  >({
    mutationFn: ({ ifMatch, ...body }) =>
      bulkUpsertDimensions(
        ratingPlanId,
        body as Parameters<typeof bulkUpsertDimensions>[1],
        ifMatch !== undefined ? { ifMatch } : {},
      ),
    onSuccess: (data) => {
      // Cold-test N10 — seed the cache from the bulk-upsert RESPONSE
      // (the canonical post-write dimensions list) instead of
      // invalidating. `invalidateQueries` refetched the list on EVERY
      // local mutation, so each territory chip-drop fired a POST→GET
      // round-trip + a full re-hydration — the storm that made bulk
      // territory grouping crawl. The response already carries the
      // authoritative state, so there's nothing extra to fetch.
      queryClient.setQueryData(dimensionsQueryKeys.list(ratingPlanId), data);
    },
  });
}
