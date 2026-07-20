/**
 * Brief 43 PR 43.5 — choropleth bucketing for the US tile-grid.
 *
 * 7 buckets (-3 … +3) anchored at the book-average value. Two
 * modes:
 *
 *   · Absolute-volume KPIs (count, total) — log-scale by ratio to
 *     the per-state average (`v / (book-total / 51)`). A state with
 *     4× the per-state share lands in bucket +3, ½× lands at -2, etc.
 *
 *   · Relative measures (avg, lr, rate_change) — z-score-ish by
 *     comparing the state's value to the cross-state average with
 *     a 25%-of-average pseudo-stddev. Caps at ±2σ for the outermost
 *     bucket.
 *
 * Why two modes: with $-totals, CA at $20M vs WY at $300K both DESERVE
 * to be "extreme" — the log-scale picks that up. With LR or rate
 * change, a state at +10% rate change vs the book +6% average is the
 * outlier story, and a z-score expresses that.
 */

import type { AnalyticsKpiId } from "./analytics-types";

/** Bucket id, -3 = far below avg, 0 = at avg, +3 = far above. */
export type ChoroplethBucket = -3 | -2 | -1 | 0 | 1 | 2 | 3;

/**
 * Bucket → raw hex fill (single-hue azure, dark = low, bright = high —
 * brighter pops on the dark canvas). Raw hex, NOT `var(--rater-color-…)`:
 * MapLibre's style spec resolves paint colors via CSS Color Level 3 and
 * can't see CSS custom properties. The canonical choropleth ramp shared
 * by the Analytics MapPanel + the Portfolio Map (Brief 71). The
 * raw-palette gate only flags `var(--rater-color-*)`, so literal hex for
 * map paint is allowed.
 */
// Navy → brand-cyan sequential ramp. Raw hex (MapLibre legacy + the SVG
// `fill` attribute can't read CSS vars), but each value MIRRORS a palette
// entry so it stays in lock-step with the `--rater-cat-choropleth-*` tokens
// the legend + chips use: azure 950/900/800/600/500 → cyan 500/300.
export const BUCKET_TO_COLOR: Readonly<Record<ChoroplethBucket, string>> = {
  [-3]: "#172554", // azure-950
  [-2]: "#1e3a8a", // azure-900
  [-1]: "#1e40af", // azure-800
  [0]: "#2563eb", // azure-600
  [1]: "#3b82f6", // azure-500
  [2]: "#06b6d4", // cyan-500
  [3]: "#67e8f9", // cyan-300
};

export function bucketColor(bucket: ChoroplethBucket): string {
  return BUCKET_TO_COLOR[bucket];
}

/**
 * Diverging ramp for SIGNED metrics (rate change, loss ratio) — emerald below
 * the baseline (shrank / better), neutral at it, orange above (grew / worse).
 * Shared by the Analytics + Portfolio maps so a signed metric never reads as a
 * one-way sequential ("more cyan = bigger"). Raw hex (SVG `fill` attr /
 * MapLibre paint can't read CSS vars), but each stop MIRRORS the sanctioned
 * data-viz delta hues so the ramp stays in the data-viz domain: emerald-500 =
 * `--rater-viz-delta-down`, orange-500 = `--rater-viz-delta-up`, with one darker
 * step toward the neutral center (zinc-700 = `--rater-surface-3`). Kept
 * value-for-value with the `--rater-cat-choropleth-div-*` tokens the chips +
 * legend use.
 */
export function divergingColor(bucket: ChoroplethBucket): string {
  if (bucket > 0) return bucket >= 2 ? "#f97316" : "#9a3412"; // orange-500 / -800 — grew
  if (bucket < 0) return bucket <= -2 ? "#10b981" : "#065f46"; // emerald-500 / -800 — shrank
  return "#3f3f46"; // neutral — zinc-700 / surface-3
}

const BUCKET_ORDER: readonly ChoroplethBucket[] = [-3, -2, -1, 0, 1, 2, 3];
/** The sequential ramp as an ordered low→high array (for legend gradients). */
export const SEQUENTIAL_RAMP: readonly string[] = BUCKET_ORDER.map((b) => BUCKET_TO_COLOR[b]);
/** The diverging ramp as an ordered low→high array (for legend gradients). */
export const DIVERGING_RAMP: readonly string[] = BUCKET_ORDER.map(divergingColor);

const CELL_COUNT = 51; // 50 states + DC

/**
 * Compute the bucket for a single state's value.
 *
 * `bookTotal` is the sum of `valueByState` across all 51 cells
 * (caller computes; we expect it pre-aggregated so we don't sum N
 * times when bucketing N cells).
 */
export function bucketForValue(
  value: number | null,
  bookTotal: number,
  bookAverage: number,
  kpi: AnalyticsKpiId,
): ChoroplethBucket {
  if (value === null || !Number.isFinite(value)) return 0;

  // Volume KPIs — log-scale by ratio to per-cell share.
  if (kpi === "count" || kpi === "total") {
    const perCellAvg = bookTotal / CELL_COUNT;
    if (perCellAvg <= 0) return 0;
    const ratio = value / perCellAvg;
    if (ratio >= 4) return 3;
    if (ratio >= 2) return 2;
    if (ratio >= 1.2) return 1;
    if (ratio >= 0.7) return 0;
    if (ratio >= 0.4) return -1;
    if (ratio >= 0.2) return -2;
    return -3;
  }

  // Relative measures — z-score-ish vs the book average.
  const delta = value - bookAverage;
  const stdish = Math.abs(bookAverage) * 0.25 || 0.05;
  const z = delta / stdish;
  if (z >= 2) return 3;
  if (z >= 1) return 2;
  if (z >= 0.3) return 1;
  if (z >= -0.3) return 0;
  if (z >= -1) return -1;
  if (z >= -2) return -2;
  return -3;
}

/**
 * Bucket every state in a map. Returns a fresh `Map<state, bucket>`.
 * `valueByState` should be keyed by state code; missing keys default
 * to null and land in bucket 0 (visually neutral).
 */
export function bucketMap(
  valueByState: ReadonlyMap<string, number | null>,
  kpi: AnalyticsKpiId,
): Map<string, ChoroplethBucket> {
  // Compute book totals once.
  let bookTotal = 0;
  let count = 0;
  for (const v of valueByState.values()) {
    if (v !== null && Number.isFinite(v)) {
      bookTotal += v;
      count += 1;
    }
  }
  const bookAverage = count > 0 ? bookTotal / count : 0;

  const buckets = new Map<string, ChoroplethBucket>();
  for (const [code, v] of valueByState) {
    buckets.set(code, bucketForValue(v, bookTotal, bookAverage, kpi));
  }
  return buckets;
}
