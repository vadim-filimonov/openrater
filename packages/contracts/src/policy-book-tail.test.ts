/**
 * evaluatePolicyBook — the OPT-IN policy tail composed on the rolled subtotal.
 *
 * Proves the path: roll the per-location premiums to the policy subtotal,
 * then compose the authored tail (an IRPM read from a TYPED INPUT column →
 * loadings → minimum premium) on that subtotal — landing the locked
 * Sample BOP oracle (P-001 $4,731 / P-002 $1,388) through the SHIPPED
 * primitives (`evaluatePolicyTail` + `makeIrpmAdjustmentResolver`), with NO
 * parallel tail math. Also pins the conformance guarantee: a book with no
 * `policyTail` yields no `composed` (byte-stable).
 *
 * Detachment Brief 1 §4 S1 — this tail originally bound a Model-Lab GLM
 * (`{from:"model"}`, `irpm_factor` role). The registry left with the cut,
 * so the SAME per-policy IRPM nets now arrive as a declared input column
 * (`irpm_total_pct` — the migration path the refusal message names), and
 * the oracle numbers are unchanged: the score's origin was never the
 * engine's business (source-blind, ADR-0042).
 *
 * The per-location premiums are fed as inputs (an echo plan) so this test
 * isolates the TAIL wiring from the rating engine; the per-location rating is
 * proven elsewhere (`sampleBopRollup.verify.test.ts`).
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

// The per-policy IRPM nets the retired GLM used to emit (factor→net,
// (f−1)·100): P-001 0.930380 → −6.9620 · P-002 1.099686 → +9.9686. They
// now travel as a declared input column — same numbers, typed source.

// The ordered policy tail (Brief §4.3): IRPM from the input column (cap
// ±25% = the filed band) → Pioneer (first-term) → new-business (<3 yrs)
// → minimum premium $500.
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
    id: "pioneer",
    display_name: "Pioneer discount",
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

// The 3-location book (per-location premiums = the live-plan-proven inputs;
// sqft = LightBox enrichment; tiv = building + bpp).
const BOOK = [
  { policy_id: "P-001", location_id: "L1", inputs: { premium: 1326, tiv: 850_000, total_floor_area_sqft: 18_000, years_in_business: 12, is_first_term: false, irpm_total_pct: -6.962 } },
  { policy_id: "P-001", location_id: "L2", inputs: { premium: 3759, tiv: 210_000, total_floor_area_sqft: 5_000, years_in_business: 12, is_first_term: false, irpm_total_pct: -6.962 } },
  { policy_id: "P-002", location_id: "L3", inputs: { premium: 1275, tiv: 260_000, total_floor_area_sqft: 6_000, years_in_business: 2, is_first_term: true, irpm_total_pct: 9.9686 } },
];

describe("evaluatePolicyBook — opt-in policy tail (scored-input IRPM → final premium)", () => {
  const compiled = compilePlan(ECHO_PLAN);

  it("composes P-001 = $4,731 (rolled $5,085 × IRPM 0.93038, loadings miss)", () => {
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
    expect(irpm.factor_or_delta).toBeCloseTo(0.93038, 4);
    expect(irpm.provenance?.source).toBe("column");
    expect(p1.composed!.adjustments.find((a) => a.id === "pioneer")!.applied).toBe(false);
    expect(p1.composed!.adjustments.find((a) => a.id === "new_business")!.applied).toBe(false);
    expect(Math.round(p1.composed!.final)).toBe(4731);
  });

  it("composes P-002 = $1,388 (rolled $1,275 × IRPM 1.09969 × Pioneer × new-business)", () => {
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
    expect(irpm.factor_or_delta).toBeCloseTo(1.09969, 4);
    expect(p2.composed!.adjustments.find((a) => a.id === "pioneer")!.applied).toBe(true);
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

  it("a legacy model-sourced tail refuses by name through the book path (S1)", () => {
    const legacyTail = [
      {
        kind: "schedule_rating",
        id: "irpm",
        display_name: "Schedule rating (GLM)",
        cap_pct: 25,
        source: { from: "model", model_id: "sunsafe-irpm-glm", version: "test" },
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
