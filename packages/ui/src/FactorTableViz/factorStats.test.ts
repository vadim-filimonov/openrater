/**
 * Brief 45 PR 45.1 — factorStats unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  UNIFORM_THRESHOLD,
  computeFactorStats,
  formatCoverageFraction,
  formatCoveragePercent,
  formatFactorValue,
  isUniform,
} from "./factorStats";

describe("computeFactorStats", () => {
  it("returns nulls when every cell is empty", () => {
    const r = computeFactorStats([undefined, undefined, undefined]);
    expect(r.mean).toBeNull();
    expect(r.range).toBeNull();
    expect(r.stddev).toBeNull();
    expect(r.populatedCount).toBe(0);
    expect(r.totalCount).toBe(3);
    expect(r.coverage).toBe(0);
    expect(r.uniformityRatio).toBeNull();
  });

  it("returns zeros when given an empty array", () => {
    const r = computeFactorStats([]);
    expect(r.populatedCount).toBe(0);
    expect(r.totalCount).toBe(0);
    expect(r.coverage).toBe(0);
  });

  it("computes mean / range / stddev for a populated table", () => {
    // Brief 45 mockup sparse-mode example: WI 1.30, IL 1.10, TX 1.00,
    // CA 0.95, NY 0.85. Mean = 1.04, range [0.85, 1.30].
    const r = computeFactorStats([1.3, 1.1, 1.0, 0.95, 0.85]);
    expect(r.mean).toBeCloseTo(1.04, 2);
    expect(r.range).toEqual([0.85, 1.3]);
    expect(r.populatedCount).toBe(5);
    expect(r.totalCount).toBe(5);
    expect(r.coverage).toBe(1);
    expect(r.stddev).toBeGreaterThan(0);
    expect(r.uniformityRatio).toBeGreaterThan(0);
  });

  it("Coverage measures populated / total — empty cells lower it", () => {
    const r = computeFactorStats([1.2, undefined, 1.0, undefined, 0.9]);
    expect(r.populatedCount).toBe(3);
    expect(r.totalCount).toBe(5);
    expect(r.coverage).toBe(0.6);
    expect(r.mean).toBeCloseTo(1.0333, 3);
  });

  it("skips NaN and ±Infinity (treats them as empty)", () => {
    const r = computeFactorStats([
      1.0,
      Number.NaN,
      1.2,
      Number.POSITIVE_INFINITY,
      0.8,
      Number.NEGATIVE_INFINITY,
    ]);
    expect(r.populatedCount).toBe(3);
    expect(r.totalCount).toBe(6);
    expect(r.mean).toBeCloseTo(1.0, 5);
    expect(r.range).toEqual([0.8, 1.2]);
  });

  it("uniformityRatio is stddev / |mean| (a relative-spread measure)", () => {
    // All ones — perfect uniformity, ratio = 0.
    const flat = computeFactorStats([1.0, 1.0, 1.0, 1.0]);
    expect(flat.stddev).toBe(0);
    expect(flat.uniformityRatio).toBe(0);

    // Constant 0.5 — also uniform, ratio = 0.
    const half = computeFactorStats([0.5, 0.5, 0.5]);
    expect(half.uniformityRatio).toBe(0);

    // Variation — ratio > 0.
    const varied = computeFactorStats([0.5, 1.0, 1.5]);
    expect(varied.uniformityRatio).toBeGreaterThan(0);
  });

  it("uniformityRatio is null when mean is effectively zero", () => {
    const r = computeFactorStats([-1, 0, 1]);
    expect(r.mean).toBeCloseTo(0, 10);
    expect(r.uniformityRatio).toBeNull();
  });

  it("stddev is the population stddev (divides by N, not N-1)", () => {
    // [0, 2] → mean 1, deviations [-1, 1], sumSq 2, /2 = 1, sqrt = 1
    const r = computeFactorStats([0, 2]);
    expect(r.stddev).toBe(1);
  });
});

describe("isUniform", () => {
  it("returns true for a fully-flat factor table at 1.0", () => {
    const r = computeFactorStats([1.0, 1.0, 1.0, 1.0, 1.0]);
    expect(isUniform(r)).toBe(true);
  });

  it("returns true even when fully-flat at a non-1.0 value", () => {
    const r = computeFactorStats([2.5, 2.5, 2.5]);
    expect(isUniform(r)).toBe(true);
  });

  it("returns false when there's measurable variance", () => {
    const r = computeFactorStats([1.0, 1.01, 1.02]); // ~1% spread
    expect(isUniform(r)).toBe(false);
  });

  it("returns false for fewer than 2 populated cells", () => {
    const single = computeFactorStats([1.0, undefined, undefined]);
    expect(isUniform(single)).toBe(false);
    const none = computeFactorStats([undefined, undefined]);
    expect(isUniform(none)).toBe(false);
  });

  it("returns true for tiny floating-point noise below the threshold", () => {
    // Within 0.001% of 1.0 — definitely below 0.5% threshold.
    const r = computeFactorStats([
      0.999_999, 1.000_001, 1.000_000, 0.999_999, 1.000_001,
    ]);
    expect(isUniform(r)).toBe(true);
  });

  it("UNIFORM_THRESHOLD is the documented 0.005 value", () => {
    expect(UNIFORM_THRESHOLD).toBe(0.005);
  });
});

describe("formatFactorValue", () => {
  it("formats null / non-finite as the em dash", () => {
    expect(formatFactorValue(null)).toBe("—");
    expect(formatFactorValue(Number.NaN)).toBe("—");
    expect(formatFactorValue(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("strips trailing zeros (e.g. 1.00 → 1)", () => {
    expect(formatFactorValue(1.0)).toBe("1");
    expect(formatFactorValue(1.5)).toBe("1.5");
    expect(formatFactorValue(1.04)).toBe("1.04");
    expect(formatFactorValue(0)).toBe("0");
  });

  it("returns 2 decimal places of precision", () => {
    expect(formatFactorValue(1.235)).toBe("1.24"); // rounded to 2dp
    expect(formatFactorValue(0.999)).toBe("1");
  });
});

describe("formatCoverageFraction", () => {
  it("returns the populated / total shape", () => {
    expect(formatCoverageFraction(48, 50)).toBe("48 / 50");
    expect(formatCoverageFraction(0, 0)).toBe("0 / 0");
  });
});

describe("formatCoveragePercent", () => {
  it("rounds to integer percent", () => {
    expect(formatCoveragePercent(0.96)).toBe("96%");
    expect(formatCoveragePercent(1.0)).toBe("100%");
    expect(formatCoveragePercent(0.999)).toBe("100%");
    expect(formatCoveragePercent(0)).toBe("0%");
  });

  it("returns em dash for non-finite", () => {
    expect(formatCoveragePercent(Number.NaN)).toBe("—");
  });
});
