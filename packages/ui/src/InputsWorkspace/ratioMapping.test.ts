/**
 * ratioMapping tests — Brief 45 K8 derived-ratio sentinel.
 *
 * Covers the four pure helpers:
 *   - isRatioMapping (prefix detection)
 *   - parseRatio (well-formed + malformed payloads)
 *   - formatRatio (round-trips with parseRatio)
 *   - computeRatioForRow (happy path + every guard: missing component,
 *     non-numeric, zero denominator, comma-stripping)
 */

import { describe, it, expect } from "vitest";

import {
  RATIO_PREFIX,
  isRatioMapping,
  parseRatio,
  formatRatio,
  computeRatioForRow,
} from "./ratioMapping";

describe("isRatioMapping", () => {
  it("recognizes the @ratio: prefix", () => {
    expect(isRatioMapping("@ratio:total_expenses/revenue")).toBe(true);
    expect(isRatioMapping(RATIO_PREFIX)).toBe(true);
  });

  it("rejects plain column names + empty + nullish", () => {
    expect(isRatioMapping("revenue")).toBe(false);
    expect(isRatioMapping("")).toBe(false);
    expect(isRatioMapping(undefined)).toBe(false);
    expect(isRatioMapping(null)).toBe(false);
  });
});

describe("parseRatio", () => {
  it("parses a well-formed sentinel", () => {
    expect(parseRatio("@ratio:total_expenses/revenue")).toEqual({
      numerator: "total_expenses",
      denominator: "revenue",
    });
  });

  it("trims surrounding whitespace in each term", () => {
    expect(parseRatio("@ratio: occupancy_expense / revenue ")).toEqual({
      numerator: "occupancy_expense",
      denominator: "revenue",
    });
  });

  it("returns null for non-ratio values", () => {
    expect(parseRatio("revenue")).toBeNull();
    expect(parseRatio("")).toBeNull();
    expect(parseRatio(undefined)).toBeNull();
  });

  it("returns null when a term is missing", () => {
    expect(parseRatio("@ratio:/revenue")).toBeNull(); // no numerator
    expect(parseRatio("@ratio:revenue/")).toBeNull(); // no denominator
    expect(parseRatio("@ratio:revenue")).toBeNull(); // no slash
    expect(parseRatio("@ratio:")).toBeNull(); // empty payload
  });

  it("returns null for ambiguous extra slashes", () => {
    expect(parseRatio("@ratio:a/b/c")).toBeNull();
  });
});

describe("formatRatio", () => {
  it("builds a sentinel that round-trips through parseRatio", () => {
    const s = formatRatio("total_expenses", "revenue");
    expect(s).toBe("@ratio:total_expenses/revenue");
    expect(parseRatio(s)).toEqual({
      numerator: "total_expenses",
      denominator: "revenue",
    });
  });
});

describe("computeRatioForRow", () => {
  const ratio = { numerator: "total_expenses", denominator: "revenue" };

  it("computes num / den on the happy path", () => {
    const v = computeRatioForRow(
      { total_expenses: "750000", revenue: "1000000" },
      ratio,
    );
    expect(v).toBeCloseTo(0.75, 10);
  });

  it("strips thousands commas before dividing", () => {
    const v = computeRatioForRow(
      { total_expenses: "1,500,000", revenue: "1,000,000" },
      ratio,
    );
    expect(v).toBeCloseTo(1.5, 10);
  });

  it("returns null when the numerator column is missing", () => {
    expect(computeRatioForRow({ revenue: "1000" }, ratio)).toBeNull();
  });

  it("returns null when the denominator column is missing", () => {
    expect(computeRatioForRow({ total_expenses: "1000" }, ratio)).toBeNull();
  });

  it("returns null for a zero denominator (no division by zero)", () => {
    expect(
      computeRatioForRow({ total_expenses: "1000", revenue: "0" }, ratio),
    ).toBeNull();
  });

  it("returns null for non-numeric components", () => {
    expect(
      computeRatioForRow({ total_expenses: "abc", revenue: "1000" }, ratio),
    ).toBeNull();
    expect(
      computeRatioForRow({ total_expenses: "1000", revenue: "n/a" }, ratio),
    ).toBeNull();
  });

  it("returns null for empty-string components", () => {
    expect(
      computeRatioForRow({ total_expenses: "", revenue: "1000" }, ratio),
    ).toBeNull();
  });
});
