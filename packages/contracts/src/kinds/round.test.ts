import { describe, it, expect } from "vitest";
import { RoundKind, roundToDecimals } from "./round";

describe("RoundKind", () => {
  it("declares one value input + one value output", () => {
    expect(RoundKind.inputs).toHaveLength(1);
    expect(RoundKind.inputs[0]?.name).toBe("value");
    expect(RoundKind.outputs).toHaveLength(1);
    expect(RoundKind.outputs[0]?.name).toBe("value");
  });

  it("rounds to 3 decimals (the ISO rate rounding)", () => {
    // The reference build: round(0.615890…, 3) = 0.616 before ×exposure×LCM.
    expect(RoundKind.execute({ value: 0.6158901 }, { decimals: 3 }).value).toBe(
      0.616,
    );
    expect(RoundKind.execute({ value: 0.6155 }, { decimals: 3 }).value).toBe(
      0.616,
    );
  });

  it("rounds to 0 decimals (the nearest-dollar premium rounding)", () => {
    expect(RoundKind.execute({ value: 1726.032 }, { decimals: 0 }).value).toBe(
      1726,
    );
    expect(RoundKind.execute({ value: 1725.5 }, { decimals: 0 }).value).toBe(
      1726,
    );
  });

  it("is half-up toward +∞ on ties (matches JS Math.round)", () => {
    expect(roundToDecimals(0.5, 0)).toBe(1);
    expect(roundToDecimals(2.5, 0)).toBe(3);
    // Math.round(-0.5) === -0 (toward +∞); normalize the sign for the assert.
    expect(roundToDecimals(-0.5, 0) + 0).toBe(0);
    expect(roundToDecimals(-1.5, 0)).toBe(-1);
  });

  it("passes non-finite values through unchanged", () => {
    expect(roundToDecimals(Number.NaN, 2)).toBeNaN();
    expect(roundToDecimals(Number.POSITIVE_INFINITY, 2)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("supports negative decimals (round to nearest 10/100)", () => {
    expect(roundToDecimals(1726, -1)).toBe(1730);
    expect(roundToDecimals(1726, -2)).toBe(1700);
  });

  it("is reproducible — same value + params → identical output", () => {
    const a = RoundKind.execute({ value: 0.615890 }, { decimals: 3 });
    const b = RoundKind.execute({ value: 0.615890 }, { decimals: 3 });
    expect(a.value).toBe(b.value);
  });

  it("validate rejects non-integer decimals", () => {
    const r = RoundKind.validate!({ decimals: 1.5 });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.field).toBe("decimals");
  });

  it("validate rejects non-finite decimals", () => {
    expect(RoundKind.validate!({ decimals: Number.NaN }).valid).toBe(false);
  });

  it("validate accepts integer decimals (incl. 0 and negative)", () => {
    expect(RoundKind.validate!({ decimals: 0 }).valid).toBe(true);
    expect(RoundKind.validate!({ decimals: 3 }).valid).toBe(true);
    expect(RoundKind.validate!({ decimals: -1 }).valid).toBe(true);
  });

  it("explainStep reads as an actuary-facing trace fragment", () => {
    const msg = RoundKind.explainStep!(
      { value: 0.6159 },
      { decimals: 3 },
      { value: 0.616 },
    );
    expect(msg).toContain("0.616");
    expect(msg).toContain("3 dp");
  });
});
