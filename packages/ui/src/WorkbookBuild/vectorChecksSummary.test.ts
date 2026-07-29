/**
 * FCA fca-2026-07-25 #19 — one verdict vocabulary for verification.
 * The audited plan (30 checks: 10 exact, 20 near, 0 mismatched) read
 * "10/30 filed checks reproduce" on Exhibits, "5 of 5 (20 within
 * rounding)" on Analytics, and "0 mismatched" in the report.
 */

import { describe, expect, it } from "vitest";

import { vectorChecksSummary } from "./vectorChecksSummary";

const checksOf = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("vectorChecksSummary", () => {
  it("the audited shape: 10 exact + 20 near reads as a PASS with the tolerance share disclosed", () => {
    const s = vectorChecksSummary({
      matched: 10,
      near: 20,
      mismatched: 0,
      checks: checksOf(30),
    });
    expect(s.reproduced).toBe(30);
    expect(s.fraction).toBe("30/30");
    expect(s.label).toBe(
      "30 of 30 checks reproduce the filing (20 within tolerance)",
    );
    expect(s.tone).toBe("warn");
  });

  it("a mismatch always leads", () => {
    const s = vectorChecksSummary({
      matched: 9,
      near: 0,
      mismatched: 3,
      checks: checksOf(12),
    });
    expect(s.fraction).toBe("9/12");
    expect(s.label).toBe(
      "9 of 12 checks reproduce the filing — 3 MISMATCHED",
    );
    expect(s.tone).toBe("error");
  });

  it("all exact is unqualified", () => {
    const s = vectorChecksSummary({
      matched: 40,
      near: 0,
      mismatched: 0,
      checks: checksOf(40),
    });
    expect(s.label).toBe("40 of 40 checks reproduce the filing exactly");
    expect(s.tone).toBe("success");
  });
});
