import { describe, it, expect } from "vitest";
import { computeDislocation } from "./dislocation";
import type { AnalyticsScoredRow } from "./exhibit-math";

const PREMIUM = "final_premium";
const mk = (prem: number): AnalyticsScoredRow => ({
  inputs: {},
  outputs: { [PREMIUM]: prem },
});

function run(base: number[], comp: number[]) {
  return computeDislocation({
    baselineRows: base.map(mk),
    comparisonRows: comp.map(mk),
    premiumColumn: PREMIUM,
  });
}

describe("computeDislocation", () => {
  it("computes a uniform increase", () => {
    const d = run([1000, 1000], [1100, 1100]);
    expect(d.summary.total).toBe(2);
    expect(d.summary.pctUp).toBe(1);
    expect(d.summary.pctDown).toBe(0);
    expect(d.summary.maxUp).toBeCloseTo(0.1, 6);
    expect(d.summary.maxDown).toBeCloseTo(0.1, 6);
    expect(d.summary.weightedAvg).toBeCloseTo(0.1, 6); // 2200/2000 − 1
    expect(d.summary.pctWithin10).toBe(1);
    expect(d.summary.pctWithin5).toBe(0);
    expect(d.summary.naCount).toBe(0);
  });

  it("splits up / down / flat and bands", () => {
    const d = run([1000, 1000, 1000], [1200, 950, 1000]); // +20%, −5%, 0%
    expect(d.summary.total).toBe(3);
    expect(d.summary.pctUp).toBeCloseTo(1 / 3, 6);
    expect(d.summary.pctDown).toBeCloseTo(1 / 3, 6);
    expect(d.summary.pctWithin5).toBeCloseTo(2 / 3, 6); // −5% and 0%
    expect(d.summary.pctWithin10).toBeCloseTo(2 / 3, 6);
    expect(d.summary.maxUp).toBeCloseTo(0.2, 6);
    expect(d.summary.maxDown).toBeCloseTo(-0.05, 6);
    expect(d.summary.weightedAvg).toBeCloseTo(0.05, 6); // 3150/3000 − 1
  });

  it("excludes zero-base rows from the Δ population (naCount)", () => {
    const d = run([0, 1000], [500, 1100]);
    expect(d.summary.total).toBe(1);
    expect(d.summary.naCount).toBe(1);
    // weightedAvg over old>0 rows only: 1100/1000 − 1
    expect(d.summary.weightedAvg).toBeCloseTo(0.1, 6);
  });

  it("counts beyond-range values without dropping them", () => {
    const d = run([1000, 1000], [4000, 400]); // +300% (>200%), −60% (<−50%)
    expect(d.summary.total).toBe(2);
    expect(d.beyondHigh).toBe(1);
    expect(d.beyondLow).toBe(1);
    expect(d.bins.reduce((s, b) => s + b.count, 0)).toBe(0); // both out of range
    expect(d.summary.maxUp).toBeCloseTo(3.0, 6);
    expect(d.summary.maxDown).toBeCloseTo(-0.6, 6);
  });

  it("bins an in-range delta at the right bucket", () => {
    const d = run([1000], [1000]); // Δ = 0
    // Default range [-0.5, 2.0], width 0.025 → 0% lands in the bin [0, 0.025).
    const zeroBin = d.bins.find((b) => Math.abs(b.lo) < 1e-9)!;
    expect(zeroBin).toBeDefined();
    expect(zeroBin.count).toBe(1);
    expect(d.beyondLow + d.beyondHigh).toBe(0);
  });

  it("only pairs up to the shorter side", () => {
    const d = run([1000, 1000], [1100]); // n = 1
    expect(d.summary.total).toBe(1);
    expect(d.summary.weightedAvg).toBeCloseTo(0.1, 6);
  });

  it("handles an empty book", () => {
    const d = run([], []);
    expect(d.summary.total).toBe(0);
    expect(d.summary.maxUp).toBeNull();
    expect(d.summary.maxDown).toBeNull();
    expect(d.summary.weightedAvg).toBeNull();
    expect(d.bins.reduce((s, b) => s + b.count, 0)).toBe(0);
  });
});
