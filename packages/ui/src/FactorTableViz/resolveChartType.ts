/**
 * resolveChartType — Brief 34 PR 34.4 + Brief 45 PR 45.5.
 *
 * Pure dispatch from table shape → chart type. Per Brief 34 §4
 * + §−1 Q2 + Brief 45 §1.1.
 *
 * Decision tree (the override is always checked first):
 *
 *   1-D path
 *     • Uniform (stddev/|mean| < 0.005)   → "callout"  (Brief 45)
 *     • Dense (populatedCount > 30)        → "distribution"  (Brief 45)
 *     • Banded with variance               → "line"
 *     • Categorical with variance          → "bar"
 *
 *   2-D path (unchanged from Brief 34)
 *     • categorical × categorical          → "heatmap"
 *     • banded × categorical (or v.v.)     → "small-multiples"
 *     • banded × banded                    → "heatmap" (surface is opt-in)
 *
 * The "surface" type is reserved for 2-D banded × banded but is
 * NOT auto-picked at v1 — surface is a pill the user must click
 * into. The Brief 45 routes ("callout", "distribution") DO auto-
 * pick when the data shape calls for them; the user can still
 * override into bar/line via the pill picker.
 */

/** All chart types the visualization layer supports. */
export type ChartType =
  | "bar"
  | "line"
  | "heatmap"
  | "small-multiples"
  | "surface"
  // Brief 44 PR 44.5 — Geographic factor tables get a "Map" mode that
  // reuses <GeoMapEditor>. Never auto-picked; the pill is offered IFF
  // the table is 1-D AND the caller supplied a `geographicAxis` prop.
  | "map"
  // Brief 45 PR 45.5 — Dense-mode (>30 levels) histogram + outlier
  // list via <FactorDistribution>. Auto-picked when level count
  // crosses DENSE_THRESHOLD (replaces the bar carpet). Available
  // pill on any 1-D table where the user wants to drop back into
  // a distribution view.
  | "distribution"
  // Brief 45 PR 45.5 — Uniform-mode (stddev/|mean| < 0.005) — when
  // all populated values are effectively flat, swap the chart for
  // a callout via <UniformCallout>. Auto-picked; "Auto" route only.
  | "callout";

/** Persisted user override. "auto" defers to the shape-based pick. */
export type VizConfigChartType = ChartType | "auto";

/**
 * The persisted vizualization preferences for a single factor
 * table. Brief 34 §8.1 reserves a `viz_config` field on
 * `FactorTable` for these knobs. Today only the chart-type
 * override is wired; future fields land here without a schema
 * migration.
 *
 * Brief 45 PR 45.3 adds `sortMode` — drives the bar-chart sort
 * order. When unset, the chart defaults to "value-desc"
 * (the §−1 Q1 lock).
 */
export interface VizConfig {
  readonly chartType?: VizConfigChartType;
  /**
   * Brief 45 PR 45.3 — Bar-chart sort order. Persisted alongside
   * `chartType`. Line / heatmap / other modes ignore this — banded
   * dims have a canonical axis order (the curve shape IS the
   * signal). Defaults to "value-desc" at the chart level.
   */
  readonly sortMode?: "value-desc" | "value-asc" | "label-asc" | "given";
}

export const DEFAULT_VIZ_CONFIG: VizConfig = { chartType: "auto" };

/**
 * Describes the shape of a factor table (whether each axis is
 * "banded" — i.e., ordered — and whether the table is 2-D). The
 * caller derives this from the dim's `shape` field.
 */
export interface TableShape {
  readonly is2D: boolean;
  readonly rowBanded: boolean;
  /** Ignored when `is2D === false`. */
  readonly colBanded: boolean;
  /**
   * Brief 44 PR 44.5 — When the row dim is geographic, the picker
   * enables the "Map" pill. Set to `true` when
   * `dimension_type === "geographic"` on the keying dim. Defaults
   * to `false`.
   */
  readonly rowGeographic?: boolean;
  /**
   * Brief 45 PR 45.5 — Data-shape signals for the auto-mode
   * router. Both fields are 1-D only; the 2-D path ignores them.
   *
   * `populatedCount` — number of populated cells in the table
   * (for 1-D tables, this is "how many levels have a tuned
   * value"). When undefined, the resolver treats density as
   * sparse.
   *
   * `uniformityRatio` — `stddev / |mean|` for populated values.
   * When undefined (or null) the resolver treats the table as
   * non-uniform. When < `UNIFORM_THRESHOLD` (0.005), the chart
   * routes to "callout" mode.
   */
  readonly populatedCount?: number;
  readonly uniformityRatio?: number | null;
}

/**
 * Brief 45 PR 45.5 — Threshold below which the resolver routes a
 * 1-D table to "callout" mode (Brief 45 §−1 Q3 lock).
 */
export const UNIFORM_RESOLVER_THRESHOLD = 0.005;

/**
 * Brief 45 PR 45.5 — Level-count threshold above which the
 * resolver routes a 1-D table to "distribution" mode (Brief 45
 * §−1 Q2 lock).
 */
export const DENSE_RESOLVER_THRESHOLD = 30;

/**
 * Resolve the chart type to render for a given table shape +
 * persisted viz config. The override always wins (unless it's
 * "auto" or absent), which gives the user full control via the
 * pill picker.
 *
 * Auto-pick for 1-D tables (Brief 45 PR 45.5):
 *   • uniform (stddev/|mean| < 0.005)  → "callout"
 *   • dense  (populatedCount > 30)     → "distribution"
 *   • banded                            → "line"
 *   • else (categorical with variance) → "bar"
 *
 * Note: "surface" is never returned from the auto path — the
 * caller has to opt in via the override.
 */
export function resolveChartType(
  shape: TableShape,
  config: VizConfig = DEFAULT_VIZ_CONFIG,
): ChartType {
  const override = config.chartType;
  if (override && override !== "auto") return override;
  if (!shape.is2D) {
    // Brief 45 PR 45.5 — Uniform-mode short-circuit. Only fires
    // when the caller has supplied a uniformityRatio (chart can
    // measure it) AND there are at least 2 populated cells so a
    // single-cell table doesn't get the "nothing tuned" callout.
    if (
      shape.uniformityRatio !== undefined &&
      shape.uniformityRatio !== null &&
      shape.uniformityRatio < UNIFORM_RESOLVER_THRESHOLD &&
      (shape.populatedCount ?? 0) >= 2
    ) {
      return "callout";
    }
    // Brief 45 PR 45.5 — Dense-mode routes when level count > 30.
    if ((shape.populatedCount ?? 0) > DENSE_RESOLVER_THRESHOLD) {
      return "distribution";
    }
    return shape.rowBanded ? "line" : "bar";
  }
  // 2-D
  if (shape.rowBanded !== shape.colBanded) {
    // Exactly one banded axis → small multiples.
    return "small-multiples";
  }
  // categorical × categorical OR banded × banded → heatmap.
  return "heatmap";
}

/**
 * The set of chart types the user can pick for a given shape.
 * Drives the pill picker in <FactorTableViz>. Disabled-but-
 * visible variants stay in the list — the pill renders disabled
 * with a tooltip explaining why.
 */
export interface PickerEntry {
  readonly chartType: ChartType;
  readonly label: string;
  readonly disabled: boolean;
  /** When disabled, optional explanation surfaced as a tooltip. */
  readonly disabledReason?: string;
}

export function availableChartTypes(
  shape: TableShape,
): readonly PickerEntry[] {
  if (!shape.is2D) {
    // Brief 44 PR 44.5 — "Map" pill is offered IFF the row dim is
    // geographic. Brief 45 PR 45.5 — "Distribution" is always
    // available for 1-D tables; "Callout" is hidden from the pill
    // bar because it's a non-chart presentation — users get there
    // via Auto when the data is uniform, not by pinning.
    const out: PickerEntry[] = [
      { chartType: "bar", label: "Bar", disabled: false },
      { chartType: "line", label: "Line", disabled: false },
      {
        chartType: "distribution",
        label: "Distribution",
        disabled: false,
      },
    ];
    if (shape.rowGeographic) {
      out.push({ chartType: "map", label: "Map", disabled: false });
    }
    return out;
  }
  // Brief 67 walkthrough fix — the Surface pill is OFF the picker
  // until its renderer exists (it routed to a stub whose copy named
  // internal PRs; no affordance the render path cannot hold). The
  // "surface" chart type stays in the union for the future renderer.
  return [
    { chartType: "heatmap", label: "Heatmap", disabled: false },
    {
      chartType: "small-multiples",
      label: "Small multiples",
      disabled: false,
    },
  ];
}
