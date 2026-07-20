/**
 * `endorsement.*` kinds tests.
 *
 * Three kinds, all sharing the same trigger semantics + a common
 * effect interface. Tests cover:
 *   1. Trigger evaluation (null = always; eq/gt/lt/in; missing var)
 *   2. Per-kind effect math (factor / additive / sublimit)
 *   3. Integration via executePlan with externalInputs
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  EndorsementFactorKind,
  EndorsementAdditiveKind,
  EndorsementSublimitKind,
  EndorsementRateBranchKind,
  evaluateEndorsementTrigger,
  type EndorsementTrigger,
} from "./endorsement";
import { ConstantKind } from "./constant";
import { OutputKind } from "./output";
import { executePlan } from "../runtime";
import { _clearRegistryForTests, registerBlockKind } from "../registry";
import type { Plan } from "../plan-types";

beforeEach(() => {
  _clearRegistryForTests();
  registerBlockKind(EndorsementFactorKind);
  registerBlockKind(EndorsementAdditiveKind);
  registerBlockKind(EndorsementSublimitKind);
  registerBlockKind(EndorsementRateBranchKind);
  registerBlockKind(ConstantKind);
  registerBlockKind(OutputKind);
});

// ────────────────────────────────────────────────────────────────
// Trigger evaluation
// ────────────────────────────────────────────────────────────────

describe("evaluateEndorsementTrigger", () => {
  it("returns true for a null trigger (always attach)", () => {
    expect(evaluateEndorsementTrigger(null, {})).toBe(true);
  });

  it("returns true when the trigger condition matches", () => {
    const t: EndorsementTrigger = {
      variable: "tiv",
      op: "gt",
      value: 1_000_000,
    };
    expect(evaluateEndorsementTrigger(t, { tiv: 4_200_000 })).toBe(true);
  });

  it("returns false when the trigger condition doesn't match", () => {
    const t: EndorsementTrigger = {
      variable: "tiv",
      op: "gt",
      value: 1_000_000,
    };
    expect(evaluateEndorsementTrigger(t, { tiv: 500_000 })).toBe(false);
  });

  it("returns false when the trigger variable is missing", () => {
    const t: EndorsementTrigger = {
      variable: "tiv",
      op: "gt",
      value: 1_000_000,
    };
    expect(evaluateEndorsementTrigger(t, {})).toBe(false);
  });

  it("supports `in` operator with an array value", () => {
    const t: EndorsementTrigger = {
      variable: "state",
      op: "in",
      value: ["CA", "TX", "FL"],
    };
    expect(evaluateEndorsementTrigger(t, { state: "CA" })).toBe(true);
    expect(evaluateEndorsementTrigger(t, { state: "WI" })).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// endorsement.factor — multiply premium
// ────────────────────────────────────────────────────────────────

describe("endorsement.factor", () => {
  it("multiplies premium when the trigger fires", () => {
    const result = EndorsementFactorKind.execute(
      { premium: 10_000 },
      {
        form_number: "MS 10 03",
        display_name: "Liquor liability",
        trigger: { variable: "class_code", op: "eq", value: "c101" },
        factor: 1.15,
      },
      { externalInputs: { class_code: "c101" }, as_of: "2026-01-01" },
    );
    expect(result.attached).toBe(true);
    expect(result.premium_out).toBe(11_500);
  });

  it("passes premium through unchanged when the trigger doesn't match", () => {
    const result = EndorsementFactorKind.execute(
      { premium: 10_000 },
      {
        form_number: "MS 10 03",
        display_name: "Liquor liability",
        trigger: { variable: "class_code", op: "eq", value: "c101" },
        factor: 1.15,
      },
      { externalInputs: { class_code: "c999" }, as_of: "2026-01-01" },
    );
    expect(result.attached).toBe(false);
    expect(result.premium_out).toBe(10_000);
  });

  it("always attaches when trigger is null", () => {
    const result = EndorsementFactorKind.execute(
      { premium: 10_000 },
      {
        form_number: "MS 10 01",
        display_name: "Base coverage surcharge",
        trigger: null,
        factor: 1.02,
      },
      { externalInputs: {}, as_of: "2026-01-01" },
    );
    expect(result.attached).toBe(true);
    expect(result.premium_out).toBe(10_200);
  });
});

// ────────────────────────────────────────────────────────────────
// endorsement.additive — flat $ add-on
// ────────────────────────────────────────────────────────────────

describe("endorsement.additive", () => {
  it("adds the amount when the trigger fires", () => {
    const result = EndorsementAdditiveKind.execute(
      { premium: 10_000 },
      {
        form_number: "MS 10 04",
        display_name: "Hired auto liability",
        trigger: { variable: "has_hired_auto", op: "eq", value: true },
        amount: 1_200,
      },
      { externalInputs: { has_hired_auto: true }, as_of: "2026-01-01" },
    );
    expect(result.attached).toBe(true);
    expect(result.premium_out).toBe(11_200);
  });

  it("passes premium through unchanged when the trigger doesn't match", () => {
    const result = EndorsementAdditiveKind.execute(
      { premium: 10_000 },
      {
        form_number: "MS 10 04",
        display_name: "Hired auto liability",
        trigger: { variable: "has_hired_auto", op: "eq", value: true },
        amount: 1_200,
      },
      { externalInputs: { has_hired_auto: false }, as_of: "2026-01-01" },
    );
    expect(result.attached).toBe(false);
    expect(result.premium_out).toBe(10_000);
  });
});

// ────────────────────────────────────────────────────────────────
// endorsement.sublimit — cap a coverage
// ────────────────────────────────────────────────────────────────

describe("endorsement.sublimit", () => {
  it("emits sublimit metadata when the trigger fires", () => {
    const result = EndorsementSublimitKind.execute(
      { premium: 10_000 },
      {
        form_number: "MS 10 02",
        display_name: "Peak limit",
        trigger: { variable: "tiv", op: "gt", value: 1_000_000 },
        coverage: "peak_items",
        sublimit: 100_000,
      },
      { externalInputs: { tiv: 4_200_000 }, as_of: "2026-01-01" },
    );
    expect(result.attached).toBe(true);
    expect(result.premium_out).toBe(10_000); // unchanged
    expect(result.sublimit_out).toEqual({
      coverage: "peak_items",
      value: 100_000,
    });
  });

  it("emits null sublimit when the trigger doesn't match", () => {
    const result = EndorsementSublimitKind.execute(
      { premium: 10_000 },
      {
        form_number: "MS 10 02",
        display_name: "Peak limit",
        trigger: { variable: "tiv", op: "gt", value: 1_000_000 },
        coverage: "peak_items",
        sublimit: 100_000,
      },
      { externalInputs: { tiv: 500_000 }, as_of: "2026-01-01" },
    );
    expect(result.attached).toBe(false);
    expect(result.premium_out).toBe(10_000);
    expect(result.sublimit_out).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// Integration — executePlan with chained endorsements
// ────────────────────────────────────────────────────────────────

describe("endorsement — integration via executePlan", () => {
  it("chains factor endorsements multiplicatively when both attach", () => {
    // Base premium = 1000; first endorsement ×1.15; second ×1.05.
    // Expected: 1000 × 1.15 × 1.05 = 1207.5
    const plan: Plan = {
      id: "test.endorsement-chain",
      version: "1.0.0",
      name: "Endorsement chain",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 1000 },
          position: { x: 0, y: 0 },
        },
        {
          id: "end1",
          kind: "endorsement.factor",
          params: {
            form_number: "MS 90 01",
            display_name: "Factor A",
            trigger: null,
            factor: 1.15,
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "end2",
          kind: "endorsement.factor",
          params: {
            form_number: "MS 90 02",
            display_name: "Factor B",
            trigger: null,
            factor: 1.05,
          },
          position: { x: 400, y: 0 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "final_premium", fieldType: "number" },
          position: { x: 600, y: 0 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "end1", port: "premium" } },
        { from: { node: "end1", port: "premium_out" }, to: { node: "end2", port: "premium" } },
        { from: { node: "end2", port: "premium_out" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.outputs.final_premium).toBeCloseTo(1207.5, 4);
  });

  it("skips a factor endorsement whose trigger doesn't match", () => {
    const plan: Plan = {
      id: "test.endorsement-skip",
      version: "1.0.0",
      name: "Endorsement skip",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 1000 },
          position: { x: 0, y: 0 },
        },
        {
          id: "end",
          kind: "endorsement.factor",
          params: {
            form_number: "MS 90 01",
            display_name: "Should skip",
            trigger: { variable: "tiv", op: "gt", value: 1_000_000 },
            factor: 1.15,
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "premium", fieldType: "number" },
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "end", port: "premium" } },
        { from: { node: "end", port: "premium_out" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { tiv: 500_000 });
    expect(result.outputs.premium).toBe(1000);
  });
});

// ────────────────────────────────────────────────────────────────
// endorsement.rate_branch
// ────────────────────────────────────────────────────────────────

describe("EndorsementRateBranchKind", () => {
  it("adds the branch's contribution to incoming premium when trigger fires", () => {
    // V18-shape pure unit test of the kind. Trigger fires; branch
    // computes 500 × 1.0 / 1 = 500; final = 1000 + 500 = 1500.
    const plan: Plan = {
      id: "rate-branch-fires",
      version: "1.0.0",
      name: "rate_branch fires",
      effective: "2026-01-01",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 1000 },
          position: { x: 0, y: 0 },
        },
        {
          id: "branch",
          kind: "endorsement.rate_branch",
          params: {
            form_number: "MS 10 06",
            display_name: "Liquor Liability",
            trigger: { variable: "has_liquor", op: "eq", value: true },
            branch_chain: {
              name: "liquor_premium",
              base_input: "form_input.liquor_receipts",
              factor_lookups: [],
              lcm: {
                factor_kind: "lcm",
                input_path: "form_input.lcm",
              },
              exposure_input: "form_input.liquor_receipts",
              exposure_unit_divisor: 1,
              output_field: "liquor_premium",
            },
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "out_premium",
          kind: "output",
          params: { fieldName: "final_premium", fieldType: "number" },
          position: { x: 400, y: 0 },
        },
        {
          id: "out_contribution",
          kind: "output",
          params: { fieldName: "branch_contribution", fieldType: "number" },
          position: { x: 400, y: 100 },
        },
        {
          id: "out_fired",
          kind: "output",
          params: { fieldName: "branch_fired", fieldType: "boolean" },
          position: { x: 400, y: 200 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "branch", port: "premium" } },
        { from: { node: "branch", port: "premium_out" }, to: { node: "out_premium", port: "value" } },
        { from: { node: "branch", port: "contribution" }, to: { node: "out_contribution", port: "value" } },
        { from: { node: "branch", port: "fired" }, to: { node: "out_fired", port: "value" } },
      ],
    };
    const result = executePlan(plan, {
      has_liquor: true,
      liquor_receipts: 500,
      lcm: 1.0,
    });
    expect(result.outputs.final_premium).toBe(1500);
    expect(result.outputs.branch_contribution).toBe(500);
    expect(result.outputs.branch_fired).toBe(true);
  });

  it("leaves premium unchanged + zero contribution when trigger misses", () => {
    const plan: Plan = {
      id: "rate-branch-misses",
      version: "1.0.0",
      name: "rate_branch misses",
      effective: "2026-01-01",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 1000 },
          position: { x: 0, y: 0 },
        },
        {
          id: "branch",
          kind: "endorsement.rate_branch",
          params: {
            form_number: "MS 10 06",
            display_name: "Liquor Liability",
            trigger: { variable: "has_liquor", op: "eq", value: true },
            branch_chain: {
              name: "liquor_premium",
              base_input: "form_input.liquor_receipts",
              factor_lookups: [],
              lcm: { factor_kind: "lcm", input_path: "form_input.lcm" },
              exposure_input: "form_input.liquor_receipts",
              exposure_unit_divisor: 1,
              output_field: "liquor_premium",
            },
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "out_premium",
          kind: "output",
          params: { fieldName: "final_premium", fieldType: "number" },
          position: { x: 400, y: 0 },
        },
        {
          id: "out_fired",
          kind: "output",
          params: { fieldName: "branch_fired", fieldType: "boolean" },
          position: { x: 400, y: 100 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "branch", port: "premium" } },
        { from: { node: "branch", port: "premium_out" }, to: { node: "out_premium", port: "value" } },
        { from: { node: "branch", port: "fired" }, to: { node: "out_fired", port: "value" } },
      ],
    };
    const result = executePlan(plan, {
      has_liquor: false,
      liquor_receipts: 500,
      lcm: 1.0,
    });
    expect(result.outputs.final_premium).toBe(1000);
    expect(result.outputs.branch_fired).toBe(false);
  });

  it("honors exposure_unit_divisor in the contribution math", () => {
    // base × lcm / divisor: 10000 × 1.20 / 100 = 120
    const plan: Plan = {
      id: "rate-branch-divisor",
      version: "1.0.0",
      name: "rate_branch divisor",
      effective: "2026-01-01",
      nodes: [
        {
          id: "base",
          kind: "constant",
          params: { value: 0 },
          position: { x: 0, y: 0 },
        },
        {
          id: "branch",
          kind: "endorsement.rate_branch",
          params: {
            form_number: "TEST",
            display_name: "Per-100",
            trigger: null,
            branch_chain: {
              name: "per_100_premium",
              base_input: "form_input.payroll",
              factor_lookups: [],
              lcm: { factor_kind: "lcm", input_path: "form_input.lcm" },
              exposure_input: "form_input.payroll",
              exposure_unit_divisor: 100,
              output_field: "per_100_premium",
            },
          },
          position: { x: 200, y: 0 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "premium", fieldType: "number" },
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "branch", port: "premium" } },
        { from: { node: "branch", port: "premium_out" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { payroll: 10000, lcm: 1.20 });
    expect(result.outputs.premium).toBe(120);
  });
});
