/**
 * Brief 44 PR 44.5 — geoBuckets unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  GEO_BUCKET_COLORS,
  GEO_BUCKET_COUNT,
  GEO_BUCKET_NEUTRAL,
  computeGeoTints,
} from "./geoBuckets";

describe("computeGeoTints", () => {
  it("returns the neutral color for every level when the cell map is empty", () => {
    const r = computeGeoTints(["WI", "MN"], new Map());
    expect(r.tints.size).toBe(2);
    expect(r.tints.get("WI")).toBe(GEO_BUCKET_NEUTRAL);
    expect(r.tints.get("MN")).toBe(GEO_BUCKET_NEUTRAL);
    expect(r.domain).toBeNull();
    expect(r.bucketLegend).toEqual([]);
  });

  it("equal-interval splits the [min, max] range into 5 buckets", () => {
    // Values 0..1 → 5 buckets of 0.2 each.
    const values = new Map<string, number>([
      ["a", 0.0],
      ["b", 0.25],
      ["c", 0.5],
      ["d", 0.75],
      ["e", 1.0],
    ]);
    const r = computeGeoTints(["a", "b", "c", "d", "e"], values);
    expect(r.domain).toEqual({ min: 0, max: 1 });
    // a is the bucket-0 (lowest), e is bucket-4 (highest).
    expect(r.tints.get("a")).toBe(GEO_BUCKET_COLORS[0]);
    expect(r.tints.get("e")).toBe(GEO_BUCKET_COLORS[GEO_BUCKET_COUNT - 1]);
    // c (0.5) sits in the middle bucket.
    expect(r.tints.get("c")).toBe(GEO_BUCKET_COLORS[2]);
  });

  it("levels missing from the value map get the neutral tint", () => {
    const values = new Map<string, number>([
      ["WI", 1.0],
      ["MN", 1.2],
    ]);
    const r = computeGeoTints(["WI", "MN", "IL"], values);
    expect(r.tints.get("IL")).toBe(GEO_BUCKET_NEUTRAL);
  });

  it("ignores NaN / Infinity in the domain calc but still tints them neutral", () => {
    const values = new Map<string, number>([
      ["a", 1.0],
      ["b", 1.2],
      ["c", Number.NaN],
      ["d", Number.POSITIVE_INFINITY],
    ]);
    const r = computeGeoTints(["a", "b", "c", "d"], values);
    expect(r.domain).toEqual({ min: 1.0, max: 1.2 });
    expect(r.tints.get("c")).toBe(GEO_BUCKET_NEUTRAL);
    expect(r.tints.get("d")).toBe(GEO_BUCKET_NEUTRAL);
  });

  it("degenerate domain (all values equal) tints everyone the middle color", () => {
    const values = new Map<string, number>([
      ["a", 1.0],
      ["b", 1.0],
      ["c", 1.0],
    ]);
    const r = computeGeoTints(["a", "b", "c"], values);
    const mid = GEO_BUCKET_COLORS[Math.floor(GEO_BUCKET_COUNT / 2)];
    expect(r.tints.get("a")).toBe(mid);
    expect(r.tints.get("b")).toBe(mid);
    expect(r.tints.get("c")).toBe(mid);
    expect(r.bucketLegend).toHaveLength(1);
  });

  it("returns a 5-entry legend with lo/hi covering the full domain", () => {
    const values = new Map<string, number>([
      ["a", 0],
      ["b", 100],
    ]);
    const r = computeGeoTints(["a", "b"], values);
    expect(r.bucketLegend).toHaveLength(GEO_BUCKET_COUNT);
    expect(r.bucketLegend[0]!.rangeLo).toBe(0);
    expect(r.bucketLegend[GEO_BUCKET_COUNT - 1]!.rangeHi).toBe(100);
  });
});
