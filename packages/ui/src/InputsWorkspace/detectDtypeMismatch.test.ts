import { describe, expect, it } from "vitest";
import { detectDtypeMismatch } from "./detectDtypeMismatch";

const rows = (vals: readonly unknown[]): Record<string, unknown>[] =>
  vals.map((v) => ({ col: v }));

describe("detectDtypeMismatch", () => {
  it("flags text in a number column (the Kansas case)", () => {
    const r = detectDtypeMismatch("number", "col", rows(["750", "Kansas"]));
    expect(r).toEqual({ bad: 1, total: 2, expectedLabel: "numbers" });
  });

  it("accepts currency/percent/comma formatting as numeric", () => {
    expect(
      detectDtypeMismatch("number", "col", rows(["$1,250,000", "12.5%", " 42 "])),
    ).toBeNull();
  });

  it("skips blanks — missing is not mistyped", () => {
    expect(
      detectDtypeMismatch("number", "col", rows(["", null, undefined, "9"])),
    ).toBeNull();
  });

  it("string dtype accepts anything", () => {
    expect(detectDtypeMismatch("string", "col", rows(["x", "7"]))).toBeNull();
  });

  it("boolean accepts the yes/no vocabulary, flags the rest", () => {
    expect(
      detectDtypeMismatch("boolean", "col", rows(["yes", "N", "TRUE", "0"])),
    ).toBeNull();
    expect(
      detectDtypeMismatch("boolean", "col", rows(["yes", "sprinklered"])),
    ).toEqual({ bad: 1, total: 2, expectedLabel: "yes/no values" });
  });

  it("date accepts ISO dates, rejects bare numbers and prose", () => {
    expect(
      detectDtypeMismatch("date", "col", rows(["2026-01-01", "Jan 5 2026"])),
    ).toBeNull();
    const r = detectDtypeMismatch("date", "col", rows(["2026-01-01", "750"]));
    expect(r).toEqual({ bad: 1, total: 2, expectedLabel: "dates" });
  });

  it("inspects only the sample cap", () => {
    const vals = ["1", "2", "3", "4", "5", "6", "7", "8", "Kansas"];
    expect(detectDtypeMismatch("number", "col", rows(vals), 8)).toBeNull();
    expect(detectDtypeMismatch("number", "col", rows(vals), 9)).toEqual({
      bad: 1,
      total: 9,
      expectedLabel: "numbers",
    });
  });

  it("undefined dtype yields null (no declared type, no judgment)", () => {
    expect(detectDtypeMismatch(undefined, "col", rows(["x"]))).toBeNull();
  });
});
