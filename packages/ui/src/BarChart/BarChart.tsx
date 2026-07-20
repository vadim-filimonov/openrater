/**
 * <BarChart> — Brief 34 PR 34.1 + PR 34.5 + Brief 45 PR 45.3
 * (1-D categorical primitive).
 *
 * SVG-rendered bar chart for 1-D categorical factor tables.
 * Brief 34 §4.1 + mockup Frame 2 shipped the structural layer
 * (axes + bars + baseline + selection); Brief 45 PR 45.3 layers
 * the redesigned visual language on top:
 *
 *   • Continuous gradient color encoding — `factorGradient(value,
 *     baseline)` paints each bar via inline `fill`, replacing
 *     the 3-tint CSS-driven palette (Brief 45 §−1 Q5 lock).
 *     The `data-tint` attribute survives for downstream CSS
 *     hooks but doesn't drive the fill color anymore.
 *   • Sort menu — `sortMode` prop reorders the data before
 *     position computation. Defaults to "value-desc" (Q1 lock);
 *     consumers pass "given" to preserve input order (Brief 34
 *     contract). Sort is stable; ties preserved.
 *   • Reference line at 1.0, always visible, with an inline
 *     `= identity` label at the right end of the baseline
 *     gridline (Q8 lock). No toggle.
 *
 *   • Hand-rolled axes; baseline dashed at y=1.0
 *   • Bars grow from the baseline (not from the X axis) so the
 *     visual encoding reads "above/below baseline" cleanly
 *   • `focusedKey` prop dims siblings (cross-highlight)
 *   • PR 34.5 — `selectedKeys` tints matching bars; `onBrushSelect`
 *     + `onPointClick` enable brush-to-select + click-to-focus
 *
 * Pure presentation. Parent owns:
 *   • Data series (key + label + value, ordered)
 *   • Baseline (defaults to 1.0)
 *   • focusedKey for cross-highlight
 *   • selectedKeys for selection tint
 *   • Hover + click + brush handlers
 *   • Brief 45 — the rich tooltip rendering. BarChart still
 *     emits `onHoverChange(key | null)`; the consumer
 *     (`<FactorTableViz>`) wires that into `<FactorTooltip>`.
 */

import { useMemo, useState, type JSX } from "react";
import { factorGradient } from "../FactorTableViz/colorRamp";
import {
  keysInXExtent,
  nearestKeyAtX,
  type BrushRect,
} from "../FactorTableViz/brushSelect";
import { useBrush1D } from "../FactorTableViz/useBrush1D";
import {
  CHART_VIEWBOX,
  PLOT_INSET,
  computeXPositions,
  computeYTicks,
  pickVisibleXLabels,
  truncateLabel,
  valueToY,
  DEFAULT_BASELINE,
} from "../LineChart/chartAxis";
import "./BarChart.css";

export interface BarChartDatum {
  /** Stable id (typically the dim level id). */
  readonly key: string;
  /** Display label rendered below the X axis. */
  readonly label: string;
  /** Numeric value. */
  readonly value: number;
}

/**
 * Brief 45 PR 45.3 — bar sort policy. The default
 * `"value-desc"` matches Brief 45 §−1 Q1: highest factor at
 * the left of the eye-flow. Pass `"given"` to preserve the
 * input order (the Brief 34 behavior).
 */
export type BarChartSortMode =
  | "value-desc"
  | "value-asc"
  | "label-asc"
  | "given";

export interface BarChartProps {
  readonly data: readonly BarChartDatum[];
  /** Baseline (typically 1.0). */
  readonly baseline?: number;
  /**
   * Brief 45 PR 45.3 — How to order bars. Defaults to
   * `"value-desc"` (the §−1 Q1 lock). Banded callers that want
   * to preserve axis order pass `"given"`.
   */
  readonly sortMode?: BarChartSortMode;
  /**
   * Currently focused datum key — its bar gains an outline + siblings
   * dim to 0.6 opacity. Drives cross-highlight from the grid.
   */
  readonly focusedKey?: string;
  /**
   * PR 34.5 — Selected datum keys. Bars in this set gain an
   * `is-selected` ring + a soft X-extent region overlay shows the
   * selection on the plot.
   */
  readonly selectedKeys?: ReadonlySet<string>;
  /**
   * PR 34.6 — Filed-snapshot values keyed by datum key. When
   * provided, a thin dashed tick renders at each bar's filed
   * y-position so the actuary sees the previous value alongside
   * the current bar. Datum keys missing from this map render no
   * tick.
   */
  readonly filedValues?: ReadonlyMap<string, number>;
  /**
   * Optional onHover — fires with the hovered datum's key or null.
   */
  readonly onHoverChange?: (key: string | null) => void;
  /**
   * PR 34.5 — Fires on brush gesture end with the set of datum
   * keys whose X-center falls within the brush extent. When
   * omitted, brush is disabled.
   */
  readonly onBrushSelect?: (keys: ReadonlySet<string>) => void;
  /**
   * PR 34.5 — Fires when the user clicks a bar (no drag). Parent
   * typically focuses + scrolls to the matching grid cell.
   */
  readonly onPointClick?: (key: string) => void;
  readonly ariaLabel?: string;
  readonly testId?: string;
}

/** Width of each bar as a fraction of its slot width. */
const BAR_WIDTH_FRACTION = 0.6;

/** Bucket a value into a tint category for color encoding. */
type Tint = "low" | "mid" | "high";

function classify(value: number, baseline: number): Tint {
  // Within 1% of baseline → mid (avoids flickering on tiny deltas).
  const delta = value - baseline;
  if (Math.abs(delta) < baseline * 0.01) return "mid";
  return delta < 0 ? "low" : "high";
}

export function BarChart(props: BarChartProps): JSX.Element {
  const {
    data: rawData,
    baseline = DEFAULT_BASELINE,
    sortMode = "value-desc",
    focusedKey,
    selectedKeys,
    filedValues,
    onHoverChange,
    onBrushSelect,
    onPointClick,
    ariaLabel = "Bar chart",
    testId = "rater-bar-chart",
  } = props;

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const effectiveFocus = focusedKey ?? hoverKey;

  // Brief 45 PR 45.3 — apply sort policy. Sort is stable; ties
  // preserve input order. The Brief 34 brush + selection math
  // operates on the sorted array (the X positions are derived
  // from it).
  const data = useMemo<readonly BarChartDatum[]>(() => {
    if (sortMode === "given") return rawData;
    const sorted = rawData.slice();
    if (sortMode === "value-desc") {
      sorted.sort((a, b) => b.value - a.value);
    } else if (sortMode === "value-asc") {
      sorted.sort((a, b) => a.value - b.value);
    } else if (sortMode === "label-asc") {
      sorted.sort((a, b) => a.label.localeCompare(b.label));
    }
    return sorted;
  }, [rawData, sortMode]);

  // ── Axes ────────────────────────────────────────────────────────
  // Include filed values in the y-axis range so a filed value
  // outside the current data doesn't get clipped in compare mode.
  const yAxis = useMemo(() => {
    const values = data.map((d) => d.value);
    if (filedValues) {
      for (const d of data) {
        const f = filedValues.get(d.key);
        if (f !== undefined) values.push(f);
      }
    }
    return computeYTicks(values, baseline);
  }, [data, baseline, filedValues]);
  const xPositions = useMemo(() => computeXPositions(data.length), [data.length]);
  // PR 45.9 / PR 45.10 — Density-adaptive label width. Rotation gives
  // each label more horizontal headroom even when packed tight, so
  // we can keep more chars than the dense-horizontal version (14 vs
  // 8). The pickVisibleXLabels stride still applies an upper bound,
  // pruning labels that would still collide after rotation.
  const labelMax = 14;

  const visibleLabelIndices = useMemo(() => {
    if (data.length === 0) return [];
    const slotWidth =
      (CHART_VIEWBOX.width - PLOT_INSET.left - PLOT_INSET.right) /
      data.length;
    // PR 45.10 — Rotated labels project ~labelChars * 0.5 chars of
    // horizontal width per label (cos 45° ≈ 0.71). Passing a smaller
    // approxCharWidth to pickVisibleXLabels accounts for that, so
    // the stride math packs more labels onto a rotated axis than the
    // horizontal version could.
    return pickVisibleXLabels(
      data.map((d) => truncateLabel(d.label, labelMax)),
      slotWidth,
      3, // ~half of the horizontal 6 — rotation halves visual width
    );
  }, [data]);

  const baselineY = useMemo(
    () => valueToY(baseline, yAxis.min, yAxis.max),
    [baseline, yAxis],
  );

  // ── PR 34.5 — Brush / click gesture ─────────────────────────────
  const dataKeys = useMemo(() => data.map((d) => d.key), [data]);
  const brushEnabled = onBrushSelect !== undefined || onPointClick !== undefined;
  const { state: brushState, svgRef, handlers: brushHandlers } = useBrush1D({
    enabled: brushEnabled,
    onBrushEnd: (rect: BrushRect) => {
      if (!onBrushSelect) return;
      const keys = keysInXExtent({ dataKeys, xPositions, brush: rect });
      onBrushSelect(keys);
    },
    onClick: (clickX: number) => {
      if (!onPointClick) return;
      const key = nearestKeyAtX({ dataKeys, xPositions, x: clickX });
      if (key) onPointClick(key);
    },
    y1: PLOT_INSET.top,
    y2: CHART_VIEWBOX.height - PLOT_INSET.bottom,
  });

  // Selection X-extent overlay.
  const selectionExtent = useMemo<{ x1: number; x2: number } | null>(() => {
    if (!selectedKeys || selectedKeys.size === 0) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const pos = xPositions[i];
      if (!d || !pos) continue;
      if (!selectedKeys.has(d.key)) continue;
      xMin = Math.min(xMin, pos.center - pos.slot / 2);
      xMax = Math.max(xMax, pos.center + pos.slot / 2);
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return null;
    return { x1: xMin, x2: xMax };
  }, [selectedKeys, data, xPositions]);

  // ── Empty state ────────────────────────────────────────────────
  if (data.length === 0) {
    return (
      <div
        className="rater-bar-chart rater-bar-chart--empty"
        data-testid={testId}
        role="img"
        aria-label={ariaLabel}
      >
        <span className="rater-bar-chart-empty-text">No data to plot</span>
      </div>
    );
  }

  return (
    <div
      className="rater-bar-chart"
      data-testid={testId}
      data-focused-key={effectiveFocus ?? ""}
      data-brushing={brushState.isBrushing ? "true" : "false"}
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        ref={svgRef}
        className="rater-bar-chart-svg"
        viewBox={`0 0 ${CHART_VIEWBOX.width} ${CHART_VIEWBOX.height}`}
        preserveAspectRatio="none"
        data-testid={`${testId}-svg`}
        {...(brushEnabled ? brushHandlers : {})}
      >
        {/* Y gridlines + labels */}
        {yAxis.ticks.map((tick) => {
          const isBaseline = Math.abs(tick.value - baseline) < 1e-6;
          return (
            <g
              key={`y-${tick.value}`}
              data-testid={`${testId}-y-tick-${tick.value}`}
            >
              <line
                className={`rater-bar-chart-gridline${
                  isBaseline ? " is-baseline" : ""
                }`}
                x1={PLOT_INSET.left}
                x2={CHART_VIEWBOX.width - PLOT_INSET.right}
                y1={tick.y}
                y2={tick.y}
              />
              <text
                className="rater-bar-chart-y-label"
                x={PLOT_INSET.left - 6}
                y={tick.y + 3}
                textAnchor="end"
              >
                {tick.label}
              </text>
            </g>
          );
        })}

        {/* Axes */}
        <line
          className="rater-bar-chart-axis"
          x1={PLOT_INSET.left}
          x2={CHART_VIEWBOX.width - PLOT_INSET.right}
          y1={CHART_VIEWBOX.height - PLOT_INSET.bottom}
          y2={CHART_VIEWBOX.height - PLOT_INSET.bottom}
        />
        <line
          className="rater-bar-chart-axis"
          x1={PLOT_INSET.left}
          x2={PLOT_INSET.left}
          y1={PLOT_INSET.top}
          y2={CHART_VIEWBOX.height - PLOT_INSET.bottom}
        />

        {/* Brief 45 PR 45.3 — "= identity" label at the right end
            of the baseline line (Q8 lock — ref line always visible). */}
        <text
          className="rater-bar-chart-identity-label"
          x={CHART_VIEWBOX.width - PLOT_INSET.right + 4}
          y={baselineY + 3}
          textAnchor="start"
          data-testid={`${testId}-identity-label`}
        >
          = identity
        </text>

        {/* Selection X-extent region (rendered behind bars) */}
        {selectionExtent && (
          <rect
            className="rater-bar-chart-selection-region"
            x={selectionExtent.x1}
            width={selectionExtent.x2 - selectionExtent.x1}
            y={PLOT_INSET.top}
            height={
              CHART_VIEWBOX.height - PLOT_INSET.top - PLOT_INSET.bottom
            }
            data-testid={`${testId}-selection-region`}
          />
        )}

        {/* PR 34.6 — Filed-value tick markers (compare overlay).
            One thin dashed horizontal across each slot at the
            filed-y; lets the actuary read the previous level
            against the current bar without obscuring it. */}
        {filedValues && (
          <g
            className="rater-bar-chart-filed-overlay"
            data-testid={`${testId}-filed-overlay`}
          >
            {data.map((d, i) => {
              const f = filedValues.get(d.key);
              if (f === undefined) return null;
              const pos = xPositions[i];
              if (!pos) return null;
              const y = valueToY(f, yAxis.min, yAxis.max);
              const tickHalf = (pos.slot * BAR_WIDTH_FRACTION) / 2;
              return (
                <line
                  key={`filed-${d.key}`}
                  className="rater-bar-chart-filed-tick"
                  x1={pos.center - tickHalf}
                  x2={pos.center + tickHalf}
                  y1={y}
                  y2={y}
                  data-testid={`${testId}-filed-tick-${d.key}`}
                />
              );
            })}
          </g>
        )}

        {/* Bars + value labels */}
        {data.map((d, i) => {
          const pos = xPositions[i];
          if (!pos) return null;
          const valueY = valueToY(d.value, yAxis.min, yAxis.max);
          // Bar grows from baseline → value (could be up OR down).
          const top = Math.min(valueY, baselineY);
          const height = Math.abs(valueY - baselineY);
          const barWidth = pos.slot * BAR_WIDTH_FRACTION;
          const barX = pos.center - barWidth / 2;
          const tint = classify(d.value, baseline);
          const isFocused = effectiveFocus === d.key;
          const isSelected = selectedKeys?.has(d.key) ?? false;
          const isDimmed =
            effectiveFocus !== null &&
            effectiveFocus !== undefined &&
            !isFocused;
          return (
            <g
              key={d.key}
              className={`rater-bar-chart-bar is-${tint}${
                isFocused ? " is-focused" : ""
              }${isSelected ? " is-selected" : ""}${
                isDimmed ? " is-dimmed" : ""
              }`}
              data-testid={`${testId}-bar-${d.key}`}
              data-tint={tint}
              data-focused={isFocused ? "true" : "false"}
              data-selected={isSelected ? "true" : "false"}
              onMouseEnter={() => {
                setHoverKey(d.key);
                onHoverChange?.(d.key);
              }}
              onMouseLeave={() => {
                setHoverKey(null);
                onHoverChange?.(null);
              }}
            >
              {/* Hover hit-area covers the full slot, not just the bar. */}
              <rect
                className="rater-bar-chart-hover-area"
                x={pos.center - pos.slot / 2}
                width={pos.slot}
                y={PLOT_INSET.top}
                height={
                  CHART_VIEWBOX.height - PLOT_INSET.top - PLOT_INSET.bottom
                }
              />
              {/* The bar itself — Brief 45 PR 45.3 paints inline
                  via the continuous gradient. `data-tint` survives on
                  the parent <g> for downstream CSS / test hooks. */}
              <rect
                className="rater-bar-chart-bar-rect"
                x={barX}
                width={barWidth}
                y={top}
                height={Math.max(height, 1)}
                rx={2}
                fill={factorGradient(d.value, baseline)}
              />
              {/* Value label — PR 45.10. Hover-only: emit ONLY for
                  the focused bar (whether by external focusedKey or
                  internal hover). The user's screenshot showed
                  adjacent same-value bars rendering "1.2.2.2" smush
                  because top-K filtering can't separate values that
                  happen to cluster. Color + size + rich tooltip do
                  the always-on work; the value text only surfaces
                  when the user expresses interest by pointing at a
                  specific bar. */}
              {isFocused && (
                <text
                  className="rater-bar-chart-value-label"
                  x={pos.center}
                  y={d.value >= baseline ? top - 4 : top + height + 12}
                  textAnchor="middle"
                >
                  {formatValueLabel(d.value)}
                </text>
              )}
            </g>
          );
        })}

        {/* X labels — PR 45.10. Rotated -45° (text-anchor "end" so
            the rightmost glyph anchors at the tick; the rest of the
            label extends down-left below the axis). Math: a vector
            pointing LEFT (-1, 0) rotated by -45° in SVG (which is
            CCW visually because of y-down coords) becomes
            (-0.707, +0.707) — i.e. down-left. The extra 30 viewBox
            units of PLOT_INSET.bottom from this PR give the rotated
            text room to render without clipping past the SVG edge. */}
        {data.map((d, i) => {
          if (!visibleLabelIndices.includes(i)) return null;
          const pos = xPositions[i];
          if (!pos) return null;
          const display = truncateLabel(d.label, labelMax);
          const baseY = CHART_VIEWBOX.height - PLOT_INSET.bottom + 12;
          return (
            <text
              key={`x-${d.key}`}
              className="rater-bar-chart-x-label"
              x={pos.center}
              y={baseY}
              textAnchor="end"
              transform={`rotate(-45 ${pos.center} ${baseY})`}
              data-testid={`${testId}-x-label-${d.key}`}
            >
              {display}
            </text>
          );
        })}

        {/* Active brush overlay (top, pointer-events:none) */}
        {brushState.isBrushing && brushState.rect && (
          <rect
            className="rater-bar-chart-brush-rect"
            x={Math.min(brushState.rect.x1, brushState.rect.x2)}
            width={Math.abs(brushState.rect.x2 - brushState.rect.x1)}
            y={PLOT_INSET.top}
            height={
              CHART_VIEWBOX.height - PLOT_INSET.top - PLOT_INSET.bottom
            }
            data-testid={`${testId}-brush-rect`}
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
}

/** Format a data-point label inline. Three decimals max. */
function formatValueLabel(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(3).replace(/\.?0+$/, "") || "0";
}
