/**
 * <LineChart> — Brief 34 PR 34.1 + PR 34.5 + Brief 45 PR 45.3
 * (1-D banded primitive).
 *
 * SVG-rendered line chart for 1-D banded factor tables. Brief 34
 * §4.2 + mockup Frame 3 shipped the structural layer (polyline +
 * markers + outlier callouts + brush); Brief 45 PR 45.3 layers the
 * redesigned visual language on top:
 *
 *   • Continuous gradient color encoding ON MARKERS — the line
 *     itself stays neutral so the curve shape reads independent
 *     of magnitude (Brief 45 §1.4). Marker fill comes from
 *     `factorGradient(value, baseline)`.
 *   • Subtle area fill under the polyline — vertical gradient
 *     (orange-up / azure-down centered on identity) at low
 *     opacity. Reinforces "above / below identity" without
 *     competing with the markers.
 *   • Reference line at 1.0, always visible, with inline
 *     `= identity` label at the right end (Q8 lock).
 *
 *   • Polyline connects markers at each band's midpoint
 *   • Baseline rendered as a dashed horizontal at y=1.0
 *   • Hand-rolled axes with tick collision avoidance
 *   • `focusedKey` prop enables cross-highlight (markers grow + dim
 *     siblings)
 *   • `outlierKeys` paint the matching marker red with a callout
 *     line down to the X axis (used for monotonicity-break detect)
 *   • PR 34.5 — `selectedKeys` tints the matching markers + a soft
 *     X-extent region overlay; `onBrushSelect` fires on drag-rect;
 *     `onPointClick` fires on a non-drag click for click-to-focus
 *
 * Pure presentation. Parent owns:
 *   • Data series (key + label + value, ordered) — axis order is
 *     canonical (Brief 45 Q1: banded dims have a sequence; the
 *     curve shape IS the signal — sort would scramble it).
 *   • Baseline value (defaults to 1.0)
 *   • focusedKey for cross-highlight
 *   • selectedKeys for selection tint
 *   • outlierKeys for monotonicity / outlier highlighting
 *   • Hover + click + brush handlers
 *   • Brief 45 — rich tooltip rendering. LineChart still emits
 *     `onHoverChange(key | null)`; the consumer (`<FactorTableViz>`)
 *     wires that into `<FactorTooltip>`.
 */

import { useId, useMemo, useState, type JSX } from "react";
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
} from "./chartAxis";
import "./LineChart.css";

export interface LineChartDatum {
  /** Stable id (typically the dim level id, e.g. "band_0_5"). */
  readonly key: string;
  /** Display label rendered below the X axis. */
  readonly label: string;
  /** Numeric value. */
  readonly value: number;
}

export interface LineChartProps {
  readonly data: readonly LineChartDatum[];
  /** Baseline (typically 1.0 — the multiplicative identity). */
  readonly baseline?: number;
  /**
   * Currently focused datum key — its marker grows + siblings dim.
   * Drives cross-highlight from the grid. When undefined, no datum
   * is focused.
   */
  readonly focusedKey?: string;
  /**
   * Datum keys flagged as outliers (e.g., monotonicity breaks).
   * Renders the marker red + a callout line down to the X axis.
   */
  readonly outlierKeys?: ReadonlySet<string>;
  /**
   * PR 34.5 — Datum keys currently selected in the grid. Their
   * markers gain a soft tint + a thin X-extent region overlay
   * shows the band on the plot.
   */
  readonly selectedKeys?: ReadonlySet<string>;
  /**
   * PR 34.6 — Filed-snapshot values keyed by datum key. When
   * provided, a dashed-gray "ghost" polyline + markers render
   * under the current line so the actuary sees how this version
   * compares to filed. Per Brief 34 §5 J3: "Compare-toggle →
   * overlay rendered in < 200ms; deltas legible at a glance."
   * Datum keys missing from this map are skipped (no ghost
   * marker for them).
   */
  readonly filedValues?: ReadonlyMap<string, number>;
  /**
   * Fires when the user hovers a datum. The parent can use this
   * to cross-highlight the matching grid cell.
   */
  readonly onHoverChange?: (key: string | null) => void;
  /**
   * PR 34.5 — Fires when the user finishes a brush gesture.
   * The set contains every datum key whose X-center falls within
   * the brush extent. When omitted, brush is disabled.
   */
  readonly onBrushSelect?: (keys: ReadonlySet<string>) => void;
  /**
   * PR 34.5 — Fires when the user clicks a datum without dragging.
   * The parent typically focuses + scrolls to the matching grid
   * cell. When omitted, click-to-focus is disabled.
   */
  readonly onPointClick?: (key: string) => void;
  /**
   * Optional aria-label for the chart container. Defaults to a
   * generic description.
   */
  readonly ariaLabel?: string;
  readonly testId?: string;
}

export function LineChart(props: LineChartProps): JSX.Element {
  const {
    data,
    baseline = DEFAULT_BASELINE,
    focusedKey,
    outlierKeys,
    selectedKeys,
    filedValues,
    onHoverChange,
    onBrushSelect,
    onPointClick,
    ariaLabel = "Line chart",
    testId = "rater-line-chart",
  } = props;

  // Track hover locally too so we render correctly even if the
  // parent doesn't echo focusedKey back.
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const effectiveFocus = focusedKey ?? hoverKey;

  // Brief 45 PR 45.3 — unique gradient id per instance (multiple
  // LineChart instances on the same page would collide on a static
  // id). Used for the area-fill `linearGradient`.
  const gradientUid = useId();
  const areaGradientId = `rater-line-chart-area-${gradientUid.replace(/:/g, "")}`;

  // ── Axes ────────────────────────────────────────────────────────
  // Include filed values in the y-axis range so the ghost line
  // doesn't get clipped when compare mode flips on.
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
  // PR 45.10 — Rotated x-labels at -45° relax the horizontal-stride
  // pressure; truncate every label to 14 chars and trust the
  // pickVisibleXLabels stride to drop any that would still collide.
  const labelMax = 14;

  const visibleLabelIndices = useMemo(() => {
    if (data.length === 0) return [];
    const slotWidth =
      (CHART_VIEWBOX.width - PLOT_INSET.left - PLOT_INSET.right) /
      data.length;
    // Pass a tighter approxCharWidth (3 instead of 6) since the
    // labels render at -45° — their horizontal footprint is roughly
    // half the unrotated width (cos 45° ≈ 0.71). More labels fit.
    return pickVisibleXLabels(
      data.map((d) => truncateLabel(d.label, labelMax)),
      slotWidth,
      3,
    );
  }, [data]);

  // ── Path string for the polyline ────────────────────────────────
  const pathPoints = useMemo(() => {
    if (data.length === 0) return "";
    return data
      .map((d, i) => {
        const x = xPositions[i]?.center ?? PLOT_INSET.left;
        const y = valueToY(d.value, yAxis.min, yAxis.max);
        return `${x},${y}`;
      })
      .join(" ");
  }, [data, xPositions, yAxis]);

  // Brief 45 PR 45.3 — closed area-fill path (polyline + drop to
  // the X axis). Subtle vertical gradient anchored to the baseline.
  const areaPath = useMemo(() => {
    if (data.length === 0) return "";
    const segs: string[] = [];
    data.forEach((d, i) => {
      const x = xPositions[i]?.center ?? PLOT_INSET.left;
      const y = valueToY(d.value, yAxis.min, yAxis.max);
      segs.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
    });
    const lastX =
      xPositions[xPositions.length - 1]?.center ??
      CHART_VIEWBOX.width - PLOT_INSET.right;
    const firstX = xPositions[0]?.center ?? PLOT_INSET.left;
    const xAxisY = CHART_VIEWBOX.height - PLOT_INSET.bottom;
    segs.push(`L ${lastX} ${xAxisY}`);
    segs.push(`L ${firstX} ${xAxisY}`);
    segs.push("Z");
    return segs.join(" ");
  }, [data, xPositions, yAxis]);

  // Baseline (identity) y position — drives the area-gradient pivot
  // and the `= identity` label placement.
  const baselineY = useMemo(
    () => valueToY(baseline, yAxis.min, yAxis.max),
    [baseline, yAxis],
  );

  // The area gradient anchors orange-up / azure-down at the
  // baseline. SVG `linearGradient` units are normalized to the
  // bounding box of the consumer element — convert baselineY into a
  // 0..1 ratio across the plot region.
  const baselineRatio = useMemo(() => {
    const top = PLOT_INSET.top;
    const bottom = CHART_VIEWBOX.height - PLOT_INSET.bottom;
    return (baselineY - top) / (bottom - top);
  }, [baselineY]);

  // ── PR 34.5 — Brush / click gesture ─────────────────────────────
  const dataKeys = useMemo(() => data.map((d) => d.key), [data]);
  const brushEnabled = onBrushSelect !== undefined || onPointClick !== undefined;
  const { state: brushState, svgRef, handlers: brushHandlers } = useBrush1D({
    enabled: brushEnabled,
    onBrushEnd: (rect: BrushRect) => {
      if (!onBrushSelect) return;
      const keys = keysInXExtent({
        dataKeys,
        xPositions,
        brush: rect,
      });
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

  // Selected-keys region overlay — show the X-extent of the
  // selection on the plot so the brush result reads as persistent.
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
        className="rater-line-chart rater-line-chart--empty"
        data-testid={testId}
        role="img"
        aria-label={ariaLabel}
      >
        <span className="rater-line-chart-empty-text">
          No data to plot
        </span>
      </div>
    );
  }

  return (
    <div
      className="rater-line-chart"
      data-testid={testId}
      data-focused-key={effectiveFocus ?? ""}
      data-brushing={brushState.isBrushing ? "true" : "false"}
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        ref={svgRef}
        className="rater-line-chart-svg"
        viewBox={`0 0 ${CHART_VIEWBOX.width} ${CHART_VIEWBOX.height}`}
        preserveAspectRatio="none"
        data-testid={`${testId}-svg`}
        {...(brushEnabled ? brushHandlers : {})}
      >
        {/* Brief 45 PR 45.3 — defs: vertical gradient for the
            area fill (orange-up / azure-down pivoting at the
            baseline ratio). Each instance gets a unique id so
            multiple LineCharts on a page don't collide. */}
        <defs>
          <linearGradient
            id={areaGradientId}
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.5" />
            <stop
              offset={`${Math.max(0, Math.min(1, baselineRatio)) * 100}%`}
              stopColor="#d4d4d8"
              stopOpacity="0.25"
            />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {/* Y gridlines + labels */}
        {yAxis.ticks.map((tick) => {
          const isBaseline = Math.abs(tick.value - baseline) < 1e-6;
          return (
            <g
              key={`y-${tick.value}`}
              data-testid={`${testId}-y-tick-${tick.value}`}
            >
              <line
                className={`rater-line-chart-gridline${
                  isBaseline ? " is-baseline" : ""
                }`}
                x1={PLOT_INSET.left}
                x2={CHART_VIEWBOX.width - PLOT_INSET.right}
                y1={tick.y}
                y2={tick.y}
              />
              <text
                className="rater-line-chart-y-label"
                x={PLOT_INSET.left - 6}
                y={tick.y + 3}
                textAnchor="end"
              >
                {tick.label}
              </text>
            </g>
          );
        })}

        {/* X axis line */}
        <line
          className="rater-line-chart-axis"
          x1={PLOT_INSET.left}
          x2={CHART_VIEWBOX.width - PLOT_INSET.right}
          y1={CHART_VIEWBOX.height - PLOT_INSET.bottom}
          y2={CHART_VIEWBOX.height - PLOT_INSET.bottom}
        />
        <line
          className="rater-line-chart-axis"
          x1={PLOT_INSET.left}
          x2={PLOT_INSET.left}
          y1={PLOT_INSET.top}
          y2={CHART_VIEWBOX.height - PLOT_INSET.bottom}
        />

        {/* Brief 45 PR 45.3 — "= identity" label at the right end
            of the baseline line (Q8 lock — always visible). */}
        <text
          className="rater-line-chart-identity-label"
          x={CHART_VIEWBOX.width - PLOT_INSET.right + 4}
          y={baselineY + 3}
          textAnchor="start"
          data-testid={`${testId}-identity-label`}
        >
          = identity
        </text>

        {/* Selection X-extent region (rendered behind the polyline) */}
        {selectionExtent && (
          <rect
            className="rater-line-chart-selection-region"
            x={selectionExtent.x1}
            width={selectionExtent.x2 - selectionExtent.x1}
            y={PLOT_INSET.top}
            height={
              CHART_VIEWBOX.height - PLOT_INSET.top - PLOT_INSET.bottom
            }
            data-testid={`${testId}-selection-region`}
          />
        )}

        {/* PR 34.6 — Filed-snapshot ghost polyline + markers
            (rendered behind the live polyline so the current line
            stays visually dominant). */}
        {filedValues && (
          <g
            className="rater-line-chart-filed-overlay"
            data-testid={`${testId}-filed-overlay`}
          >
            <polyline
              className="rater-line-chart-filed-polyline"
              points={data
                .map((d, i) => {
                  const f = filedValues.get(d.key);
                  if (f === undefined) return null;
                  const x = xPositions[i]?.center ?? PLOT_INSET.left;
                  const y = valueToY(f, yAxis.min, yAxis.max);
                  return `${x},${y}`;
                })
                .filter((p): p is string => p !== null)
                .join(" ")}
            />
            {data.map((d, i) => {
              const f = filedValues.get(d.key);
              if (f === undefined) return null;
              const pos = xPositions[i];
              if (!pos) return null;
              const cy = valueToY(f, yAxis.min, yAxis.max);
              return (
                <circle
                  key={`filed-${d.key}`}
                  className="rater-line-chart-filed-marker"
                  cx={pos.center}
                  cy={cy}
                  r={3}
                  data-testid={`${testId}-filed-marker-${d.key}`}
                />
              );
            })}
          </g>
        )}

        {/* Brief 45 PR 45.3 — Subtle area fill under the line.
            Vertical gradient orange-up / azure-down pivoting at
            the identity baseline. Renders behind the polyline at
            low opacity so it never competes for attention. */}
        {data.length > 1 && (
          <path
            className="rater-line-chart-area"
            d={areaPath}
            fill={`url(#${areaGradientId})`}
            data-testid={`${testId}-area`}
          />
        )}

        {/* Polyline */}
        <polyline
          className="rater-line-chart-polyline"
          points={pathPoints}
          data-testid={`${testId}-polyline`}
        />

        {/* Markers + value labels */}
        {data.map((d, i) => {
          const pos = xPositions[i];
          if (!pos) return null;
          const cy = valueToY(d.value, yAxis.min, yAxis.max);
          const isOutlier = outlierKeys?.has(d.key) ?? false;
          const isFocused = effectiveFocus === d.key;
          const isSelected = selectedKeys?.has(d.key) ?? false;
          const isDimmed =
            effectiveFocus !== null &&
            effectiveFocus !== undefined &&
            !isFocused;
          return (
            <g
              key={d.key}
              className={`rater-line-chart-point${
                isOutlier ? " is-outlier" : ""
              }${isFocused ? " is-focused" : ""}${
                isSelected ? " is-selected" : ""
              }${isDimmed ? " is-dimmed" : ""}`}
              data-testid={`${testId}-point-${d.key}`}
              data-outlier={isOutlier ? "true" : "false"}
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
              {/* Outlier callout: dashed line down to X axis */}
              {isOutlier && (
                <line
                  className="rater-line-chart-outlier-callout"
                  x1={pos.center}
                  x2={pos.center}
                  y1={cy}
                  y2={CHART_VIEWBOX.height - PLOT_INSET.bottom}
                />
              )}
              {/* Hover hit-area (transparent, wider than the marker). */}
              <circle
                className="rater-line-chart-hover-area"
                cx={pos.center}
                cy={cy}
                r="12"
              />
              {/* Marker — Brief 45 PR 45.3 paints inline via the
                  continuous gradient so each point reads its
                  factor magnitude in color. Outlier styling (red
                  fill via CSS) still wins via class specificity. */}
              <circle
                className="rater-line-chart-marker"
                cx={pos.center}
                cy={cy}
                r={isFocused ? 6 : isOutlier ? 5 : 4}
                fill={
                  isOutlier ? undefined : factorGradient(d.value, baseline)
                }
              />
              {/* Value label above the marker — PR 45.10. Hover-
                  only: emits only when this marker is the focused
                  one (external focusedKey OR internal hover). The
                  earlier top-K filter still produced "1.21.21.2"
                  smush when adjacent markers shared the same value
                  (the screenshot bug). Color + size signal
                  magnitude; the value text only appears on demand
                  via hover, and the rich tooltip carries the rest. */}
              {isFocused && (
                <text
                  className="rater-line-chart-value-label"
                  x={pos.center}
                  y={cy - 8}
                  textAnchor="middle"
                >
                  {formatValueLabel(d.value)}
                </text>
              )}
            </g>
          );
        })}

        {/* X labels — PR 45.10. Rotated -45° with text-anchor "end"
            so each label's rightmost glyph anchors at the marker
            tick + the rest extends down-left below the axis. */}
        {data.map((d, i) => {
          if (!visibleLabelIndices.includes(i)) return null;
          const pos = xPositions[i];
          if (!pos) return null;
          const isOutlier = outlierKeys?.has(d.key) ?? false;
          const display = truncateLabel(d.label, labelMax);
          const baseY = CHART_VIEWBOX.height - PLOT_INSET.bottom + 12;
          return (
            <text
              key={`x-${d.key}`}
              className={`rater-line-chart-x-label${isOutlier ? " is-outlier" : ""}`}
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

        {/* Active brush rectangle — rendered on top, pointer-
            events:none so it doesn't intercept marker hovers. */}
        {brushState.isBrushing && brushState.rect && (
          <rect
            className="rater-line-chart-brush-rect"
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
