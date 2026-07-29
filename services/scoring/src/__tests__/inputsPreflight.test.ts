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
import {
  declaredInputsFromStages,
  preflightInputs,
  withDeclaredGateDefaults,
} from "../core/inputsPreflight";

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
    const supplied = preflightInputs(plan, { class_code: "53983", state: "KS" });
    expect(supplied.unknown_inputs).toEqual([]);
    expect(supplied.missing_inputs).toEqual([]);
    const absent = preflightInputs(plan, { class_code: "53983" });
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
    const out = preflightInputs(plan, { class_code: "53983" });
    expect(out.missing_inputs).toEqual([]);
    // …and supplying one is not "unknown".
    const withIt = preflightInputs(plan, {
      class_code: "53983",
      annual_payroll: 120000,
    });
    expect(withIt.unknown_inputs).toEqual([]);
  });
});

// FCA fca-2026-07-25 (S0 — required gate-only input rated anyway):
// the DECLARED input dictionary widens the required net. A field the
// workbook declares required with no default is demanded even when
// only the eligibility gate consumes it; the Brief 83.2 grace remains
// for UNDECLARED gate variables (partial-account intake).
describe("preflightInputs — declared input dictionary (FCA gate-only required)", () => {
  const GATE_ONLY_PLAN = planOf([
    {
      id: "gate",
      kind: "eligibility.gate",
      params: {
        rules: [
          {
            rule_id: "delivery_livery",
            variable: "vehicle_use",
            op: "in",
            value: ["delivery", "livery"],
            tier: "decline",
          },
          { rule_id: "state", variable: "state", op: "ne", value: "NE", tier: "submit" },
        ],
        default_tier: "standard",
        default_reasoning: "",
      },
    },
    { id: "zip", kind: "input", params: { fieldName: "garaging_zip", fieldType: "string" } },
  ]);

  const STAGES = [
    {
      stage_kind: "input_node",
      config_json: {
        name: "vehicle_use",
        data_type: "string",
        source: "form",
        source_path: "vehicle_use",
        required: true,
        output_field: "value",
      },
    },
    {
      stage_kind: "input_node",
      config_json: {
        name: "garaging_zip",
        data_type: "string",
        source: "form",
        source_path: "garaging_zip",
        required: true,
        output_field: "value",
      },
    },
  ];

  it("declaredInputsFromStages distills the dictionary", () => {
    const declared = declaredInputsFromStages([
      ...STAGES,
      {
        stage_kind: "input_node",
        config_json: {
          name: "deductible",
          data_type: "string",
          source: "form",
          source_path: "deductible",
          required: false,
          default_value: "none",
          output_field: "value",
        },
      },
      {
        stage_kind: "input_node",
        config_json: {
          name: "total_sales",
          data_type: "money",
          source: "derived",
          source_path: "total_sales",
          required: false,
          output_field: "value",
        },
      },
      { stage_kind: "multiplicative_chain", config_json: {} },
    ]);
    expect(declared).toEqual([
      { fieldName: "vehicle_use", required: true, hasDefault: false, derived: false },
      { fieldName: "garaging_zip", required: true, hasDefault: false, derived: false },
      { fieldName: "deductible", required: false, hasDefault: true, defaultValue: "none", derived: false },
      { fieldName: "total_sales", required: false, hasDefault: false, derived: true },
    ]);
  });

  it("a declared-required gate-only field is DEMANDED — and REFUSED — when absent", () => {
    const out = preflightInputs(
      GATE_ONLY_PLAN,
      { garaging_zip: "68144" },
      declaredInputsFromStages(STAGES),
    );
    expect(out.missing_inputs).toEqual(["vehicle_use"]);
    // The §12.4 refusal subset carries it too — dictionary-derived.
    expect(out.refused_inputs).toEqual(["vehicle_use"]);
    // …and supplied, it is neither missing nor unknown.
    const withIt = preflightInputs(
      GATE_ONLY_PLAN,
      { garaging_zip: "68144", vehicle_use: "livery" },
      declaredInputsFromStages(STAGES),
    );
    expect(withIt.missing_inputs).toEqual([]);
    expect(withIt.refused_inputs).toEqual([]);
    expect(withIt.unknown_inputs).toEqual([]);
  });

  it("a projected-node defaultValue or optional flag SATISFIES a declared requirement", () => {
    // FCA review — the caller/projector constant (PR D2b) and the
    // Brief 83.2 structural grace both beat the dictionary: refusing
    // a field the projected plan rates correctly is a regression.
    const planWithDefault = planOf([
      {
        id: "zip",
        kind: "input",
        params: { fieldName: "garaging_zip", fieldType: "string", defaultValue: "68144" },
      },
      {
        id: "ov",
        kind: "input",
        params: { fieldName: "vehicle_use", fieldType: "string", optional: true },
      },
    ]);
    const out = preflightInputs(
      planWithDefault,
      {},
      declaredInputsFromStages(STAGES),
    );
    expect(out.refused_inputs).toEqual([]);
    expect(out.missing_inputs).toEqual([]);
  });

  it("node-scan demands stay ADVISORY — never refused without a declaration", () => {
    // A raw plan (no dictionary): node-required fields report as
    // missing (G5 ergonomics) but never refuse — the engine's G8
    // refusal covers genuinely-fatal chain misses, and authored
    // lookup grace may legitimately rate the row.
    const plan = planOf([
      { id: "a", kind: "input", params: { fieldName: "zip", fieldType: "string" } },
    ]);
    const out = preflightInputs(plan, {});
    expect(out.missing_inputs).toEqual(["zip"]);
    expect(out.refused_inputs).toEqual([]);
  });

  it("the dictionary's required:false beats a node-scan demand", () => {
    // Declared-OPTIONAL chain-consumed field with no default: the
    // workbook's word wins — not listed, not refused.
    const plan = planOf([
      { id: "d", kind: "input", params: { fieldName: "deductible_code", fieldType: "string" } },
    ]);
    const stages = [
      {
        stage_kind: "input_node",
        config_json: {
          name: "deductible_code",
          data_type: "string",
          source: "form",
          source_path: "deductible_code",
          required: false,
          output_field: "value",
        },
      },
    ];
    const out = preflightInputs(plan, {}, declaredInputsFromStages(stages));
    expect(out.missing_inputs).toEqual([]);
    expect(out.refused_inputs).toEqual([]);
  });

  it("a declared default or optional flag keeps the field un-demanded", () => {
    const stages = [
      {
        stage_kind: "input_node",
        config_json: {
          name: "deductible",
          data_type: "string",
          source: "form",
          source_path: "deductible",
          required: false,
          default_value: "none",
          output_field: "value",
        },
      },
      {
        stage_kind: "input_node",
        config_json: {
          name: "tools_endorsement_units",
          data_type: "int",
          source: "form",
          source_path: "tools_endorsement_units",
          required: true,
          default_value: 0,
          output_field: "value",
        },
      },
    ];
    const out = preflightInputs(
      GATE_ONLY_PLAN,
      { garaging_zip: "68144", vehicle_use: "pleasure" },
      declaredInputsFromStages(stages),
    );
    // required-but-defaulted and optional-no-default both stay quiet.
    expect(out.missing_inputs).toEqual([]);
  });

  it("derived declared inputs are never demanded (computed, not supplied)", () => {
    const stages = [
      {
        stage_kind: "input_node",
        config_json: {
          name: "total_sales",
          data_type: "money",
          source: "derived",
          source_path: "total_sales",
          required: true,
          output_field: "value",
        },
      },
    ];
    const out = preflightInputs(
      GATE_ONLY_PLAN,
      { garaging_zip: "68144", vehicle_use: "pleasure" },
      declaredInputsFromStages(stages),
    );
    expect(out.missing_inputs).toEqual([]);
  });

  it("UNDECLARED gate variables keep the Brief 83.2 grace", () => {
    // `state` is a gate variable with no declaration — absent must
    // remain a rule no-match, not a demand (partial-account intake).
    const out = preflightInputs(
      GATE_ONLY_PLAN,
      { garaging_zip: "68144", vehicle_use: "pleasure" },
      declaredInputsFromStages(STAGES),
    );
    expect(out.missing_inputs).toEqual([]);
    expect(out.unknown_inputs).toEqual([]);
  });

  describe("JSON null supplies no value (FCA #10 — the wire sample's placeholder)", () => {
    it("a null'd declared-required field refuses exactly like the omission", () => {
      // Without this, `"vehicle_use": null` counted as supplied, the
      // gate's grace only covers `undefined`, and the row rated a risk
      // whose one eligibility answer was never given — the S0 lie
      // through a null.
      const out = preflightInputs(
        GATE_ONLY_PLAN,
        { garaging_zip: "68144", vehicle_use: null },
        declaredInputsFromStages(STAGES),
      );
      expect(out.missing_inputs).toEqual(["vehicle_use"]);
      expect(out.refused_inputs).toEqual(["vehicle_use"]);
      // Still counted supplied for the typo tell — it is not unknown.
      expect(out.unknown_inputs).toEqual([]);
    });

    it("a null'd declared field WITH a default stays quiet — the default fills it", () => {
      const stages = [
        {
          stage_kind: "input_node",
          config_json: {
            name: "deductible",
            data_type: "string",
            source: "form",
            source_path: "deductible",
            required: true,
            default_value: "none",
            output_field: "value",
          },
        },
      ];
      const declared = declaredInputsFromStages(stages);
      const out = preflightInputs(
        GATE_ONLY_PLAN,
        { garaging_zip: "68144", vehicle_use: "pleasure", deductible: null },
        declared,
      );
      expect(out.missing_inputs).toEqual([]);
      expect(out.refused_inputs).toEqual([]);
      // …and the gate-only default injection treats the null as the
      // omission it is: the declared default lands in the record.
      const filled = withDeclaredGateDefaults(GATE_ONLY_PLAN, declared, {
        deductible: null,
      });
      expect(filled["deductible"]).toBe("none");
      // A real supplied value still wins over the default.
      const kept = withDeclaredGateDefaults(GATE_ONLY_PLAN, declared, {
        deductible: "500",
      });
      expect(kept["deductible"]).toBe("500");
    });
  });
});
