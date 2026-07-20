/**
 * Brief 45 PR 45.1 — Factor-table summary statistics.
 *
 * Pure helper that computes the three hero KPIs surfaced above
 * every chart pane (Brief 45 §−1 Q7 lock):
 *
 *   • Mean      — average factor value across populated cells
 *   • Range     — [min, max]
 *   • Coverage  — populated cells / total cells (as a fraction)
 *
 * Plus two derived measurements the hero strip + the
 * `resolveChartType` extension consume:
 *
 *   • stddev    — population standard deviation across populated
 *                  cells. Drives the uniform-mode detection
 *                  (`stddev / |mean| < UNIFORM_THRESHOLD`).
 *   • populatedCount  — convenience count (also = Coverage numerator)
 *
 * Empty cells (undefined / null) are excluded from the Mean + Range
 * calculations but count toward the Coverage denominator. The
 * caller is responsible for distinguishing "factor = 1.0" from
 * "no value yet" — typically by passing `undefined` for missing
 * cells.
 */

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** A single cell value. `undefined` = no factor authored. */
export type FactorCellValue = number | undefined;

export interface FactorStats {
  /** Mean of populated cells. `null` when there are no populated cells. */
  readonly mean: number | null;
  /** `[min, max]` of populated cells. `null` when none populated. */
  readonly range: readonly [number, number] | null;
  /** Population standard deviation of populated cells. `null` when none. */
  readonly stddev: number | null;
  /** Number of populated cells. */
  readonly populatedCount: number;
  /** Total cells (populated + empty). */
  readonly totalCount: number;
  /** populatedCount / totalCount (0 when totalCount is 0). */
  readonly coverage: number;
  /**
   * stddev / |mean| — the uniformity ratio. `null` when mean is
   * null OR mean is 0 (avoiding divide-by-zero). Brief 45 uses
   * this with `UNIFORM_THRESHOLD` to detect "nothing tuned yet"
   * factor tables.
   */
  readonly uniformityRatio: number | null;
}

/**
 * The threshold below which `<resolveChartType>` returns "callout"
 * instead of a bar/line chart (Brief 45 Q3 lock).
 *
 * 0.005 ≈ "values within 0.5% of the mean" — generous enough to
 * survive floating-point noise from cell entry yet tight enough to
 * still detect a real perturbation when the user starts tuning.
 */
export const UNIFORM_THRESHOLD = 0.005;

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Compute summary statistics over a list of factor cell values.
 *
 * Pass `undefined` for empty cells; pass `NaN` / `±Infinity` to
 * have them skipped (treated as if they were `undefined`).
 *
 * Returns `null` for mean / range / stddev when there are no
 * populated cells. Coverage is still meaningful (it's 0 when
 * everything is empty).
 */
export function computeFactorStats(
  values: readonly FactorCellValue[],
): FactorStats {
  const populated: number[] = [];
  for (const v of values) {
    if (typeof v !== "number") continue;
    if (!Number.isFinite(v)) continue;
    populated.push(v);
  }

  const totalCount = values.length;
  const populatedCount = populated.length;
  const coverage = totalCount === 0 ? 0 : populatedCount / totalCount;

  if (populatedCount === 0) {
    return {
      mean: null,
      range: null,
      stddev: null,
      populatedCount: 0,
      totalCount,
      coverage,
      uniformityRatio: null,
    };
  }

  let sum = 0;
  let min = populated[0]!;
  let max = populated[0]!;
  for (const v of populated) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / populatedCount;

  let sqDeviationSum = 0;
  for (const v of populated) {
    const d = v - mean;
    sqDeviationSum += d * d;
  }
  // Population stddev (divide by N, not N-1) — the dataset IS the
  // population for a factor table, not a sample of one.
  const stddev = Math.sqrt(sqDeviationSum / populatedCount);

  const uniformityRatio =
    Math.abs(mean) < 1e-12 ? null : stddev / Math.abs(mean);

  return {
    mean,
    range: [min, max] as const,
    stddev,
    populatedCount,
    totalCount,
    coverage,
    uniformityRatio,
  };
}

/**
 * Convenience: returns `true` when the values look uniform enough
 * that the chart should switch to callout mode.
 *
 * Edge cases:
 *   • No populated cells → false (use the empty-state UI; uniform
 *     callout assumes "all cells equal the same NON-empty value")
 *   • Single populated cell → false (one data point isn't a chart)
 *   • Mean ≈ 0 → false (the threshold is multiplicative; we can't
 *     meaningfully measure relative spread against zero)
 */
export function isUniform(stats: FactorStats): boolean {
  if (stats.populatedCount < 2) return false;
  if (stats.uniformityRatio === null) return false;
  return stats.uniformityRatio < UNIFORM_THRESHOLD;
}

/**
 * Format a factor value for the hero strip (e.g. "1.04", "0.85",
 * "—" for null). Three significant digits, trailing zeros trimmed.
 *
 * Kept here (not in a CSS string) because the consumer renders
 * inside SVG `<text>` in addition to plain DOM, and the same
 * formatting needs to apply.
 */
export function formatFactorValue(value: number | null): string {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  // 2 decimals is the chart convention (mean / values display).
  return value.toFixed(2).replace(/\.?0+$/, "") || "0";
}

/**
 * Format coverage as "n / total" — the hero strip uses this pattern.
 * Brief 45 §1.2 mockup: "48 / 50 (96%)" — the percent flows in the
 * detail line below. This helper returns just the fraction string.
 */
export function formatCoverageFraction(
  populatedCount: number,
  totalCount: number,
): string {
  return `${populatedCount} / ${totalCount}`;
}

/** Format coverage as a percent string (e.g. "96%", "100%"). */
export function formatCoveragePercent(coverage: number): string {
  if (!Number.isFinite(coverage)) return "—";
  const pct = Math.round(coverage * 100);
  return `${pct}%`;
}
