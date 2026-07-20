/**
 * Policy-tail hooks — TanStack Query wrappers around
 * @openrater/api-client/policy-tail. (ADR-0055 Option A.)
 *
 * The tail is a per-plan singleton — no per-id collection — so the
 * hook surface is `usePolicyTailEnvelope(planId)` + the upsert +
 * delete mutations. The query returns `null` (not an error) when the
 * plan exists but has no tail authored yet; the rate-lab store hook
 * (`usePolicyTailSynced`) reconciles that state against the legacy
 * localStorage cache and runs the one-shot migration.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deletePolicyTail,
  getPolicyTail,
  upsertPolicyTail,
  type PolicyTailEnvelope,
  type UpsertPolicyTailRequest,
} from "@openrater/api-client";

export const policyTailQueryKeys = {
  all: ["policy-tail"] as const,
  detail: (ratingPlanId: string) =>
    [...policyTailQueryKeys.all, ratingPlanId] as const,
};

/**
 * Fetch the plan's policy tail. Returns `null` when the plan has no
 * tail authored yet (the GET endpoint's 404 `policy_tail_not_found`
 * is translated into `null` so it's not an error state for the UI).
 */
export function usePolicyTailEnvelope(ratingPlanId: string | undefined) {
  return useQuery<PolicyTailEnvelope | null>({
    queryKey: ratingPlanId
      ? policyTailQueryKeys.detail(ratingPlanId)
      : policyTailQueryKeys.detail("__missing__"),
    queryFn: ({ signal }) => {
      if (!ratingPlanId) {
        throw new Error("usePolicyTailEnvelope: ratingPlanId is required");
      }
      return getPolicyTail(ratingPlanId, { signal });
    },
    enabled: Boolean(ratingPlanId),
  });
}

/**
 * Replace the plan's policy tail. Idempotent. Invalidates the
 * per-plan query so consumers re-render with the latest envelope.
 * A non-DRAFT plan's PUT is a 409 (`assert_plan_writable`) — callers
 * gate on writability before mutating.
 */
export function useUpsertPolicyTail(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<PolicyTailEnvelope, Error, UpsertPolicyTailRequest & { ifMatch?: string }>({
    mutationFn: ({ ifMatch, ...body }) =>
      upsertPolicyTail(
        ratingPlanId,
        body as Parameters<typeof upsertPolicyTail>[1],
        ifMatch !== undefined ? { ifMatch } : {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: policyTailQueryKeys.detail(ratingPlanId),
      });
    },
  });
}

/**
 * Clear the plan's policy tail. Idempotent — DELETE on a missing tail
 * returns 204. Invalidates the per-plan query.
 */
export function useDeletePolicyTail(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => deletePolicyTail(ratingPlanId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: policyTailQueryKeys.detail(ratingPlanId),
      });
    },
  });
}
