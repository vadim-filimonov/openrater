// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
import { describe, it, expect, beforeAll } from "vitest";
import type { StageSummary } from "@openrater/api-client";
import {
  _clearRegistryForTests,
  registerBuiltinKinds,
  type PolicyAdjustment,
} from "@openrater/contracts";
import { runBookRerate, type RerateSnapshotBody } from "./runBookRerate";
import type { RerateBookSubmission } from "@openrater/ui";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

const ONE: RerateBookSubmission[] = [
  { submission_id: "S1", locations: [{ location_key: "A", inputs: { x: 1 } }] },
];

// These exercise the guard paths — empty book + a snapshot with no rating
// chain (no stages → `snapshotBodyToRuntimePlan` returns null). The happy
// path runs the real engine and is browser-verified in 73.3.
describe("runBookRerate guards", () => {
  it("blocks an empty book with a plain reason", () => {
    const r = runBookRerate({ book: [], baselineBody: {}, candidateBody: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no bound submissions/i);
  });

  it("blocks when the baseline snapshot has no runnable rating chain", () => {
    const r = runBookRerate({ book: ONE, baselineBody: {}, candidateBody: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/baseline.*no runnable rating chain/i);
  });

  it("blocks when the CANDIDATE snapshot has no runnable rating chain (CT-6)", () => {
    // A baseline with stages would project; give it a trivially-empty
    // candidate so the candidate-side guard fires (the baseline guard is
    // covered above — here both are empty, baseline fires first, so assert
    // the message is a no-chain block either way).
    const r = runBookRerate({ book: ONE, baselineBody: {}, candidateBody: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no runnable rating chain/i);
  });
});

// ── Total-less multi-coverage plans (93.4 follow-through) ───────────
// A filing with ≥2 coverage towers and NO total row is a legal
// transcription; its policy premium is the dec-page SUM. These run the
// REAL engine over frozen snapshot bodies, mirroring the scoring
// service's total-less fixtures (base_value literals → self-contained
// towers, empty location inputs).

function stage(
  stage_id: string,
  stage_kind: string,
  sequence: number,
  config_json: Record<string, unknown>,
): StageSummary {
  return {
    stage_id,
    sequence,
    stage_kind,
    display_name: stage_id,
    config_json,
    citation_rule: null,
    citation_page: null,
    source_filing_id: null,
  };
}

/** Two coverage towers, NO round stage and no total output — the legal
 *  total-less transcription (`output_total_field` is chain metadata the
 *  projector never emits as an output). */
function twoTowerChain(building: number, contents: number): StageSummary {
  return stage("chain_1", "multiplicative_chain", 1, {
    chains: [
      {
        name: "building",
        base_input: "ignored",
        base_value: building,
        factor_lookups: [],
        lcm: { value: 1.0 },
        output_field: "building_premium",
      },
      {
        name: "contents",
        base_input: "ignored",
        base_value: contents,
        factor_lookups: [],
        lcm: { value: 1.0 },
        output_field: "contents_premium",
      },
    ],
    output_total_field: "all_coverages_subtotal",
  });
}

function totalLessBody(building: number, contents: number): RerateSnapshotBody {
  return { stages: [twoTowerChain(building, contents)] };
}

/** The same two towers PLUS a plan-total round stage — the plan now
 *  DECLARES its premium (`grand_total`), so its side of the dislocation
 *  must read that field, not the coverage sum. */
function totalFulBody(building: number, contents: number): RerateSnapshotBody {
  return {
    stages: [
      twoTowerChain(building, contents),
      stage("round_1", "round", 2, {
        output_field: "grand_total",
        min_value_input: "literal:0",
        increment_input: "1",
      }),
    ],
  };
}

/** S1 has two locations, S2 one — so the roll-up itself is exercised. */
const BOOK: RerateBookSubmission[] = [
  {
    submission_id: "S1",
    locations: [
      { location_key: "A", inputs: {} },
      { location_key: "B", inputs: {} },
    ],
  },
  { submission_id: "S2", locations: [{ location_key: "A", inputs: {} }] },
];

const FLAT_TAIL: readonly PolicyAdjustment[] = [
  {
    kind: "endorsement",
    id: "e_flat",
    display_name: "Flat charge",
    effect: { kind: "flat", amount: 25 },
  },
];

describe("runBookRerate · total-less multi-coverage plans", () => {
  it("diffs the dec-page SUM, not one tower (and not nothing)", () => {
    // Baseline $100 + $200 = $300/location; candidate $150 + $250 =
    // $400/location. The SUM moves +33.33% — a number NEITHER tower
    // shows (+50% / +25%), so a read that follows one tower cannot
    // pass; a read that rolls nothing leaves total = 0.
    const r = runBookRerate({
      book: BOOK,
      baselineBody: totalLessBody(100, 200),
      candidateBody: totalLessBody(150, 250),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dislocation.matched).toBe(2);
    const { summary } = r.dislocation.dislocation;
    expect(summary.total).toBe(2);
    expect(summary.naCount).toBe(0);
    expect(summary.weightedAvg).toBeCloseTo(400 / 300 - 1, 9);
    // Per-policy Δ is the sum's +33.33% — inside ±50%, outside ±25%.
    expect(summary.maxUp).toBeCloseTo(400 / 300 - 1, 9);
    expect(summary.maxDown).toBeCloseTo(400 / 300 - 1, 9);
  });

  it("a policy tail over a total-less plan is the NAMED Law-2 refusal", () => {
    // A tail does money math over ONE rolled-up field; a total-less plan
    // declares none. Silently taxing the last tower is the exact wrong
    // number the refusal kills (mirrors /score-policy + grouped books).
    const r = runBookRerate({
      book: BOOK,
      baselineBody: totalLessBody(100, 200),
      candidateBody: totalLessBody(150, 250),
      policyTail: FLAT_TAIL,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/declares no total output/);
    expect(r.reason).toMatch(/baseline/i);
  });

  it("mixed sides — each side diffs on ITS OWN premium basis", () => {
    // A rate change that ADDS the plan total: baseline is total-less
    // ($300/location, coverage sum), the candidate declares
    // `grand_total` ($120 + $240 = $360/location) → +20% book-wide.
    const r = runBookRerate({
      book: BOOK,
      baselineBody: totalLessBody(100, 200),
      candidateBody: totalFulBody(120, 240),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { summary } = r.dislocation.dislocation;
    expect(summary.total).toBe(2);
    expect(summary.weightedAvg).toBeCloseTo(0.2, 9);
  });
});
