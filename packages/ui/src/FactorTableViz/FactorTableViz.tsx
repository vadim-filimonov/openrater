/**
 * <FactorTableViz> — Brief 34 PR 34.4 + PR 34.5.
 *
 * The orchestrator that mounts the right chart for the table's
 * shape, surfaces a pill picker for user override, and composes
 * the <InsightsPanel> below the chart. This is the "chartPane"
 * that <FactorTableNode> hosts in its split view.
 *
 * Per Brief 34 §4 (chart-type catalog) + §5 (interactions) + §6
 * (auto-insights):
 *
 *   • Auto-pick chart by shape via `resolveChartType()`
 *   • Pill picker UI surfaces all available types for the shape;
 *     disabled types render with a tooltip explaining why
 *   • `vizConfig.chartType` is the persisted override (per
 *     Brief 34 §8.1 — reserved on FactorTable substrate)
 *   • <InsightsPanel> sits below the chart with the orchestrator's
 *     `runInsights()` results
 *   • PR 34.5 — Cross-highlight (chart ↔ grid hover) + click-to-
 *     focus + brush-to-select are threaded through here. Outgoing
 *     hover is debounced via useHoverDelay (Brief 34 §5.1).
 *
 * Pure presentation. Parent owns:
 *   • Axes + cells + isBanded shape info
 *   • viz_config (controlled — parent writes back through
 *     `onVizConfigChange`)
 *   • focusedKey (cross-highlight from the grid)
 *   • selectedKeys (mirrors the grid's selection so the chart
 *     can tint the region)
 *   • onJumpToCell (insights → cell jump)
 *   • onPointClick / onBrushSelect (chart → grid wiring)
 *
 * For "surface" chart type (banded × banded opt-in) the v1
 * implementation renders a stub message; the real WebGL/isometric
 * surface lands as a follow-up PR per Brief 34 §11.
 */

import { useCallback, useMemo, useRef, useState, type JSX } from "react";
import { BarChart, type BarChartDatum } from "../BarChart";
import { LineChart, type LineChartDatum } from "../LineChart";
import { HeatmapGrid } from "../HeatmapGrid";
import { LineMultiples } from "../LineMultiples";
import {
  InsightsPanel,
  runInsights,
  type CellAnchor,
  type Insight,
  type InsightInput,
  type MonotonicityExpectation,
} from "../InsightsPanel";
import {
  cellKey,
  type FactorTableGrid2DAxis,
} from "../FactorTableGrid2D";
import {
  availableChartTypes,
  resolveChartType,
  DEFAULT_VIZ_CONFIG,
  type ChartType,
  type TableShape,
  type VizConfig,
} from "./resolveChartType";
import { useHoverDelay } from "./useHoverDelay";
import { computeGeoTints } from "./geoBuckets";
import { Button, Menu } from "@openrater/design-system";
import { ChevronDown } from "lucide-react";
import { UsChoropleth } from "../UsChoropleth";
// Brief 45 PR 45.5 — chart-experience integration.
import { FactorVizHeroStrip } from "../FactorVizHeroStrip";
import { FactorTooltip, type FactorTooltipAnchor } from "../FactorTooltip";
import { FactorDistribution } from "../FactorDistribution";
import { UniformCallout } from "../UniformCallout";
import { computeFactorStats } from "./factorStats";
import {
  computeFactorDistribution,
  type FactorDistributionDatum,
} from "./factorDistribution";
import {
  computeFactorTooltipData,
  type GetChainReferences,
} from "./factorTooltipData";
import "./FactorTableViz.css";

/**
 * Brief 44 PR 44.5 — Geographic context for the "Map" mode. When set,
 * the FactorTableViz pill picker offers a "Map" tab; clicking it
 * renders <UsChoropleth> with tints computed from cell values.
 */
export interface FactorTableVizGeographicAxis {
  readonly granularity: "state" | "county" | "zip";
  readonly scope:
    | { readonly kind: "national" }
    | { readonly kind: "subset"; readonly states: readonly string[] };
}

export interface FactorTableVizProps {
  /** Row axis. Required. */
  readonly rowAxis: FactorTableGrid2DAxis;
  /** Column axis. Omit for 1-D tables. */
  readonly colAxis?: FactorTableGrid2DAxis;
  /**
   * Cell values keyed by `cellKey(rowId, colId)`. The viz
   * derives the chart series + insights from this.
   */
  readonly cells: ReadonlyMap<string, number>;
  /**
   * Whether each axis is banded (ordered). Drives the auto-pick
   * dispatch + the monotonicity / diagonal-smooth insights.
   * Defaults to `{ row: false, col: false }`.
   */
  readonly isBanded?: TableShape extends { is2D: infer _ }
    ? { readonly row?: boolean; readonly col?: boolean }
    : never;
  /**
   * Baseline (multiplicative identity). Passed through to charts
   * + insights. Defaults to 1.0.
   */
  readonly baseline?: number;
  /**
   * Whether the row dim has explicitly opted into monotonicity
   * checking. Defaults to `true` (infer direction) for banded row
   * dims (matches Brief 34 §6 + mockup Frame 3).
   *
   * PR 34.6 — Also accepts an explicit direction
   * (`'increasing'` / `'decreasing'`) per the Brief 30 follow-up
   * locked in Brief 34 §−1. When set explicitly, the
   * monotonicity-break insight no longer infers direction from
   * the first non-equal pair.
   */
  readonly monotonicityExpected?: MonotonicityExpectation;
  /**
   * Persisted visualization preferences. The parent reads from
   * the substrate (`FactorTable.viz_config`) and writes back via
   * `onVizConfigChange`. When omitted, defaults to "auto" for the
   * chart-type pick.
   */
  readonly vizConfig?: VizConfig;
  /**
   * Fires when the user picks a different chart type via the pill
   * picker. The parent persists the change to `viz_config`.
   */
  readonly onVizConfigChange?: (next: VizConfig) => void;
  /**
   * Currently focused cell key (PR 34.5 cross-highlight). For
   * 1-D charts, the matching marker grows + siblings dim. For
   * 2-D charts, the matching cell + row/col headers tint.
   */
  readonly focusedKey?: string;
  /**
   * Fires when the user hovers a chart datum. The parent
   * cross-highlights the matching grid cell.
   */
  readonly onHoverChange?: (key: string | null) => void;
  /**
   * Fires when the user clicks an insight that carries a
   * CellAnchor. The parent typically scrolls + selects the cell
   * in the grid.
   */
  readonly onJumpToCell?: (anchor: CellAnchor) => void;
  /**
   * PR 34.5 — Selected cellKey set (mirror of the grid's
   * `selectedCells`). The chart paints a tinted X-extent region
   * + per-marker `is-selected` styling so the chart shows what's
   * selected. For 1-D charts the keys are row ids (cellKey with
   * null col); for 2-D charts they're "row::col".
   */
  readonly selectedKeys?: ReadonlySet<string>;
  /**
   * PR 34.5 — Fires when the user finishes a brush gesture on
   * a chart. Receives the cellKey set the brush covers. The
   * parent typically pushes this into the grid's `selectedCells`
   * so a follow-up power-tools action (e.g. "+%") applies to it.
   */
  readonly onBrushSelect?: (keys: ReadonlySet<string>) => void;
  /**
   * PR 34.5 — Fires when the user clicks a chart datum (no drag).
   * The parent typically focuses + scrolls to the matching grid
   * cell. For LineMultiples this is not wired in v1.
   */
  readonly onPointClick?: (key: string) => void;
  /**
   * PR 34.6 — Filed-snapshot cell values keyed by `cellKey(rowId,
   * colId)`. When provided, compare mode is on:
   *
   *   • Chart primitives render a dashed-gray ghost overlay of
   *     the filed values (LineChart polyline, BarChart per-bar
   *     ticks, HeatmapGrid per-cell Δ% annotation, LineMultiples
   *     per-series ghost line).
   *   • The InsightsPanel surfaces compare-delta insights
   *     ("Vintage row up 5%") for rows whose mean delta exceeds
   *     `compareDeltaThreshold` (default 2%).
   *
   * When omitted, compare mode is off (no overlay, no compare
   * insights). The parent typically pulls this from the filed
   * snapshot of the FactorTable.
   */
  readonly filedCells?: ReadonlyMap<string, number>;
  /**
   * PR 34.6 — Override the per-row delta threshold used by the
   * compare-delta insight. Defaults to 0.02 (2%) per Brief 34
   * §6. Set higher to surface only large deltas.
   */
  readonly compareDeltaThreshold?: number;
  /**
   * Hide the insights panel below the chart. Useful when the
   * parent renders insights in its own location (e.g., the
   * right-rail inspector). Defaults to false.
   */
  readonly hideInsights?: boolean;
  /**
   * Brief 44 PR 44.5 — When set, the pill picker offers a "Map" tab
   * for 1-D tables. The "Map" mode renders <UsChoropleth> with
   * tints derived from cell values via geoBuckets. The pill is
   * disabled for 2-D tables (map mode is single-axis).
   */
  readonly geographicAxis?: FactorTableVizGeographicAxis;
  /**
   * Brief 45 PR 45.5 — Hide the new hero strip (Mean / Range /
   * Coverage) above the chart. Defaults to false. Useful when
   * the parent renders KPIs elsewhere.
   */
  readonly hideHeroStrip?: boolean;
  /**
   * Brief 45 PR 45.5 — Optional chain-reference resolver for the
   * rich tooltip. Given a datum key, returns the chain ids the
   * level appears in. When omitted, the tooltip skips the
   * "Referenced in" block.
   */
  readonly getChainReferences?: GetChainReferences;
  /**
   * Brief 45 PR 45.5 — Fires when the user clicks the
   * `[Edit first cell →]` CTA in uniform-mode callout. Parent
   * typically focuses + scrolls the grid to the first editable
   * cell.
   */
  readonly onEditFirstCell?: () => void;
  readonly testId?: string;
}

export function FactorTableViz(
  props: FactorTableVizProps,
): JSX.Element {
  const {
    rowAxis,
    colAxis,
    cells,
    isBanded,
    baseline = 1,
    monotonicityExpected,
    vizConfig = DEFAULT_VIZ_CONFIG,
    onVizConfigChange,
    focusedKey,
    onHoverChange,
    onJumpToCell,
    selectedKeys,
    onBrushSelect,
    onPointClick,
    filedCells,
    compareDeltaThreshold,
    hideInsights = false,
    geographicAxis,
    hideHeroStrip = false,
    getChainReferences,
    onEditFirstCell,
    testId = "rater-ft-viz",
  } = props;

  // ── Brief 45 PR 45.5 — Compute factor stats once per cell-map
  // change. Drives both the hero strip + the data-shape resolver.
  // For 2-D tables we still compute stats (uses all cells) but the
  // resolver path ignores uniformity/density there.
  const flatValues = useMemo(() => {
    if (colAxis === undefined) {
      // 1-D: ordered by row axis, `undefined` for empty cells.
      return rowAxis.values.map((row) =>
        cells.get(cellKey(row.id, null)),
      );
    }
    // 2-D: collect every cell across the grid.
    const out: (number | undefined)[] = [];
    for (const row of rowAxis.values) {
      for (const col of colAxis.values) {
        out.push(cells.get(cellKey(row.id, col.id)));
      }
    }
    return out;
  }, [rowAxis, colAxis, cells]);

  const factorStats = useMemo(
    () => computeFactorStats(flatValues),
    [flatValues],
  );

  const shape: TableShape = {
    is2D: colAxis !== undefined,
    rowBanded: isBanded?.row === true,
    colBanded: isBanded?.col === true,
    // Brief 44 PR 44.5 — Enables the "Map" pill for 1-D geographic
    // tables. The pill is filtered out of 2-D shapes by
    // availableChartTypes (map mode is single-axis).
    rowGeographic: geographicAxis !== undefined,
    // Brief 45 PR 45.5 — Data-shape signals for the auto-mode
    // router. Only meaningful on 1-D tables.
    populatedCount: factorStats.populatedCount,
    uniformityRatio: factorStats.uniformityRatio,
  };
  const chartType = useMemo<ChartType>(
    () => resolveChartType(shape, vizConfig),
    [shape, vizConfig],
  );
  const pickerEntries = useMemo(
    () => availableChartTypes(shape),
    [shape],
  );

  // Local hover state echoes to the parent (so the chart can
  // cross-highlight the grid without a parent round-trip). When
  // the parent supplies `focusedKey`, it wins.
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const effectiveFocus = focusedKey ?? hoverKey;

  // Brief 45 PR 45.5 — Tooltip anchor + payload. Driven by hover.
  // The tooltip is a portal-rendered floating panel; we track the
  // anchor by mouse position so flips work without DOM-anchor
  // measurements.
  const [tooltipAnchor, setTooltipAnchor] =
    useState<FactorTooltipAnchor | null>(null);
  // Derive col id from the focused cell key for LineMultiples
  // cross-highlight (it focuses by col, not cell).
  const focusedColId = useMemo<string | null>(() => {
    if (!effectiveFocus) return null;
    return effectiveFocus.includes("::")
      ? effectiveFocus.split("::")[1]!
      : null;
  }, [effectiveFocus]);

  // PR 34.5 — Debounce the OUTGOING hover signal to the parent per
  // Brief 34 §5.1 ("100ms hover delay before triggering (no jitter)").
  // Local hover state stays instant so the chart's own marker-
  // dimming reads as snappy.
  const { onEnter: emitHoverEnter, onLeave: emitHoverLeave } = useHoverDelay<string>(
    onHoverChange !== undefined ? { onChange: onHoverChange } : {},
  );

  // Brief 45 PR 45.5 — Track the most recent mouse position so the
  // tooltip can pin against it. A ref avoids re-renders on every
  // mousemove; the tooltip reads at hover-enter time only.
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Mirror local hover when the chart fires onHoverChange. The
  // tooltip anchor updates here too — Brief 45 PR 45.5 wires the
  // rich tooltip onto chart hover events.
  const handleChartHover = useCallback(
    (key: string | null) => {
      setHoverKey(key);
      if (key === null) {
        emitHoverLeave();
        setTooltipAnchor(null);
      } else {
        emitHoverEnter(key);
        setTooltipAnchor({
          kind: "point",
          x: lastMousePosRef.current.x,
          y: lastMousePosRef.current.y,
        });
      }
    },
    [emitHoverEnter, emitHoverLeave],
  );

  // Cheap — single MouseEvent listener at the FactorTableViz root.
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    },
    [],
  );

  // ── Insights ────────────────────────────────────────────────────
  const insights: readonly Insight[] = useMemo(() => {
    const input: InsightInput = {
      rowAxis,
      cells,
      baseline,
      isBanded: {
        row: shape.rowBanded,
        col: shape.colBanded,
      },
      ...(monotonicityExpected !== undefined
        ? { monotonicityExpected }
        : { monotonicityExpected: shape.rowBanded }),
      ...(colAxis !== undefined ? { colAxis } : {}),
      // PR 34.6 — Pass the filed snapshot so compare-delta insights
      // surface in the panel when compare mode is on.
      ...(filedCells !== undefined ? { filedCells } : {}),
      ...(compareDeltaThreshold !== undefined
        ? { compareDeltaThreshold }
        : {}),
    };
    return runInsights(input);
  }, [
    rowAxis,
    colAxis,
    cells,
    baseline,
    shape.rowBanded,
    shape.colBanded,
    monotonicityExpected,
    filedCells,
    compareDeltaThreshold,
  ]);

  // PR 34.6 — Derive 1-D filed values for the BarChart/LineChart
  // primitives (they expect `Map<rowId, number>`; the orchestrator
  // owns the keying convention).
  const filed1D = useMemo<ReadonlyMap<string, number> | undefined>(() => {
    if (!filedCells) return undefined;
    if (shape.is2D) return undefined; // 2-D charts take cellKey keys directly
    const out = new Map<string, number>();
    for (const row of rowAxis.values) {
      const v = filedCells.get(cellKey(row.id, null));
      if (v !== undefined) out.set(row.id, v);
    }
    return out;
  }, [filedCells, rowAxis, shape.is2D]);

  // ── Pill picker change ──────────────────────────────────────────
  const handlePillChange = useCallback(
    (next: ChartType | "auto") => {
      onVizConfigChange?.({ ...vizConfig, chartType: next });
    },
    [onVizConfigChange, vizConfig],
  );

  // ── Render the chart per resolved type ──────────────────────────
  const chartBody = (() => {
    switch (chartType) {
      case "bar": {
        const data: BarChartDatum[] = rowAxis.values.map((row) => {
          const v = cells.get(cellKey(row.id, null));
          return {
            key: row.id,
            label: row.label,
            value: v ?? baseline,
          };
        });
        return (
          <BarChart
            data={data}
            baseline={baseline}
            onHoverChange={handleChartHover}
            testId={`${testId}-bar`}
            {...(effectiveFocus !== null ? { focusedKey: effectiveFocus } : {})}
            {...(selectedKeys !== undefined ? { selectedKeys } : {})}
            {...(onBrushSelect !== undefined ? { onBrushSelect } : {})}
            {...(onPointClick !== undefined ? { onPointClick } : {})}
            {...(filed1D !== undefined ? { filedValues: filed1D } : {})}
          />
        );
      }
      case "line": {
        const data: LineChartDatum[] = rowAxis.values.map((row) => {
          const v = cells.get(cellKey(row.id, null));
          return {
            key: row.id,
            label: row.label,
            value: v ?? baseline,
          };
        });
        // Outliers from monotonicity-break insights anchor on row id.
        const outliers = new Set<string>();
        for (const ins of insights) {
          if (ins.kind === "monotonicity-break" && ins.anchor?.rowId) {
            outliers.add(ins.anchor.rowId);
          }
        }
        return (
          <LineChart
            data={data}
            baseline={baseline}
            outlierKeys={outliers}
            onHoverChange={handleChartHover}
            testId={`${testId}-line`}
            {...(effectiveFocus !== null ? { focusedKey: effectiveFocus } : {})}
            {...(selectedKeys !== undefined ? { selectedKeys } : {})}
            {...(onBrushSelect !== undefined ? { onBrushSelect } : {})}
            {...(onPointClick !== undefined ? { onPointClick } : {})}
            {...(filed1D !== undefined ? { filedValues: filed1D } : {})}
          />
        );
      }
      case "heatmap":
        if (!colAxis) return renderUnavailable("Heatmap requires a 2-D table.");
        return (
          <HeatmapGrid
            rowAxis={rowAxis}
            colAxis={colAxis}
            cells={cells}
            baseline={baseline}
            onHoverChange={(rowId, colId) =>
              handleChartHover(cellKey(rowId, colId))
            }
            testId={`${testId}-heatmap`}
            {...(effectiveFocus !== null ? { focusedKey: effectiveFocus } : {})}
            {...(selectedKeys !== undefined ? { selectedKeys } : {})}
            {...(onPointClick !== undefined ? { onPointClick } : {})}
            {...(filedCells !== undefined ? { filedCells } : {})}
          />
        );
      case "small-multiples":
        if (!colAxis)
          return renderUnavailable("Small multiples requires a 2-D table.");
        return (
          <LineMultiples
            rowAxis={rowAxis}
            colAxis={colAxis}
            cells={cells}
            baseline={baseline}
            onHoverChange={(colId) => {
              setHoverKey(null); // line-multiples focus is by col, not cell
              if (colId === null) {
                emitHoverLeave();
              } else {
                emitHoverEnter(colId);
              }
            }}
            testId={`${testId}-multiples`}
            {...(focusedColId !== null ? { focusedColId } : {})}
            {...(selectedKeys !== undefined ? { selectedKeys } : {})}
            {...(onBrushSelect !== undefined ? { onBrushSelect } : {})}
            {...(filedCells !== undefined ? { filedCells } : {})}
          />
        );
      case "surface":
        // Unreachable from the picker (the pill is off until the
        // renderer exists); the arm satisfies exhaustiveness.
        return renderUnavailable("This chart type isn't available yet.");
      case "map": {
        // Brief 44 PR 44.5 — Map mode reuses <GeoMapEditor>. Compute
        // per-level tints from cell values via the equal-interval
        // bucketing util (geoBuckets). Defensive: only 1-D + geographicAxis
        // is required; the picker already filters this out otherwise.
        if (!geographicAxis || shape.is2D) {
          return renderUnavailable(
            "Map view requires a 1-D geographic dimension. Pick Bar or Line for this shape.",
          );
        }
        if (geographicAxis.granularity === "zip") {
          // <UsChoropleth> draws states + counties (us-atlas has no ZIP
          // geometry); a ZIP factor table reads better as a distribution.
          return renderUnavailable(
            "ZIP-level maps aren't available — pick Bar or Distribution for a ZIP factor table.",
          );
        }
        const levelIds = rowAxis.values.map((v) => v.id);
        const valueByLevel = new Map<string, number>();
        for (const row of rowAxis.values) {
          const v = cells.get(cellKey(row.id, null));
          if (typeof v === "number") valueByLevel.set(row.id, v);
        }
        const { tints } = computeGeoTints(levelIds, valueByLevel);
        // Available states for the county-grain flip picker: the scope's
        // states (or all 51 for national). State grain ignores this — it
        // draws the whole national choropleth at once.
        const availableStates =
          geographicAxis.scope.kind === "national"
            ? ALL_USPS_CODES
            : geographicAxis.scope.states;
        return (
          <FactorTableMapView
            granularity={geographicAxis.granularity}
            availableStates={availableStates}
            tints={tints}
            valueByLevel={valueByLevel}
            focusedKey={effectiveFocus}
            onLevelClick={onPointClick}
            onLevelHover={handleChartHover}
            testId={`${testId}-map`}
          />
        );
      }
      // Brief 45 PR 45.5 — Dense-mode histogram + outlier list.
      case "distribution": {
        if (shape.is2D) {
          return renderUnavailable(
            "Distribution view applies to 1-D tables. Pick Heatmap or Small multiples for this shape.",
          );
        }
        const data: FactorDistributionDatum[] = rowAxis.values.map((row) => {
          const v = cells.get(cellKey(row.id, null));
          // Skip empty cells from the distribution — they would
          // skew the median + outlier ranking. The factor stats
          // already exclude them.
          const entry: FactorDistributionDatum = {
            key: row.id,
            label: row.label,
            value: v ?? Number.NaN,
          };
          return entry;
        });
        const distribution = computeFactorDistribution({ data });
        return (
          <FactorDistribution
            distribution={distribution}
            baseline={baseline}
            testId={`${testId}-distribution`}
            {...(onPointClick !== undefined
              ? { onOutlierClick: onPointClick }
              : {})}
          />
        );
      }
      // Brief 45 PR 45.5 — Uniform-mode callout (nothing tuned).
      case "callout": {
        if (shape.is2D) {
          return renderUnavailable(
            "Callout view applies to 1-D tables. Pick Heatmap or Small multiples for this shape.",
          );
        }
        return (
          <UniformCallout
            value={factorStats.mean}
            baseline={baseline}
            testId={`${testId}-callout`}
            {...(onEditFirstCell !== undefined
              ? { onEditFirst: onEditFirstCell }
              : {})}
          />
        );
      }
    }
  })();

  // Brief 45 PR 45.5 — Tooltip payload. Computed from the focused
  // datum; reuses the same data the chart consumes so the tooltip
  // numbers match the chart exactly.
  const tooltipData = useMemo(() => {
    if (effectiveFocus === null || effectiveFocus === undefined) return null;
    // For 2-D tables we don't surface the tooltip in v1 (the
    // existing heatmap cell + LineMultiples markers are the
    // affordance). Brief 45 §1.2 scopes the rich tooltip to 1-D.
    if (shape.is2D) return null;
    // Find the focused row.
    const row = rowAxis.values.find((r) => r.id === effectiveFocus);
    if (!row) return null;
    const value = cells.get(cellKey(row.id, null));
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return computeFactorTooltipData({
      datum: { key: row.id, label: row.label, value },
      values: flatValues,
      baseline,
      ...(getChainReferences !== undefined ? { getChainReferences } : {}),
    });
  }, [
    effectiveFocus,
    shape.is2D,
    rowAxis,
    cells,
    flatValues,
    baseline,
    getChainReferences,
  ]);

  return (
    <section
      className="rater-ft-viz"
      data-testid={testId}
      data-chart-type={chartType}
      aria-label={`Factor table visualization · ${chartType}`}
      onMouseMove={handleMouseMove}
    >
      {/* Brief 45 PR 45.5 — Hero strip (Mean / Range / Coverage) */}
      {!hideHeroStrip && !shape.is2D && (
        <FactorVizHeroStrip
          stats={factorStats}
          baseline={baseline}
          testId={`${testId}-hero`}
        />
      )}

      <header
        className="rater-ft-viz-head"
        data-testid={`${testId}-head`}
      >
        <div
          className="rater-ft-viz-pill-group"
          role="tablist"
          aria-label="Chart type"
          data-testid={`${testId}-picker`}
        >
          {pickerEntries.map((entry) => {
            const isActive = entry.chartType === chartType;
            const handle = entry.disabled
              ? undefined
              : () => handlePillChange(entry.chartType);
            return (
              <button
                type="button"
                key={entry.chartType}
                role="tab"
                aria-selected={isActive}
                className={`rater-ft-viz-pill${
                  isActive ? " is-active" : ""
                }${entry.disabled ? " is-disabled" : ""}`}
                disabled={entry.disabled}
                title={entry.disabledReason}
                onClick={handle}
                data-testid={`${testId}-pill-${entry.chartType}`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        {vizConfig.chartType && vizConfig.chartType !== "auto" && (
          <button
            type="button"
            className="rater-ft-viz-auto-reset"
            onClick={() => handlePillChange("auto")}
            data-testid={`${testId}-auto-reset`}
          >
            Reset to auto
          </button>
        )}
      </header>

      <div
        className="rater-ft-viz-body"
        data-testid={`${testId}-body`}
      >
        {chartBody}
      </div>

      {!hideInsights && (
        <InsightsPanel
          insights={insights}
          testId={`${testId}-insights`}
          {...(onJumpToCell !== undefined ? { onJumpToCell } : {})}
        />
      )}

      {/* Brief 45 PR 45.5 — Rich tooltip portal. Only fires when a
          datum is focused on a 1-D chart. Anchor is the cursor
          position captured by onMouseMove. */}
      <FactorTooltip
        open={tooltipData !== null && tooltipAnchor !== null}
        anchor={tooltipAnchor}
        data={tooltipData}
        testId={`${testId}-tooltip`}
      />
    </section>
  );
}

/**
 * Render a placeholder for chart types that can't render with the
 * current table shape (e.g., surface stub, heatmap on a 1-D table).
 */
function renderUnavailable(message: string): JSX.Element {
  return (
    <div
      className="rater-ft-viz-unavailable"
      data-testid="rater-ft-viz-unavailable"
    >
      <span className="rater-ft-viz-unavailable-text">{message}</span>
    </div>
  );
}

/**
 * Brief 44 PR 44.5 — Map view sub-component for `<FactorTableViz>`
 * (maps next-gen: now <UsChoropleth>, the d3-geo Albers SVG, not MapLibre).
 *
 * State grain draws the whole national choropleth at once (every state
 * tinted by its factor); county grain draws one state's counties with a
 * flip picker. Forwards hover as `key|null` so the orchestrator's
 * cross-highlight reuses onHoverChange (level id IS the rowId for 1-D
 * tables); click → focus the row.
 */
interface FactorTableMapViewProps {
  readonly granularity: "state" | "county";
  readonly availableStates: readonly string[];
  readonly tints: ReadonlyMap<string, string>;
  /** Level id → factor value, for the hover tooltip. */
  readonly valueByLevel: ReadonlyMap<string, number>;
  readonly focusedKey: string | null;
  readonly onLevelClick: ((key: string) => void) | undefined;
  readonly onLevelHover: (key: string | null) => void;
  readonly testId: string;
}

function FactorTableMapView({
  granularity,
  availableStates,
  tints,
  valueByLevel,
  focusedKey,
  onLevelClick,
  onLevelHover,
  testId,
}: FactorTableMapViewProps): JSX.Element {
  const initial = availableStates[0] ?? "WI";
  const [flipState, setFlipState] = useState(initial);
  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, v] of tints) m.set(k.toUpperCase(), v);
    return m;
  }, [tints]);
  const valueById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const [k, v] of valueByLevel) m.set(k.toUpperCase(), v);
    return m;
  }, [valueByLevel]);
  return (
    <div className="rater-ft-viz__map" data-testid={`${testId}-wrap`}>
      {granularity === "county" ? (
        <div className="rater-ft-viz__map-head">
          <Menu>
            <Menu.Trigger>
              <Button variant="ghost" size="sm" iconAfter={<ChevronDown />}>
                State: {flipState}
              </Button>
            </Menu.Trigger>
            <Menu.Items aria-label="Pick a state">
              {availableStates.map((s) => (
                <Menu.Item key={s} onSelect={() => setFlipState(s)}>
                  {s}
                </Menu.Item>
              ))}
            </Menu.Items>
          </Menu>
        </div>
      ) : null}
      <UsChoropleth
        granularity={granularity}
        {...(granularity === "county" ? { focusState: flipState } : {})}
        colorById={colorById}
        valueById={valueById}
        formatValue={(v) =>
          v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 4 })
        }
        metricLabel="Factor"
        {...(focusedKey !== null ? { selectedId: focusedKey } : {})}
        {...(onLevelClick !== undefined ? { onSelect: onLevelClick } : {})}
        onHover={onLevelHover}
        testId={testId}
      />
    </div>
  );
}

/**
 * Brief 44 PR 44.5 — Alphabetical USPS codes for the "national" scope
 * branch. Mirrors STATE_SEED's order (also alphabetical) so the
 * dropdown is stable across renders. Inlined to keep this module's
 * dependencies tight.
 */
const ALL_USPS_CODES: readonly string[] = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];
