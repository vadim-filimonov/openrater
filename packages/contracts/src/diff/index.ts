/**
 * Diff library barrel — Brief 12 (Comparison primitive).
 *
 * Pure deterministic diff functions + data shapes. Same inputs →
 * byte-identical output (verified by tests). Consumers in
 * `@openrater/ui` render the resulting trees via `<PlanCompareView>`.
 */

export { diffPlans, diffValue } from "./diff-plans";
export { diffTraces } from "./diff-traces";
export { diffRuns } from "./diff-runs";
export {
  canonicalNodes,
  canonicalEdges,
  edgeKey,
  canonicalObjectKeys,
  unionKeys,
  unionIds,
  nodesById,
  PLAN_TOP_KEYS,
} from "./canonical";
export type {
  DiffState,
  DiffNode,
  DiffSummary,
  DiffSide,
  DiffDeeplink,
  RateImpact,
  PlanDiff,
  TraceDiff,
  RunDiff,
} from "./types";
