/**
 * Brief 45 PR 45.4 — factorDistribution unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTLIER_COUNT,
  DENSE_THRESHOLD,
  MAX_BINS,
  MIN_BINS,
  binIndexForValue,
  computeFactorDistribution,
  formatBinLabel,
  isDense,
  sturgesBinCount,
  type FactorDistributionDatum,
} from "./factorDistribution";

function gen(n: number, base = 1.0, spread = 0.5): FactorDistributionDatum[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `k${i}`,
    label: `Level ${i}`,
    value: base + (spread * (i - n / 2)) / n,
  }));
}

describe("sturgesBinCount", () => {
  it("returns MIN_BINS for very small n", () => {
    expect(sturgesBinCount(0)).toBe(MIN_BINS);
    expect(sturgesBinCount(1)).toBe(MIN_BINS);
    expect(sturgesBinCount(2)).toBe(MIN_BINS); // ceil(log2(2)+1) = 2 → clamped
  });

  it("returns ceil(log2(n)+1) within bounds", () => {
    expect(sturgesBinCount(10)).toBe(5); // ceil(3.32+1)=5
    expect(sturgesBinCount(50)).toBe(7); // ceil(5.64+1)=7
    expect(sturgesBinCount(500)).toBe(10); // ceil(8.97+1)=10
  });

  it("caps at MAX_BINS for very large n", () => {
    expect(sturgesBinCount(1_000_000)).toBe(MAX_BINS);
    expect(sturgesBinCount(Number.MAX_SAFE_INTEGER)).toBe(MAX_BINS);
  });
});

describe("computeFactorDistribution", () => {
  it("returns nulls + empty arrays when data is empty", () => {
    const r = computeFactorDistribution({ data: [] });
    expect(r.bins).toEqual([]);
    expect(r.domain).toBeNull();
    expect(r.median).toBeNull();
    expect(r.mean).toBeNull();
    expect(r.stddev).toBeNull();
    expect(r.populatedCount).toBe(0);
    expect(r.topOutliers).toEqual([]);
    expect(r.bottomOutliers).toEqual([]);
    expect(r.allRankedByDeviation).toEqual([]);
  });

  it("filters non-finite values from the population", () => {
    const r = computeFactorDistribution({
      data: [
        { key: "a", label: "A", value: 1.0 },
        { key: "b", label: "B", value: Number.NaN },
        { key: "c", label: "C", value: 1.2 },
        { key: "d", label: "D", value: Number.POSITIVE_INFINITY },
      ],
    });
    expect(r.populatedCount).toBe(2);
    expect(r.domain).toEqual([1.0, 1.2]);
  });

  it("produces a single degenerate bin when all values are equal", () => {
    const data = gen(10, 1.0, 0); // all values = 1.0
    const r = computeFactorDistribution({ data });
    expect(r.bins).toHaveLength(1);
    expect(r.bins[0]?.count).toBe(10);
    expect(r.bins[0]?.lo).toBe(1.0);
    expect(r.bins[0]?.hi).toBe(1.0);
    expect(r.domain).toEqual([1.0, 1.0]);
    expect(r.stddev).toBe(0);
  });

  it("distributes values across Sturges-derived bins for n=50", () => {
    const data = gen(50, 1.0, 2.0); // values spread roughly [0, 2]
    const r = computeFactorDistribution({ data });
    expect(r.binCount).toBe(7); // Sturges: ceil(log2(50)+1) = 7
    expect(r.bins).toHaveLength(7);
    // Sum of bin counts equals the populated count.
    const total = r.bins.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(50);
  });

  it("respects the override binCount", () => {
    const data = gen(100, 1.0, 1.0);
    const r = computeFactorDistribution({ data, binCount: 10 });
    expect(r.binCount).toBe(10);
    expect(r.bins).toHaveLength(10);
  });

  it("each bin's midpoint sits between its lo and hi", () => {
    const data = gen(100, 1.0, 1.0);
    const r = computeFactorDistribution({ data, binCount: 5 });
    for (const b of r.bins) {
      expect(b.midpoint).toBeGreaterThanOrEqual(b.lo);
      expect(b.midpoint).toBeLessThanOrEqual(b.hi);
    }
  });

  it("topOutliers are the highest N values, sorted value desc", () => {
    const data = [
      { key: "a", label: "A", value: 1.0 },
      { key: "b", label: "B", value: 2.5 },
      { key: "c", label: "C", value: 0.5 },
      { key: "d", label: "D", value: 1.8 },
      { key: "e", label: "E", value: 2.0 },
      { key: "f", label: "F", value: 1.2 },
    ];
    const r = computeFactorDistribution({ data, outlierCount: 3 });
    expect(r.topOutliers).toHaveLength(3);
    expect(r.topOutliers.map((o) => o.key)).toEqual(["b", "e", "d"]);
  });

  it("bottomOutliers are the lowest N values, sorted value asc", () => {
    const data = [
      { key: "a", label: "A", value: 1.0 },
      { key: "b", label: "B", value: 2.5 },
      { key: "c", label: "C", value: 0.5 },
      { key: "d", label: "D", value: 1.8 },
      { key: "e", label: "E", value: 2.0 },
      { key: "f", label: "F", value: 1.2 },
    ];
    const r = computeFactorDistribution({ data, outlierCount: 3 });
    expect(r.bottomOutliers).toHaveLength(3);
    expect(r.bottomOutliers.map((o) => o.key)).toEqual(["c", "a", "f"]);
  });

  it("default outlier count is 5 each per the Q6 lock", () => {
    expect(DEFAULT_OUTLIER_COUNT).toBe(5);
    const data = gen(20, 1.0, 1.0);
    const r = computeFactorDistribution({ data });
    expect(r.topOutliers).toHaveLength(5);
    expect(r.bottomOutliers).toHaveLength(5);
  });

  it("outlier entries carry the optional sublabel", () => {
    const data: FactorDistributionDatum[] = [
      { key: "x", label: "Class 1234", value: 2.0, sublabel: "5345 NTEE" },
    ];
    const r = computeFactorDistribution({ data });
    expect(r.topOutliers[0]?.sublabel).toBe("5345 NTEE");
  });

  it("allRankedByDeviation sorts by |value - median| desc", () => {
    const data = [
      { key: "a", label: "A", value: 1.0 },
      { key: "b", label: "B", value: 1.0 },
      { key: "c", label: "C", value: 1.0 },
      { key: "d", label: "D", value: 5.0 },
      { key: "e", label: "E", value: 0.1 },
    ];
    const r = computeFactorDistribution({ data });
    expect(r.median).toBe(1.0);
    // 5.0 deviates by 4.0; 0.1 deviates by 0.9; rest by 0.
    expect(r.allRankedByDeviation[0]?.key).toBe("d");
    expect(r.allRankedByDeviation[1]?.key).toBe("e");
  });

  it("maxBinCount is the max count across bins", () => {
    const data = gen(100, 1.0, 1.0);
    const r = computeFactorDistribution({ data });
    let max = 0;
    for (const b of r.bins) if (b.count > max) max = b.count;
    expect(r.maxBinCount).toBe(max);
  });

  it("each bin's keys are the level ids that fall into it", () => {
    const data = [
      { key: "a", label: "A", value: 0.5 },
      { key: "b", label: "B", value: 1.0 },
      { key: "c", label: "C", value: 1.5 },
      { key: "d", label: "D", value: 2.0 },
    ];
    const r = computeFactorDistribution({ data, binCount: 4 });
    const allBinKeys = r.bins.flatMap((b) => b.keys);
    expect(allBinKeys.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("mean + stddev + median match independent calculations", () => {
    const values = [0.5, 1.0, 1.0, 1.5, 2.0];
    const data = values.map((v, i) => ({
      key: `k${i}`,
      label: `L${i}`,
      value: v,
    }));
    const r = computeFactorDistribution({ data });
    expect(r.mean).toBeCloseTo(1.2, 5);
    expect(r.median).toBe(1.0);
    // stddev pop: var = (0.49+0.04+0.04+0.09+0.64)/5 = 0.26; sqrt ≈ 0.51
    expect(r.stddev).toBeCloseTo(0.5099, 3);
  });
});

describe("formatBinLabel", () => {
  it("uses closed-open notation by default", () => {
    expect(
      formatBinLabel(
        { index: 0, lo: 0.5, hi: 1.0, midpoint: 0.75, count: 0, keys: [] },
        false,
      ),
    ).toBe("[0.5 — 1)");
  });

  it("uses closed-closed for the last bin", () => {
    expect(
      formatBinLabel(
        { index: 4, lo: 2.0, hi: 2.85, midpoint: 2.425, count: 0, keys: [] },
        true,
      ),
    ).toBe("[2 — 2.85]");
  });

  it("strips trailing zeros in the formatted bounds", () => {
    expect(
      formatBinLabel(
        { index: 0, lo: 1.0, hi: 2.0, midpoint: 1.5, count: 0, keys: [] },
        false,
      ),
    ).toBe("[1 — 2)");
  });
});

describe("binIndexForValue", () => {
  const data = gen(20, 1.0, 1.0);
  const r = computeFactorDistribution({ data, binCount: 5 });

  it("returns -1 when bins is empty", () => {
    expect(binIndexForValue(1.0, [])).toBe(-1);
  });

  it("locates the bin a value falls into", () => {
    expect(binIndexForValue(r.bins[0]!.midpoint, r.bins)).toBe(0);
    expect(binIndexForValue(r.bins[2]!.midpoint, r.bins)).toBe(2);
    expect(binIndexForValue(r.bins[4]!.midpoint, r.bins)).toBe(4);
  });

  it("places the global max in the last bin (closed-closed semantic)", () => {
    const max = r.domain![1];
    expect(binIndexForValue(max, r.bins)).toBe(r.bins.length - 1);
  });
});

describe("isDense + DENSE_THRESHOLD", () => {
  it("returns true above the threshold (>30 levels)", () => {
    expect(DENSE_THRESHOLD).toBe(30);
    expect(isDense(30)).toBe(false); // at threshold = not dense
    expect(isDense(31)).toBe(true);
    expect(isDense(487)).toBe(true);
  });

  it("returns false at or below the threshold", () => {
    expect(isDense(0)).toBe(false);
    expect(isDense(10)).toBe(false);
    expect(isDense(30)).toBe(false);
  });
});
