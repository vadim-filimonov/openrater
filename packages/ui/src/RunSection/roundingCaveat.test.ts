/**
 * FCA fca-2026-07-25 #14 (display half) — the Run panel must explain
 * itself when its rounded coverage rows don't sum to the once-rounded
 * total it displays.
 */

import { describe, expect, it } from "vitest";

import { roundingReconciliationCaveat } from "./roundingCaveat";

describe("roundingReconciliationCaveat", () => {
  it("the audited WE-2 shape: rows sum $439 under a $440 headline → caveat", () => {
    const caveat = roundingReconciliationCaveat({
      outputs: {
        bi_premium: 108.63,
        pd_premium: 91.4,
        comp_premium: 97.42,
        coll_premium: 141.71,
        total_premium: 439.16, // engine total, rounds to 439... headline 440
      },
      premium: 439.16,
      composed: false,
    });
    // parts round to 109+91+97+142 = 439; headline rounds to 439 → no
    // caveat in THIS arithmetic — use the real audited split instead:
    expect(caveat).toBeNull();

    const audited = roundingReconciliationCaveat({
      outputs: {
        bi_premium: 109.4,
        pd_premium: 91.2,
        comp_premium: 97.3,
        coll_premium: 142.28,
        total_premium: 440.18,
      },
      premium: 440.18,
      composed: false,
    });
    // 109 + 91 + 97 + 142 = 439 ≠ 440 → the panel says why.
    expect(audited).not.toBeNull();
    expect(audited).toContain("$439");
    expect(audited).toContain("rounds ONCE");
  });

  it("rows that visibly sum need no caveat", () => {
    expect(
      roundingReconciliationCaveat({
        outputs: { a: 100, b: 200, total_premium: 300 },
        premium: 300,
        composed: false,
      }),
    ).toBeNull();
  });

  it("composed rows are exempt (the build-up explains the delta)", () => {
    expect(
      roundingReconciliationCaveat({
        outputs: { a: 60.4, b: 53.8, total_premium: 114.2 },
        premium: 250,
        composed: true,
      }),
    ).toBeNull();
  });

  it("single-tower plans (no separate parts) say nothing", () => {
    expect(
      roundingReconciliationCaveat({
        outputs: { total_premium: 440 },
        premium: 440,
        composed: false,
      }),
    ).toBeNull();
    // No total row among outputs → nothing to reconcile against.
    expect(
      roundingReconciliationCaveat({
        outputs: { a: 109.4, b: 91.2 },
        premium: 200.6,
        composed: false,
      }),
    ).toBeNull();
  });
});
