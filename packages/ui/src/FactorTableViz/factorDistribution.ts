/**
 * Brief 45 PR 45.4 — Histogram + outlier computation for the
 * dense (>30 level) chart mode.
 *
 * For factor tables with many levels (class codes, NTEE codes,
 * ZIPs, large class-of-construction tables), the bar carpet
 * collapses to unreadable 2-px slices. Brief 45 §−1 Q2 locks the
 * substitute: **histogram of factor values + top-N / bottom-N
 * outlier list**.
 *
 * This module is pure: takes a list of `{key, label, value}` data
 * + (optional) baseline + outlier count, returns the
 * `FactorDistribution` payload the `<FactorDistribution>`
 * presentation primitive consumes.
 *
 * Bucketing:
 *   • Sturges' rule (`ceil(log2(n) + 1)`) for bin count, capped
 *     at MAX_BINS (20). Common factor tables have 50-5,000 levels;
 *     that produces 6-12 bins which read cleanly.
 *   • Equal-interval bin widths across `[min, max]` of populated
 *     values. Last bin is inclusive on the upper bound.
 *   • Each bin tracks its keys for click-to-drill (the
 *     `<FactorDistribution>` bin click opens a drawer listing
 *     the levels in that bin).
 *
 * Outliers:
 *   • `topOutliers` = highest N values, sorted value desc.
 *   • `bottomOutliers` = lowest N values, sorted value asc.
 *   • `allRankedByDeviation` = full list sorted by
 *     `|value - median|` desc (for the "Show all N" drawer).
 *
 * Pure data in / pure data out. No React, no DOM, no SVG.
 */

import type { FactorCellValue } from "./factorStats";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** A single histogram bin. Index 0 is the leftmost (lowest values). */
export interface HistogramBin {
  readonly index: number;
  /** Inclusive lower bound of the bin. */
  readonly lo: number;
  /**
   * Exclusive upper bound (except for the rightmost bin, where
   * `hi === domain.max` and values exactly equal to `hi` count).
   */
  readonly hi: number;
  /** Midpoint of the bin — drives the gradient color encoding. */
  readonly midpoint: number;
  /** Number of data points whose value falls in this bin. */
  readonly count: number;
  /** Datum keys whose values fall in this bin (preserve input order). */
  readonly keys: readonly string[];
}

/** One row in the outlier list. */
export interface OutlierEntry {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Optional second-line text (e.g. "Class 5345"). */
  readonly sublabel?: string;
  /** `value - median`. Positive = above; negative = below. */
  readonly deviationFromMedian: number;
}

/** A datum the histogram + outliers consume. */
export interface FactorDistributionDatum {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Optional secondary label rendered below the primary. */
  readonly sublabel?: string;
}

/** Complete distribution payload. */
export interface FactorDistribution {
  readonly bins: readonly HistogramBin[];
  /** Convenience — bins.length. */
  readonly binCount: number;
  /** Max `count` across all bins. Drives the histogram's y-axis. */
  readonly maxBinCount: number;
  /** `[min, max]` of populated values. `null` when there are none. */
  readonly domain: readonly [number, number] | null;
  /** Median of populated values. `null` when there are none. */
  readonly median: number | null;
  /** Mean of populated values. `null` when there are none. */
  readonly mean: number | null;
  /** Population standard deviation. `null` when there are none. */
  readonly stddev: number | null;
  /** Number of populated values. */
  readonly populatedCount: number;
  /**
   * Top-N outliers — highest values, sorted value desc. Length up
   * to `outlierCount`.
   */
  readonly topOutliers: readonly OutlierEntry[];
  /**
   * Bottom-N outliers — lowest values, sorted value asc. Length
   * up to `outlierCount`.
   */
  readonly bottomOutliers: readonly OutlierEntry[];
  /**
   * Full ranked list by `|value - median|` desc. Length =
   * populatedCount. Consumers can paginate or virtualize.
   */
  readonly allRankedByDeviation: readonly OutlierEntry[];
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

/** Maximum bin count regardless of Sturges' rule. */
export const MAX_BINS = 20;
/** Minimum bin count — at least 4 bins so the shape reads. */
export const MIN_BINS = 4;
/** Default number of top + bottom outliers (5 each per Q6 lock). */
export const DEFAULT_OUTLIER_COUNT = 5;

// ─────────────────────────────────────────────────────────────────
// Math
// ─────────────────────────────────────────────────────────────────

/**
 * Compute bin count via Sturges' rule, capped at [MIN_BINS,
 * MAX_BINS]:
 *
 *   bins = ceil(log2(n) + 1)
 *
 * For n=1, returns MIN_BINS (Sturges is degenerate at 1).
 */
export function sturgesBinCount(n: number): number {
  if (n < 2) return MIN_BINS;
  const sturges = Math.ceil(Math.log2(n) + 1);
  if (sturges < MIN_BINS) return MIN_BINS;
  if (sturges > MAX_BINS) return MAX_BINS;
  return sturges;
}

/** Compute the median of a sorted-ascending array. */
function medianOfSorted(sorted: readonly number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export interface ComputeFactorDistributionArgs {
  readonly data: readonly FactorDistributionDatum[];
  /** Override the Sturges bin count. Useful for tests + tuning. */
  readonly binCount?: number;
  /** Top + bottom outlier slice size. Defaults to 5 (Q6 lock). */
  readonly outlierCount?: number;
}

/**
 * Compute the histogram + outlier payload for a dense-mode chart.
 *
 * Empty cells (sublabel-only / no value) and non-finite values
 * are filtered before bucketing — they don't count toward the
 * population. Callers should pre-filter the data array if they
 * want to drop levels entirely (e.g. exclude "DO NOT USE" rows).
 */
export function computeFactorDistribution(
  args: ComputeFactorDistributionArgs,
): FactorDistribution {
  const { data, binCount: overrideBinCount, outlierCount = DEFAULT_OUTLIER_COUNT } = args;

  // Filter to finite-valued data.
  const populated = data.filter(
    (d) => typeof d.value === "number" && Number.isFinite(d.value),
  );
  const populatedCount = populated.length;

  if (populatedCount === 0) {
    return {
      bins: [],
      binCount: 0,
      maxBinCount: 0,
      domain: null,
      median: null,
      mean: null,
      stddev: null,
      populatedCount: 0,
      topOutliers: [],
      bottomOutliers: [],
      allRankedByDeviation: [],
    };
  }

  // Compute domain + summary stats.
  let min = populated[0]!.value;
  let max = populated[0]!.value;
  let sum = 0;
  for (const d of populated) {
    if (d.value < min) min = d.value;
    if (d.value > max) max = d.value;
    sum += d.value;
  }
  const mean = sum / populatedCount;
  const sortedValues = populated.map((d) => d.value).sort((a, b) => a - b);
  const median = medianOfSorted(sortedValues);

  let sqDevSum = 0;
  for (const d of populated) {
    const x = d.value - mean;
    sqDevSum += x * x;
  }
  const stddev = Math.sqrt(sqDevSum / populatedCount);

  // Resolve bin count + boundaries.
  const binCount =
    overrideBinCount !== undefined
      ? Math.min(Math.max(overrideBinCount, 1), MAX_BINS)
      : sturgesBinCount(populatedCount);

  const bins: HistogramBin[] = [];
  if (min === max) {
    // Degenerate domain — one bin holds everything.
    bins.push({
      index: 0,
      lo: min,
      hi: min,
      midpoint: min,
      count: populatedCount,
      keys: populated.map((d) => d.key),
    });
  } else {
    const step = (max - min) / binCount;
    const binKeys: string[][] = Array.from({ length: binCount }, () => []);
    const binCounts: number[] = new Array(binCount).fill(0);
    for (const d of populated) {
      let idx = Math.floor((d.value - min) / step);
      if (idx >= binCount) idx = binCount - 1; // edge case for d.value === max
      if (idx < 0) idx = 0;
      binCounts[idx]! += 1;
      binKeys[idx]!.push(d.key);
    }
    for (let i = 0; i < binCount; i += 1) {
      const lo = min + step * i;
      const hi = i === binCount - 1 ? max : min + step * (i + 1);
      bins.push({
        index: i,
        lo,
        hi,
        midpoint: (lo + hi) / 2,
        count: binCounts[i]!,
        keys: binKeys[i]!,
      });
    }
  }

  const maxBinCount = bins.reduce((m, b) => (b.count > m ? b.count : m), 0);

  // Top + bottom outliers — sorted by value.
  const sortedDesc = populated.slice().sort((a, b) => b.value - a.value);
  const sortedAsc = sortedDesc.slice().reverse();
  const medianValue = median ?? mean;

  function toEntry(d: FactorDistributionDatum): OutlierEntry {
    const entry: {
      key: string;
      label: string;
      value: number;
      sublabel?: string;
      deviationFromMedian: number;
    } = {
      key: d.key,
      label: d.label,
      value: d.value,
      deviationFromMedian: d.value - medianValue,
    };
    if (d.sublabel !== undefined) entry.sublabel = d.sublabel;
    return entry as OutlierEntry;
  }

  const topOutliers = sortedDesc.slice(0, outlierCount).map(toEntry);
  const bottomOutliers = sortedAsc.slice(0, outlierCount).map(toEntry);

  // Full ranked list by |value - median| desc — drives the
  // "Show all" drawer + the underlying audit query.
  const allRankedByDeviation = populated
    .slice()
    .sort(
      (a, b) =>
        Math.abs(b.value - medianValue) - Math.abs(a.value - medianValue),
    )
    .map(toEntry);

  return {
    bins,
    binCount: bins.length,
    maxBinCount,
    domain: [min, max] as const,
    median,
    mean,
    stddev,
    populatedCount,
    topOutliers,
    bottomOutliers,
    allRankedByDeviation,
  };
}

/**
 * Format a bin range label for display, e.g. "[0.95 — 1.05)" or
 * "[1.95 — 2.85]" for the last bin.
 */
export function formatBinLabel(bin: HistogramBin, isLast: boolean): string {
  const fmt = (n: number): string => {
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2).replace(/\.?0+$/, "") || "0";
  };
  const close = isLast ? "]" : ")";
  return `[${fmt(bin.lo)} — ${fmt(bin.hi)}${close}`;
}

/**
 * Helper: given a value, find the bin index it falls into. Used
 * by the consumer to map "user clicked on histogram bin N" to
 * "level keys in bin N." Returns -1 when value is outside domain
 * or bins is empty.
 */
export function binIndexForValue(
  value: number,
  bins: readonly HistogramBin[],
): number {
  if (bins.length === 0) return -1;
  for (let i = 0; i < bins.length; i += 1) {
    const b = bins[i]!;
    const isLast = i === bins.length - 1;
    if (value >= b.lo && (isLast ? value <= b.hi : value < b.hi)) return i;
  }
  return -1;
}

/**
 * Use this to detect when the dense-mode chart applies. Brief 45
 * §−1 Q2 lock + §1.5 — when level count > DENSE_THRESHOLD, the
 * chart routes to `<FactorDistribution>` instead of `<BarChart>`.
 */
export const DENSE_THRESHOLD = 30;
export function isDense(populatedCount: number): boolean {
  return populatedCount > DENSE_THRESHOLD;
}

// Allow callers to use the FactorCellValue type without re-importing
// it explicitly when computing distributions from raw arrays.
export type { FactorCellValue };
