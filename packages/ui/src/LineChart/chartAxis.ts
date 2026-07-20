/**
 * chartAxis — Brief 34 PR 34.1.
 *
 * Pure axis math shared between <LineChart> and <BarChart>. Lives
 * with LineChart since that's the primary consumer; BarChart
 * imports from here. Both primitives ship in Phase 1 of Brief 34.
 *
 * Conventions:
 *   • All chart math operates in SVG viewBox units (typically
 *     360×220 — but the math is unit-agnostic)
 *   • The chart's plot region is inset from the viewBox by
 *     PLOT_INSET_LEFT (40px) + PLOT_INSET_RIGHT (20px) +
 *     PLOT_INSET_TOP (20px) + PLOT_INSET_BOTTOM (30px)
 *   • Y-axis ticks are computed to span the data range, padded
 *     symmetrically around the baseline (typically 1.0)
 *   • X-axis ticks render at each data category's center
 */

/** Plot area inset (px) inside the SVG viewBox.
 *
 * PR 45.9.1 — `bottom` raised from 30 → 60 to give the rotated
 * x-axis labels (Brief 45 ask: 45° tilt for dense categorical
 * series) room to render inside the viewBox. A 14-char label
 * rotated -45° extends ~60 viewBox-units down-left from its
 * anchor; with the old 30-unit gutter it clipped past the SVG
 * bottom edge. */
export const PLOT_INSET = {
  left: 40,
  right: 20,
  top: 20,
  bottom: 60,
} as const;

/** Default SVG viewBox dimensions. Matches the polished mockup. */
export const CHART_VIEWBOX = {
  width: 360,
  height: 220,
} as const;

/** Default baseline value for factor-table charts (multiplicative identity). */
export const DEFAULT_BASELINE = 1;

/** A single point along the Y axis — a numeric value + its
 *  formatted label. */
export interface YTick {
  readonly value: number;
  readonly y: number; // SVG y coordinate (already converted)
  readonly label: string;
}

/**
 * Compute a "nice" Y-axis range + ticks for a series of values
 * around a baseline. Returns 4–6 evenly-spaced ticks that bracket
 * the data range and pass through the baseline.
 *
 * Behavior:
 *   • If `values` is empty, returns a default range around the
 *     baseline (±0.2) with 4 ticks
 *   • Otherwise, the range is symmetric around the baseline if the
 *     data crosses it, or one-sided if it doesn't
 *   • Tick step is rounded to a "nice" decimal (0.05, 0.1, 0.2, 0.5)
 *   • The baseline is always one of the ticks
 */
export function computeYTicks(
  values: readonly number[],
  baseline: number = DEFAULT_BASELINE,
  plotHeight: number = CHART_VIEWBOX.height -
    PLOT_INSET.top -
    PLOT_INSET.bottom,
): {
  readonly ticks: readonly YTick[];
  readonly min: number;
  readonly max: number;
} {
  if (values.length === 0) {
    return computeYTicks([baseline - 0.2, baseline + 0.2], baseline, plotHeight);
  }
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Expand the range a tiny bit so the data doesn't kiss the chart edges.
  const range = Math.max(dataMax - dataMin, 0.1);
  const padding = range * 0.15;
  let min = Math.min(dataMin, baseline) - padding;
  let max = Math.max(dataMax, baseline) + padding;
  // Round to a nice tick step.
  const niceSteps = [0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
  const step =
    niceSteps.find((s) => (max - min) / s <= 6) ?? niceSteps[niceSteps.length - 1]!;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  // Ensure baseline is a tick: snap min so (baseline - min) is
  // divisible by step. Use an epsilon to dodge float-precision
  // drift (e.g., (1.0 - 0.8) / 0.1 = 1.9999999... in IEEE-754).
  const offset = (baseline - min) / step;
  const offsetRounded = Math.round(offset);
  if (Math.abs(offset - offsetRounded) > 1e-9) {
    min = baseline - Math.floor(offset) * step;
  }
  const ticks: YTick[] = [];
  const tickCount = Math.round((max - min) / step) + 1;
  for (let i = 0; i < tickCount; i++) {
    const value = min + i * step;
    const y = valueToY(value, min, max, plotHeight);
    ticks.push({
      value: Math.round(value * 1000) / 1000,
      y,
      label: formatTickLabel(value),
    });
  }
  return { ticks, min, max };
}

/** Convert a data value to an SVG y coordinate (top-down). */
export function valueToY(
  value: number,
  min: number,
  max: number,
  plotHeight: number = CHART_VIEWBOX.height -
    PLOT_INSET.top -
    PLOT_INSET.bottom,
): number {
  const range = max - min;
  if (range === 0) return PLOT_INSET.top + plotHeight / 2;
  const ratio = (value - min) / range;
  // SVG y grows downward, so invert.
  return PLOT_INSET.top + plotHeight * (1 - ratio);
}

/** Format a tick label — three decimals max, trailing zeros stripped. */
export function formatTickLabel(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(3).replace(/\.?0+$/, "") || "0";
}

/**
 * Compute X positions for a categorical series. Each category gets
 * an evenly-spaced "slot" within the plot region; the slot center
 * is the bar/marker x.
 */
export function computeXPositions(
  count: number,
  plotWidth: number = CHART_VIEWBOX.width -
    PLOT_INSET.left -
    PLOT_INSET.right,
): readonly { readonly center: number; readonly slot: number }[] {
  if (count === 0) return [];
  const slotWidth = plotWidth / count;
  const out: { readonly center: number; readonly slot: number }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      center: PLOT_INSET.left + slotWidth * (i + 0.5),
      slot: slotWidth,
    });
  }
  return out;
}

/**
 * Tick-collision avoidance for X axis labels. Given the slot width
 * and a label-length heuristic (~6px per char at 9pt), returns the
 * indices of labels to render. Drops every Nth label when they'd
 * overlap.
 *
 * For 5 short labels in a 320px plot, all render. For 12 long
 * labels, only every other (or every third).
 */
export function pickVisibleXLabels(
  labels: readonly string[],
  slotWidth: number,
  approxCharWidth: number = 6,
): readonly number[] {
  if (labels.length === 0) return [];
  const indices: number[] = [];
  let lastRight = -Infinity;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    const halfWidth = (label.length * approxCharWidth) / 2;
    const center = slotWidth * (i + 0.5);
    const left = center - halfWidth;
    if (left >= lastRight) {
      indices.push(i);
      lastRight = center + halfWidth + 4; // 4px breathing room
    }
  }
  return indices;
}

// ─────────────────────────────────────────────────────────────────
// Brief 45 PR 45.9 — Label-collision fixes
// ─────────────────────────────────────────────────────────────────

/**
 * Truncate a label to a max character count, appending an ellipsis
 * when truncated. Used by BarChart + LineChart x-axis to bound the
 * visual width of category names regardless of the source string
 * length ("Community Improvement & Capacity Building" → "Community
 * Improvem…"). The truncation point stays user-readable even at
 * dense viewports.
 *
 * Pure. Idempotent — `truncateLabel(truncateLabel(x, n), n) ===
 * truncateLabel(x, n)`.
 */
export function truncateLabel(s: string, maxChars: number = 14): string {
  if (s.length <= maxChars) return s;
  // Reserve one slot for the ellipsis character.
  return `${s.slice(0, Math.max(maxChars - 1, 1))}…`;
}

/**
 * Brief 45 §−1 Q6 lock — top-5-by-deviation value-label filter.
 *
 * When a chart has more than `denseThreshold` data points, the
 * per-bar/marker value labels overlap badly (worst case: 27 NTEE
 * levels with "1.0505050505" smushed into the gradient). Q6 locked
 * "top-5/bottom-5" labels: surface only the K most-deviant values
 * (above + below baseline). The remaining bars/markers keep their
 * hover tooltip and the gradient color signal — the value label is
 * just one of three channels.
 *
 * For small datasets (≤ denseThreshold) ALL points are labeled —
 * the typical 2-5 level table stays legible without filtering. The
 * threshold defaults to 10 (5 above + 5 below = 10 labels, so any
 * dataset under that count is already at top-K parity).
 *
 * Algorithm:
 *   1. Compute |value - baseline| for each point.
 *   2. Take the K points with the LARGEST deviation (any direction).
 *   3. Return the union of their original indices.
 *
 * Returns the Set of indices that should render their value label.
 * The caller filters its `<text>` emission against this set.
 *
 * Pure. Deterministic — ties break on lower index first.
 */
export function pickValueLabelIndices(
  values: readonly number[],
  baseline: number = DEFAULT_BASELINE,
  topK: number = 10,
  denseThreshold: number = 10,
): ReadonlySet<number> {
  const set = new Set<number>();
  if (values.length === 0) return set;
  // Small datasets — label every point.
  if (values.length <= denseThreshold) {
    for (let i = 0; i < values.length; i += 1) set.add(i);
    return set;
  }
  // Dense — pick top-K by deviation.
  const ranked = values
    .map((v, i) => ({ i, dev: Math.abs(v - baseline) }))
    .sort((a, b) => {
      if (b.dev !== a.dev) return b.dev - a.dev;
      return a.i - b.i; // stable: earlier index wins
    });
  const limit = Math.min(topK, ranked.length);
  for (let k = 0; k < limit; k += 1) set.add(ranked[k]!.i);
  return set;
}
