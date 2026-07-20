/**
 * useDurableInputDeclarations — Brief 58 Pillar C.
 *
 * Makes the input-dictionary bulk-add ("Quick-add Sample BOP (28)" /
 * Seed-from-CSV / Paste-JSON) durable. The PASS-2 walkthrough lost all
 * 28 inputs when the actuary navigated away immediately after quick-add:
 * the sequential `addStage` loop lived inside the Inputs workspace
 * component, which unmounts on a tab switch, so the loop was orphaned
 * mid-flight and nothing recovered it.
 *
 * The fix has two parts:
 *   1. A localStorage queue (`@openrater/ui` pendingQueue) holds the
 *      intended declarations BEFORE the saves run — reload/crash-safe.
 *   2. THIS hook drives the drain. Call it from the STABLE
 *      PlanDetailContent level (which does NOT unmount on tab switch), so
 *      the saves complete in the background even after the actuary
 *      navigates away. A residual queue resumes on mount.
 *
 * A failed save stops the drain and leaves the remainder queued; the
 * global save-failure surface (Pillar A — `useAddStage` has no
 * `meta.localErrorSurface`) shows it, and the next enqueue / mount
 * resumes. `pendingCount` drives the "Declaring N…" busy state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { plansQueryKeys, useAddStage } from "@openrater/hooks";
import {
  drainPendingDeclarations,
  enqueuePendingDeclarations,
  peekPendingDeclarations,
  type InputDictEntry,
} from "@openrater/ui";
import { entryToAddStageRequest } from "./inputDictStages";

export interface InputDeclarationsApi {
  /**
   * Durably declare inputs. Pre-filter against the plan's already-declared
   * inputs at the call site; this dedupes within the queue. Returns how
   * many were freshly queued. The saves run + resume in the background.
   */
  readonly enqueue: (entries: readonly InputDictEntry[]) => number;
  /** Declarations still saving — drives the "Declaring N…" indicator. */
  readonly pendingCount: number;
}

export function useDurableInputDeclarations(
  planId: string,
): InputDeclarationsApi {
  const addStage = useAddStage(planId);
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(
    () => peekPendingDeclarations(planId).length,
  );
  // Guard against overlapping drains (a second enqueue while one runs).
  const drainingRef = useRef(false);
  // Latest mutation instance in a ref so `drain` stays stable (it must
  // not re-fire the resume effect every render).
  const addStageRef = useRef(addStage);
  addStageRef.current = addStage;

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      setPendingCount(peekPendingDeclarations(planId).length);
      await drainPendingDeclarations(
        planId,
        (entry) =>
          addStageRef.current
            .mutateAsync(entryToAddStageRequest(entry, "$last"))
            .then(() => undefined),
        (remaining) => setPendingCount(remaining),
      );
    } finally {
      drainingRef.current = false;
      const remaining = peekPendingDeclarations(planId).length;
      setPendingCount(remaining);
      // F16 — the per-item `useAddStage` invalidations fire mid-drain and
      // race/cancel one another during a rapid bulk declare, so the
      // plan-detail cache can settle stale: the Gate field-picker (which
      // reads `plan.stages`) then misses the just-declared inputs until a
      // manual reload. One explicit invalidation once the batch has fully
      // drained guarantees a single clean refetch of the settled stage set
      // for every consumer (Gate field-picker, CSV mapper, Assemble rail).
      if (remaining === 0) {
        void queryClient.invalidateQueries({
          queryKey: plansQueryKeys.detail(planId),
        });
      }
    }
  }, [planId, queryClient]);

  // Resume any residual queue on mount / plan change (reload/crash-safe).
  useEffect(() => {
    void drain();
  }, [drain]);

  const enqueue = useCallback(
    (entries: readonly InputDictEntry[]): number => {
      const added = enqueuePendingDeclarations(planId, entries);
      setPendingCount(peekPendingDeclarations(planId).length);
      void drain();
      return added.length;
    },
    [planId, drain],
  );

  return useMemo<InputDeclarationsApi>(
    () => ({ enqueue, pendingCount }),
    [enqueue, pendingCount],
  );
}
