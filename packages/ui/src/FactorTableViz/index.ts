export { FactorTableViz } from "./FactorTableViz";
export type {
  FactorTableVizProps,
  FactorTableVizGeographicAxis,
} from "./FactorTableViz";
export {
  resolveChartType,
  availableChartTypes,
  DEFAULT_VIZ_CONFIG,
} from "./resolveChartType";
export type {
  ChartType,
  VizConfigChartType,
  VizConfig,
  TableShape,
  PickerEntry,
} from "./resolveChartType";

// ── Brief 45 PR 45.1 — Hero-strip + chart visual primitives ─────
//
// `factorGradient` is the continuous color ramp every chart pane
// uses to encode factor magnitude (azure-700 below 1.0 → neutral
// at 1.0 → orange-600 above 1.0). `computeFactorStats` powers
// the Mean / Range / Coverage KPIs the hero strip displays plus
// the uniformity test the Brief 45 `resolveChartType` extension
// will key off in PR 45.5.
export {
  factorGradient,
  factorGradientLegend,
  FACTOR_GRADIENT_MIN,
  FACTOR_GRADIENT_MAX,
  FACTOR_GRADIENT_NEUTRAL,
} from "./colorRamp";
export type { GradientLegendStop } from "./colorRamp";

export {
  computeFactorStats,
  isUniform,
  formatFactorValue,
  formatCoverageFraction,
  formatCoveragePercent,
  UNIFORM_THRESHOLD,
} from "./factorStats";
export type { FactorCellValue, FactorStats } from "./factorStats";

// ── Brief 45 PR 45.2 — Rich tooltip payload adapter ─────────────
//
// `computeFactorTooltipData(...)` packages the datum + values +
// (optional) chain-reference resolver into the FactorTooltipData
// the `<FactorTooltip>` primitive renders. Kept here next to the
// other pure FactorTableViz helpers so the entire chart pane's
// math layer lives in one folder.
export {
  computeFactorTooltipData,
  computePercentile,
  formatPercentileLabel,
  formatDeviationLabel,
} from "./factorTooltipData";
export type {
  FactorTooltipData,
  FactorDatum,
  GetChainReferences,
  ComputeFactorTooltipDataArgs,
} from "./factorTooltipData";

// ── Brief 45 PR 45.4 — Distribution / outliers pure module ──────
//
// Histogram + outlier ranking math for the dense-mode chart.
// Consumed by `<FactorDistribution>` + `<OutlierDrawer>` + the
// resolveChartType extension (PR 45.5).
export {
  computeFactorDistribution,
  sturgesBinCount,
  formatBinLabel,
  binIndexForValue,
  isDense,
  MAX_BINS,
  MIN_BINS,
  DEFAULT_OUTLIER_COUNT,
  DENSE_THRESHOLD,
} from "./factorDistribution";
export type {
  FactorDistribution as FactorDistributionPayload,
  FactorDistributionDatum,
  HistogramBin,
  OutlierEntry,
  ComputeFactorDistributionArgs,
} from "./factorDistribution";
