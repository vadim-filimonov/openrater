// Brief 64 — the Brief 43 single-slice <AnalyticsWorkspace> component was
// removed (replaced by <AnalyticsWorkspaceV2>). The shared KPI catalog +
// types it used to own now live in ./analytics-types so the math modules,
// the Brief 64 primitives, and the v2 orchestrator share them without a
// component dependency.
export { ANALYTICS_KPIS } from "./analytics-types";
export type {
  AnalyticsKpiId,
  AnalyticsKpiSpec,
  AnalyticsSliceOption,
  AnalyticsSnapshotSummary,
  // L32 — persisted view-state shape (slice / level / kpi / metric).
  AnalyticsViewState,
} from "./analytics-types";

// PR 43.4 — exhibit math (pure, exported for fixtures + downstream
// PRs like the KPI tile row that share the same `(dataset, slice,
// KPI)` primitive).
export {
  computeSliceExhibit,
  formatKpiValue,
  formatDeltaPct,
  deltaTone,
  kpiValue,
  // Cold-test L27 — premium-metric column discovery for the toolbar
  // picker (multi-LOB plans switch D&O / GL / combined total).
  derivePremiumMetricColumns,
  defaultPremiumMetricColumn,
} from "./exhibit-math";
export type {
  AnalyticsScoredRow,
  ScoredBatchResult,
  LevelStat,
  SliceExhibit,
  PremiumMetricOption,
} from "./exhibit-math";

// PR 43.5 — map bucketing math + state tile grid. Exported so
// consumers can preview the choropleth without re-implementing
// the math.
export { bucketForValue, bucketMap } from "./map-bucket";
export type { ChoroplethBucket } from "./map-bucket";
export { STATE_TILE_GRID, STATE_CODES } from "./map-data";
export type { StateCode } from "./map-data";

// PR 43.6.a — Scored-result persistence bridge between the Inputs
// workspace's "Score all" output and the Analytics workspace's
// chart + map exhibits.
export {
  runRowsToScoredBatchResult,
  toScoredBatchResult,
  persistScoredResult,
  loadScoredResult,
  clearScoredResult,
  resolvePremiumColumn,
  resolveLossColumn,
  // Brief 43 §6.1 / ADR-0041 Phase 2 — staleness fingerprint.
  computeScoringFingerprint,
} from "./analytics-bridge";
export type { ToScoredBatchResultArgs } from "./analytics-bridge";

// The synthesized-column contract + THE plan-premium resolver for
// total-less plans (#482/#483 seams). The scoring service imports the
// same module — one authority, no browser twin (93.4).
export {
  COVERAGE_SUM_COLUMN,
  COVERAGE_SUM_COLUMN_LABEL,
  isTotalLessMultiCoverage,
  resolvePlanPremiumContext,
  sumMoneyFields,
  totalLessTailRefusalMessage,
  // The BOOK's premium basis — the mapping's `rollup_fields` read on
  // top of the plan's own declarations. Shared with the scoring
  // service's two composers.
  declaredPremiumRollup,
  extraPolicyRollupFields,
  isCoverageSumBook,
  premiumBasisField,
  rolledPolicyPremium,
} from "./premium-resolution";
export type {
  PlanPremiumContext,
  PremiumPlanLike,
  PremiumStageLike,
} from "./premium-resolution";

// PR 43.6.c — Footer helpers + PR 43.6.d — per-snapshot re-rate.
export {
  exhibitRowCount,
  formatRelativeTime,
} from "./exhibit-math";
export {
  rerateSnapshotRows,
  snapshotBodyToProjection,
  snapshotBodyToRuntimePlan,
  // ADR-0055 — both-shape readers for the body's singleton substrates
  // (the API serializes them as ENVELOPES; fixtures may carry them bare).
  snapshotBodyInputMapping,
  snapshotBodyPolicyTail,
} from "./analytics-bridge";
export type { RerateSnapshotRowsArgs } from "./analytics-bridge";

// PR 43.7 — Export scored CSV.
export {
  buildAnalyticsScoredCsv,
  analyticsScoredCsvFilename,
} from "./analytics-bridge";
export type { BuildAnalyticsScoredCsvOptions } from "./analytics-bridge";

// Brief 89 §3 (89.3) — analytics before data: the probe exhibits.
// Brief 93 — the plan report (Analytics' landing view; 93.1 replaced
// <AnalyticsProbeMode>, whose exhibits the report composes directly).
export { PlanReport, buildPinsCaption } from "./PlanReport";
export type { PlanReportProps } from "./PlanReport";
export {
  buildProvenanceClause,
  buildReportMetaLine,
  computePlanReportFacts,
} from "./report-facts";
export type { PlanReportFacts, ReportStageLike } from "./report-facts";
export { computeReferenceWalk } from "./report-walk";
export type { ReferenceWalk, WalkRow } from "./report-walk";
export { buildGateRows } from "./report-gates";
export type {
  ReportGateCondition,
  ReportGateFieldMeta,
  ReportGateRow,
  ReportGateRuleLike,
} from "./report-gates";
export { buildVerifiedExamples } from "./report-examples";
export type {
  VerifiedExampleRow,
  VerifiedExamples,
  VectorResultLike,
  VectorsSummaryLike,
} from "./report-examples";
export { RateCardExhibit } from "./RateCardExhibit";
export type { RateCardExhibitProps } from "./RateCardExhibit";
export { StructuralDrivers } from "./StructuralDrivers";
export type { StructuralDriversProps } from "./StructuralDrivers";
export {
  computeStructuralDrivers,
  probeAxisCandidates,
  buildRateCardCsv,
} from "./probe-math";
export type { StructuralDriver, RateCardCellResult } from "./probe-math";

// Brief 89 §3.2 B3 (89.4) — the probe book: sweep + readout + card.
export { ProbeBookCard } from "./ProbeBookCard";
export type { ProbeBookCardProps, ProbeBookState } from "./ProbeBookCard";
export {
  buildProbeSweep,
  buildDefaultProbeSweep,
  analyzeProbeRows,
  dimInputKeys,
} from "./probe-math";
export type {
  ProbeSweep,
  ProbeResultRow,
  ProbeReadout,
  ProbeVariableReadout,
} from "./probe-math";
