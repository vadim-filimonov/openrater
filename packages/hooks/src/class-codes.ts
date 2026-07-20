/**
 * Class-codes hooks — TanStack Query wrappers around
 * @openrater/api-client/class-codes.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkImportPlanClassCodes,
  deletePlanClassCode,
  listClassCodes,
  listPlanClassCodes,
  upsertPlanClassCode,
  type BulkImportClassCodesRequest,
  type BulkImportClassCodesResponse,
  type ClassRecord,
  type ListClassCodesResponse,
  type ListClassesFilter,
  type PlanClassCode,
  type UpsertClassCodeRequest,
} from "@openrater/api-client";

export const classCodesQueryKeys = {
  all: ["class-codes"] as const,
  lists: () => [...classCodesQueryKeys.all, "list"] as const,
  list: (filter: ListClassesFilter) =>
    [...classCodesQueryKeys.lists(), filter] as const,
};

/**
 * Fetch the class library, optionally scoped by filter.
 *
 * Returns the full ClassRecord[] — the consumer (ClassificationRoute,
 * ClassPicker, etc.) does further filter / sort on the client side.
 * Server-side pagination lands when the catalog grows beyond ~1k rows.
 */
export function useClassCodes(filter: ListClassesFilter = {}) {
  return useQuery<ClassRecord[]>({
    queryKey: classCodesQueryKeys.list(filter),
    queryFn: ({ signal }) => listClassCodes(filter, { signal }),
    // Class library is essentially static — cache aggressively.
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// ---------------------------------------------------------------------------
// Brief 51 — per-plan writable registry hooks (real backend, no fixture).
// ---------------------------------------------------------------------------

export const planClassCodesQueryKeys = {
  all: (planId: string) => ["plan-class-codes", planId] as const,
  list: (planId: string) =>
    [...planClassCodesQueryKeys.all(planId), "list"] as const,
};

/** List the plan's class registry. Disabled until a planId is known. */
export function usePlanClassCodes(planId: string | undefined) {
  return useQuery<ListClassCodesResponse>({
    queryKey: planClassCodesQueryKeys.list(planId ?? ""),
    queryFn: ({ signal }) => listPlanClassCodes(planId as string, { signal }),
    enabled: Boolean(planId),
    staleTime: 30 * 1000,
  });
}

/** Create / edit one class. Invalidates the plan's registry list. */
export function useUpsertClassCode(planId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlanClassCode, Error, UpsertClassCodeRequest>({
    mutationFn: (body) => upsertPlanClassCode(planId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: planClassCodesQueryKeys.list(planId),
      });
    },
  });
}

/** Delete one class by code. Invalidates the plan's registry list. */
export function useDeleteClassCode(planId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (classCode) => deletePlanClassCode(planId, classCode),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: planClassCodesQueryKeys.list(planId),
      });
    },
  });
}

/** Bulk-import a class table (merge | replace). Invalidates the list. */
export function useBulkImportClassCodes(planId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    BulkImportClassCodesResponse,
    Error,
    BulkImportClassCodesRequest
  >({
    mutationFn: (body) => bulkImportPlanClassCodes(planId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: planClassCodesQueryKeys.list(planId),
      });
    },
  });
}
