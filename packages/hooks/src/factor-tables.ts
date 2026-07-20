/**
 * Factor tables hooks — TanStack Query wrappers around
 * @openrater/api-client/factor-tables. (D6.3 / ADR-0027.)
 *
 * Query keys live here so cache invalidation has one definition.
 * Mutations invalidate `factorTablesQueryKeys.list(planId)` so the
 * Parametrize canvas + Coverage Chains sections re-render without
 * a hard reload.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkUpsertFactorTables,
  deleteFactorTable,
  listFactorTables,
  upsertFactorTable,
  upsertFactorTableCells,
  type BulkUpsertFactorTablesRequest,
  type ListFactorTablesResponse,
  type PlanFactorTable,
  type UpsertFactorTableCellsRequest,
  type UpsertFactorTableRequest,
} from "@openrater/api-client";

export const factorTablesQueryKeys = {
  all: ["factor-tables"] as const,
  lists: () => [...factorTablesQueryKeys.all, "list"] as const,
  list: (ratingPlanId: string) =>
    [...factorTablesQueryKeys.lists(), ratingPlanId] as const,
};

/**
 * Fetch all factor tables (with cells inlined) for a plan. Returns
 * the full envelope `{ rating_plan_id, factor_tables }` so callers
 * that need both can destructure; most just read `.factor_tables`.
 *
 * Pass `undefined` to disable the query until a real plan id is
 * available.
 */
export function useFactorTablesList(ratingPlanId: string | undefined) {
  return useQuery<ListFactorTablesResponse>({
    queryKey: ratingPlanId
      ? factorTablesQueryKeys.list(ratingPlanId)
      : factorTablesQueryKeys.list("__missing__"),
    queryFn: ({ signal }) => {
      if (!ratingPlanId) {
        throw new Error("useFactorTablesList: ratingPlanId is required");
      }
      return listFactorTables(ratingPlanId, { signal });
    },
    enabled: Boolean(ratingPlanId),
  });
}

/**
 * Upsert a single factor table (metadata + optional cells). PUT under
 * the hood, idempotent on `table_id`. Invalidates the per-plan list.
 */
export function useUpsertFactorTable(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlanFactorTable, Error, UpsertFactorTableRequest>({
    mutationFn: (body) => upsertFactorTable(ratingPlanId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: factorTablesQueryKeys.list(ratingPlanId),
      });
    },
  });
}

/**
 * Replace-all the cell map for one FT. Metadata is untouched.
 * Invalidates the per-plan list so the canvas re-renders the grid.
 */
export function useUpsertFactorTableCells(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    PlanFactorTable,
    Error,
    { tableId: string; body: UpsertFactorTableCellsRequest }
  >({
    mutationFn: ({ tableId, body }) =>
      upsertFactorTableCells(ratingPlanId, tableId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: factorTablesQueryKeys.list(ratingPlanId),
      });
    },
  });
}

/**
 * Delete a factor table (cells cascade). Returns void on success
 * (204). Invalidates the per-plan list.
 */
export function useDeleteFactorTable(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { tableId: string }>({
    mutationFn: ({ tableId }) => deleteFactorTable(ratingPlanId, tableId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: factorTablesQueryKeys.list(ratingPlanId),
      });
    },
  });
}

/**
 * Atomic replace-all. Used by the localStorage → API one-shot
 * migration on first plan open (ADR-0027 §3) and the future
 * `/from-template` endpoint (D6.4). Returns the full materialized
 * list (same shape as `useFactorTablesList`).
 */
export function useBulkUpsertFactorTables(ratingPlanId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    ListFactorTablesResponse,
    Error,
    BulkUpsertFactorTablesRequest & { ifMatch?: string }
  >({
    mutationFn: ({ ifMatch, ...body }) =>
      bulkUpsertFactorTables(
        ratingPlanId,
        body as Parameters<typeof bulkUpsertFactorTables>[1],
        ifMatch !== undefined ? { ifMatch } : {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: factorTablesQueryKeys.list(ratingPlanId),
      });
    },
  });
}
