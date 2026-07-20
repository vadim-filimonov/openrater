/**
 * Banded dimension utilities — Brief 30 PR 30.2.
 *
 * Pure helpers for the banded shape of the inline DimensionEditor:
 *
 *   • Bidirectional conversion between the level table's per-row
 *     {lo, hi, id, label} representation and the scrubber's
 *     breakpoint vector.
 *   • Equal-width / log-scale level generation for the
 *     `⌃ Generate…` panel (Frame 14).
 *   • Default-id derivation from a band's [lo, hi) range.
 *
 * No React, no DOM. Everything in this module is pure functions
 * that the editor and tests can compose freely.
 */

import type { LevelRow } from "./LevelRowsTable";

/** The Generate panel's method choice (Brief 30 §−1 Q4). */
export type BandedGenerateMethod = "equal-width" | "log-scale";

/**
 * Recipe a consumer of `<GeneratePanel>` produces and applies.
 * Manual entry doesn't go through Generate at all — the user just
 * types into the level table — so it's not in this union.
 */
export interface BandedGenerateRecipe {
  readonly method: BandedGenerateMethod;
  readonly min: number;
  readonly max: number;
  readonly count: number;
}

/**
 * Format a number for use in a band id. Keeps integers integer +
 * collapses trailing zeros from decimals (so `0` not `0.0` and
 * `12.5` not `12.5000`). Matches the scrubber's number formatter.
 *
 * Used by `defaultBandId` below; exported separately so consumers
 * that build their own labels stay consistent.
 */
export function formatBandNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return value === Number.POSITIVE_INFINITY ? "inf" : "neg_inf";
  }
  if (Number.isInteger(value)) return String(value);
  // Up to 3 decimal places, trim trailing zeros.
  const fixed = value.toFixed(3);
  return fixed.replace(/\.?0+$/, "").replace(".", "_");
}

/**
 * Default id for a band with the given [lo, hi) range.
 * Matches the legacy `band_<lo>_<hi>` convention so existing
 * fixtures (and any factor tables keyed on band ids) keep working.
 */
export function defaultBandId(lo: number, hi: number): string {
  return `band_${formatBandNumber(lo)}_${formatBandNumber(hi)}`;
}

/**
 * Default human-readable label for a band, used when the user hasn't
 * typed one (matches the scrubber's auto-derived label format).
 * `2 – 5` for finite ranges; `≥ 50` / `< 5` for open-ended.
 */
export function defaultBandLabel(lo: number, hi: number): string {
  if (lo === Number.NEGATIVE_INFINITY) return `< ${formatBandLabelNumber(hi)}`;
  if (hi === Number.POSITIVE_INFINITY) return `≥ ${formatBandLabelNumber(lo)}`;
  return `${formatBandLabelNumber(lo)} – ${formatBandLabelNumber(hi)}`;
}

function formatBandLabelNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return Number(value.toFixed(3)).toString();
}

/**
 * Extract a sorted, deduped breakpoint vector from the banded
 * level rows. The scrubber needs N+1 breakpoints for N bands;
 * adjacent levels share a boundary (`bands[i].hi === bands[i+1].lo`
 * when contiguous), so the breakpoint set is the union of all
 * `lo` + the last band's `hi`.
 *
 * Handles open-ended bands gracefully: ±Infinity values are
 * preserved in the output (the scrubber's `formatNumber` renders
 * them as ±∞).
 */
export function levelsToBreakpoints(
  levels: readonly LevelRow[],
): readonly number[] {
  if (levels.length === 0) return [];
  const set = new Set<number>();
  for (const l of levels) {
    if (typeof l.lo === "number") set.add(l.lo);
    if (typeof l.hi === "number") set.add(l.hi);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Build banded level rows from a sorted breakpoint vector.
 * Pairs adjacent breakpoints into [lo, hi) bands. Optionally takes
 * an array of preserved labels (one per band) — pads with empty
 * strings when there are more bands than labels.
 *
 * When `existingIds` is supplied, the function preserves the
 * existing id for each band slot (helps round-trip stability when
 * the user nudges a single handle without renaming the band).
 */
export function breakpointsToLevels(
  breakpoints: readonly number[],
  options: {
    readonly labels?: readonly string[];
    readonly existingIds?: readonly string[];
  } = {},
): readonly LevelRow[] {
  if (breakpoints.length < 2) return [];
  const labels = options.labels ?? [];
  const existingIds = options.existingIds ?? [];
  const out: LevelRow[] = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const lo = breakpoints[i]!;
    const hi = breakpoints[i + 1]!;
    const id = existingIds[i] ?? defaultBandId(lo, hi);
    const label = labels[i] ?? "";
    out.push({ kind: "banded", id, label, lo, hi });
  }
  return out;
}

/**
 * Generate N equal-width bands across [min, max]. Returns the bands
 * as LevelRow[] directly so the consumer can drop them into the
 * dim's `levels` patch.
 *
 * Numerical safety: the count is clamped to [2, 100] (the lower
 * bound prevents 0/1-band states that the resolver can't handle;
 * the upper bound is generous enough for any realistic banded dim
 * while preventing pathological generates).
 *
 * Rounds breakpoints to 4 decimal places to avoid float drift in
 * the displayed values.
 */
export function generateEqualWidthBands(
  min: number,
  max: number,
  count: number,
): readonly LevelRow[] {
  if (!(Number.isFinite(min) && Number.isFinite(max)) || max <= min) {
    return [];
  }
  const safeCount = Math.max(2, Math.min(100, Math.floor(count)));
  const width = (max - min) / safeCount;
  const breakpoints: number[] = [];
  for (let i = 0; i <= safeCount; i++) {
    breakpoints.push(roundTo4(min + i * width));
  }
  return breakpointsToLevels(breakpoints);
}

/**
 * Generate N log-scale bands across [min, max]. Requires `min > 0`
 * — log of zero or negative is undefined; if the caller passes
 * `min ≤ 0` we return an empty vector (the consumer falls back to
 * equal-width and surfaces the limitation in the UI).
 */
export function generateLogScaleBands(
  min: number,
  max: number,
  count: number,
): readonly LevelRow[] {
  if (
    !(Number.isFinite(min) && Number.isFinite(max)) ||
    min <= 0 ||
    max <= min
  ) {
    return [];
  }
  const safeCount = Math.max(2, Math.min(100, Math.floor(count)));
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  const step = (logMax - logMin) / safeCount;
  const breakpoints: number[] = [];
  for (let i = 0; i <= safeCount; i++) {
    breakpoints.push(roundTo4(Math.exp(logMin + i * step)));
  }
  return breakpointsToLevels(breakpoints);
}

/**
 * Apply a Generate recipe → return the new LevelRow[]. Centralizes
 * the method-switch so the consumer only has to call one function.
 * Returns `[]` when the recipe is degenerate (e.g., log-scale with
 * min ≤ 0).
 */
export function applyGenerateRecipe(
  recipe: BandedGenerateRecipe,
): readonly LevelRow[] {
  if (recipe.method === "equal-width") {
    return generateEqualWidthBands(recipe.min, recipe.max, recipe.count);
  }
  return generateLogScaleBands(recipe.min, recipe.max, recipe.count);
}

/**
 * Determine whether applying a recipe would discard hand-tuned work.
 * Triggers the "Replace N bands" warning in the Generate panel.
 *
 * A level is "hand-tuned" if any of:
 *   • Its label is non-empty (the user typed it)
 *   • Its id doesn't match the default `band_<lo>_<hi>` pattern
 *     (the user renamed the id)
 *   • There's a non-default count of levels (the existing state
 *     differs in shape from what we'd generate)
 *
 * Returns true if the user has invested any visible effort that the
 * generate would clobber.
 */
export function hasHandTunedLevels(
  levels: readonly LevelRow[],
): boolean {
  if (levels.length === 0) return false;
  return levels.some((l) => {
    if (l.kind !== "banded") return false;
    if (l.label.trim() !== "") return true;
    if (
      typeof l.lo === "number" &&
      typeof l.hi === "number" &&
      l.id !== defaultBandId(l.lo, l.hi)
    ) {
      return true;
    }
    return false;
  });
}

function roundTo4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Update a single band's `lo` (or `hi`) and propagate the change to
 * adjacent bands so the breakpoint chain stays contiguous. When the
 * user edits `bands[i].lo`, that's also `bands[i-1].hi`; we set
 * both so the rows stay consistent without the user having to type
 * two cells.
 *
 * Returns a new LevelRow[] (does not mutate). The id of each
 * affected band stays the same — the user controls renames.
 */
export function patchBandedBoundary(
  levels: readonly LevelRow[],
  index: number,
  edge: "lo" | "hi",
  newValue: number,
): readonly LevelRow[] {
  if (index < 0 || index >= levels.length) return levels;
  if (!Number.isFinite(newValue)) return levels;
  // Build a mutable working copy. The output is widened back to
  // readonly via the function's return type.
  type Mutable = {
    -readonly [K in keyof LevelRow]: LevelRow[K];
  };
  const next: Mutable[] = levels.map((l) => ({ ...l }));
  const target = next[index]!;
  if (edge === "lo") {
    target.lo = newValue;
    if (index > 0) {
      next[index - 1]!.hi = newValue;
    }
  } else {
    target.hi = newValue;
    if (index < next.length - 1) {
      next[index + 1]!.lo = newValue;
    }
  }
  return next as readonly LevelRow[];
}
