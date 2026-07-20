/**
 * Inputs mapping hooks — TanStack Query wrappers around
 * @openrater/api-client/inputs-mapping. (D6.1 / ADR-0027.)
 *
 * The mapping is a per-plan singleton — no per-id collection — so
 * the hook surface is just `useInputMapping(planId)` + the upsert
 * + delete mutations. `useInputMapping` returns `null` (not an
 * error) when the plan exists but has no mapping yet; the UI
 * renders the empty DataSourcePicker drawer in that case.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteInputMapping,
  getInputMapping,
  upsertInputMapping,
  type InputMappingEnvelope,
  type UpsertInputMappingRequest,
} from "@openrater/api-client";

export const inputMappingQueryKeys = {
  all: ["inputs-mapping"] as const,
  detail: (ratingPlanId: string) =>
    [...inputMappingQueryKeys.all, ratingPlanId] as const,
};

/**
 * Fetch the plan's input mapping. Returns `null` when the plan has
 * no mapping authored yet (the route's GET endpoint translates the
 * 404 `inputs_mapping_not_found` into `null` so it's not an error
 * state for the UI).
 */
export function useInputMapping(ratingPlanId: string | undefined) {
  return useQuery<InputMappingEnvelope | null>({
    queryKey: ratingPlanId
      ? inputMappingQueryKeys.detail(ratingPlanId)
      : inputMappingQueryKeys.detail("__missing__"),
    queryFn: ({ signal }) => {
      if (!ratingPlanId) {
        throw new Error("useInputMapping: ratingPlanId is required");
      }
      return getInputMapping(ratingPlanId, { signal });
    },
    enabled: Boolean(ratingPlanId),
  });
}

/**
 * Replace the plan's input mapping. Idempotent. Invalidates the
 * per-plan query so consumers re-render with the latest envelope.
 */
export function useUpsertInputMapping(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    InputMappingEnvelope,
    Error,
    UpsertInputMappingRequest & { ifMatch?: string }
  >({
    mutationFn: ({ ifMatch, ...body }) =>
      upsertInputMapping(
        ratingPlanId,
        body as Parameters<typeof upsertInputMapping>[1],
        ifMatch !== undefined ? { ifMatch } : {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: inputMappingQueryKeys.detail(ratingPlanId),
      });
    },
  });
}

/**
 * Clear the plan's input mapping. Idempotent — DELETE on a missing
 * mapping returns 204. Invalidates the per-plan query.
 */
export function useDeleteInputMapping(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => deleteInputMapping(ratingPlanId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: inputMappingQueryKeys.detail(ratingPlanId),
      });
    },
  });
}
