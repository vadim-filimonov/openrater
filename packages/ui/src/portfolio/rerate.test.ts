// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
import { describe, it, expect } from "vitest";
import type { PolicyBookResult } from "@openrater/contracts";
import {
  portfolioBookToPolicyRows,
  policyFinalPremium,
  policyBookDislocation,
  type RerateBookSubmission,
} from "./rerate";

/** A minimal PolicyBookResult fixture — only the fields the re-rate math
 *  reads (policy_id, rollup.rolled, composed). The appetite decision is
 *  unread here, so a structural stub suffices. */
function mkResult(
  policy_id: string,
  opts: { rolled?: Record<string, number>; final?: number } = {},
): PolicyBookResult {
  return {
    policy_id,
    rollup: {
      policy_id,
      location_count: 1,
      location_ids: ["L1"],
      rolled: opts.rolled ?? { total_premium: 0 },
      breakdown: {},
    },
    appetite: { tier: "standard", scope: "policy", reasoning: "", trace: [] },
    ...(opts.final !== undefined
      ? { composed: { final: opts.final, subtotal: opts.final, adjustments: [] } }
      : {}),
  } as unknown as PolicyBookResult;
}

describe("portfolioBookToPolicyRows (73.0)", () => {
  it("flattens submissions → one keyed row per location", () => {
    const book: RerateBookSubmission[] = [
      {
        submission_id: "S1",
        locations: [
          { location_key: "A", inputs: { building_limit: 100 } },
          { location_key: "B", inputs: { building_limit: 200 } },
        ],
      },
      { submission_id: "S2", locations: [{ location_key: "A", inputs: { building_limit: 50 } }] },
    ];
    const rows = portfolioBookToPolicyRows(book);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      policy_id: "S1",
      location_id: "A",
      inputs: { building_limit: 100 },
    });
    expect(rows[2]!.policy_id).toBe("S2");
    // inputs are copied, not aliased.
    rows[0]!.inputs.building_limit = 999;
    expect(book[0]!.locations[0]!.inputs.building_limit).toBe(100);
  });
});

describe("policyFinalPremium (73.1)", () => {
  it("prefers the IRPM-composed final when a tail ran", () => {
    expect(policyFinalPremium(mkResult("S1", { rolled: { total_premium: 1000 }, final: 1200 }))).toBe(1200);
  });
  it("falls back to total_premium, then premium, then null", () => {
    expect(policyFinalPremium(mkResult("S1", { rolled: { total_premium: 800 } }))).toBe(800);
    expect(policyFinalPremium(mkResult("S1", { rolled: { premium: 600 } }))).toBe(600);
    expect(policyFinalPremium(mkResult("S1", { rolled: {} }))).toBeNull();
  });
  it("honors an explicit premium field", () => {
    expect(
      policyFinalPremium(mkResult("S1", { rolled: { subtotal_after_chain_usd: 700 } }), "subtotal_after_chain_usd"),
    ).toBe(700);
  });
});

describe("policyBookDislocation (73.1)", () => {
  it("matches by policy_id and diffs final premiums", () => {
    const baseline = [
      mkResult("S1", { rolled: { total_premium: 1000 } }),
      mkResult("S2", { rolled: { total_premium: 500 } }),
    ];
    const candidate = [
      mkResult("S1", { rolled: { total_premium: 1100 } }), // +10%
      mkResult("S2", { rolled: { total_premium: 450 } }), //  -10%
    ];
    const { dislocation, matched, candidateOnly, baselineOnly } = policyBookDislocation(
      baseline,
      candidate,
    );
    expect(matched).toBe(2);
    expect(candidateOnly).toBe(0);
    expect(baselineOnly).toBe(0);
    expect(dislocation.summary.pctUp).toBeCloseTo(0.5, 6); // 1 of 2 up
    expect(dislocation.summary.pctDown).toBeCloseTo(0.5, 6);
  });

  it("CT-4 — weighted avg = Σnew/Σold − 1, to the cent", () => {
    // S1: 1000→1100, S2: 500→450. Σold=1500, Σnew=1550 → +3.333%.
    const { dislocation } = policyBookDislocation(
      [mkResult("S1", { rolled: { total_premium: 1000 } }), mkResult("S2", { rolled: { total_premium: 500 } })],
      [mkResult("S1", { rolled: { total_premium: 1100 } }), mkResult("S2", { rolled: { total_premium: 450 } })],
    );
    expect(dislocation.summary.weightedAvg).toBeCloseTo(1550 / 1500 - 1, 9);
  });

  it("CT-2 — candidate-only policy is counted, not diffed", () => {
    const { matched, candidateOnly, baselineOnly } = policyBookDislocation(
      [mkResult("S1", { rolled: { total_premium: 1000 } })],
      [mkResult("S1", { rolled: { total_premium: 1000 } }), mkResult("S2-new", { rolled: { total_premium: 300 } })],
    );
    expect(matched).toBe(1);
    expect(candidateOnly).toBe(1);
    expect(baselineOnly).toBe(0);
  });

  it("counts baseline-only (dropped) policies", () => {
    const { baselineOnly, candidateOnly } = policyBookDislocation(
      [mkResult("S1", { rolled: { total_premium: 1000 } }), mkResult("S2", { rolled: { total_premium: 500 } })],
      [mkResult("S1", { rolled: { total_premium: 1000 } })],
    );
    expect(baselineOnly).toBe(1);
    expect(candidateOnly).toBe(0);
  });

  it("a zero-baseline policy lands in the n/a bucket (never divided)", () => {
    const { dislocation } = policyBookDislocation(
      [mkResult("S1", { rolled: { total_premium: 0 } })],
      [mkResult("S1", { rolled: { total_premium: 400 } })],
    );
    expect(dislocation.summary.naCount).toBe(1);
  });

  it("CT-5 — deterministic: same inputs → identical dislocation", () => {
    const base = [mkResult("S1", { rolled: { total_premium: 1000 } })];
    const cand = [mkResult("S1", { rolled: { total_premium: 1234 } })];
    expect(policyBookDislocation(base, cand)).toEqual(policyBookDislocation(base, cand));
  });

  it("93.4 — per-side premium fields diff each side on ITS OWN basis", () => {
    // Baseline is a total-less book (premium = the materialized
    // coverage_sum_premium); the candidate DECLARES a total. One shared
    // field name could not read both sides.
    const { dislocation } = policyBookDislocation(
      [mkResult("S1", { rolled: { coverage_sum_premium: 300 } })],
      [mkResult("S1", { rolled: { grand_total: 360 } })],
      {
        baselinePremiumField: "coverage_sum_premium",
        candidatePremiumField: "grand_total",
      },
    );
    expect(dislocation.summary.total).toBe(1);
    expect(dislocation.summary.weightedAvg).toBeCloseTo(0.2, 9);
  });

  it("93.4 — a per-side field falls back to the shared premiumField", () => {
    const { dislocation } = policyBookDislocation(
      [mkResult("S1", { rolled: { bespoke: 100 } })],
      [mkResult("S1", { rolled: { bespoke: 110 } })],
      { premiumField: "bespoke", candidatePremiumField: "bespoke" },
    );
    expect(dislocation.summary.weightedAvg).toBeCloseTo(0.1, 9);
  });
});
