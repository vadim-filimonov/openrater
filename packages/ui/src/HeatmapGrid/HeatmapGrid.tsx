/**
 * <HeatmapGrid> — Brief 34 PR 34.2 (2-D categorical × categorical
 * primitive).
 *
 * The 2-D heatmap that doubles as a chart and a grid. Per Brief 34
 * §4.3 + mockup Frame 4:
 *
 *   "The grid IS the heatmap."
 *
 * Each cell carries a background-color encoding from `heatBucket`.
 * Sticky col + row headers (carry from FactorTableGrid2D's visual
 * vocabulary). Read-only — no edit, no selection. Hover a cell →
 * tooltip surfaces the deviation as a percentage; row + col
 * headers tint to highlight the coordinate (PR 34.5 wires the
 * cross-highlight; this PR ships the cell encoding + header tint).
 *
 * Pure presentation. Parent owns:
 *   • Axes (row + col)
 *   • Cell values (Map<key, number>)
 *   • Baseline
 *   • focusedKey (cellKey of the focused cell — PR 34.5)
 *   • Hover handler (so the parent can cross-highlight the chart
 *     side of the split view)
 */

import { useCallback, useMemo, useState, type JSX } from "react";
import {
  cellKey,
  type FactorTableGrid2DAxis,
} from "../FactorTableGrid2D";
import {
  HEAT_BASELINE,
  HEAT_LEGEND_ENTRIES,
  formatHeatCell,
  heatBucket,
} from "./heatBucket";
import "./HeatmapGrid.css";

export interface HeatmapGridProps {
  /** Row axis. Required. */
  readonly rowAxis: FactorTableGrid2DAxis;
  /** Column axis. Required (heatmaps are inherently 2-D). */
  readonly colAxis: FactorTableGrid2DAxis;
  /**
   * Cell values keyed by `cellKey(rowId, colId)`. Cells absent
   * from the map render as empty + neutral.
   */
  readonly cells: ReadonlyMap<string, number>;
  /** Baseline (typically 1.0). */
  readonly baseline?: number;
  /**
   * Currently focused cellKey — the matching cell + its row + col
   * headers get a focus ring. Drives cross-highlight from the
   * chart side of the split view.
   */
  readonly focusedKey?: string;
  /**
   * PR 34.5 — Selected cellKey set. Cells in this set gain an
   * `is-selected` ring (visible on top of the heat encoding).
   */
  readonly selectedKeys?: ReadonlySet<string>;
  /**
   * PR 34.6 — Filed-snapshot values keyed by `cellKey(rowId, colId)`.
   * When provided, each cell shows a small mono delta annotation
   * beneath its value ("Δ +5.0%"). Cells absent from this map
   * render no delta annotation.
   */
  readonly filedCells?: ReadonlyMap<string, number>;
  /**
   * Fires when the user hovers a cell. The parent can use this
   * to cross-highlight the chart, or to surface a tooltip.
   */
  readonly onHoverChange?: (rowId: string, colId: string) => void;
  /**
   * PR 34.5 — Fires when the user clicks a cell (no drag — the
   * heatmap doesn't support brush in v1; consumers can shift-
   * click on the grid pane for rectangular selection). Parent
   * typically focuses + scrolls the matching grid cell.
   */
  readonly onPointClick?: (key: string) => void;
  /**
   * Hide the heat-scale legend below the grid. Defaults to false
   * (legend visible). Useful when the parent owns the legend
   * (e.g., FactorTableViz renders it in the toolbar).
   */
  readonly hideLegend?: boolean;
  readonly testId?: string;
}

export function HeatmapGrid(props: HeatmapGridProps): JSX.Element {
  const {
    rowAxis,
    colAxis,
    cells,
    baseline = HEAT_BASELINE,
    focusedKey,
    selectedKeys,
    filedCells,
    onHoverChange,
    onPointClick,
    hideLegend = false,
    testId = "rater-heatmap-grid",
  } = props;

  // Locally track hover so cross-highlight works without a parent
  // round-trip.
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const effectiveFocus = focusedKey ?? hoverKey;
  const focusedRowId = useMemo(() => {
    if (!effectiveFocus) return null;
    return effectiveFocus.includes("::")
      ? effectiveFocus.split("::")[0]!
      : effectiveFocus;
  }, [effectiveFocus]);
  const focusedColId = useMemo(() => {
    if (!effectiveFocus) return null;
    return effectiveFocus.includes("::")
      ? effectiveFocus.split("::")[1]!
      : null;
  }, [effectiveFocus]);

  const handleCellHover = useCallback(
    (rowId: string, colId: string) => {
      setHoverKey(cellKey(rowId, colId));
      onHoverChange?.(rowId, colId);
    },
    [onHoverChange],
  );
  const handleCellLeave = useCallback(() => {
    setHoverKey(null);
  }, []);

  const rowCount = rowAxis.values.length;
  const colCount = colAxis.values.length;

  // ── Style overrides — col + row count drive the CSS grid. ───────
  const styleVars: Record<string, string> = {
    "--heatmap-col-count": String(colCount),
    "--heatmap-row-count": String(rowCount),
  };

  // Corner label — "rowSlug · colSlug".
  const cornerLabel = `${rowAxis.dimSlug} · ${colAxis.dimSlug}`;

  return (
    <div
      className="rater-heatmap-grid-wrap"
      data-testid={testId}
      data-row-count={rowCount}
      data-col-count={colCount}
    >
      <div
        className="rater-heatmap-grid"
        style={styleVars as React.CSSProperties}
        role="img"
        aria-label={`Heatmap · ${cornerLabel}`}
      >
        {/* Corner */}
        <div
          className="rater-heatmap-grid-corner"
          data-testid={`${testId}-corner`}
        >
          {cornerLabel}
        </div>

        {/* Column header row */}
        <div
          className="rater-heatmap-grid-header-row"
          data-testid={`${testId}-header-row`}
          role="row"
        >
          {colAxis.values.map((col) => {
            const isFocused = focusedColId === col.id;
            return (
              <div
                key={col.id}
                className={`rater-heatmap-grid-col-h${
                  isFocused ? " is-focused" : ""
                }`}
                role="columnheader"
                data-testid={`${testId}-col-h-${col.id}`}
              >
                <span className="rater-heatmap-grid-col-h-label">
                  {col.label}
                </span>
                <span className="rater-heatmap-grid-col-h-sub">
                  {col.sublabel ?? col.id}
                </span>
              </div>
            );
          })}
        </div>

        {/* Row header column */}
        <div
          className="rater-heatmap-grid-header-col"
          data-testid={`${testId}-header-col`}
        >
          {rowAxis.values.map((row) => {
            const isFocused = focusedRowId === row.id;
            return (
              <div
                key={row.id}
                className={`rater-heatmap-grid-row-h${
                  isFocused ? " is-focused" : ""
                }`}
                role="rowheader"
                data-testid={`${testId}-row-h-${row.id}`}
              >
                <span className="rater-heatmap-grid-row-h-label">
                  {row.label}
                </span>
                <span className="rater-heatmap-grid-row-h-sub">
                  {row.sublabel ?? row.id}
                </span>
              </div>
            );
          })}
        </div>

        {/* Body — heatmap cells */}
        <div
          className="rater-heatmap-grid-body"
          data-testid={`${testId}-body`}
        >
          {rowAxis.values.map((row) =>
            colAxis.values.map((col) => {
              const key = cellKey(row.id, col.id);
              const value = cells.get(key);
              const bucket = heatBucket(value, baseline);
              const isFocused = effectiveFocus === key;
              const isSelected = selectedKeys?.has(key) ?? false;
              const isEmpty = value === undefined;
              const classes = ["rater-heatmap-grid-cell"];
              if (bucket > 0) classes.push(`heat-${bucket}`);
              if (isEmpty) classes.push("is-empty");
              if (isFocused) classes.push("is-focused");
              if (isSelected) classes.push("is-selected");
              const titleParts: string[] = [
                `${rowAxis.dimSlug}:${row.label}`,
                `${colAxis.dimSlug}:${col.label}`,
              ];
              if (value !== undefined) {
                const delta = ((value - baseline) / baseline) * 100;
                const sign = delta >= 0 ? "+" : "";
                titleParts.push(
                  `factor ${formatHeatCell(value)} (${sign}${delta.toFixed(1)}%)`,
                );
              } else {
                titleParts.push("no value");
              }
              // PR 34.6 — delta annotation when compare mode is on.
              const filed = filedCells?.get(key);
              const showDelta =
                filed !== undefined && value !== undefined && filed !== 0;
              const deltaPct = showDelta
                ? ((value - filed!) / filed!) * 100
                : null;
              return (
                <div
                  key={key}
                  className={classes.join(" ")}
                  role={onPointClick ? "button" : "gridcell"}
                  data-testid={`${testId}-cell-${row.id}-${col.id}`}
                  data-bucket={bucket}
                  data-empty={isEmpty ? "true" : "false"}
                  data-focused={isFocused ? "true" : "false"}
                  data-selected={isSelected ? "true" : "false"}
                  title={titleParts.join(" · ")}
                  onMouseEnter={() => handleCellHover(row.id, col.id)}
                  onMouseLeave={handleCellLeave}
                  {...(onPointClick
                    ? { onClick: () => onPointClick(key) }
                    : {})}
                >
                  <span className="rater-heatmap-grid-cell-value">
                    {formatHeatCell(value)}
                  </span>
                  {deltaPct !== null && Math.abs(deltaPct) >= 0.05 && (
                    <span
                      className={`rater-heatmap-grid-cell-delta${
                        deltaPct > 0 ? " is-positive" : " is-negative"
                      }`}
                      data-testid={`${testId}-cell-delta-${row.id}-${col.id}`}
                    >
                      Δ {deltaPct > 0 ? "+" : ""}
                      {deltaPct.toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            }),
          )}
        </div>
      </div>

      {!hideLegend && (
        <div
          className="rater-heatmap-grid-legend"
          data-testid={`${testId}-legend`}
        >
          <span className="rater-heatmap-grid-legend-label">Heat scale</span>
          {HEAT_LEGEND_ENTRIES.map((entry) => (
            <span
              key={entry.bucket}
              className="rater-heatmap-grid-legend-entry"
              data-testid={`${testId}-legend-${entry.bucket}`}
            >
              <span
                className={`rater-heatmap-grid-legend-swatch heat-${entry.bucket}`}
                aria-hidden
              />
              <span className="rater-heatmap-grid-legend-text">
                {entry.label}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
