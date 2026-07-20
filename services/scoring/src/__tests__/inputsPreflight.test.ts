/**
 * inputsPreflight — Brief 83.2 (preflight accuracy).
 *
 * The G5 contract plus the two 83.2 refinements:
 *   · eligibility-gate rule variables are CONSUMED (a gate-only field
 *     like `state` is never an "unknown input" typo tell) but never
 *     REQUIRED (missing-variable grace: absent = rule no-match).
 *   · `optional: true` input nodes (declared overrides, exposure-option
 *     branch inputs, the IRPM schedule application) are consumed but
 *     never demanded as missing.
 */

import { describe, it, expect } from "vitest";
import type { Plan } from "@openrater/contracts";
import { preflightInputs } from "../core/inputsPreflight";

function planOf(nodes: unknown[]): Plan {
  return {
    id: "p",
    version: "1.0.0",
    name: "p",
    lines: [],
    effective: "2026-01-01",
    nodes,
    edges: [],
  } as unknown as Plan;
}

describe("preflightInputs — the G5 base contract", () => {
  it("names required-missing and unknown-supplied fields", () => {
    const plan = planOf([
      { id: "a", kind: "input", params: { fieldName: "zip", fieldType: "string" } },
      { id: "b", kind: "input", params: { fieldName: "base", fieldType: "number", defaultValue: 1 } },
    ]);
    const out = preflightInputs(plan, { zap: "66002" });
    expect(out.missing_inputs).toEqual(["zip"]);
    expect(out.unknown_inputs).toEqual(["zap"]);
  });
});

describe("preflightInputs — Brief 83.2 refinements", () => {
  it("gate rule variables are consumed (not unknown) but never required", () => {
    const plan = planOf([
      {
        id: "gate",
        kind: "eligibility.gate",
        params: {
          rules: [
            { rule_id: "state", variable: "state", op: "ne", value: "KS", tier: "decline" },
            {
              rule_id: "contractor",
              conditions: [
                { variable: "annual_gross_sales", op: "gt", value: 300000 },
                { variable: "class_code", op: "in", value: ["1"] },
              ],
              tier: "submit",
            },
          ],
          default_tier: "standard",
          default_reasoning: "",
        },
      },
      { id: "cc", kind: "input", params: { fieldName: "class_code", fieldType: "string" } },
    ]);
    // `state` supplied → not unknown; absent gate vars → not missing.
    const supplied = preflightInputs(plan, { class_code: "c101", state: "NE" });
    expect(supplied.unknown_inputs).toEqual([]);
    expect(supplied.missing_inputs).toEqual([]);
    const absent = preflightInputs(plan, { class_code: "c101" });
    expect(absent.missing_inputs).toEqual([]); // grace, not a demand
  });

  it("optional input nodes are consumed but never demanded", () => {
    const plan = planOf([
      { id: "cc", kind: "input", params: { fieldName: "class_code", fieldType: "string" } },
      {
        id: "ov",
        kind: "input",
        params: {
          fieldName: "liab_exposure_basis_override",
          fieldType: "string",
          optional: true,
        },
      },
      {
        id: "pay",
        kind: "input",
        params: { fieldName: "annual_payroll", fieldType: "number", optional: true },
      },
    ]);
    const out = preflightInputs(plan, { class_code: "c101" });
    expect(out.missing_inputs).toEqual([]);
    // …and supplying one is not "unknown".
    const withIt = preflightInputs(plan, {
      class_code: "c101",
      annual_payroll: 120000,
    });
    expect(withIt.unknown_inputs).toEqual([]);
  });
});
