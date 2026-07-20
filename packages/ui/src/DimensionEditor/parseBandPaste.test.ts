/**
 * Tests for parseBandPaste — cold-test L12.
 *
 * Covers the grammar the banded DimensionEditor's "Paste bands" drawer
 * commits to: `lo,hi[,label]` rows, auto-derived labels, open-ended
 * edges, `$`/k/m number tolerance, inverted-band + duplicate skipping,
 * CSV header detection, and the irregular revenue edge set the feature
 * exists to enable.
 */

import { describe, expect, it } from "vitest";
import { parseBandPaste } from "./parseBandPaste";

describe("parseBandPaste", () => {
  it("returns empty result for empty input", () => {
    const result = parseBandPaste("");
    expect(result.added).toEqual([]);
    expect(result.hadHeader).toBe(false);
  });

  it("parses `lo,hi` rows and auto-derives the label", () => {
    const result = parseBandPaste("0,25000\n25000,50000");
    expect(result.added).toEqual([
      { id: "band_0_25000", label: "0 – 25000", lo: 0, hi: 25000 },
      {
        id: "band_25000_50000",
        label: "25000 – 50000",
        lo: 25000,
        hi: 50000,
      },
    ]);
  });

  it("keeps an explicit label after the third comma (label may contain commas)", () => {
    const result = parseBandPaste("25000,50000,Mid, mid-large");
    expect(result.added).toEqual([
      {
        id: "band_25000_50000",
        label: "Mid, mid-large",
        lo: 25000,
        hi: 50000,
      },
    ]);
  });

  it("treats a blank lo edge as -Infinity (open low band)", () => {
    const result = parseBandPaste(",25000");
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      lo: Number.NEGATIVE_INFINITY,
      hi: 25000,
    });
    // Default label for an open-low band.
    expect(result.added[0]?.label).toContain("<");
  });

  it("treats a blank hi edge as +Infinity (open high band)", () => {
    const result = parseBandPaste("1000000,");
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      lo: 1000000,
      hi: Number.POSITIVE_INFINITY,
    });
    expect(result.added[0]?.label).toContain("≥");
  });

  it("tolerates $ prefixes and k / m magnitude suffixes", () => {
    const result = parseBandPaste("$25k, $50k\n0.5m,1.5m");
    expect(result.added).toEqual([
      { id: "band_25000_50000", label: "25000 – 50000", lo: 25000, hi: 50000 },
      {
        id: "band_500000_1500000",
        label: "500000 – 1500000",
        lo: 500000,
        hi: 1500000,
      },
    ]);
  });

  it("skips inverted / empty bands (lo >= hi)", () => {
    const result = parseBandPaste("50000,25000\n100,100");
    expect(result.added).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "inverted",
      "inverted",
    ]);
  });

  it("skips unparseable rows (no comma, or non-numeric edges)", () => {
    const result = parseBandPaste("not a band\n25000,abc");
    expect(result.added).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "unparseable",
      "unparseable",
    ]);
  });

  it("dedupes against existing ids + within the same paste", () => {
    const result = parseBandPaste("0,25000\n0,25000", {
      existingIds: ["band_25000_50000"],
    });
    // First 0–25000 added; second is an in-paste duplicate.
    expect(result.added).toHaveLength(1);
    const dupResult = parseBandPaste("25000,50000", {
      existingIds: ["band_25000_50000"],
    });
    expect(dupResult.added).toEqual([]);
    expect(dupResult.skipped[0]?.reason).toBe("duplicate");
  });

  it("detects + skips a lo,hi[,label] header row", () => {
    const result = parseBandPaste("lo,hi,label\n0,25000");
    expect(result.hadHeader).toBe(true);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.lo).toBe(0);
  });

  it("skips blank lines", () => {
    const result = parseBandPaste("0,25000\n\n25000,50000\n");
    expect(result.added).toHaveLength(2);
  });

  it("builds the irregular revenue edge set Generate can't (cold-test L12)", () => {
    // 25k / 50k / 100k / 250k / 500k / 1M / 5M — non-uniform widths,
    // not log-uniform either, so neither Generate method produces it.
    const result = parseBandPaste(
      [
        "0,25000",
        "25000,50000",
        "50000,100000",
        "100000,250000",
        "250000,500000",
        "500000,1000000",
        "1000000,5000000",
      ].join("\n"),
    );
    expect(result.added).toHaveLength(7);
    expect(result.added.map((b) => b.hi)).toEqual([
      25000, 50000, 100000, 250000, 500000, 1000000, 5000000,
    ]);
    // The bands are contiguous: each lo equals the previous hi.
    for (let i = 1; i < result.added.length; i += 1) {
      expect(result.added[i]?.lo).toBe(result.added[i - 1]?.hi);
    }
  });
});
