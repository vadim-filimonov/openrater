/**
 * Dimension validation — Brief 30 PR 30.3.
 *
 * Pure helpers that detect issues in a banded dimension's level
 * vector. Used by:
 *   • The inline `<DimensionEditor>` to render gap warning rows
 *     in the level table + tint the scrubber's gap segments
 *     + show "N gap to fix" in the autosave pill.
 *   • The route's plan-level issue aggregator (wired in PR 30.4)
 *     to surface dim validation issues in `<UnifiedErrorPanel>`.
 *
 * The existing `validateBandedLevels` (in dimension-types.ts) is
 * the load-time gate — returns the first hard error as a string or
 * null. This module is the richer authoring-time view: returns ALL
 * issues at once, each with a structured kind + location so the
 * UI can highlight precisely the bands involved.
 *
 * Pure functions only — no React, no DOM, no IO.
 */

import {
  type BandedLevel,
  type Dimension,
  type DimensionLevel,
  bandHi,
  bandLo,
} from "./dimension-types";

/**
 * One issue with a banded dimension. The discriminator (`kind`) drives
 * the editor's visual treatment + the UnifiedErrorPanel's message.
 */
export type BandedDimensionIssue =
  | {
      /**
       * Consecutive bands leave a coverage gap — e.g., `bands[i].hi`
       * is 15 and `bands[i+1].lo` is 30, so inputs in [15, 30) hit
       * no row.
       */
      readonly kind: "gap";
      /** Index of the band BEFORE the gap (i.e., bands[afterIndex].hi < bands[afterIndex+1].lo). */
      readonly afterIndex: number;
      /** Where the gap starts (= bands[afterIndex].hi). */
      readonly lo: number;
      /** Where the gap ends (= bands[afterIndex+1].lo). */
      readonly hi: number;
    }
  | {
      /**
       * Consecutive bands overlap — e.g., `bands[i].hi` is 20 but
       * `bands[i+1].lo` is 15, so inputs in [15, 20) match two
       * bands. Resolver behavior here is undefined.
       */
      readonly kind: "overlap";
      readonly afterIndex: number;
      readonly lo: number;
      readonly hi: number;
    }
  | {
      /**
       * Bands aren't sorted ascending by `lo`. The level table's
       * order doesn't match the numeric order.
       */
      readonly kind: "sort-order";
      readonly index: number;
    }
  | {
      /**
       * A single band has invalid bounds (lo ≥ hi, or NaN, or
       * non-finite-when-not-an-endpoint).
       */
      readonly kind: "invalid-bound";
      readonly index: number;
      readonly reason:
        | "lo-ge-hi"
        | "nan-lo"
        | "nan-hi"
        | "neg-inf-not-first"
        | "pos-inf-not-last";
    }
  | {
      /** The dim has shape "banded" but no levels at all. */
      readonly kind: "empty";
    }
  | {
      /**
       * A level has `kind !== "banded"` mixed into a banded dim.
       * Should never happen in normal authoring; surfaced as a
       * safety net for legacy fixtures.
       */
      readonly kind: "non-banded-level";
      readonly index: number;
    };

/**
 * Run all banded validation rules over the dim's levels. Returns
 * every issue found, NOT just the first — the editor needs them all
 * to render the right warning rows.
 *
 * Ordering: issues are returned in (kind-priority, index) order so
 * the output is stable across calls with the same input:
 *   1. `empty` (only one possible)
 *   2. `non-banded-level`
 *   3. `invalid-bound`
 *   4. `sort-order`
 *   5. `gap` / `overlap` (interleaved by index)
 *
 * Pass a Dimension or a level array directly. The shape check is
 * tolerant — non-banded dims return [] (no issues).
 */
export function validateBandedDimension(
  dimOrLevels: Dimension | readonly DimensionLevel[],
): readonly BandedDimensionIssue[] {
  // Normalize: accept Dimension or bare level array.
  let levels: readonly DimensionLevel[];
  if (Array.isArray(dimOrLevels)) {
    levels = dimOrLevels;
  } else {
    const dim = dimOrLevels as Dimension;
    if (dim.shape !== "banded") return [];
    levels = dim.levels ?? [];
  }

  const issues: BandedDimensionIssue[] = [];

  // 1. Empty
  if (levels.length === 0) {
    issues.push({ kind: "empty" });
    return issues;
  }

  // 2. Mixed-shape sanity check + collect banded levels with their
  //    original index. Subsequent rules operate on the banded levels
  //    only (so we don't bail on the first mixed entry).
  const bandedWithIdx: ReadonlyArray<{
    readonly band: BandedLevel;
    readonly index: number;
  }> = levels.flatMap((l, index) => {
    if (l.kind !== "banded") {
      issues.push({ kind: "non-banded-level", index });
      return [];
    }
    return [{ band: l as BandedLevel, index }];
  });

  // 3. Invalid bounds (per-band). Null bounds coalesce onto ±Infinity
  //    (finding E5 — the JSON-safe open-end encoding) before checking.
  for (const { band, index } of bandedWithIdx) {
    const lo = bandLo(band);
    const hi = bandHi(band);
    if (Number.isNaN(lo)) {
      issues.push({ kind: "invalid-bound", index, reason: "nan-lo" });
    }
    if (Number.isNaN(hi)) {
      issues.push({ kind: "invalid-bound", index, reason: "nan-hi" });
    }
    if (!Number.isNaN(lo) && !Number.isNaN(hi) && !(lo < hi)) {
      issues.push({ kind: "invalid-bound", index, reason: "lo-ge-hi" });
    }
    if (lo === Number.NEGATIVE_INFINITY && index !== bandedWithIdx[0]?.index) {
      issues.push({
        kind: "invalid-bound",
        index,
        reason: "neg-inf-not-first",
      });
    }
    if (
      hi === Number.POSITIVE_INFINITY &&
      index !== bandedWithIdx[bandedWithIdx.length - 1]?.index
    ) {
      issues.push({
        kind: "invalid-bound",
        index,
        reason: "pos-inf-not-last",
      });
    }
  }

  // 4. Sort order — any band whose `lo` is less than the previous
  //    band's `lo` is out of order. Operates on the banded-only list
  //    so non-banded entries don't shift the comparison.
  for (let i = 1; i < bandedWithIdx.length; i++) {
    const prev = bandedWithIdx[i - 1]!.band;
    const cur = bandedWithIdx[i]!.band;
    if (bandLo(cur) < bandLo(prev)) {
      issues.push({ kind: "sort-order", index: bandedWithIdx[i]!.index });
    }
  }

  // 5. Gaps + overlaps between consecutive bands (in the sorted-as-
  //    rendered order). When the user has hand-tuned a sort-order
  //    issue we still flag gaps based on the rendered order so the
  //    warning is visible AS the user reads the rows.
  for (let i = 0; i < bandedWithIdx.length - 1; i++) {
    const prev = bandedWithIdx[i]!.band;
    const next = bandedWithIdx[i + 1]!.band;
    const prevHi = bandHi(prev);
    const nextLo = bandLo(next);
    if (
      !Number.isFinite(prevHi) ||
      !Number.isFinite(nextLo) ||
      Number.isNaN(prevHi) ||
      Number.isNaN(nextLo)
    ) {
      // Skip — invalid-bound already covers it.
      continue;
    }
    if (prevHi < nextLo) {
      issues.push({
        kind: "gap",
        afterIndex: bandedWithIdx[i]!.index,
        lo: prevHi,
        hi: nextLo,
      });
    } else if (prevHi > nextLo) {
      issues.push({
        kind: "overlap",
        afterIndex: bandedWithIdx[i]!.index,
        lo: nextLo,
        hi: prevHi,
      });
    }
  }

  return issues;
}

/**
 * Convenience: filter `validateBandedDimension`'s output down to
 * just the gap + overlap issues. Used by the scrubber to compute
 * the gap-band-indices vector for visual tinting.
 */
export function bandedGapsAndOverlaps(
  dimOrLevels: Dimension | readonly DimensionLevel[],
): ReadonlyArray<
  Extract<BandedDimensionIssue, { kind: "gap" } | { kind: "overlap" }>
> {
  return validateBandedDimension(dimOrLevels).filter(
    (
      i,
    ): i is Extract<
      BandedDimensionIssue,
      { kind: "gap" } | { kind: "overlap" }
    > => i.kind === "gap" || i.kind === "overlap",
  );
}

/**
 * Compose a human-readable message for an issue. Used by the
 * editor's warning row + the (PR 30.4) UnifiedErrorPanel adapter.
 *
 * Messages are complete sentences ending in a period, per Brief 13
 * style. Numbers render via `formatBound` for consistent display
 * across the editor (matches the scrubber's labels).
 */
export function describeBandedIssue(issue: BandedDimensionIssue): string {
  switch (issue.kind) {
    case "empty":
      return "Banded dimension has no bands.";
    case "non-banded-level":
      return `Level at index ${issue.index} has the wrong kind for a banded dim.`;
    case "invalid-bound": {
      const reasons: Record<typeof issue.reason, string> = {
        "lo-ge-hi": `Band ${issue.index}: lo must be strictly less than hi.`,
        "nan-lo": `Band ${issue.index}: lo is not a number.`,
        "nan-hi": `Band ${issue.index}: hi is not a number.`,
        "neg-inf-not-first": `Band ${issue.index}: -∞ lower bound is only allowed on the first band.`,
        "pos-inf-not-last": `Band ${issue.index}: +∞ upper bound is only allowed on the last band.`,
      };
      return reasons[issue.reason];
    }
    case "sort-order":
      return `Band ${issue.index} is out of order — its lo is less than the previous band's lo.`;
    case "gap":
      return `Coverage gap: inputs in [${formatBound(issue.lo)}, ${formatBound(issue.hi)}) match no band.`;
    case "overlap":
      return `Band overlap: bands ${issue.afterIndex} and ${issue.afterIndex + 1} both cover [${formatBound(issue.lo)}, ${formatBound(issue.hi)}).`;
  }
}

function formatBound(value: number): string {
  if (value === Number.NEGATIVE_INFINITY) return "−∞";
  if (value === Number.POSITIVE_INFINITY) return "+∞";
  if (Number.isInteger(value)) return String(value);
  return Number(value.toFixed(3)).toString();
}
