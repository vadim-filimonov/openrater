/**
 * Verifies that a synthetic multi-location book rolls up first and then applies
 * an authored policy tail. Per-location premiums use an echo plan so the test
 * isolates policy composition from the rating engine.
 */

import { describe, it, expect } from "vitest";
import { evaluatePolicyBook } from "./policy-book";
import { compilePlan } from "./runtime";
import { registerBuiltinKinds } from "./kinds";
import {
  makeIrpmAdjustmentResolver,
  MODEL_SOURCE_RETIRED_MESSAGE,
} from "./irpm-source";
import type { RollupField } from "./policy-rollup";
import type { PolicyAdjustment } from "./policy-adjustments";
import type { Plan } from "./plan-types";

registerBuiltinKinds();

// An echo plan: the per-location premium is an input the plan passes through to
// its `premium` output (so the roll-up sums the real per-location premiums). tiv
// + total_floor_area_sqft ride in as inputs (present in the rolled `values`).
const ECHO_PLAN: Plan = {
  id: "echo-premium",
  version: "1.0.0",
  name: "Echo premium",
  nodes: [
    { id: "in_prem", kind: "input.source", params: { fieldName: "premium", fieldType: "money", sourceType: "form" } },
    { id: "out_prem", kind: "output", params: { fieldName: "premium", fieldType: "money" } },
  ],
  edges: [{ from: { node: "in_prem", port: "value" }, to: { node: "out_prem", port: "value" } }],
};

const ROLLUP: readonly RollupField[] = [
  { field: "premium", reducer: "sum", as: "total_premium" },
  { field: "tiv", reducer: "sum" },
  { field: "total_floor_area_sqft", reducer: "sum" },
];

// The ordered tail reads schedule rating from a declared input column, then
// applies guarded package factors and a minimum premium.
const TAIL: readonly PolicyAdjustment[] = [
  {
    kind: "schedule_rating",
    id: "irpm",
    display_name: "Schedule rating (scored input)",
    cap_pct: 25,
    source: { from: "column", column: "irpm_total_pct" },
  },
  {
    kind: "package_factor",
    id: "first_term_credit",
    display_name: "Meridian first-term credit",
    factor: 0.9,
    when: { field: "is_first_term", op: "eq", value: true },
  },
  {
    kind: "package_factor",
    id: "new_business",
    display_name: "New-business charge",
    factor: 1.1,
    when: { field: "years_in_business", op: "lt", value: 3 },
  },
  { kind: "minimum_premium", id: "min", floor: 500 },
];

// A three-location synthetic book.
const BOOK = [
  { policy_id: "P-001", location_id: "L1", inputs: { premium: 1326, tiv: 850_000, total_floor_area_sqft: 18_000, years_in_business: 12, is_first_term: false, irpm_total_pct: -5 } },
  { policy_id: "P-001", location_id: "L2", inputs: { premium: 3759, tiv: 210_000, total_floor_area_sqft: 5_000, years_in_business: 12, is_first_term: false, irpm_total_pct: -5 } },
  { policy_id: "P-002", location_id: "L3", inputs: { premium: 1275, tiv: 260_000, total_floor_area_sqft: 6_000, years_in_business: 2, is_first_term: true, irpm_total_pct: 10 } },
];

describe("evaluatePolicyBook — opt-in policy tail", () => {
  const compiled = compilePlan(ECHO_PLAN);

  it("composes P-001 after a -5% schedule adjustment", () => {
    const results = evaluatePolicyBook(
      compiled,
      BOOK,
      {
        rollupFields: ROLLUP,
        policyTail: TAIL,
        policyInputKeys: ["years_in_business", "is_first_term", "irpm_total_pct"],
      },
      { resolveAdjustment: makeIrpmAdjustmentResolver() },
    );
    const p1 = results.find((r) => r.policy_id === "P-001")!;
    expect(p1.rollup.rolled.total_premium).toBe(5085);
    expect(p1.rollup.rolled.total_floor_area_sqft).toBe(23_000); // Σ sqft rolls up
    expect(p1.composed).toBeDefined();
    expect(p1.composed!.subtotal).toBe(5085);
    const irpm = p1.composed!.adjustments.find((a) => a.id === "irpm")!;
    expect(irpm.applied).toBe(true);
    expect(irpm.factor_or_delta).toBeCloseTo(0.95, 4);
    expect(irpm.provenance?.source).toBe("column");
    expect(p1.composed!.adjustments.find((a) => a.id === "first_term_credit")!.applied).toBe(false);
    expect(p1.composed!.adjustments.find((a) => a.id === "new_business")!.applied).toBe(false);
    expect(Math.round(p1.composed!.final)).toBe(4831);
  });

  it("composes P-002 through both guarded factors", () => {
    const results = evaluatePolicyBook(
      compiled,
      BOOK,
      {
        rollupFields: ROLLUP,
        policyTail: TAIL,
        policyInputKeys: ["years_in_business", "is_first_term", "irpm_total_pct"],
      },
      { resolveAdjustment: makeIrpmAdjustmentResolver() },
    );
    const p2 = results.find((r) => r.policy_id === "P-002")!;
    expect(p2.composed!.subtotal).toBe(1275);
    expect(p2.rollup.rolled.total_floor_area_sqft).toBe(6_000);
    const irpm = p2.composed!.adjustments.find((a) => a.id === "irpm")!;
    expect(irpm.factor_or_delta).toBeCloseTo(1.1, 4);
    expect(p2.composed!.adjustments.find((a) => a.id === "first_term_credit")!.applied).toBe(true);
    expect(p2.composed!.adjustments.find((a) => a.id === "new_business")!.applied).toBe(true);
    expect(Math.round(p2.composed!.final)).toBe(1388);
  });

  it("no tail configured ⇒ no `composed` (byte-stable; the conformance guarantee)", () => {
    const results = evaluatePolicyBook(compiled, BOOK, { rollupFields: ROLLUP });
    for (const r of results) {
      expect(r.composed).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(r, "composed")).toBe(false);
    }
  });

  it("a column IRPM source with no injected resolver throws (Validate-early, never a silent 1.0)", () => {
    expect(() =>
      evaluatePolicyBook(compiled, BOOK, {
        rollupFields: ROLLUP,
        policyTail: TAIL,
        policyInputKeys: ["years_in_business", "is_first_term", "irpm_total_pct"],
      }),
    ).toThrow(/resolveAdjustment/);
  });

  it("a legacy model-sourced tail refuses by name through the book path", () => {
    const legacyTail = [
      {
        kind: "schedule_rating",
        id: "irpm",
        display_name: "Schedule rating (GLM)",
        cap_pct: 25,
        source: { from: "model", model_id: "legacy-demo-irpm", version: "test" },
      },
    ] as unknown as readonly PolicyAdjustment[];
    expect(() =>
      evaluatePolicyBook(
        compiled,
        BOOK,
        {
          rollupFields: ROLLUP,
          policyTail: legacyTail,
          policyInputKeys: ["irpm_total_pct"],
        },
        { resolveAdjustment: makeIrpmAdjustmentResolver() },
      ),
    ).toThrow(MODEL_SOURCE_RETIRED_MESSAGE);
  });
});
