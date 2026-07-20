/**
 * Tests for banded-utils — Brief 30 PR 30.2.
 *
 * Pure-function suite for the helpers that bridge between the level
 * table's per-row {lo, hi} representation and the scrubber's
 * breakpoint vector + drive the Generate panel's math.
 */

import { describe, expect, it } from "vitest";
import {
  applyGenerateRecipe,
  breakpointsToLevels,
  defaultBandId,
  defaultBandLabel,
  formatBandNumber,
  generateEqualWidthBands,
  generateLogScaleBands,
  hasHandTunedLevels,
  levelsToBreakpoints,
  patchBandedBoundary,
} from "./banded-utils";
import type { LevelRow } from "./LevelRowsTable";

describe("formatBandNumber", () => {
  it("renders integers without decimals", () => {
    expect(formatBandNumber(0)).toBe("0");
    expect(formatBandNumber(5)).toBe("5");
    expect(formatBandNumber(-3)).toBe("-3");
  });

  it("collapses decimals into underscore-separated tokens", () => {
    expect(formatBandNumber(12.5)).toBe("12_5");
    expect(formatBandNumber(0.25)).toBe("0_25");
  });

  it("handles infinity sentinels", () => {
    expect(formatBandNumber(Number.POSITIVE_INFINITY)).toBe("inf");
    expect(formatBandNumber(Number.NEGATIVE_INFINITY)).toBe("neg_inf");
  });
});

describe("defaultBandId / defaultBandLabel", () => {
  it("composes the default id as band_<lo>_<hi>", () => {
    expect(defaultBandId(0, 5)).toBe("band_0_5");
    expect(defaultBandId(15, 30)).toBe("band_15_30");
  });

  it("composes default labels as ranges with em-dash style", () => {
    expect(defaultBandLabel(0, 5)).toBe("0 – 5");
    expect(defaultBandLabel(15, 30)).toBe("15 – 30");
  });

  it("handles open-ended bands", () => {
    expect(defaultBandLabel(Number.NEGATIVE_INFINITY, 5)).toBe("< 5");
    expect(defaultBandLabel(50, Number.POSITIVE_INFINITY)).toBe("≥ 50");
  });
});

describe("levelsToBreakpoints", () => {
  it("returns sorted, deduped breakpoints from contiguous bands", () => {
    const levels: readonly LevelRow[] = [
      { kind: "banded", id: "a", label: "A", lo: 0, hi: 5 },
      { kind: "banded", id: "b", label: "B", lo: 5, hi: 15 },
      { kind: "banded", id: "c", label: "C", lo: 15, hi: 30 },
    ];
    expect(levelsToBreakpoints(levels)).toEqual([0, 5, 15, 30]);
  });

  it("returns empty array when no levels supplied", () => {
    expect(levelsToBreakpoints([])).toEqual([]);
  });

  it("dedupes shared boundaries", () => {
    const levels: readonly LevelRow[] = [
      { kind: "banded", id: "a", label: "A", lo: 0, hi: 5 },
      { kind: "banded", id: "b", label: "B", lo: 5, hi: 10 },
    ];
    expect(levelsToBreakpoints(levels)).toEqual([0, 5, 10]);
  });
});

describe("breakpointsToLevels", () => {
  it("pairs adjacent breakpoints into [lo, hi) bands", () => {
    const levels = breakpointsToLevels([0, 5, 15, 30]);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toMatchObject({ lo: 0, hi: 5, kind: "banded" });
    expect(levels[1]).toMatchObject({ lo: 5, hi: 15 });
    expect(levels[2]).toMatchObject({ lo: 15, hi: 30 });
  });

  it("preserves existing labels when provided", () => {
    const levels = breakpointsToLevels([0, 5, 15], {
      labels: ["New", "Modern"],
    });
    expect(levels[0]!.label).toBe("New");
    expect(levels[1]!.label).toBe("Modern");
  });

  it("preserves existing ids when provided (factor-table reference stability)", () => {
    const levels = breakpointsToLevels([0, 5, 15], {
      existingIds: ["custom_1", "custom_2"],
    });
    expect(levels[0]!.id).toBe("custom_1");
    expect(levels[1]!.id).toBe("custom_2");
  });

  it("returns empty when fewer than 2 breakpoints", () => {
    expect(breakpointsToLevels([])).toEqual([]);
    expect(breakpointsToLevels([5])).toEqual([]);
  });
});

describe("generateEqualWidthBands", () => {
  it("generates N evenly-spaced bands across [min, max]", () => {
    const levels = generateEqualWidthBands(0, 100, 5);
    expect(levels).toHaveLength(5);
    expect(levels[0]).toMatchObject({ lo: 0, hi: 20 });
    expect(levels[1]).toMatchObject({ lo: 20, hi: 40 });
    expect(levels[4]).toMatchObject({ lo: 80, hi: 100 });
  });

  it("clamps count to [2, 100]", () => {
    expect(generateEqualWidthBands(0, 10, 1)).toHaveLength(2);
    expect(generateEqualWidthBands(0, 10, 200)).toHaveLength(100);
  });

  it("returns empty array when range is degenerate", () => {
    expect(generateEqualWidthBands(5, 5, 3)).toEqual([]);
    expect(generateEqualWidthBands(10, 5, 3)).toEqual([]);
  });
});

describe("generateLogScaleBands", () => {
  it("generates log-spaced bands across [min, max]", () => {
    const levels = generateLogScaleBands(1, 1000, 3);
    expect(levels).toHaveLength(3);
    // log(1) = 0, log(1000) ≈ 6.9, step ≈ 2.3 → bands [1, 10, 100, 1000]
    expect(levels[0]!.lo).toBe(1);
    expect(levels[0]!.hi).toBeCloseTo(10, 1);
    expect(levels[2]!.hi).toBe(1000);
  });

  it("returns empty when min ≤ 0 (log undefined)", () => {
    expect(generateLogScaleBands(0, 100, 5)).toEqual([]);
    expect(generateLogScaleBands(-5, 100, 5)).toEqual([]);
  });

  it("returns empty when range is degenerate", () => {
    expect(generateLogScaleBands(5, 5, 3)).toEqual([]);
  });
});

describe("applyGenerateRecipe", () => {
  it("dispatches to equal-width", () => {
    const levels = applyGenerateRecipe({
      method: "equal-width",
      min: 0,
      max: 10,
      count: 2,
    });
    expect(levels).toHaveLength(2);
    expect(levels[0]).toMatchObject({ lo: 0, hi: 5 });
  });

  it("dispatches to log-scale", () => {
    const levels = applyGenerateRecipe({
      method: "log-scale",
      min: 1,
      max: 100,
      count: 2,
    });
    expect(levels).toHaveLength(2);
  });
});

describe("hasHandTunedLevels", () => {
  it("returns false for empty input", () => {
    expect(hasHandTunedLevels([])).toBe(false);
  });

  it("returns false when all bands have default ids + empty labels", () => {
    const levels: readonly LevelRow[] = [
      { kind: "banded", id: defaultBandId(0, 5), label: "", lo: 0, hi: 5 },
      { kind: "banded", id: defaultBandId(5, 10), label: "", lo: 5, hi: 10 },
    ];
    expect(hasHandTunedLevels(levels)).toBe(false);
  });

  it("returns true when any band has a typed label", () => {
    const levels: readonly LevelRow[] = [
      { kind: "banded", id: "band_0_5", label: "New", lo: 0, hi: 5 },
    ];
    expect(hasHandTunedLevels(levels)).toBe(true);
  });

  it("returns true when a band id is renamed off the default", () => {
    const levels: readonly LevelRow[] = [
      { kind: "banded", id: "custom_id", label: "", lo: 0, hi: 5 },
    ];
    expect(hasHandTunedLevels(levels)).toBe(true);
  });
});

describe("patchBandedBoundary", () => {
  const SAMPLE: readonly LevelRow[] = [
    { kind: "banded", id: "a", label: "A", lo: 0, hi: 5 },
    { kind: "banded", id: "b", label: "B", lo: 5, hi: 15 },
    { kind: "banded", id: "c", label: "C", lo: 15, hi: 30 },
  ];

  it("updates lo + propagates to prev's hi", () => {
    const next = patchBandedBoundary(SAMPLE, 1, "lo", 7);
    expect(next[0]!.hi).toBe(7);
    expect(next[1]!.lo).toBe(7);
    // bands beyond the edge are untouched
    expect(next[2]!.lo).toBe(15);
  });

  it("updates hi + propagates to next's lo", () => {
    const next = patchBandedBoundary(SAMPLE, 1, "hi", 20);
    expect(next[1]!.hi).toBe(20);
    expect(next[2]!.lo).toBe(20);
    expect(next[0]!.hi).toBe(5);
  });

  it("does not propagate beyond the array (first lo / last hi)", () => {
    const nextFirst = patchBandedBoundary(SAMPLE, 0, "lo", -2);
    expect(nextFirst[0]!.lo).toBe(-2);
    const nextLast = patchBandedBoundary(SAMPLE, 2, "hi", 50);
    expect(nextLast[2]!.hi).toBe(50);
  });

  it("returns the original vector unchanged for out-of-range index", () => {
    expect(patchBandedBoundary(SAMPLE, 99, "lo", 0)).toBe(SAMPLE);
  });

  it("returns the original vector unchanged for non-finite values", () => {
    expect(patchBandedBoundary(SAMPLE, 1, "lo", NaN)).toBe(SAMPLE);
    expect(
      patchBandedBoundary(SAMPLE, 1, "lo", Number.POSITIVE_INFINITY),
    ).toBe(SAMPLE);
  });
});
