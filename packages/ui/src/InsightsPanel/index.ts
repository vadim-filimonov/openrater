export { InsightsPanel, INSIGHTS_DEFAULT_LIMIT } from "./InsightsPanel";
export type { InsightsPanelProps } from "./InsightsPanel";
export {
  runInsights,
  generateRange,
  generateMonotonicityBreak,
  generateOutlier,
  generateAllDefault,
  generateDiagonalSmooth,
  generateAllOnSide,
  generateNarrowSpread,
  generateCompareDelta,
  INSIGHTS_BASELINE,
  COMPARE_DELTA_THRESHOLD,
} from "./insights";
export type {
  Insight,
  InsightInput,
  InsightKind,
  InsightSeverity,
  CellAnchor,
  MonotonicityExpectation,
} from "./insights";
