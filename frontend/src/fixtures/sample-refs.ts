/**
 * Detachment Brief 1 (Phase B) — the bundled ISO BOP sample refs were
 * removed with the fixture cut (§3.2). These exports keep the
 * PlanDetailRoute type positions (`typeof SAMPLE_*[number]`) and its
 * fixture-fallback gates compiling with the fallback DISABLED: the
 * sentinel plan id never matches a real plan, so every gate takes the
 * live-data branch, and the empty arrays are dead branches.
 *
 * TODO(S3): either delete the gates outright in the Phase C/D cleanup
 * or re-point them at the synthetic Meridian seed program.
 */

import type {
  DimensionRefOption,
  DimensionRow,
  FactorTableRefOption,
  FactorTableRow,
} from "@openrater/ui";

/** Never matches a persisted plan — the fixture fallback is retired. */
export const SAMPLE_PLAN_ID = "__sample_plan_retired__";

export const SAMPLE_DIMENSIONS: readonly (DimensionRefOption &
  DimensionRow)[] = Object.freeze([]);

export const SAMPLE_FACTOR_TABLES: readonly (FactorTableRefOption &
  FactorTableRow)[] = Object.freeze([]);
