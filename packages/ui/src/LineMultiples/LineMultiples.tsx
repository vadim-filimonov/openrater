/**
 * <LineMultiples> — Brief 34 PR 34.2 (2-D banded × categorical
 * primitive).
 *
 * Per Brief 34 §4.4 + mockup Frame 1: "the cold-test hero." One
 * line per column, all lines on the same axis. Lets the actuary
 * compare row-shape across cols ("does Frame increase faster than
 * JM?"). The legend is the column dim's levels.
 *
 * Series colors cycle through a 6-color palette (azure, purple,
 * emerald, amber, rose, cyan). Columns where every cell is at the
 * baseline (1.0) get the special "all-default" treatment: dashed
 * gray line. This is a calm cue that the actuary hasn't
 * differentiated that column yet.
 *
 * Hover any line → that line stays at full opacity, siblings dim
 * to 40%. `focusedColId` enables cross-highlight from the grid
 * side of the split view (PR 34.5 wires it).
 *
 * Pure presentation. Parent owns:
 *   • Axes (row = X / banded; col = the legend / categorical)
 *   • Cell values (Map<key, number>)
 *   • Baseline
 *   • focusedColId (cross-highlight from the grid)
 *   • onHoverChange callback
 */

import { useMemo, useState, type JSX } from "react";
import {
  cellKey,
  type FactorTableGrid2DAxis,
} from "../FactorTableGrid2D";
import {
  cellKeysInXExtent2D,
  type BrushRect,
} from "../FactorTableViz/brushSelect";
import { useBrush1D } from "../FactorTableViz/useBrush1D";
import {
  CHART_VIEWBOX,
  PLOT_INSET,
  computeXPositions,
  computeYTicks,
  pickVisibleXLabels,
  valueToY,
  DEFAULT_BASELINE,
} from "../LineChart";
import "./LineMultiples.css";

/**
 * 6-color palette for series. Rotates by index. Matches the mockup
 * Frame 1's choices (azure / purple) plus four more to cover up to
 * 6 columns without collisions. Beyond 6 the palette cycles —
 * acceptable since beyond 6 series the chart becomes unreadable
 * regardless of color (PR 34.4 will recommend grouping in that
 * case).
 *
 * Polish PR 9f (audit §C3): the palette routes through the canonical
 * `--rater-cat-categorical-{1..8}` aliases instead of raw-palette
 * hues. The categorical alias layer was designed for exactly this
 * use case — a fixed-order distinguishing palette for line / bar
 * series. The original mockup colors (azure / purple / emerald /
 * amber / rose / cyan) map to the categorical layer's azure / violet
 * / emerald / amber / red / dim-emerald — minor hue shifts but the
 * chart's "distinct enough to tell apart" contract is preserved.
 */
export const LINE_MULTIPLES_PALETTE: readonly string[] = [
  "var(--rater-cat-categorical-1)", // azure
  "var(--rater-cat-categorical-4)", // violet (was purple)
  "var(--rater-cat-categorical-2)", // emerald
  "var(--rater-cat-categorical-3)", // amber
  "var(--rater-cat-categorical-5)", // red (was rose)
  "var(--rater-cat-categorical-7)", // dim emerald (was cyan)
];

/** Threshold for "all-default" — within 1% of baseline. */
const DEFAULT_EPSILON = 0.01;

export interface LineMultiplesProps {
  /** Row axis (X axis values — banded, ordered). */
  readonly rowAxis: FactorTableGrid2DAxis;
  /** Column axis (the legend — one series per col). */
  readonly colAxis: FactorTableGrid2DAxis;
  /** Cell values keyed by `cellKey(rowId, colId)`. */
  readonly cells: ReadonlyMap<string, number>;
  /** Baseline (typically 1.0). */
  readonly baseline?: number;
  /**
   * Currently focused col id (the line to highlight). Siblings dim
   * to 40%. Drives cross-highlight from the grid side.
   */
  readonly focusedColId?: string;
  /**
   * Fires when the user hovers a series (line or its legend swatch).
   */
  readonly onHoverChange?: (colId: string | null) => void;
  /**
   * PR 34.5 — Selected cellKey set. Markers whose cellKey is in
   * the set gain a thicker stroke; a soft X-extent overlay shows
   * the band-range of the selection.
   */
  readonly selectedKeys?: ReadonlySet<string>;
  /**
   * PR 34.6 — Filed-snapshot values keyed by `cellKey(rowId, colId)`.
   * When provided, each series gets a dashed-gray ghost line
   * rendered behind the current series. Cells missing from the
   * filed map are skipped (no ghost marker).
   */
  readonly filedCells?: ReadonlyMap<string, number>;
  /**
   * PR 34.5 — Fires when the user finishes a brush gesture. Emits
   * cellKey(rowId, colId) for every (rowId in extent) × (every
   * colId) — i.e., the brush selects bands across all series in
   * one stroke (matches Brief 34 §3 J4).
   */
  readonly onBrushSelect?: (keys: ReadonlySet<string>) => void;
  /**
   * Hide the legend below the chart. Defaults to false. Useful
   * when the parent surfaces the legend in the toolbar.
   */
  readonly hideLegend?: boolean;
  readonly ariaLabel?: string;
  readonly testId?: string;
}

interface Series {
  readonly colId: string;
  readonly colLabel: string;
  readonly color: string;
  readonly isAllDefault: boolean;
  readonly points: ReadonlyArray<{
    readonly rowId: string;
    readonly value: number;
  }>;
}

export function LineMultiples(props: LineMultiplesProps): JSX.Element {
  const {
    rowAxis,
    colAxis,
    cells,
    baseline = DEFAULT_BASELINE,
    focusedColId,
    onHoverChange,
    selectedKeys,
    onBrushSelect,
    filedCells,
    hideLegend = false,
    ariaLabel = "Small multiples line chart",
    testId = "rater-line-multiples",
  } = props;

  const [hoverColId, setHoverColId] = useState<string | null>(null);
  const effectiveFocus = focusedColId ?? hoverColId;

  // ── Build series ────────────────────────────────────────────────
  // For each col, walk the row axis and pick up the cell values
  // that actually have a value. Skip missing cells (don't break the
  // line — just stop drawing through them).
  const series = useMemo<Series[]>(() => {
    return colAxis.values.map((col, colIdx) => {
      const points: { readonly rowId: string; readonly value: number }[] = [];
      let allDefault = true;
      for (const row of rowAxis.values) {
        const v = cells.get(cellKey(row.id, col.id));
        if (v === undefined) {
          allDefault = false; // missing ≠ all-default
          continue;
        }
        points.push({ rowId: row.id, value: v });
        if (Math.abs(v - baseline) > baseline * DEFAULT_EPSILON) {
          allDefault = false;
        }
      }
      const color =
        LINE_MULTIPLES_PALETTE[colIdx % LINE_MULTIPLES_PALETTE.length]!;
      return {
        colId: col.id,
        colLabel: col.label,
        color: allDefault
          ? "var(--rater-text-muted, #71717a)"
          : color,
        isAllDefault: allDefault && points.length > 0,
        points,
      };
    });
  }, [rowAxis, colAxis, cells, baseline]);

  // ── Axes ────────────────────────────────────────────────────────
  // Y axis spans the union of all visible values + (PR 34.6) any
  // filed values when compare mode is on, so ghost lines don't
  // clip the plot.
  const allValues = useMemo(() => {
    const out: number[] = [];
    for (const s of series) {
      for (const p of s.points) out.push(p.value);
    }
    if (filedCells) {
      for (const v of filedCells.values()) out.push(v);
    }
    return out;
  }, [series, filedCells]);
  const yAxis = useMemo(
    () => computeYTicks(allValues, baseline),
    [allValues, baseline],
  );
  const xPositions = useMemo(
    () => computeXPositions(rowAxis.values.length),
    [rowAxis.values.length],
  );

  // ── PR 34.5 — Brush gesture (no click-to-focus for v1) ──────────
  const rowIds = useMemo(
    () => rowAxis.values.map((r) => r.id),
    [rowAxis],
  );
  const colIds = useMemo(
    () => colAxis.values.map((c) => c.id),
    [colAxis],
  );
  const { state: brushState, svgRef, handlers: brushHandlers } = useBrush1D({
    enabled: onBrushSelect !== undefined,
    onBrushEnd: (rect: BrushRect) => {
      if (!onBrushSelect) return;
      const keys = cellKeysInXExtent2D({
        rowIds,
        colIds,
        xPositions,
        brush: rect,
      });
      onBrushSelect(keys);
    },
    y1: PLOT_INSET.top,
    y2: CHART_VIEWBOX.height - PLOT_INSET.bottom,
  });

  // Selection X-extent: the union of row positions whose cellKey is
  // in any selectedKey. (We treat the chart selection as banded.)
  const selectionExtent = useMemo<{ x1: number; x2: number } | null>(() => {
    if (!selectedKeys || selectedKeys.size === 0) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < rowAxis.values.length; i++) {
      const row = rowAxis.values[i];
      const pos = xPositions[i];
      if (!row || !pos) continue;
      // Any cellKey starting with row.id::… counts as selecting the band.
      const prefix = `${row.id}::`;
      let hit = false;
      for (const k of selectedKeys) {
        if (k === row.id || k.startsWith(prefix)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      xMin = Math.min(xMin, pos.center - pos.slot / 2);
      xMax = Math.max(xMax, pos.center + pos.slot / 2);
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return null;
    return { x1: xMin, x2: xMax };
  }, [selectedKeys, rowAxis, xPositions]);
  const visibleLabelIndices = useMemo(() => {
    if (rowAxis.values.length === 0) return [];
    const slotWidth =
      (CHART_VIEWBOX.width - PLOT_INSET.left - PLOT_INSET.right) /
      rowAxis.values.length;
    return pickVisibleXLabels(
      rowAxis.values.map((r) => r.label),
      slotWidth,
    );
  }, [rowAxis]);

  // ── Empty state ────────────────────────────────────────────────
  if (
    rowAxis.values.length === 0 ||
    colAxis.values.length === 0 ||
    series.every((s) => s.points.length === 0)
  ) {
    return (
      <div
        className="rater-line-multiples rater-line-multiples--empty"
        data-testid={testId}
        role="img"
        aria-label={ariaLabel}
      >
        <span className="rater-line-multiples-empty-text">
          No data to plot
        </span>
      </div>
    );
  }

  return (
    <div
      className="rater-line-multiples"
      data-testid={testId}
      data-focused-col-id={effectiveFocus ?? ""}
      data-brushing={brushState.isBrushing ? "true" : "false"}
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        ref={svgRef}
        className="rater-line-multiples-svg"
        viewBox={`0 0 ${CHART_VIEWBOX.width} ${CHART_VIEWBOX.height}`}
        preserveAspectRatio="none"
        data-testid={`${testId}-svg`}
        {...(onBrushSelect !== undefined ? brushHandlers : {})}
      >
        {/* Y gridlines + labels */}
        {yAxis.ticks.map((tick) => {
          const isBaseline = Math.abs(tick.value - baseline) < 1e-6;
          return (
            <g key={`y-${tick.value}`}>
              <line
                className={`rater-line-multiples-gridline${
                  isBaseline ? " is-baseline" : ""
                }`}
                x1={PLOT_INSET.left}
                x2={CHART_VIEWBOX.width - PLOT_INSET.right}
                y1={tick.y}
                y2={tick.y}
              />
              <text
                className="rater-line-multiples-y-label"
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
          className="rater-line-multiples-axis"
          x1={PLOT_INSET.left}
          x2={CHART_VIEWBOX.width - PLOT_INSET.right}
          y1={CHART_VIEWBOX.height - PLOT_INSET.bottom}
          y2={CHART_VIEWBOX.height - PLOT_INSET.bottom}
        />
        <line
          className="rater-line-multiples-axis"
          x1={PLOT_INSET.left}
          x2={PLOT_INSET.left}
          y1={PLOT_INSET.top}
          y2={CHART_VIEWBOX.height - PLOT_INSET.bottom}
        />

        {/* Selection X-extent region (behind series) */}
        {selectionExtent && (
          <rect
            className="rater-line-multiples-selection-region"
            x={selectionExtent.x1}
            width={selectionExtent.x2 - selectionExtent.x1}
            y={PLOT_INSET.top}
            height={
              CHART_VIEWBOX.height - PLOT_INSET.top - PLOT_INSET.bottom
            }
            data-testid={`${testId}-selection-region`}
          />
        )}

        {/* PR 34.6 — Filed-snapshot ghost lines (one per col).
            Rendered before the live series so the current lines
            sit on top visually. */}
        {filedCells && (
          <g
            className="rater-line-multiples-filed-overlay"
            data-testid={`${testId}-filed-overlay`}
          >
            {colAxis.values.map((col) => {
              const pts: string[] = [];
              for (const row of rowAxis.values) {
                const f = filedCells.get(cellKey(row.id, col.id));
                if (f === undefined) continue;
                const rIdx = rowAxis.values.findIndex((r) => r.id === row.id);
                const x = xPositions[rIdx]?.center ?? PLOT_INSET.left;
                const y = valueToY(f, yAxis.min, yAxis.max);
                pts.push(`${x},${y}`);
              }
              if (pts.length < 2) return null;
              return (
                <polyline
                  key={`filed-${col.id}`}
                  className="rater-line-multiples-filed-polyline"
                  points={pts.join(" ")}
                  data-testid={`${testId}-filed-${col.id}`}
                />
              );
            })}
          </g>
        )}

        {/* Series — one polyline per column */}
        {series.map((s) => {
          if (s.points.length === 0) return null;
          const pointsStr = s.points
            .map((p) => {
              const rIdx = rowAxis.values.findIndex(
                (r) => r.id === p.rowId,
              );
              const x = xPositions[rIdx]?.center ?? PLOT_INSET.left;
              const y = valueToY(p.value, yAxis.min, yAxis.max);
              return `${x},${y}`;
            })
            .join(" ");
          const isFocused = effectiveFocus === s.colId;
          const isDimmed =
            effectiveFocus !== null &&
            effectiveFocus !== undefined &&
            !isFocused;
          return (
            <g
              key={s.colId}
              className={`rater-line-multiples-series${
                s.isAllDefault ? " is-all-default" : ""
              }${isFocused ? " is-focused" : ""}${
                isDimmed ? " is-dimmed" : ""
              }`}
              data-testid={`${testId}-series-${s.colId}`}
              data-all-default={s.isAllDefault ? "true" : "false"}
              data-focused={isFocused ? "true" : "false"}
              onMouseEnter={() => {
                setHoverColId(s.colId);
                onHoverChange?.(s.colId);
              }}
              onMouseLeave={() => {
                setHoverColId(null);
                onHoverChange?.(null);
              }}
            >
              <polyline
                className="rater-line-multiples-polyline"
                fill="none"
                stroke={s.color}
                strokeWidth={isFocused ? 2.5 : 2}
                strokeDasharray={s.isAllDefault ? "3,3" : undefined}
                points={pointsStr}
              />
              {s.points.map((p) => {
                const rIdx = rowAxis.values.findIndex(
                  (r) => r.id === p.rowId,
                );
                const x = xPositions[rIdx]?.center ?? PLOT_INSET.left;
                const y = valueToY(p.value, yAxis.min, yAxis.max);
                return (
                  <circle
                    key={p.rowId}
                    className="rater-line-multiples-marker"
                    cx={x}
                    cy={y}
                    r={isFocused ? 4 : 3}
                    fill={s.color}
                  />
                );
              })}
            </g>
          );
        })}

        {/* X labels (with collision avoidance) */}
        {rowAxis.values.map((row, i) => {
          if (!visibleLabelIndices.includes(i)) return null;
          const pos = xPositions[i];
          if (!pos) return null;
          return (
            <text
              key={`x-${row.id}`}
              className="rater-line-multiples-x-label"
              x={pos.center}
              y={CHART_VIEWBOX.height - PLOT_INSET.bottom + 14}
              textAnchor="middle"
              data-testid={`${testId}-x-label-${row.id}`}
            >
              {row.label}
            </text>
          );
        })}

        {/* Active brush overlay (top, pointer-events:none) */}
        {brushState.isBrushing && brushState.rect && (
          <rect
            className="rater-line-multiples-brush-rect"
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

      {!hideLegend && (
        <div
          className="rater-line-multiples-legend"
          data-testid={`${testId}-legend`}
        >
          {series.map((s) => {
            const isFocused = effectiveFocus === s.colId;
            const isDimmed =
              effectiveFocus !== null &&
              effectiveFocus !== undefined &&
              !isFocused;
            return (
              <button
                type="button"
                key={s.colId}
                className={`rater-line-multiples-legend-entry${
                  s.isAllDefault ? " is-all-default" : ""
                }${isFocused ? " is-focused" : ""}${
                  isDimmed ? " is-dimmed" : ""
                }`}
                data-testid={`${testId}-legend-${s.colId}`}
                onMouseEnter={() => {
                  setHoverColId(s.colId);
                  onHoverChange?.(s.colId);
                }}
                onMouseLeave={() => {
                  setHoverColId(null);
                  onHoverChange?.(null);
                }}
              >
                <span
                  className="rater-line-multiples-legend-swatch"
                  style={{ background: s.color }}
                  aria-hidden
                />
                <span className="rater-line-multiples-legend-label">
                  {s.colLabel}
                  {s.isAllDefault && (
                    <span className="rater-line-multiples-legend-note">
                      {" "}
                      (all default)
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
