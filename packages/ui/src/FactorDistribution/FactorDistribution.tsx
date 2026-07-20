/**
 * <FactorDistribution> — Brief 45 PR 45.4.
 *
 * The dense-mode chart for factor tables with > 30 levels (class
 * codes, NTEE codes, ZIPs, large class-of-construction tables).
 * Replaces the bar carpet with two coupled panes:
 *
 *   • Histogram (left) — Sturges-binned, gradient-colored. Each
 *     bin's fill comes from `factorGradient(midpoint)` so the
 *     viewer reads value distribution + magnitude in one glance.
 *   • Outlier list (right) — top-5 / bottom-5 by value (Q6 lock).
 *     Click an outlier row → grid scrolls + cell pulses. Click
 *     "Show all N outliers" → opens <OutlierDrawer> with the full
 *     ranked list.
 *
 * Pure presentation. Pass the precomputed `FactorDistribution`
 * payload from `computeFactorDistribution()` upstream.
 *
 * Brief 64 — generalized so Analytics can reuse it for a *premium*
 * distribution (the >30-level rate-driver case). Two optional props
 * keep the factor defaults intact (zero change for Brief 45 callers):
 *   • `title` overrides the "Distribution of factor values" heading.
 *   • `valueFormatter` formats every displayed value (axis, baseline,
 *     footer, outliers, drawer). Defaults to `formatFactorValue`;
 *     Analytics passes a currency formatter. The gradient pivots on
 *     `baseline` (pass the book-average premium) per colorRamp's
 *     value/baseline normalization.
 *
 * Cross-highlight contract: emits `onBinClick(binIndex)` and
 * `onOutlierClick(key)`. The parent (FactorTableViz / consumer)
 * wires those to the grid + drawer behaviors.
 */

import { useMemo, useState, type JSX } from "react";
import {
  type FactorDistribution as FactorDistributionPayload,
  type HistogramBin,
  type OutlierEntry,
  formatBinLabel,
} from "../FactorTableViz/factorDistribution";
import { factorGradient } from "../FactorTableViz/colorRamp";
import { formatFactorValue } from "../FactorTableViz/factorStats";
import { OutlierDrawer } from "../OutlierDrawer";
import "./FactorDistribution.css";

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export interface FactorDistributionProps {
  /** Precomputed payload via `computeFactorDistribution()`. */
  readonly distribution: FactorDistributionPayload;
  /**
   * Baseline (typically 1.0). Drives the gradient pivot — values
   * normalize to `value / baseline` before lookup. Analytics passes
   * the book-average premium so the histogram reads above/below
   * average.
   */
  readonly baseline?: number;
  /**
   * Brief 64 — histogram heading. Defaults to "Distribution of factor
   * values"; Analytics passes e.g. "Distribution of average premium".
   */
  readonly title?: string;
  /**
   * Brief 64 — formats every displayed value (axis labels, baseline
   * marker, footer median/σ, outlier rows, the "show all" drawer).
   * Defaults to the factor format; Analytics passes a currency formatter.
   * Accepts `number | null` (median/σ can be null) — both
   * `formatFactorValue` and `formatKpiValue` render null as "—".
   */
  readonly valueFormatter?: (value: number | null) => string;
  /**
   * Fires when the user clicks a bin (drills to the levels in
   * that bin).
   */
  readonly onBinClick?: (binIndex: number) => void;
  /**
   * Fires when the user clicks an outlier row (top or bottom).
   * Parent typically focuses + scrolls the grid.
   */
  readonly onOutlierClick?: (key: string) => void;
  /**
   * Plan-table identifier for the "Show all 487 outliers" drawer
   * title — purely cosmetic.
   */
  readonly tableLabel?: string;
  readonly testId?: string;
}

type OutlierTab = "top" | "bottom";

export function FactorDistribution(
  props: FactorDistributionProps,
): JSX.Element {
  const {
    distribution,
    baseline = 1.0,
    title = "Distribution of factor values",
    valueFormatter = formatFactorValue,
    onBinClick,
    onOutlierClick,
    tableLabel,
    testId = "rater-factor-distribution",
  } = props;

  const [outlierTab, setOutlierTab] = useState<OutlierTab>("top");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Histogram ─────────────────────────────────────────────────
  // SVG viewBox: 460×170 — matches the Brief 45 mockup; the chart
  // CSS scales it via width: 100%.
  const VIEW_W = 460;
  const VIEW_H = 170;
  const PAD = { l: 30, r: 10, t: 12, b: 22 };
  const plotW = VIEW_W - PAD.l - PAD.r;
  const plotH = VIEW_H - PAD.t - PAD.b;

  const bins = distribution.bins;
  const maxBinCount = distribution.maxBinCount || 1;

  // Y axis: 4 evenly spaced gridlines at 25/50/75/100% of plot height.
  const yGridlines = useMemo(() => {
    const ticks: Array<{ y: number; count: number }> = [];
    for (let i = 1; i <= 4; i += 1) {
      const ratio = i / 4;
      const count = Math.round(maxBinCount * ratio);
      const y = PAD.t + plotH - plotH * ratio;
      ticks.push({ y, count });
    }
    return ticks;
  }, [maxBinCount, plotH]);

  // Baseline marker — vertical dashed line at `baseline` inside
  // the domain (when domain spans it).
  const baselineX = useMemo<number | null>(() => {
    if (distribution.domain === null) return null;
    const [min, max] = distribution.domain;
    if (baseline < min || baseline > max) return null;
    return PAD.l + ((baseline - min) / (max - min || 1)) * plotW;
  }, [baseline, distribution.domain, plotW]);

  function barWidth(): number {
    return bins.length > 0 ? plotW / bins.length - 2 : 0;
  }
  function barX(i: number): number {
    return bins.length > 0 ? PAD.l + (plotW / bins.length) * i + 1 : 0;
  }
  function barHeight(b: HistogramBin): number {
    return (b.count / maxBinCount) * plotH;
  }
  function barY(b: HistogramBin): number {
    return PAD.t + plotH - barHeight(b);
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div
      className="rater-fdist"
      data-testid={testId}
      data-bin-count={bins.length}
    >
      <div className="rater-fdist__layout">
        {/* HISTOGRAM */}
        <div
          className="rater-fdist__hist"
          data-testid={`${testId}-histogram`}
        >
          <div className="rater-fdist__hist-head">
            <span className="rater-fdist__hist-title">{title}</span>
            <span className="rater-fdist__hist-meta">
              Sturges · {distribution.binCount} bins
            </span>
          </div>

          <svg
            className="rater-fdist__hist-svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            data-testid={`${testId}-svg`}
          >
            {/* Gridlines + count labels */}
            {yGridlines.map((g) => (
              <g key={`g-${g.y}`}>
                <line
                  className="rater-fdist__hist-gridline"
                  x1={PAD.l}
                  x2={VIEW_W - PAD.r}
                  y1={g.y}
                  y2={g.y}
                />
                <text
                  className="rater-fdist__hist-y-label"
                  x={PAD.l - 6}
                  y={g.y + 3}
                  textAnchor="end"
                >
                  {g.count}
                </text>
              </g>
            ))}

            {/* X axis line */}
            <line
              className="rater-fdist__hist-axis"
              x1={PAD.l}
              x2={VIEW_W - PAD.r}
              y1={PAD.t + plotH}
              y2={PAD.t + plotH}
            />
            <line
              className="rater-fdist__hist-axis"
              x1={PAD.l}
              x2={PAD.l}
              y1={PAD.t}
              y2={PAD.t + plotH}
            />

            {/* Baseline marker (dashed vertical) */}
            {baselineX !== null && (
              <g data-testid={`${testId}-baseline`}>
                <line
                  className="rater-fdist__hist-baseline"
                  x1={baselineX}
                  x2={baselineX}
                  y1={PAD.t}
                  y2={PAD.t + plotH}
                />
                <text
                  className="rater-fdist__hist-baseline-label"
                  x={baselineX + 4}
                  y={PAD.t + 10}
                >
                  {valueFormatter(baseline)}
                </text>
              </g>
            )}

            {/* Bars */}
            {bins.map((b, i) => {
              const w = barWidth();
              const x = barX(i);
              const y = barY(b);
              const h = barHeight(b);
              return (
                <g
                  key={`bin-${i}`}
                  className="rater-fdist__hist-bar"
                  data-testid={`${testId}-bin-${i}`}
                  onClick={() => onBinClick?.(i)}
                  style={{
                    cursor: onBinClick ? "pointer" : "default",
                  }}
                >
                  <rect
                    className="rater-fdist__hist-bar-rect"
                    x={x}
                    width={Math.max(1, w)}
                    y={y}
                    height={Math.max(1, h)}
                    rx={1.5}
                    fill={factorGradient(b.midpoint, baseline)}
                  />
                  {/* Hover hit area (transparent, larger than the bar) */}
                  <rect
                    className="rater-fdist__hist-bar-hit"
                    x={x}
                    width={Math.max(1, w)}
                    y={PAD.t}
                    height={plotH}
                  >
                    <title>
                      {formatBinLabel(b, i === bins.length - 1)} · {b.count}{" "}
                      {b.count === 1 ? "level" : "levels"}
                    </title>
                  </rect>
                </g>
              );
            })}

            {/* X axis labels — show first / domain-mid / last */}
            {distribution.domain !== null && bins.length > 0 && (
              <>
                <text
                  className="rater-fdist__hist-x-label"
                  x={PAD.l}
                  y={VIEW_H - 6}
                  textAnchor="middle"
                >
                  {valueFormatter(distribution.domain[0])}
                </text>
                <text
                  className="rater-fdist__hist-x-label"
                  x={(PAD.l + VIEW_W - PAD.r) / 2}
                  y={VIEW_H - 6}
                  textAnchor="middle"
                >
                  {valueFormatter(
                    (distribution.domain[0] + distribution.domain[1]) / 2,
                  )}
                </text>
                <text
                  className="rater-fdist__hist-x-label"
                  x={VIEW_W - PAD.r}
                  y={VIEW_H - 6}
                  textAnchor="middle"
                >
                  {valueFormatter(distribution.domain[1])}
                </text>
              </>
            )}
          </svg>

          {/* Hist footer — shape hint + stats */}
          <div className="rater-fdist__hist-footer">
            <span>
              {bins.length === 1
                ? "Single bin · uniform values"
                : describeShape(distribution)}
            </span>
            <span>
              median {valueFormatter(distribution.median)} · σ{" "}
              {valueFormatter(distribution.stddev)}
            </span>
          </div>
        </div>

        {/* OUTLIERS */}
        <div
          className="rater-fdist__outliers"
          data-testid={`${testId}-outliers`}
        >
          <div className="rater-fdist__outliers-head">
            <button
              type="button"
              className={`rater-fdist__outliers-tab${
                outlierTab === "top" ? " is-active" : ""
              }`}
              onClick={() => setOutlierTab("top")}
              data-testid={`${testId}-tab-top`}
            >
              Top {distribution.topOutliers.length}
            </button>
            <button
              type="button"
              className={`rater-fdist__outliers-tab${
                outlierTab === "bottom" ? " is-active" : ""
              }`}
              onClick={() => setOutlierTab("bottom")}
              data-testid={`${testId}-tab-bottom`}
            >
              Bottom {distribution.bottomOutliers.length}
            </button>
            <span className="rater-fdist__outliers-spacer" />
            {distribution.populatedCount >
              distribution.topOutliers.length +
                distribution.bottomOutliers.length && (
              <button
                type="button"
                className="rater-fdist__outliers-expand"
                onClick={() => setDrawerOpen(true)}
                data-testid={`${testId}-show-all`}
              >
                Show all {distribution.populatedCount} →
              </button>
            )}
          </div>

          <div className="rater-fdist__outliers-body">
            {(outlierTab === "top"
              ? distribution.topOutliers
              : distribution.bottomOutliers
            ).map((entry) => (
              <OutlierRow
                key={entry.key}
                entry={entry}
                baseline={baseline}
                valueFormatter={valueFormatter}
                {...(onOutlierClick ? { onClick: onOutlierClick } : {})}
                testId={`${testId}-outlier-${entry.key}`}
              />
            ))}
            {distribution.populatedCount === 0 && (
              <div className="rater-fdist__outliers-empty">
                No values to rank.
              </div>
            )}
          </div>

          <div className="rater-fdist__outliers-footer">
            <span>Sorted by value {outlierTab === "top" ? "desc" : "asc"}</span>
            <span>median {valueFormatter(distribution.median)}</span>
          </div>
        </div>
      </div>

      {/* "Show all N" drawer */}
      <OutlierDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        entries={distribution.allRankedByDeviation}
        baseline={baseline}
        median={distribution.median}
        valueFormatter={valueFormatter}
        {...(tableLabel !== undefined ? { tableLabel } : {})}
        {...(onOutlierClick
          ? {
              onOutlierClick: (key: string) => {
                onOutlierClick(key);
                setDrawerOpen(false);
              },
            }
          : {})}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

interface OutlierRowProps {
  readonly entry: OutlierEntry;
  readonly baseline: number;
  readonly valueFormatter: (value: number | null) => string;
  readonly onClick?: (key: string) => void;
  readonly testId: string;
}

function OutlierRow({
  entry,
  baseline,
  valueFormatter,
  onClick,
  testId,
}: OutlierRowProps): JSX.Element {
  const dev = baseline !== 0 ? entry.value / baseline - 1 : 0;
  const sign = dev >= 0 ? "+" : "";
  const pct = Math.round(dev * 100);
  const direction = dev >= 0 ? "up" : "down";
  return (
    <button
      type="button"
      className={`rater-fdist__outlier-row is-${direction}`}
      onClick={() => onClick?.(entry.key)}
      data-testid={testId}
    >
      <span className="rater-fdist__outlier-label">
        <span className="rater-fdist__outlier-label-primary">{entry.label}</span>
        {entry.sublabel && (
          <span className="rater-fdist__outlier-label-sub">
            {entry.sublabel}
          </span>
        )}
      </span>
      <span className="rater-fdist__outlier-val">
        {valueFormatter(entry.value)}
      </span>
      <span
        className={`rater-fdist__outlier-dev is-${direction}`}
        aria-label={`${sign}${pct}% from identity`}
      >
        {sign}
        {pct}%
      </span>
      <svg
        className="rater-fdist__outlier-chev"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Heuristic shape description — surfaced beneath the histogram so
 * the viewer doesn't have to read the bars cold.
 *
 * Cheap rules of thumb:
 *   • If the max bin is in the first 30%, "right-skewed" (long
 *     tail to the high side)
 *   • If the max bin is in the last 30%, "left-skewed"
 *   • Else "centered"
 *   • If there are two clear peaks separated by a valley, "bimodal"
 *
 * Returns a short phrase suitable for the footer.
 */
function describeShape(d: FactorDistributionPayload): string {
  if (d.bins.length === 0) return "";
  const maxIdx = d.bins.reduce(
    (best, b, i) => (b.count > d.bins[best]!.count ? i : best),
    0,
  );
  const r = maxIdx / Math.max(1, d.bins.length - 1);
  // Detect simple bimodal: two peaks ≥ 80% of max separated by a
  // dip ≤ 50% of max.
  let bimodal = false;
  const max = d.bins[maxIdx]!.count;
  let secondPeakIdx = -1;
  for (let i = 0; i < d.bins.length; i += 1) {
    if (i === maxIdx) continue;
    const b = d.bins[i]!;
    if (b.count >= max * 0.7 && Math.abs(i - maxIdx) >= 2) {
      // Check for a dip between i and maxIdx.
      const lo = Math.min(i, maxIdx);
      const hi = Math.max(i, maxIdx);
      let minBetween = Infinity;
      for (let j = lo + 1; j < hi; j += 1) {
        const c = d.bins[j]!.count;
        if (c < minBetween) minBetween = c;
      }
      if (minBetween <= max * 0.5) {
        bimodal = true;
        secondPeakIdx = i;
        break;
      }
    }
  }
  if (bimodal && secondPeakIdx !== -1) return "Bimodal · two peaks";
  if (r < 0.3) return "Right-skewed · long tail above";
  if (r > 0.7) return "Left-skewed · long tail below";
  return "Centered · values cluster near the middle";
}
