/**
 * policyBookConfig — re-export shim (P2 G4, ADR-0056).
 *
 * The pure extraction moved to `@openrater/ui` so the scoring service
 * composes the FILED premium through the SAME code path the browser
 * uses (Law 1). Every rate-lab import keeps working through this shim;
 * new call sites may import from `@openrater/ui` directly.
 */

export {
  policyBookConfigFromPlan,
  policyAggregateFields,
  keyedRowsFromBook,
  planMinimumPremium,
  appendPlanFloor,
  PLAN_MIN_PREMIUM_STEP_ID,
  POLICY_LOCATION_COUNT,
  type AuthoredRollupField,
  type AuthoredGrouping,
} from "@openrater/ui";
