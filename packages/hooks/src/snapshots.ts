/**
 * Plan snapshots hooks — TanStack Query wrappers around
 * @openrater/api-client/snapshots. (Brief 43 / PR 43.1.)
 *
 * The Analytics workspace uses these three hooks:
 *
 *   useSnapshotsList(planId)   — picker on the toolbar (newest-first)
 *   useSnapshotDetail(...)      — fetch body for re-rating
 *   useFreezeSnapshot(planId)  — "Freeze version" dialog on plan header
 *
 * Snapshots are append-only — there's no useUpdateSnapshot /
 * useDeleteSnapshot. Cache strategy is single source of truth: the
 * mutation invalidates the list on success so any mounted picker
 * picks the new snapshot up automatically.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  freezeSnapshot,
  getSnapshot,
  listSnapshots,
  type FreezeSnapshotRequest,
  type ListSnapshotsResponse,
  type PlanSnapshot,
} from "@openrater/api-client";

export const snapshotsQueryKeys = {
  all: ["plan-snapshots"] as const,
  list: (planId: string) =>
    [...snapshotsQueryKeys.all, planId, "list"] as const,
  detail: (planId: string, snapshotId: string) =>
    [...snapshotsQueryKeys.all, planId, snapshotId] as const,
};

/**
 * List every snapshot for a plan, newest first. Returns an empty
 * `{snapshots: []}` for plans that exist but have nothing frozen yet
 * — the picker treats this as a first-class empty state rather than
 * an error.
 */
export function useSnapshotsList(planId: string | undefined) {
  return useQuery<ListSnapshotsResponse>({
    queryKey: planId
      ? snapshotsQueryKeys.list(planId)
      : snapshotsQueryKeys.list("__missing__"),
    queryFn: ({ signal }) => {
      if (!planId) {
        throw new Error("useSnapshotsList: planId is required");
      }
      return listSnapshots(planId, { signal });
    },
    enabled: Boolean(planId),
  });
}

/**
 * Fetch one snapshot including the self-contained body for re-rating.
 * Returns 404 (via RaterApiError) if the snapshot doesn't exist OR
 * belongs to a different plan.
 */
export function useSnapshotDetail(
  planId: string | undefined,
  snapshotId: string | undefined,
) {
  return useQuery<PlanSnapshot>({
    queryKey:
      planId && snapshotId
        ? snapshotsQueryKeys.detail(planId, snapshotId)
        : snapshotsQueryKeys.detail("__missing__", "__missing__"),
    queryFn: ({ signal }) => {
      if (!planId || !snapshotId) {
        throw new Error(
          "useSnapshotDetail: planId + snapshotId are required",
        );
      }
      return getSnapshot(planId, snapshotId, { signal });
    },
    enabled: Boolean(planId && snapshotId),
  });
}

/**
 * Freeze the current draft state. On success invalidates the list
 * query so any mounted picker shows the new snapshot without a
 * manual refetch. The 409 collision case bubbles up unchanged so the
 * dialog can surface it inline.
 */
export function useFreezeSnapshot(planId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlanSnapshot, Error, FreezeSnapshotRequest>({
    mutationFn: (body) => freezeSnapshot(planId, body),
    // Brief 58 — the freeze dialog surfaces the 409 inline + other
    // errors in its own banner; opt out of the global surface.
    meta: { localErrorSurface: true },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: snapshotsQueryKeys.list(planId),
      });
    },
  });
}
