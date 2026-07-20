import { describe, it, expect } from "vitest";
import {
  computeEqualCountBins,
  binIndexForValue,
  type EqualCountBinning,
  type EqualCountGroups,
} from "./binning";

/** Assert the structural invariants every binning must satisfy (§5.1). */
function expectInvariants(binning: EqualCountBinning, expectedN: number): void {
  const { bins, formed, requested, n } = binning;
  expect(n).toBe(expectedN);
  expect(formed).toBe(bins.length);
  expect(formed).toBeLessThanOrEqual(requested);
  if (expectedN === 0) {
    expect(bins).toHaveLength(0);
    return;
  }
  // Counts partition all rows.
  expect(bins.reduce((s, b) => s + b.count, 0)).toBe(expectedN);
  // Sorted, disjoint, contiguous-by-value: each bin's hi < the next bin's lo.
  for (let i = 0; i < bins.length; i++) {
    expect(bins[i]!.lo).toBeLessThanOrEqual(bins[i]!.hi);
    expect(bins[i]!.count).toBeGreaterThan(0);
    if (i > 0) expect(bins[i - 1]!.hi).toBeLessThan(bins[i]!.lo);
  }
  // ≥ 2 distinct values per bin, except the degenerate single-bin case.
  if (formed > 1) {
    for (const b of bins) expect(b.distinctCount).toBeGreaterThanOrEqual(2);
  }
}

describe("computeEqualCountBins", () => {
  it("returns no bins for empty input", () => {
    const r = computeEqualCountBins([], 10);
    expect(r.bins).toHaveLength(0);
    expect(r.formed).toBe(0);
    expect(r.n).toBe(0);
  });

  it("drops non-finite values", () => {
    const r = computeEqualCountBins(
      [1, 2, NaN, 3, Infinity, 4, -Infinity, 5, 6, 7, 8, 9, 10],
      5,
    );
    expectInvariants(r, 10); // only the 10 finite values count
  });

  it("collapses to a single bin when all values are identical", () => {
    const r = computeEqualCountBins([5, 5, 5, 5], 10);
    expect(r.formed).toBe(1);
    expect(r.bins[0]).toMatchObject({ lo: 5, hi: 5, count: 4, distinctCount: 1 });
  });

  it("collapses when there are too few distinct values for 2 groups", () => {
    // 3 distinct values can support at most floor(3/2) = 1 bin (≥2 distinct each).
    const r = computeEqualCountBins([1, 2, 3], 5);
    expect(r.formed).toBe(1);
    expectInvariants(r, 3);
  });

  it("splits a uniform spread into equal-count groups", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r = computeEqualCountBins(values, 5);
    expect(r.formed).toBe(5);
    expectInvariants(r, 10);
    // Each group holds exactly 2 rows / 2 distinct values.
    for (const b of r.bins) {
      expect(b.count).toBe(2);
      expect(b.distinctCount).toBe(2);
    }
    expect(r.bins.map((b) => [b.lo, b.hi])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
    ]);
  });

  it("forms 20 balanced bins from 100 distinct values", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const r = computeEqualCountBins(values, 20);
    expect(r.formed).toBe(20);
    expectInvariants(r, 100);
    for (const b of r.bins) expect(b.count).toBe(5);
  });

  it("keeps a mass point whole (never splits equal values across bins)", () => {
    // Five 1's, then 2,3,4. With 4 distinct values, at most 2 bins.
    const values = [1, 1, 1, 1, 1, 2, 3, 4];
    const r = computeEqualCountBins(values, 5);
    expect(r.formed).toBe(2);
    expectInvariants(r, 8);
    // The mass point lands wholly in the first bin.
    expect(r.bins[0]!.count).toBe(6); // {1×5, 2×1}
    expect(r.bins[1]!.count).toBe(2); // {3, 4}
  });

  it("reports requested vs formed honestly when ties force fewer bins", () => {
    // 6 distinct values → at most 3 bins, even though 10 were requested.
    const r = computeEqualCountBins([1, 2, 3, 4, 5, 6], 10);
    expect(r.requested).toBe(10);
    expect(r.formed).toBeLessThan(10);
    expect(r.formed).toBe(3);
    expectInvariants(r, 6);
  });

  it.each<EqualCountGroups>([5, 10, 20])(
    "holds invariants on a skewed distribution for groups=%i",
    (groups) => {
      // Long right tail + a couple of mass points.
      const values: number[] = [];
      for (let i = 0; i < 50; i++) values.push(1); // mass point at 1
      for (let i = 0; i < 30; i++) values.push(2); // mass point at 2
      for (let v = 3; v <= 80; v++) values.push(v); // long tail
      const r = computeEqualCountBins(values, groups);
      expectInvariants(r, values.length);
    },
  );
});

describe("binIndexForValue", () => {
  const binning = computeEqualCountBins(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    5,
  ); // bins [1,2] [3,4] [5,6] [7,8] [9,10]

  it("assigns interior values to the owning bin", () => {
    expect(binIndexForValue(binning, 1)).toBe(0);
    expect(binIndexForValue(binning, 2)).toBe(0);
    expect(binIndexForValue(binning, 4)).toBe(1);
    expect(binIndexForValue(binning, 9)).toBe(4);
    expect(binIndexForValue(binning, 10)).toBe(4);
  });

  it("clamps out-of-sample values to the first / last bin", () => {
    expect(binIndexForValue(binning, -100)).toBe(0);
    expect(binIndexForValue(binning, 999)).toBe(4);
  });

  it("returns -1 when there are no bins", () => {
    expect(binIndexForValue(computeEqualCountBins([], 5), 3)).toBe(-1);
  });
});
