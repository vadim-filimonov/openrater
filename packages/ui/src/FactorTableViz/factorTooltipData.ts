/**
 * Brief 45 PR 45.2 — Pure data adapter for the rich factor tooltip.
 *
 * The chart primitives know their datum (key + label + value) but
 * not the context: where this value sits relative to the rest of
 * the table, by how much it deviates from the baseline, which
 * chains reference the key. This module computes that context
 * once per (datum, dataset, baseline) tuple so the tooltip render
 * is a pure mapping.
 *
 * Pure module: no React, no DOM, no measurements. Returns plain
 * data the tooltip presentation consumes.
 */

import type { FactorCellValue } from "./factorStats";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/**
 * Chain-reference resolver shape. The consumer passes a function
 * that, given a datum key, returns the chain ids (or labels) that
 * reference this level. Empty array means the level isn't yet
 * referenced anywhere — the tooltip suppresses the chains row.
 *
 * Returning a maximum of ~3 entries is recommended; the tooltip
 * caps display at 4 with "+N more" overflow.
 */
export type GetChainReferences = (key: string) => readonly string[];

/** A single chart datum the chart owns. */
export interface FactorDatum {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/** The full computed tooltip payload. Fed straight to <FactorTooltip>. */
export interface FactorTooltipData {
  /** Display label (e.g. "Class 5345 — Day Care Centers"). */
  readonly label: string;
  /** Numeric value formatted at 3 decimal places, trailing zeros stripped. */
  readonly value: number;
  /**
   * Deviation from baseline as a decimal (e.g. 0.247 = +24.7%).
   * Returns 0 when value === baseline.
   */
  readonly deviation: number;
  /**
   * Human-readable deviation string with sign + percent (e.g.
   * "+24.7% above identity" / "-15.0% below identity"). When
   * deviation is within 0.5% of 0, returns "at identity".
   */
  readonly deviationLabel: string;
  /**
   * Direction signal — "up" / "down" / "neutral". Drives the
   * gradient-color text class on the tooltip.
   */
  readonly direction: "up" | "down" | "neutral";
  /**
   * Percentile rank (0..100) within the populated values, where
   * 100 means "highest" and 0 means "lowest." Computed via the
   * "≤" definition (count of values not greater than this one /
   * total populated). Identical values share a rank.
   */
  readonly percentile: number;
  /**
   * Human-readable percentile label (e.g. "92nd percentile",
   * "highest", "lowest"). Special-cases 100 → "highest" and
   * 0 → "lowest" to read more naturally.
   */
  readonly percentileLabel: string;
  /**
   * The chains that reference this level (truncated to the first
   * 4 + a "+N more" suffix when overflow). Empty when the level
   * isn't referenced anywhere.
   */
  readonly chainRefs: readonly string[];
  /**
   * Total number of chain references (before truncation). The
   * tooltip uses this to render "+N more" when chainRefs is the
   * truncated subset.
   */
  readonly chainRefsTotal: number;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Compute the percentile rank of `value` within `populated` using
 * the "≤" definition. Returns 0..100.
 *
 *   percentile(v) = (count of populated values ≤ v) / populated.length × 100
 *
 * When `populated` is empty, returns 50 (a no-signal default).
 */
export function computePercentile(
  value: number,
  populated: readonly number[],
): number {
  if (populated.length === 0) return 50;
  let leq = 0;
  for (const v of populated) {
    if (v <= value) leq += 1;
  }
  return (leq / populated.length) * 100;
}

/** Ordinal suffix for whole-number percentiles ("st" / "nd" / "rd" / "th"). */
function ordinalSuffix(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  const rem10 = n % 10;
  if (rem10 === 1) return "st";
  if (rem10 === 2) return "nd";
  if (rem10 === 3) return "rd";
  return "th";
}

/** Format the percentile rank into the human label. */
export function formatPercentileLabel(percentile: number): string {
  if (!Number.isFinite(percentile)) return "—";
  const rounded = Math.round(percentile);
  if (rounded >= 100) return "highest";
  if (rounded <= 0) return "lowest";
  return `${rounded}${ordinalSuffix(rounded)} percentile`;
}

/**
 * Format the deviation as a human string. Sign + 1-decimal percent
 * + the direction phrasing.
 */
export function formatDeviationLabel(deviation: number): string {
  if (!Number.isFinite(deviation)) return "—";
  // Within ±0.5% — pin to identity to avoid "0.0% above identity"
  // jitter on rounding.
  if (Math.abs(deviation) < 0.005) return "at identity";
  const pct = deviation * 100;
  const sign = pct >= 0 ? "+" : "";
  const word = pct >= 0 ? "above" : "below";
  return `${sign}${pct.toFixed(1)}% ${word} identity`;
}

function classifyDirection(deviation: number): "up" | "down" | "neutral" {
  if (!Number.isFinite(deviation)) return "neutral";
  if (Math.abs(deviation) < 0.005) return "neutral";
  return deviation > 0 ? "up" : "down";
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export interface ComputeFactorTooltipDataArgs {
  readonly datum: FactorDatum;
  /**
   * All cell values in the table (typically the full keyed data
   * the chart received). Empty cells should be `undefined`; the
   * function filters those + non-finite values when computing the
   * percentile context.
   */
  readonly values: readonly FactorCellValue[];
  /** Baseline factor — defaults to 1.0. */
  readonly baseline?: number;
  /**
   * Optional chain-reference resolver. When omitted, chainRefs is
   * always empty.
   */
  readonly getChainReferences?: GetChainReferences;
  /**
   * Maximum number of chain refs to include in the displayed list
   * before falling back to "+N more". Defaults to 4.
   */
  readonly maxChainRefs?: number;
}

/**
 * Build the full FactorTooltipData payload from a datum + the
 * populated cell values + (optional) chain-reference resolver.
 *
 * Pure: no DOM, no React. Memoize at the call site.
 */
export function computeFactorTooltipData(
  args: ComputeFactorTooltipDataArgs,
): FactorTooltipData {
  const {
    datum,
    values,
    baseline = 1.0,
    getChainReferences,
    maxChainRefs = 4,
  } = args;

  // Filter to finite numeric values for the percentile context.
  const populated: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) populated.push(v);
  }

  const deviation = baseline !== 0 ? datum.value / baseline - 1 : 0;
  const direction = classifyDirection(deviation);
  const percentile = computePercentile(datum.value, populated);

  // Resolve chains (defensive — caller may pass through random data).
  const allChains = getChainReferences ? getChainReferences(datum.key) : [];
  const chainRefsTotal = allChains.length;
  const chainRefs =
    chainRefsTotal <= maxChainRefs
      ? allChains
      : allChains.slice(0, Math.max(0, maxChainRefs - 1));

  return {
    label: datum.label,
    value: datum.value,
    deviation,
    deviationLabel: formatDeviationLabel(deviation),
    direction,
    percentile,
    percentileLabel: formatPercentileLabel(percentile),
    chainRefs,
    chainRefsTotal,
  };
}
