/**
 * Tests for validateBandedDimension — Brief 30 PR 30.3.
 *
 * Pure-function coverage. Each rule has at least one positive case
 * (issue surfaced) and a negative case (no issue when the input is
 * clean).
 */

import { describe, expect, it } from "vitest";
import {
  bandedGapsAndOverlaps,
  describeBandedIssue,
  validateBandedDimension,
  type BandedDimensionIssue,
} from "./dimension-validation";
import type { Dimension, DimensionLevel } from "./dimension-types";

// Helper — build a banded dim from a compact tuple list. Each tuple
// is [lo, hi, label?]. The id is auto-derived as `band_<lo>_<hi>`.
function bandedFrom(
  ranges: ReadonlyArray<readonly [number, number, string?]>,
): Dimension {
  return {
    id: "test_dim",
    display_name: "Test",
    slug: "test_dim",
    data_type: "number",
    role: "rating-input",
    shape: "banded",
    levels: ranges.map(([lo, hi, label]) => ({
      kind: "banded" as const,
      id: `band_${lo}_${hi}`,
      label: label ?? "",
      lo,
      hi,
    })),
  } as Dimension;
}

// ──────────────────────────────────────────────────────────────────
// Clean dims — no issues
// ──────────────────────────────────────────────────────────────────

describe("validateBandedDimension — clean dims", () => {
  it("returns [] for a contiguous banded dim", () => {
    const dim = bandedFrom([
      [0, 5],
      [5, 15],
      [15, 30],
    ]);
    expect(validateBandedDimension(dim)).toEqual([]);
  });

  it("returns [] when called with a bare level array", () => {
    const levels: readonly DimensionLevel[] = [
      { kind: "banded", id: "a", label: "A", lo: 0, hi: 5 },
      { kind: "banded", id: "b", label: "B", lo: 5, hi: 10 },
    ];
    expect(validateBandedDimension(levels)).toEqual([]);
  });

  it("returns [] for a non-banded dim (tolerant)", () => {
    const dim: Dimension = {
      id: "x",
      display_name: "X",
      slug: "x",
      data_type: "string",
      role: "rating-input",
      shape: "categorical",
      levels: [],
    } as Dimension;
    expect(validateBandedDimension(dim)).toEqual([]);
  });

  it("accepts open-ended bounds at the endpoints", () => {
    const dim = bandedFrom([
      [Number.NEGATIVE_INFINITY, 5],
      [5, 50],
      [50, Number.POSITIVE_INFINITY],
    ]);
    expect(validateBandedDimension(dim)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Empty
// ──────────────────────────────────────────────────────────────────

describe("validateBandedDimension — empty", () => {
  it("returns a single 'empty' issue for a banded dim with no levels", () => {
    const dim = bandedFrom([]);
    const issues = validateBandedDimension(dim);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("empty");
  });
});

// ──────────────────────────────────────────────────────────────────
// Gaps
// ──────────────────────────────────────────────────────────────────

describe("validateBandedDimension — gaps", () => {
  it("flags a single gap with the correct [lo, hi)", () => {
    const dim = bandedFrom([
      [0, 5],
      [5, 15],
      [30, 50],
    ]);
    const issues = validateBandedDimension(dim);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "gap",
      afterIndex: 1,
      lo: 15,
      hi: 30,
    });
  });

  it("flags multiple gaps in order of appearance", () => {
    const dim = bandedFrom([
      [0, 5],
      [10, 15],
      [20, 30],
      [40, 50],
    ]);
    const issues = validateBandedDimension(dim).filter(
      (i): i is Extract<BandedDimensionIssue, { kind: "gap" }> =>
        i.kind === "gap",
    );
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => [i.lo, i.hi])).toEqual([
      [5, 10],
      [15, 20],
      [30, 40],
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Overlaps
// ──────────────────────────────────────────────────────────────────

describe("validateBandedDimension — overlaps", () => {
  it("flags a single overlap with the correct [lo, hi)", () => {
    const dim = bandedFrom([
      [0, 10],
      [5, 20],
    ]);
    const issues = validateBandedDimension(dim);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "overlap",
      afterIndex: 0,
      lo: 5,
      hi: 10,
    });
  });

  it("treats touching boundaries (lo == hi) as contiguous, not overlap", () => {
    const dim = bandedFrom([
      [0, 5],
      [5, 10],
    ]);
    expect(validateBandedDimension(dim)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Sort order
// ──────────────────────────────────────────────────────────────────

describe("validateBandedDimension — sort order", () => {
  it("flags an out-of-order band", () => {
    // bands[1].lo (0) < bands[0].lo (10) → sort-order issue at index 1.
    const dim = bandedFrom([
      [10, 20],
      [0, 5],
    ]);
    const issues = validateBandedDimension(dim).filter(
      (i) => i.kind === "sort-order",
    );
    expect(issues).toHaveLength(1);
    expect((issues[0] as { index: number }).index).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────
// Invalid bounds
// ──────────────────────────────────────────────────────────────────

describe("validateBandedDimension — invalid bounds", () => {
  it("flags lo ≥ hi", () => {
    const dim = bandedFrom([
      [10, 10],
      [10, 20],
    ]);
    const issues = validateBandedDimension(dim).filter(
      (i) => i.kind === "invalid-bound",
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatchObject({
      kind: "invalid-bound",
      index: 0,
      reason: "lo-ge-hi",
    });
  });

  it("flags NaN bounds", () => {
    const dim = bandedFrom([[NaN, 5]]);
    const issues = validateBandedDimension(dim).filter(
      (i) => i.kind === "invalid-bound",
    );
    expect(issues.some((i) => (i as { reason: string }).reason === "nan-lo")).toBe(true);
  });

  it("flags -Infinity on a non-first band", () => {
    const dim = bandedFrom([
      [0, 5],
      [Number.NEGATIVE_INFINITY, 10],
    ]);
    const issues = validateBandedDimension(dim).filter(
      (i) => i.kind === "invalid-bound",
    );
    expect(
      issues.some(
        (i) => (i as { reason: string }).reason === "neg-inf-not-first",
      ),
    ).toBe(true);
  });

  it("flags +Infinity on a non-last band", () => {
    const dim = bandedFrom([
      [0, Number.POSITIVE_INFINITY],
      [5, 10],
    ]);
    const issues = validateBandedDimension(dim).filter(
      (i) => i.kind === "invalid-bound",
    );
    expect(
      issues.some(
        (i) => (i as { reason: string }).reason === "pos-inf-not-last",
      ),
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
// Mixed non-banded levels
// ──────────────────────────────────────────────────────────────────

describe("validateBandedDimension — mixed kinds", () => {
  it("flags non-banded levels with their original index", () => {
    const levels: readonly DimensionLevel[] = [
      { kind: "banded", id: "a", label: "A", lo: 0, hi: 5 },
      { kind: "categorical", id: "x", label: "X", aliases: [] },
      { kind: "banded", id: "b", label: "B", lo: 5, hi: 10 },
    ];
    const issues = validateBandedDimension(levels).filter(
      (i) => i.kind === "non-banded-level",
    );
    expect(issues).toHaveLength(1);
    expect((issues[0] as { index: number }).index).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────
// bandedGapsAndOverlaps helper
// ──────────────────────────────────────────────────────────────────

describe("bandedGapsAndOverlaps", () => {
  it("returns only gap + overlap issues", () => {
    const dim = bandedFrom([
      [0, 5],
      [10, 15], // gap 5-10
      [12, 20], // overlap 12-15
    ]);
    const subset = bandedGapsAndOverlaps(dim);
    // 1 gap + 1 overlap = 2; no sort/empty/invalid in output.
    expect(subset.map((i) => i.kind).sort()).toEqual(["gap", "overlap"]);
  });

  it("returns [] when there are no gap/overlap issues", () => {
    const dim = bandedFrom([
      [0, 5],
      [5, 10],
    ]);
    expect(bandedGapsAndOverlaps(dim)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// describeBandedIssue — message strings
// ──────────────────────────────────────────────────────────────────

describe("describeBandedIssue", () => {
  it("produces a complete-sentence message for a gap", () => {
    const msg = describeBandedIssue({
      kind: "gap",
      afterIndex: 1,
      lo: 15,
      hi: 30,
    });
    expect(msg).toContain("Coverage gap");
    expect(msg).toContain("15");
    expect(msg).toContain("30");
    expect(msg.endsWith(".")).toBe(true);
  });

  it("produces a message for empty", () => {
    expect(describeBandedIssue({ kind: "empty" })).toContain("no bands");
  });

  it("produces a message for invalid-bound with reason", () => {
    expect(
      describeBandedIssue({
        kind: "invalid-bound",
        index: 2,
        reason: "lo-ge-hi",
      }),
    ).toContain("strictly less than");
  });
});
