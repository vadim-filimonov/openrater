/**
 * Per-plan localStorage cache cleanup (K1.6).
 *
 * Every plan-scoped substrate keeps a localStorage shadow cache for
 * dev-time offline editing — the keys are listed in
 * `PLAN_LOCAL_STORAGE_PREFIXES`. When a plan is HARD-deleted (DELETE
 * /api/v1/plans/{id} via {@link import("@openrater/api-client").deletePlan}),
 * those caches need to go too, otherwise:
 *
 *   1. Stale dim/FT/mapping data shadows whatever the user does next
 *      (a new plan reusing the deleted id would inherit ghosts).
 *   2. The keys accumulate without GC — heavy power users would hit
 *      the ~5MB localStorage ceiling after enough delete cycles.
 *   3. On the next preview boot the cache hydrates with values that
 *      no longer have a backend row to point at, surfacing as either
 *      404s (the runtime gracefully skips) or zombie UI rows.
 *
 * Soft-delete (discard) does NOT call this — the plan still exists
 * server-side, the caches are still meaningful, and a future rollback
 * would expect them. Only the hard-delete path purges.
 */

/**
 * The complete set of localStorage key prefixes that are keyed by
 * rating_plan_id. Each prefix is followed by the bare plan id (no
 * suffix, no trailing slash). Update this list whenever a new
 * plan-scoped substrate adds a localStorage shadow.
 *
 * Audited 2026-05-29 against `rate-lab/frontend/src/routes/`:
 *   · PlanDetailRoute.tsx — DIM, FT, FT_CELLS, INPUTS_MAPPING,
 *     INPUTS_GEO_TRANSFORMER, ANALYTICS_VIEW (L32)
 *   · PlanNewRoute.tsx    — DIMENSIONS, FACTOR_TABLES,
 *     FACTOR_TABLE_CELLS, INPUTS_MAPPING
 *
 * The `plan-lines:v1` shadow was removed in ADR-0033 gate 4 (the
 * multi-LOB-in-one-plan model is retired; cross-product totals live
 * on a Policy per ADR-0034).
 */
export const PLAN_LOCAL_STORAGE_PREFIXES: readonly string[] = [
  "openrater:dimensions:v1:",
  "openrater:factor-tables:v1:",
  "openrater:factor-table-cells:v1:",
  "openrater:inputs-mapping:v1:",
  "openrater:inputs-geo-transformer:v1:",
  // L32 — Analytics workspace SLICE/LEVEL/KPI/METRIC selection.
  "openrater:analytics-view:v1:",
  // Brief 58 Pillar B — autosaved in-progress ParametrizeCanvas draft.
  "openrater:factor-table-draft:v1:",
  // Brief 58 Pillar C — durable input-dictionary bulk-add queue.
  "openrater:input-dict-pending:v1:",
  // Brief 62.4 — the plan's Final-adjustments tail (in-memory authoring,
  // localStorage-backed per Brief 46 D2; persistence is a separate brief).
  "openrater:policy-tail:v1:",
] as const;

/**
 * Remove every cached per-plan localStorage entry for the given plan id.
 *
 * Idempotent — keys that don't exist are silently skipped. Safe to call
 * even if localStorage is unavailable (private mode / SSR / Node):
 * gracefully no-ops rather than throwing, on the principle that a
 * cache-cleanup failure should never block the user-visible delete.
 *
 * @param ratingPlanId — the plan id whose caches to purge. Falsy values
 *   are a no-op (defends against accidental delete-everything calls).
 * @returns the list of keys that were actually removed, for telemetry.
 */
export function purgePlanLocalStorage(
  ratingPlanId: string,
): readonly string[] {
  if (!ratingPlanId) return [];
  if (typeof window === "undefined") return [];

  const storage = safeStorage();
  if (storage === null) return [];

  const removed: string[] = [];
  for (const prefix of PLAN_LOCAL_STORAGE_PREFIXES) {
    const key = `${prefix}${ratingPlanId}`;
    if (storage.getItem(key) !== null) {
      storage.removeItem(key);
      removed.push(key);
    }
  }
  return removed;
}

/**
 * Defensive accessor — Private Browsing in some Safari versions
 * exposes `window.localStorage` but throws on read/write. Wrapping
 * with a probe makes the purge resilient.
 */
function safeStorage(): Storage | null {
  try {
    const probe = "__rater_purge_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
