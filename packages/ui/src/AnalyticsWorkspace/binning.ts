/**
 * Brief 64 §5.1 — equal-count (quantile) binning for a continuous numeric
 * variable, with the locked "≥ 2 distinct values per group" rule.
 *
 * Equal *policy count* is the locked basis (§−1.Q2): each of the 5 / 10 / 20
 * groups holds ~`N / groups` rows. The Overview ranks a numeric variable by
 * the spread of premium across these bins; the detail exhibit renders one
 * bar per bin with a user-selectable group count.
 *
 * Pure + deterministic — no I/O, no wall-clock, no randomness. The function
 * is the single source of truth for "how do we split a numeric column" so
 * the Overview ranking and the detail exhibit always agree.
 *
 * Honesty (§5.1): the realized bin count can be `< groups` when ties (mass
 * points) make equal-count groups of ≥ 2 distinct values impossible. The
 * caller surfaces `requested` vs `formed` ("10 requested · 7 formed").
 */

export type EqualCountGroups = 5 | 10 | 20;

export interface EqualCountBin {
  /** Inclusive lower bound — the smallest value that falls in this bin. */
  readonly lo: number;
  /** Inclusive upper bound — the largest value that falls in this bin. */
  readonly hi: number;
  /** Rows (policies) whose value falls in this bin. */
  readonly count: number;
  /** Distinct values spanned. ≥ 2 except the degenerate single-bin case. */
  readonly distinctCount: number;
}

export interface EqualCountBinning {
  readonly bins: readonly EqualCountBin[];
  /** What the caller asked for (5 / 10 / 20). */
  readonly requested: number;
  /** What actually formed — `< requested` when ties forced merges. */
  readonly formed: number;
  /** Count of finite values that were binned. */
  readonly n: number;
}

/**
 * Split `rawValues` into ~equal-policy-count bins. Non-finite values are
 * dropped. See module header for the ≥2-distinct rule + the honest
 * `requested`/`formed` reporting.
 */
export function computeEqualCountBins(
  rawValues: readonly number[],
  groups: EqualCountGroups,
): EqualCountBinning {
  const values = rawValues
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);
  const n = values.length;
  if (n === 0) return { bins: [], requested: groups, formed: 0, n: 0 };

  // Distinct values + the row count carried by each (a "mass point" is a
  // distinct value with a high count — it can never be split across bins).
  const distinct: number[] = [];
  const dcount: number[] = [];
  for (const v of values) {
    if (distinct.length === 0 || distinct[distinct.length - 1] !== v) {
      distinct.push(v);
      dcount.push(1);
    } else {
      dcount[dcount.length - 1]! += 1;
    }
  }
  const D = distinct.length;

  // Each bin needs ≥ 2 distinct values → at most floor(D/2) bins are
  // possible. A single distinct value (or two) collapses to one bin.
  const maxBins = Math.max(1, Math.floor(D / 2));
  const targetBins = Math.min(groups, maxBins);

  if (targetBins <= 1) {
    return {
      bins: [
        { lo: values[0]!, hi: values[n - 1]!, count: n, distinctCount: D },
      ],
      requested: groups,
      formed: 1,
      n,
    };
  }

  // Prefix row counts over distinct values: prefix[k] = rows in distinct[0..k-1].
  const prefix: number[] = [0];
  for (let k = 0; k < D; k++) prefix.push(prefix[k]! + dcount[k]!);

  const targetPerBin = n / targetBins;

  // Greedy build over distinct values (a value is atomic — never split):
  // give each bin ≥ 2 distinct values, extend until its cumulative row count
  // reaches the running target, and always leave ≥ 2 distinct per later bin.
  type Range = { startK: number; endK: number }; // [startK, endK) over distinct[]
  const ranges: Range[] = [];
  let k = 0;
  for (let b = 0; b < targetBins; b++) {
    const isLast = b === targetBins - 1;
    const startK = k;
    if (isLast) {
      k = D;
    } else {
      const remainingBinsAfter = targetBins - 1 - b;
      const maxK = D - remainingBinsAfter * 2; // reserve 2 distinct per later bin
      const cumTarget = (b + 1) * targetPerBin;
      k = Math.min(startK + 2, D); // ≥ 2 distinct to start
      while (k < D && prefix[k]! < cumTarget) k++;
      if (k > maxK) k = maxK; // don't starve the later bins
      if (k < startK + 2) k = Math.min(startK + 2, D); // never below 2 distinct
    }
    ranges.push({ startK, endK: k });
    if (k >= D) break;
  }

  // Backstop (§5.1): guarantee every bin has ≥ 2 distinct values. Merge any
  // 1-distinct range into a neighbor (contiguous ranges have disjoint value
  // sets, so distinct counts simply add). Iterate to a fixpoint.
  for (let guard = 0; guard < ranges.length + 1; guard++) {
    const bad = ranges.findIndex((r) => r.endK - r.startK < 2);
    if (bad === -1) break;
    if (ranges.length === 1) break; // can't merge a lone range
    const into = bad > 0 ? bad - 1 : bad + 1; // prefer merge-left, else right
    const lo = Math.min(ranges[bad]!.startK, ranges[into]!.startK);
    const hi = Math.max(ranges[bad]!.endK, ranges[into]!.endK);
    ranges.splice(Math.min(bad, into), 2, { startK: lo, endK: hi });
  }

  const bins: EqualCountBin[] = ranges.map((r) => ({
    lo: distinct[r.startK]!,
    hi: distinct[r.endK - 1]!,
    count: prefix[r.endK]! - prefix[r.startK]!,
    distinctCount: r.endK - r.startK,
  }));

  return { bins, requested: groups, formed: bins.length, n };
}

/**
 * Which bin does `value` fall in? Bins are disjoint, contiguous, sorted —
 * `bins[i].hi < bins[i+1].lo` — so the first bin whose `hi ≥ value` owns it.
 * Values below the first bin map to bin 0; values above the last map to the
 * last bin (so out-of-sample rows still land somewhere). Returns -1 only
 * when there are no bins.
 */
export function binIndexForValue(
  binning: EqualCountBinning,
  value: number,
): number {
  const { bins } = binning;
  if (bins.length === 0) return -1;
  for (let i = 0; i < bins.length - 1; i++) {
    if (value <= bins[i]!.hi) return i;
  }
  return bins.length - 1;
}
