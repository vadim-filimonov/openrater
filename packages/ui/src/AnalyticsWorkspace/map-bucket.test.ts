/**
 * Tests for the choropleth bucketing math — Brief 43 PR 43.5.
 *
 * Two modes:
 *   · Volume (count, total): ratio-to-per-cell-share
 *   · Relative (avg, lr, rate_change): z-score-ish vs book avg
 */

import { describe, expect, it } from "vitest";
import {
  bucketForValue,
  bucketMap,
  divergingColor,
  DIVERGING_RAMP,
  SEQUENTIAL_RAMP,
} from "./map-bucket";

describe("bucketForValue — volume KPIs (count, total)", () => {
  // bookTotal=51 → per-cell-avg=1.0; ratios map to:
  //   ≥4  → +3
  //   ≥2  → +2
  //   ≥1.2 → +1
  //   ≥0.7 → 0
  //   ≥0.4 → -1
  //   ≥0.2 → -2
  //   else → -3
  const total = 51;
  const avg = 0; // unused for volume

  it("returns +3 for value ≥ 4× per-cell average", () => {
    expect(bucketForValue(4, total, avg, "count")).toBe(3);
    expect(bucketForValue(10, total, avg, "total")).toBe(3);
  });

  it("returns +2 for 2× ≤ value < 4×", () => {
    expect(bucketForValue(2, total, avg, "count")).toBe(2);
    expect(bucketForValue(3.99, total, avg, "total")).toBe(2);
  });

  it("returns +1 for 1.2× ≤ value < 2×", () => {
    expect(bucketForValue(1.2, total, avg, "count")).toBe(1);
    expect(bucketForValue(1.9, total, avg, "total")).toBe(1);
  });

  it("returns 0 for 0.7× ≤ value < 1.2× (the 'at-average' band)", () => {
    expect(bucketForValue(1, total, avg, "count")).toBe(0);
    expect(bucketForValue(0.7, total, avg, "total")).toBe(0);
    expect(bucketForValue(1.19, total, avg, "count")).toBe(0);
  });

  it("returns -1 / -2 / -3 for progressively smaller values", () => {
    expect(bucketForValue(0.5, total, avg, "count")).toBe(-1);
    expect(bucketForValue(0.3, total, avg, "total")).toBe(-2);
    expect(bucketForValue(0.1, total, avg, "count")).toBe(-3);
    expect(bucketForValue(0, total, avg, "total")).toBe(-3);
  });

  it("returns 0 when book total is non-positive", () => {
    expect(bucketForValue(100, 0, avg, "count")).toBe(0);
    expect(bucketForValue(100, -5, avg, "total")).toBe(0);
  });
});

describe("bucketForValue — relative KPIs (avg, lr, rate_change)", () => {
  // bookAverage=100 → stdish=25.
  //   z ≥  2 → +3   (value ≥ 150)
  //   z ≥  1 → +2   (value ≥ 125)
  //   z ≥  0.3 → +1 (value ≥ 107.5)
  //   z ≥ -0.3 → 0  (92.5 ≤ value < 107.5)
  //   z ≥ -1 → -1   (75 ≤ value < 92.5)
  //   z ≥ -2 → -2   (50 ≤ value < 75)
  //   else → -3
  const total = 0; // unused for relative
  const avg = 100;

  it("returns 0 for value within ±0.3 stdish of the average", () => {
    expect(bucketForValue(100, total, avg, "avg")).toBe(0);
    expect(bucketForValue(105, total, avg, "lr")).toBe(0);
    expect(bucketForValue(95, total, avg, "rate_change")).toBe(0);
  });

  it("returns +1 / +2 / +3 for progressively larger values", () => {
    expect(bucketForValue(110, total, avg, "avg")).toBe(1);
    expect(bucketForValue(130, total, avg, "lr")).toBe(2);
    expect(bucketForValue(200, total, avg, "rate_change")).toBe(3);
  });

  it("returns -1 / -2 / -3 for progressively smaller values", () => {
    expect(bucketForValue(85, total, avg, "avg")).toBe(-1);
    expect(bucketForValue(60, total, avg, "lr")).toBe(-2);
    expect(bucketForValue(20, total, avg, "rate_change")).toBe(-3);
  });

  it("handles zero average with the 0.05 floor (no divide-by-zero)", () => {
    // avg=0 → stdish floor=0.05. value=0.06 → z=1.2 → +2
    expect(bucketForValue(0.06, total, 0, "rate_change")).toBe(2);
    expect(bucketForValue(0, total, 0, "rate_change")).toBe(0);
    expect(bucketForValue(-0.06, total, 0, "rate_change")).toBe(-2);
  });
});

describe("bucketForValue — null / NaN handling", () => {
  it("treats null + NaN as bucket 0 (neutral)", () => {
    expect(bucketForValue(null, 100, 50, "total")).toBe(0);
    expect(bucketForValue(NaN, 100, 50, "lr")).toBe(0);
    expect(bucketForValue(Infinity, 100, 50, "avg")).toBe(0);
  });
});

describe("bucketMap", () => {
  it("buckets every state in the map at once", () => {
    // With bookTotal=305 across 4 states, per-cell-avg ≈ 5.98.
    //  CA=200 → ratio ≈ 33  → +3
    //  TX=100 → ratio ≈ 17  → +3
    //  WY=0.5 → ratio ≈ 0.08 → -3
    //  FL=null → 0 (neutral)
    const values = new Map<string, number | null>([
      ["CA", 200],
      ["WY", 0.5],
      ["TX", 100],
      ["FL", null],
    ]);
    const buckets = bucketMap(values, "total");
    expect(buckets.size).toBe(4);
    expect(buckets.get("CA")).toBeGreaterThan(0);
    expect(buckets.get("WY")).toBeLessThan(0);
    expect(buckets.get("FL")).toBe(0);
  });

  it("derives book totals from the value map", () => {
    // 4 states, total 100, per-cell-avg = 100/51 ≈ 1.96
    // CA=50 → ratio≈25.5 → +3
    // TX=30 → ratio≈15.3 → +3
    // NY=15 → ratio≈7.65 → +3
    // WY=5  → ratio≈2.55 → +2
    const values = new Map<string, number | null>([
      ["CA", 50],
      ["TX", 30],
      ["NY", 15],
      ["WY", 5],
    ]);
    const buckets = bucketMap(values, "total");
    expect(buckets.get("CA")).toBe(3);
    expect(buckets.get("TX")).toBe(3);
    expect(buckets.get("NY")).toBe(3);
    expect(buckets.get("WY")).toBe(2);
  });

  it("returns an empty map for empty input", () => {
    const buckets = bucketMap(new Map(), "total");
    expect(buckets.size).toBe(0);
  });
});

describe("divergingColor — signed metrics (rate change / loss ratio)", () => {
  it("paints emerald below the baseline, orange above, neutral at it", () => {
    // emerald (shrank / better) — extreme brighter than near-center
    expect(divergingColor(-3)).toBe("#10b981"); // emerald-500
    expect(divergingColor(-2)).toBe("#10b981");
    expect(divergingColor(-1)).toBe("#065f46"); // emerald-800
    // neutral
    expect(divergingColor(0)).toBe("#3f3f46"); // zinc-700 / surface-3
    // orange (grew / worse)
    expect(divergingColor(1)).toBe("#9a3412"); // orange-800
    expect(divergingColor(2)).toBe("#f97316"); // orange-500
    expect(divergingColor(3)).toBe("#f97316");
  });

  it("mirrors the sanctioned viz-delta hues (emerald-500 down, orange-500 up)", () => {
    // these are --rater-viz-delta-down / --rater-viz-delta-up, value-for-value
    expect(divergingColor(-2)).toBe("#10b981");
    expect(divergingColor(2)).toBe("#f97316");
  });

  it("exposes both ramps low→high as 7-stop arrays for the legend gradient", () => {
    expect(SEQUENTIAL_RAMP).toHaveLength(7);
    expect(DIVERGING_RAMP).toHaveLength(7);
    // sequential is the navy→cyan ramp, low (navy) → high (cyan)
    expect(SEQUENTIAL_RAMP[0]).toBe("#172554"); // azure-950
    expect(SEQUENTIAL_RAMP[6]).toBe("#67e8f9"); // cyan-300
    // diverging runs emerald (low) → neutral (mid) → orange (high)
    expect(DIVERGING_RAMP[0]).toBe("#10b981");
    expect(DIVERGING_RAMP[3]).toBe("#3f3f46");
    expect(DIVERGING_RAMP[6]).toBe("#f97316");
  });
});
