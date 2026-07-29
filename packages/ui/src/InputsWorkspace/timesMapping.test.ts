/**
 * timesMapping tests (FCA #23, finding 13) — the `@times:` scaled-
 * column sentinel: payroll-in-thousands finally has a mapping-layer
 * home.
 */

import { describe, expect, it } from "vitest";

import {
  TIMES_PREFIX,
  computeTimesForRow,
  formatTimes,
  isTimesMapping,
  parseTimes,
} from "./timesMapping";

describe("isTimesMapping / parseTimes / formatTimes", () => {
  it("round-trips the audited shape: payroll × 1000", () => {
    const sentinel = formatTimes("payroll", 1000);
    expect(sentinel).toBe("@times:payroll*1000");
    expect(isTimesMapping(sentinel)).toBe(true);
    expect(parseTimes(sentinel)).toEqual({ column: "payroll", multiplier: 1000 });
  });

  it("plain columns and ratio sentinels are not times mappings", () => {
    expect(isTimesMapping("payroll")).toBe(false);
    expect(isTimesMapping("@ratio:a/b")).toBe(false);
    expect(parseTimes("payroll")).toBeNull();
  });

  it("rejects malformed payloads: no column, no star, zero/non-finite multiplier", () => {
    expect(parseTimes(`${TIMES_PREFIX}*1000`)).toBeNull();
    expect(parseTimes(`${TIMES_PREFIX}payroll`)).toBeNull();
    expect(parseTimes(`${TIMES_PREFIX}payroll*0`)).toBeNull();
    expect(parseTimes(`${TIMES_PREFIX}payroll*abc`)).toBeNull();
    expect(parseTimes(`${TIMES_PREFIX}payroll*`)).toBeNull();
  });

  it("accepts fractional multipliers (cents → dollars is ×0.01)", () => {
    expect(parseTimes("@times:premium_cents*0.01")).toEqual({
      column: "premium_cents",
      multiplier: 0.01,
    });
  });
});

describe("computeTimesForRow", () => {
  const times = { column: "payroll", multiplier: 1000 };

  it("multiplies the raw cell, stripping thousands commas", () => {
    expect(computeTimesForRow({ payroll: "240" }, times)).toBe(240_000);
    expect(computeTimesForRow({ payroll: "1,247" }, times)).toBe(1_247_000);
  });

  it("missing / empty / non-numeric cells are null — treated like empty cells", () => {
    expect(computeTimesForRow({}, times)).toBeNull();
    expect(computeTimesForRow({ payroll: "" }, times)).toBeNull();
    expect(computeTimesForRow({ payroll: "n/a" }, times)).toBeNull();
  });
});
