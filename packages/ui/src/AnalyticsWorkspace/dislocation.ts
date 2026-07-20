/**
 * Brief 64 §5.2 — portfolio dislocation: the distribution of per-policy
 * rate change between a baseline and a comparison scoring of the SAME book.
 *
 * Rows are aligned by index (baseline = old, comparison = new — the same
 * contract as `rerateSnapshotRows`, which scores both sides against the
 * same input rows). Per row `Δ% = (new − old) / old`. Rows whose old
 * premium is ≤ 0 can't yield a ratio, so they're counted separately
 * (`naCount`) and excluded from the Δ% population — never divided.
 *
 * The histogram clamps to a display range with explicit beyond-range
 * counts (no silent suppression — comparison-primitive P-CP10 #3). The
 * weighted-average uses the aggregate `Σnew / Σold − 1` over the same
 * (old > 0) population so it agrees with the per-policy story.
 *
 * Pure + deterministic. No I/O, no wall-clock.
 */

import { type AnalyticsScoredRow } from "./exhibit-math";

export interface DislocationBin {
  /** Inclusive lower Δ% bound (fraction, e.g. -0.05 = −5%). */
  readonly lo: number;
  /** Exclusive upper Δ% bound (inclusive on the last in-range bin). */
  readonly hi: number;
  readonly count: number;
}

export interface DislocationSummary {
  /** Rows with a computable Δ% (paired, old > 0). */
  readonly total: number;
  /** Fraction of `total` with Δ% > 0 / < 0. */
  readonly pctUp: number;
  readonly pctDown: number;
  /** Fraction within ±5% / ±10%. */
  readonly pctWithin5: number;
  readonly pctWithin10: number;
  /** Largest increase / decrease (fractions). Null when `total` is 0. */
  readonly maxUp: number | null;
  readonly maxDown: number | null;
  /** Book-wide weighted change: `Σnew / Σold − 1`. Null when Σold ≤ 0. */
  readonly weightedAvg: number | null;
  /** Rows excluded because old ≤ 0 (e.g. new business / zero base). */
  readonly naCount: number;
}

export interface Dislocation {
  readonly bins: readonly DislocationBin[];
  readonly summary: DislocationSummary;
  /** Counts that fell outside the display range (kept, never dropped). */
  readonly beyondLow: number;
  readonly beyondHigh: number;
  readonly displayRange: readonly [number, number];
  readonly binWidth: number;
}

export interface ComputeDislocationArgs {
  readonly baselineRows: readonly AnalyticsScoredRow[];
  readonly comparisonRows: readonly AnalyticsScoredRow[];
  readonly premiumColumn: string;
  /** Histogram bin width in Δ-fraction. Default 0.025 (2.5%). */
  readonly binWidth?: number;
  /** Display clamp [lo, hi] in Δ-fraction. Default [-0.5, 2.0]. */
  readonly displayRange?: readonly [number, number];
}

const EPS = 1e-9;

export function computeDislocation(args: ComputeDislocationArgs): Dislocation {
  const {
    baselineRows,
    comparisonRows,
    premiumColumn,
    binWidth = 0.025,
    displayRange = [-0.5, 2.0],
  } = args;
  const [rangeLo, rangeHi] = displayRange;

  const n = Math.min(baselineRows.length, comparisonRows.length);
  const deltas: number[] = [];
  let naCount = 0;
  let sumOld = 0;
  let sumNew = 0;

  for (let i = 0; i < n; i += 1) {
    const old = toNum(baselineRows[i]!.outputs[premiumColumn]);
    const next = toNum(comparisonRows[i]!.outputs[premiumColumn]);
    if (old === null || next === null) continue; // unscored on a side
    if (old <= 0) {
      naCount += 1;
      continue;
    }
    sumOld += old;
    sumNew += next;
    deltas.push((next - old) / old);
  }

  const total = deltas.length;
  let up = 0;
  let down = 0;
  let within5 = 0;
  let within10 = 0;
  let maxUp: number | null = null;
  let maxDown: number | null = null;

  // Histogram setup over the display range.
  const binCount = Math.max(1, Math.round((rangeHi - rangeLo) / binWidth));
  const counts = new Array<number>(binCount).fill(0);
  let beyondLow = 0;
  let beyondHigh = 0;

  for (const d of deltas) {
    if (d > EPS) up += 1;
    else if (d < -EPS) down += 1;
    if (Math.abs(d) <= 0.05 + EPS) within5 += 1;
    if (Math.abs(d) <= 0.1 + EPS) within10 += 1;
    if (maxUp === null || d > maxUp) maxUp = d;
    if (maxDown === null || d < maxDown) maxDown = d;

    if (d < rangeLo) {
      beyondLow += 1;
    } else if (d >= rangeHi) {
      // Values exactly at / above the top edge land in the last bin only
      // when within range; strictly above → beyondHigh.
      if (d > rangeHi + EPS) beyondHigh += 1;
      else counts[binCount - 1]! += 1;
    } else {
      const idx = Math.min(
        binCount - 1,
        Math.floor((d - rangeLo) / binWidth),
      );
      counts[idx]! += 1;
    }
  }

  const bins: DislocationBin[] = counts.map((count, i) => ({
    lo: rangeLo + i * binWidth,
    hi: rangeLo + (i + 1) * binWidth,
    count,
  }));

  const summary: DislocationSummary = {
    total,
    pctUp: total > 0 ? up / total : 0,
    pctDown: total > 0 ? down / total : 0,
    pctWithin5: total > 0 ? within5 / total : 0,
    pctWithin10: total > 0 ? within10 / total : 0,
    maxUp,
    maxDown,
    weightedAvg: sumOld > 0 ? sumNew / sumOld - 1 : null,
    naCount,
  };

  return {
    bins,
    summary,
    beyondLow,
    beyondHigh,
    displayRange: [rangeLo, rangeHi],
    binWidth,
  };
}

function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
