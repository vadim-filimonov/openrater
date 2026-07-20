/**
 * <FactorVizHeroStrip> — Brief 45 PR 45.1.
 *
 * Three KPIs above every factor-table chart pane (Brief 45 §−1
 * Q7 lock):
 *
 *   • Mean       — average factor value across populated cells
 *   • Range      — [min, max]
 *   • Coverage   — populated / total + percent
 *
 * Visual flags (Brief 45 §4.1):
 *   • Mean within ±2% of identity → soft azure underline on the
 *     cell. Within ±10% but outside ±2% → no underline. Outside
 *     ±10% → orange underline (warm side) signaling "this table
 *     skews".
 *   • Coverage < 100% → amber "needs authoring" detail line.
 *
 * Pure presentation. Parent owns the stats — typically the
 * FactorTableViz consumer that already has the cell map. Accepts
 * either a precomputed `FactorStats` OR a raw `values` array
 * (the component memoizes the computation).
 *
 * Adapts to narrow viewports — at < 480px the three cells stack
 * vertically; default is a 3-column grid.
 */

import { useMemo, type JSX } from "react";
import {
  computeFactorStats,
  formatCoveragePercent,
  formatFactorValue,
  type FactorCellValue,
  type FactorStats,
} from "../FactorTableViz/factorStats";
import "./FactorVizHeroStrip.css";

/** How far from the baseline before "Mean" gets a flag color. */
const MEAN_NEAR_THRESHOLD = 0.02; // ±2%
const MEAN_SKEW_THRESHOLD = 0.1; // ±10%

export interface FactorVizHeroStripProps {
  /**
   * Pre-computed factor stats. When supplied, the component skips
   * the local `computeFactorStats` call. Useful when the parent
   * already needs the stats for other reasons (chart-mode
   * resolution, etc.).
   */
  readonly stats?: FactorStats;
  /**
   * Raw cell values when the parent hasn't already computed the
   * stats. Pass `undefined` for empty cells, `number` for
   * populated cells, `NaN` / `±Infinity` to skip a cell. Ignored
   * when `stats` is supplied.
   */
  readonly values?: readonly FactorCellValue[];
  /**
   * The baseline the chart anchors against. Defaults to 1.0 (the
   * multiplicative identity). Drives the Mean cell's flag color
   * (which only fires near the baseline; for non-1.0 baselines
   * the proximity logic uses ratio, not absolute distance).
   */
  readonly baseline?: number;
  /** Optional accessibility label override. */
  readonly ariaLabel?: string;
  readonly testId?: string;
}

interface MeanFlag {
  readonly kind: "near-identity" | "skew-low" | "skew-high" | "none";
  /** "+24%" / "-8%" / "" — the percent-delta string for the detail line. */
  readonly deltaText: string;
}

function classifyMean(mean: number | null, baseline: number): MeanFlag {
  if (mean === null) return { kind: "none", deltaText: "" };
  if (baseline <= 0 || !Number.isFinite(baseline)) {
    return { kind: "none", deltaText: "" };
  }
  const ratio = mean / baseline;
  const delta = ratio - 1.0;
  const absDelta = Math.abs(delta);

  let kind: MeanFlag["kind"] = "none";
  if (absDelta <= MEAN_NEAR_THRESHOLD) {
    kind = "near-identity";
  } else if (absDelta > MEAN_SKEW_THRESHOLD) {
    kind = delta < 0 ? "skew-low" : "skew-high";
  }

  const sign = delta >= 0 ? "+" : "";
  const pct = Math.round(delta * 100);
  const deltaText = `${sign}${pct}% vs identity`;

  return { kind, deltaText };
}

export function FactorVizHeroStrip(
  props: FactorVizHeroStripProps,
): JSX.Element {
  const {
    stats: providedStats,
    values,
    baseline = 1.0,
    ariaLabel = "Factor-table summary",
    testId = "rater-factor-viz-hero-strip",
  } = props;

  const stats = useMemo<FactorStats>(() => {
    if (providedStats) return providedStats;
    return computeFactorStats(values ?? []);
  }, [providedStats, values]);

  const meanFlag = useMemo(
    () => classifyMean(stats.mean, baseline),
    [stats.mean, baseline],
  );

  // ── Mean cell ──────────────────────────────────────────────────
  const meanClass = `rater-fvhs__stat rater-fvhs__stat--mean is-${meanFlag.kind}`;
  let meanDetail = "—";
  if (stats.mean !== null) {
    if (meanFlag.kind === "near-identity") meanDetail = "at identity";
    else if (meanFlag.kind === "none") meanDetail = "near identity";
    else meanDetail = meanFlag.deltaText;
  } else if (stats.totalCount === 0) {
    meanDetail = "no cells";
  } else {
    meanDetail = "no values yet";
  }

  // ── Range cell ─────────────────────────────────────────────────
  let rangeContent: JSX.Element;
  let rangeDetail = "—";
  if (stats.range === null) {
    rangeContent = <span className="rater-fvhs__stat-val">—</span>;
  } else {
    const [lo, hi] = stats.range;
    const spread = hi - lo;
    rangeContent = (
      <span className="rater-fvhs__stat-val">
        <span className="rater-fvhs__bracket">[</span>
        {formatFactorValue(lo)}
        <span className="rater-fvhs__bracket">…</span>
        {formatFactorValue(hi)}
        <span className="rater-fvhs__bracket">]</span>
      </span>
    );
    if (spread === 0) rangeDetail = "no dispersion";
    else rangeDetail = `spread ${formatFactorValue(spread)}`;
  }

  // ── Coverage cell ──────────────────────────────────────────────
  const isFullCoverage =
    stats.totalCount > 0 && stats.populatedCount === stats.totalCount;
  const coverageClass = `rater-fvhs__stat rater-fvhs__stat--coverage is-${
    stats.totalCount === 0
      ? "empty"
      : isFullCoverage
        ? "full"
        : "partial"
  }`;
  const coverageDetail =
    stats.totalCount === 0
      ? "no cells"
      : isFullCoverage
        ? `${formatCoveragePercent(stats.coverage)} · complete`
        : `${formatCoveragePercent(stats.coverage)} · needs authoring`;

  return (
    <div
      className="rater-fvhs"
      data-testid={testId}
      role="group"
      aria-label={ariaLabel}
    >
      {/* Mean */}
      <div
        className={meanClass}
        data-testid={`${testId}-mean`}
        data-flag={meanFlag.kind}
      >
        <span className="rater-fvhs__stat-val">
          {formatFactorValue(stats.mean)}
        </span>
        <span className="rater-fvhs__stat-label">Mean</span>
        <span className="rater-fvhs__stat-detail">{meanDetail}</span>
      </div>

      {/* Range */}
      <div
        className="rater-fvhs__stat rater-fvhs__stat--range"
        data-testid={`${testId}-range`}
      >
        {rangeContent}
        <span className="rater-fvhs__stat-label">Range</span>
        <span className="rater-fvhs__stat-detail">{rangeDetail}</span>
      </div>

      {/* Coverage */}
      <div
        className={coverageClass}
        data-testid={`${testId}-coverage`}
        data-coverage={stats.coverage.toFixed(4)}
      >
        <span className="rater-fvhs__stat-val">
          {stats.populatedCount}
          <span className="rater-fvhs__bracket">
            {" "}
            / {stats.totalCount}
          </span>
        </span>
        <span className="rater-fvhs__stat-label">Coverage</span>
        <span className="rater-fvhs__stat-detail">{coverageDetail}</span>
      </div>
    </div>
  );
}
