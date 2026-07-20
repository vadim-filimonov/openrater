/**
 * policyBookConfig — the "config from plan" adapter (E08/E03 PR D / ADR-016).
 *
 * Proves the authored-artifacts → oracle pipeline end-to-end: derived-input
 * expressions + roll-up fields + policy-scope gates → PolicyBookConfig →
 * evaluatePolicyBook → the stress-test acceptance oracle.
 */

import { describe, it, expect } from "vitest";
import {
  policyBookConfigFromPlan,
  keyedRowsFromBook,
  policyAggregateFields,
  type AuthoredRollupField,
} from "./policyBookConfig";
import {
  compilePlan,
  evaluatePolicyBook,
  registerBuiltinKinds,
  type Plan,
} from "@openrater/contracts";
import type { StageSummary } from "@openrater/api-client";

registerBuiltinKinds();

// Authored stages: building_limit + bpp_limit inputs, a DERIVED `tiv`
// (building + bpp), and a POLICY-scope gate "tiv < $1M → decline".
const stage = (s: Partial<StageSummary> & { stage_id: string; stage_kind: string }): StageSummary =>
  ({ display_name: s.stage_id, sequence: 0, inputs: [], outputs: [], ...s }) as unknown as StageSummary;

const TIV_EXPR = {
  kind: "op",
  op: "+",
  left: { kind: "input", name: "building_limit" },
  right: { kind: "input", name: "bpp_limit" },
};

const STAGES: StageSummary[] = [
  stage({ stage_id: "input_building_limit", stage_kind: "input_node", config_json: { name: "building_limit", source_path: "building_limit", source: "form" } }),
  stage({ stage_id: "input_bpp_limit", stage_kind: "input_node", config_json: { name: "bpp_limit", source_path: "bpp_limit", source: "form" } }),
  stage({ stage_id: "input_tiv", stage_kind: "input_node", config_json: { name: "tiv", source_path: "tiv", source: "derived", derived_expr: TIV_EXPR } }),
  stage({
    stage_id: "gate_min_tiv",
    stage_kind: "eligibility.gate",
    config_json: {
      scope: "policy",
      rules: [{ rule_id: "min_tiv", variable: "tiv", op: "lt", value: 1_000_000, tier: "decline", reasoning: "Policy TIV below $1M." }],
      default_tier: "standard",
      default_reasoning: "Policy in appetite.",
    },
  }),
  // a row-scope gate is ignored by the policy-book config (no policy meaning).
  stage({ stage_id: "gate_row", stage_kind: "eligibility.gate", config_json: { scope: "row", rules: [], default_tier: "standard", default_reasoning: "ok" } }),
];

const ROLLUP: AuthoredRollupField[] = [
  { fieldName: "tiv", reducer: "sum" },
  { fieldName: "premium", reducer: "sum" },
];

// The compiled plan: premium = (building_limit + bpp_limit) × 0.001. `tiv` is
// the derived field injected by computedFields (config) + rolled up.
const PLAN: Plan = {
  id: "policy-book-e2e",
  version: "1.0.0",
  name: "E2E",
  nodes: [
    { id: "bldg", kind: "input.source", params: { fieldName: "building_limit", fieldType: "money", sourceType: "form" } },
    { id: "bpp", kind: "input.source", params: { fieldName: "bpp_limit", fieldType: "money", sourceType: "form" } },
    { id: "sum", kind: "math.op", params: { op: "add" } },
    { id: "rate", kind: "constant", params: { value: 0.001, type: "factor" } },
    { id: "prem", kind: "math.op", params: { op: "mul" } },
    { id: "prem_out", kind: "output", params: { fieldName: "premium", fieldType: "money" } },
  ],
  edges: [
    { from: { node: "bldg", port: "value" }, to: { node: "sum", port: "x" } },
    { from: { node: "bpp", port: "value" }, to: { node: "sum", port: "y" } },
    { from: { node: "sum", port: "result" }, to: { node: "prem", port: "x" } },
    { from: { node: "rate", port: "value" }, to: { node: "prem", port: "y" } },
    { from: { node: "prem", port: "result" }, to: { node: "prem_out", port: "value" } },
  ],
};

describe("policyBookConfigFromPlan", () => {
  it("extracts computedFields, rollupFields, and policy-scope gates", () => {
    const cfg = policyBookConfigFromPlan(STAGES, ROLLUP);
    expect(cfg.computedFields).toEqual([{ name: "tiv", expr: TIV_EXPR }]);
    expect(cfg.rollupFields).toEqual([
      { field: "tiv", reducer: "sum" },
      { field: "premium", reducer: "sum" },
    ]);
    expect(cfg.policyGates).toHaveLength(1); // only the scope:"policy" gate
    expect(cfg.policyGates![0]!.rules[0]!.variable).toBe("tiv");
  });

  it("omits computedFields / policyGates when none are authored", () => {
    const cfg = policyBookConfigFromPlan(
      [stage({ stage_id: "input_x", stage_kind: "input_node", config_json: { name: "x", source_path: "x" } })],
      [{ fieldName: "premium", reducer: "sum" }],
    );
    expect(cfg.computedFields).toBeUndefined();
    expect(cfg.policyGates).toBeUndefined();
    expect(cfg.rollupFields).toEqual([{ field: "premium", reducer: "sum" }]);
  });
});

describe("keyedRowsFromBook", () => {
  it("pairs projected rows with their policy/location ids", () => {
    const keyed = keyedRowsFromBook(
      [{ building_limit: 800000 }, { building_limit: 180000 }],
      [
        { policy_id: "P1", location_id: "L1", building_limit: "800000" },
        { policy_id: "P1", location_id: "L2", building_limit: "180000" },
      ],
      { policy_id_column: "policy_id", location_id_column: "location_id" },
    );
    expect(keyed.map((r) => r.policy_id)).toEqual(["P1", "P1"]);
    expect(keyed.map((r) => r.location_id)).toEqual(["L1", "L2"]);
    expect(keyed[0]!.inputs).toEqual({ building_limit: 800000 });
  });

  it("a row missing a policy id forms its own single-location policy", () => {
    const keyed = keyedRowsFromBook([{ x: 1 }], [{}], {
      policy_id_column: "policy_id",
    });
    expect(keyed[0]!.policy_id).toBe("row_0");
    expect(keyed[0]!.location_id).toBe("L1");
  });
});

describe("end-to-end — authored plan → evaluatePolicyBook → acceptance oracle", () => {
  it("2 locations $850k+$210k → IN appetite ($1.06M); single $260k → declines", () => {
    const compiled = compilePlan(PLAN);
    const config = policyBookConfigFromPlan(STAGES, ROLLUP);
    const keyed = keyedRowsFromBook(
      [
        { building_limit: 800_000, bpp_limit: 50_000 },
        { building_limit: 180_000, bpp_limit: 30_000 },
        { building_limit: 240_000, bpp_limit: 20_000 },
      ],
      [
        { policy_id: "P1", location_id: "L1" },
        { policy_id: "P1", location_id: "L2" },
        { policy_id: "P2", location_id: "L1" },
      ],
      { policy_id_column: "policy_id", location_id_column: "location_id" },
    );
    const results = evaluatePolicyBook(compiled, keyed, config);

    const p1 = results.find((r) => r.policy_id === "P1")!;
    expect(p1.rollup.rolled.tiv).toBe(1_060_000);
    expect(p1.rollup.rolled.premium).toBeCloseTo(1060, 6);
    expect(p1.appetite.tier).toBe("standard"); // IN appetite

    const p2 = results.find((r) => r.policy_id === "P2")!;
    expect(p2.rollup.rolled.tiv).toBe(260_000);
    expect(p2.appetite.tier).toBe("decline");
  });
});

describe("policy field-picker options ⇔ readable rolled keys (ADR-0046)", () => {
  // The picker (route `policyFields`) and the set of keys a policy gate can read
  // are BOTH derived from the same roll-up declarations via
  // `policyAggregateFields`, so every option the UI offers is a present,
  // readable gate variable — a policy gate authored through the field-picker can
  // never silently no-match (the footgun ADR-0046 closes). Includes
  // `location_count`, which `rollUpBook` keeps as a SIBLING of `rolled`.
  const compiled = compilePlan(PLAN);
  const KEYED = keyedRowsFromBook(
    [
      { building_limit: 800_000, bpp_limit: 50_000 },
      { building_limit: 180_000, bpp_limit: 30_000 },
    ],
    [
      { policy_id: "P1", location_id: "L1" },
      { policy_id: "P1", location_id: "L2" },
    ],
    { policy_id_column: "policy_id", location_id_column: "location_id" },
  );
  const base = policyBookConfigFromPlan(STAGES, ROLLUP);
  const options = policyAggregateFields(ROLLUP.map((f) => f.fieldName));

  const probeGate = (variable: string) => ({
    ...base,
    policyGates: [
      {
        // `variable > -1` is TRUE for any present numeric total; an ABSENT
        // variable is skipped by `evaluateAppetiteRules` (→ default, rule_id
        // null). So matched_rule_id === "probe" iff `variable` is a real key.
        rules: [
          {
            rule_id: "probe",
            variable,
            op: "gt" as const,
            value: -1,
            tier: "submit" as const,
            reasoning: "probe",
          },
        ],
        default_tier: "standard" as const,
        default_reasoning: "variable absent → silent no-match",
      },
    ],
  });

  it("offers the RAW declared roll-up names + location_count (never policy_*)", () => {
    expect(options).toEqual(["tiv", "premium", "location_count"]);
    // the brief/doc footgun — the picker must never offer the prefixed name
    expect(options).not.toContain("policy_tiv");
    expect(options).not.toContain("policy_premium");
  });

  it.each(options.map((variable) => [variable]))(
    "field-picker option `%s` is a readable policy-gate variable (fires, not skipped)",
    (variable) => {
      const results = evaluatePolicyBook(compiled, KEYED, probeGate(variable));
      const policyVerdict = results[0]!.appetite.verdicts.find(
        (v) => v.scope === "policy",
      )!;
      expect(policyVerdict.matched_rule_id).toBe("probe");
    },
  );

  it("location_count reaches a policy gate (regression: it lives outside `rolled`)", () => {
    // "more than 1 location → submit": the 2-location P1 must MATCH, proving
    // location_count is injected into the gate-eval map (else silent no-match).
    const config = {
      ...base,
      policyGates: [
        {
          rules: [
            {
              rule_id: "multi_loc",
              variable: "location_count",
              op: "gt" as const,
              value: 1,
              tier: "submit" as const,
              reasoning: "Multi-location policy — refer.",
            },
          ],
          default_tier: "standard" as const,
          default_reasoning: "Single location.",
        },
      ],
    };
    const verdict = evaluatePolicyBook(compiled, KEYED, config)[0]!.appetite.verdicts.find(
      (v) => v.scope === "policy",
    )!;
    expect(verdict.matched_rule_id).toBe("multi_loc");
    expect(verdict.tier).toBe("submit");
  });
});

// ══════════════════════════════════════════════════════════════════
// P2 G9 (ADR-0056) — the minimum-premium floor applies ONCE per
// policy, post-IRPM, when the book is policy-composed
// ══════════════════════════════════════════════════════════════════

import {
  planMinimumPremium,
  appendPlanFloor,
  PLAN_MIN_PREMIUM_STEP_ID,
} from "./policyBookConfig";
import { stagesToRuntimePlan } from "@openrater/ui";

describe("P2 G9 · policy-scope minimum premium", () => {
  // base $140 per location, min $500 — the proven over-charge case:
  // 3 locations floored per row paid $1,500 vs the filed $500.
  const G9_STAGES: StageSummary[] = [
    stage({
      stage_id: "chain_1",
      stage_kind: "multiplicative_chain",
      config_json: {
        chains: [
          {
            name: "prem",
            base_input: "ignored",
            base_value: 140,
            factor_lookups: [],
            lcm: { value: 1.0 },
            output_field: "prem_premium",
          },
        ],
        output_total_field: "premium",
      },
    }),
    stage({
      stage_id: "final_round",
      stage_kind: "round",
      config_json: {
        input_path: "chain.total_premium",
        increment_input: "literal:1",
        min_value_input: "literal:500",
        output_field: "total_premium",
      },
    }),
  ];

  const THREE_LOCATIONS = [
    { policy_id: "P-1", location_id: "L1", inputs: {} },
    { policy_id: "P-1", location_id: "L2", inputs: {} },
    { policy_id: "P-1", location_id: "L3", inputs: {} },
  ];

  it("planMinimumPremium reads the round stage's literal floor", () => {
    expect(planMinimumPremium(G9_STAGES)).toBe(500);
    expect(planMinimumPremium(STAGES)).toBeNull(); // no round stage
  });

  it("appendPlanFloor writes the terminal minimum_premium step (and no-ops on null)", () => {
    expect(appendPlanFloor([], null)).toEqual([]);
    expect(appendPlanFloor([], 500)).toEqual([
      { kind: "minimum_premium", id: PLAN_MIN_PREMIUM_STEP_ID, floor: 500 },
    ]);
  });

  it("GROUPED: 3×$140 policy composes to the $500 floor ONCE — not $1,500", () => {
    const { plan } = stagesToRuntimePlan(
      G9_STAGES as never,
      [],
      [],
      new Map(),
      { minPremiumScope: "policy" },
    );
    const compiled = compilePlan(plan as unknown as Plan);
    const config = {
      ...policyBookConfigFromPlan(G9_STAGES, [
        { fieldName: "total_premium", reducer: "sum" as const },
      ]),
      premiumRollupField: "total_premium",
      policyTail: appendPlanFloor([], planMinimumPremium(G9_STAGES)),
    };
    const results = evaluatePolicyBook(compiled, THREE_LOCATIONS, config);
    expect(results).toHaveLength(1);
    // Rows are UNFLOORED under policy scope: 3 × $140 = $420 rolled…
    expect(results[0]!.rollup.rolled.total_premium).toBe(420);
    // …and the floor binds ONCE at composition: filed $500, not $1,500.
    expect(results[0]!.composed?.final).toBe(500);
  });

  it("UNGROUPED default keeps the per-row floor (no undercharge regression)", () => {
    const { plan } = stagesToRuntimePlan(
      G9_STAGES as never,
      [],
      [],
      new Map(),
    );
    const compiled = compilePlan(plan as unknown as Plan);
    const results = evaluatePolicyBook(compiled, THREE_LOCATIONS, {
      ...policyBookConfigFromPlan(G9_STAGES, [
        { fieldName: "total_premium", reducer: "sum" as const },
      ]),
    });
    // Each ROW floors to $500 (a standalone quote per row) — the
    // pre-G9 semantic, still correct when nothing composes policies.
    expect(results[0]!.rollup.rolled.total_premium).toBe(1500);
  });
});
