/**
 * heatBucket tests — Brief 34 PR 34.2.
 */

import { describe, expect, it } from "vitest";
import {
  heatBucket,
  formatHeatCell,
  HEAT_BASELINE,
  HEAT_LEGEND_ENTRIES,
} from "./heatBucket";

describe("heatBucket", () => {
  it("returns 0 for undefined values", () => {
    expect(heatBucket(undefined)).toBe(0);
  });

  it("returns 3 (baseline) for values within 5% of baseline", () => {
    expect(heatBucket(1.0)).toBe(3);
    expect(heatBucket(1.04)).toBe(3);
    expect(heatBucket(0.96)).toBe(3);
  });

  it("returns 4 for slight surcharge (5-15%)", () => {
    expect(heatBucket(1.05)).toBe(4);
    expect(heatBucket(1.10)).toBe(4);
    expect(heatBucket(1.14)).toBe(4);
  });

  it("returns 5 for moderate surcharge (15-30%)", () => {
    expect(heatBucket(1.20)).toBe(5);
    expect(heatBucket(1.29)).toBe(5);
  });

  it("returns 6 for deep surcharge (30-50%)", () => {
    expect(heatBucket(1.30)).toBe(6);
    expect(heatBucket(1.45)).toBe(6);
  });

  it("returns 7 for extreme surcharge (≥ 50%)", () => {
    expect(heatBucket(1.50)).toBe(7);
    expect(heatBucket(2.00)).toBe(7);
  });

  it("returns 2 for moderate discount (5-30%)", () => {
    expect(heatBucket(0.95)).toBe(2);
    expect(heatBucket(0.80)).toBe(2);
    expect(heatBucket(0.71)).toBe(2);
  });

  it("returns 1 for deep discount (≥ 30%)", () => {
    expect(heatBucket(0.70)).toBe(1);
    expect(heatBucket(0.50)).toBe(1);
  });

  it("honors a custom baseline", () => {
    // Baseline 2.0; value 2.4 = 20% surcharge → bucket 5
    expect(heatBucket(2.4, 2.0)).toBe(5);
  });
});

describe("formatHeatCell", () => {
  it("returns the placeholder for undefined", () => {
    expect(formatHeatCell(undefined)).toBe("·");
  });
  it("formats integers without trailing decimals", () => {
    expect(formatHeatCell(1)).toBe("1");
    expect(formatHeatCell(0)).toBe("0");
  });
  it("trims trailing zeros from decimals", () => {
    expect(formatHeatCell(1.25)).toBe("1.25");
    expect(formatHeatCell(0.875)).toBe("0.875");
  });
});

describe("HEAT_LEGEND_ENTRIES", () => {
  it("exports 7 entries in bucket order", () => {
    expect(HEAT_LEGEND_ENTRIES.length).toBe(7);
    expect(HEAT_LEGEND_ENTRIES.map((e) => e.bucket)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});

describe("HEAT_BASELINE", () => {
  it("is 1 (multiplicative identity)", () => {
    expect(HEAT_BASELINE).toBe(1);
  });
});
