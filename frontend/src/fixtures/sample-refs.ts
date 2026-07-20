/**
 * Empty compatibility values for retired sample-only branches in
 * PlanDetailRoute. The sentinel never matches a persisted plan, so runtime
 * data always comes from the plan API. Keep these exports only until those
 * legacy type positions are removed from the route.
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
