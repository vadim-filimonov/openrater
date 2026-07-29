/**
 * evaluatePolicyBook — the multi-location policy pipeline (E08 + E03).
 *
 * Exercises the whole chain against the REAL runtime: derive → rate →
 * roll-up → policy gates → most-restrictive precedence, on a plan that
 * computes tiv + premium and carries a per-row eligibility gate.
 */

import { describe, it, expect } from "vitest";
import { evaluatePolicyBook, type PolicyGateSpec } from "./policy-book";
import { compilePlan } from "./runtime";
import { registerBuiltinKinds } from "./kinds";
import type { RollupField } from "./policy-rollup";
import type { ComputedField } from "./policy-appetite";
import type { Plan } from "./plan-types";

registerBuiltinKinds();

// A plan that: tiv = building_limit + bpp_limit (→ output tiv);
// premium = tiv × 0.001 (→ output premium); and a per-row eligibility gate
// "building_limit > $10M → decline" (→ output row_tier).
const PLAN: Plan = {
  id: "policy-book",
  version: "1.0.0",
  name: "Location rater + row gate",
  nodes: [
    { id: "bldg", kind: "input.source", params: { fieldName: "building_limit", fieldType: "money", sourceType: "form" } },
    { id: "bpp", kind: "input.source", params: { fieldName: "bpp_limit", fieldType: "money", sourceType: "form" } },
    { id: "tiv", kind: "math.op", params: { op: "add" } },
    { id: "tiv_out", kind: "output", params: { fieldName: "tiv", fieldType: "money" } },
    { id: "rate", kind: "constant", params: { value: 0.001, type: "factor" } },
    { id: "prem", kind: "math.op", params: { op: "mul" } },
    { id: "prem_out", kind: "output", params: { fieldName: "premium", fieldType: "money" } },
    {
      id: "gate",
      kind: "eligibility.gate",
      params: {
        rules: [
          {
            rule_id: "big_location",
            variable: "building_limit",
            op: "gt",
            value: 10_000_000,
            tier: "decline",
            reasoning: "Single location building limit over $10M.",
          },
        ],
        default_tier: "standard",
        default_reasoning: "Location in appetite.",
        scope: "row",
      },
    },
    { id: "gate_out", kind: "output", params: { fieldName: "row_tier", fieldType: "string" } },
  ],
  edges: [
    { from: { node: "bldg", port: "value" }, to: { node: "tiv", port: "x" } },
    { from: { node: "bpp", port: "value" }, to: { node: "tiv", port: "y" } },
    { from: { node: "tiv", port: "result" }, to: { node: "tiv_out", port: "value" } },
    { from: { node: "tiv", port: "result" }, to: { node: "prem", port: "x" } },
    { from: { node: "rate", port: "value" }, to: { node: "prem", port: "y" } },
    { from: { node: "prem", port: "result" }, to: { node: "prem_out", port: "value" } },
    { from: { node: "gate", port: "tier" }, to: { node: "gate_out", port: "value" } },
  ],
};

// These exercise the optional `RollupField.as` rename (a primitive capability):
// the rolled keys here are `policy_premium`/`policy_tiv`. NOTE the rate-lab
// WIRED adapter (`policyBookConfigFromPlan`) does NOT set `as`, so the LIVE
// rolled keys are the RAW field names (`premium`/`tiv`); the field-picker ⇔
// rolled-key agreement for the wired path is proven in
// `rate-lab/frontend/src/integrations/policyBookConfig.test.ts` (ADR-0046).
const ROLLUP: readonly RollupField[] = [
  { field: "premium", reducer: "sum", as: "policy_premium" },
  { field: "tiv", reducer: "sum", as: "policy_tiv" },
];

const TIV_FLOOR: PolicyGateSpec = {
  rules: [
    {
      rule_id: "min_policy_tiv",
      variable: "policy_tiv",
      op: "lt",
      value: 1_000_000,
      tier: "decline",
      reasoning: "Policy TIV below the $1M minimum.",
    },
  ],
  default_tier: "standard",
  default_reasoning: "Policy in appetite.",
};

describe("evaluatePolicyBook — acceptance oracle", () => {
  const compiled = compilePlan(PLAN);

  it("2-location $1.06M policy is IN appetite; neither location declined", () => {
    const results = evaluatePolicyBook(
      compiled,
      [
        { policy_id: "P1", location_id: "L1", inputs: { building_limit: 800_000, bpp_limit: 50_000 } },
        { policy_id: "P1", location_id: "L2", inputs: { building_limit: 180_000, bpp_limit: 30_000 } },
      ],
      { rollupFields: ROLLUP, policyGates: [TIV_FLOOR], rowVerdictOutput: "row_tier" },
    );
    expect(results).toHaveLength(1);
    const p1 = results[0]!;
    expect(p1.rollup.rolled.policy_tiv).toBe(1_060_000);
    expect(p1.rollup.rolled.policy_premium).toBeCloseTo(1060, 6);
    expect(p1.appetite.tier).toBe("standard"); // IN appetite
    // every per-location row verdict is standard (not declined)
    const rowVerdicts = p1.appetite.verdicts.filter((v) => v.scope === "row");
    expect(rowVerdicts).toHaveLength(2);
    expect(rowVerdicts.every((v) => v.tier === "standard")).toBe(true);
  });

  it("single-location $260k policy declines (policy gate is the deciding verdict)", () => {
    const results = evaluatePolicyBook(
      compiled,
      [{ policy_id: "P2", location_id: "L1", inputs: { building_limit: 240_000, bpp_limit: 20_000 } }],
      { rollupFields: ROLLUP, policyGates: [TIV_FLOOR], rowVerdictOutput: "row_tier" },
    );
    const p2 = results[0]!;
    expect(p2.rollup.rolled.policy_tiv).toBe(260_000);
    expect(p2.appetite.tier).toBe("decline");
    expect(p2.appetite.deciding?.scope).toBe("policy");
  });

  it("a per-row decline wins by precedence even when the policy total is in appetite", () => {
    const results = evaluatePolicyBook(
      compiled,
      [{ policy_id: "P3", location_id: "L1", inputs: { building_limit: 20_000_000, bpp_limit: 0 } }],
      { rollupFields: ROLLUP, policyGates: [TIV_FLOOR], rowVerdictOutput: "row_tier" },
    );
    const p3 = results[0]!;
    expect(p3.rollup.rolled.policy_tiv).toBe(20_000_000); // policy gate: standard
    expect(p3.appetite.tier).toBe("decline"); // the row gate declines the $20M location
    expect(p3.appetite.deciding?.scope).toBe("row");
  });

  it("G11 — a row-gate decline reaches the policy WITHOUT rowVerdictOutput wiring", () => {
    // Same $20M location as the precedence test, but the config does NOT
    // name a verdict output. Pre-G11 this produced ZERO row verdicts (the
    // combine only read `outputs[rowVerdictOutput]`), so the policy sailed
    // through as standard while the row gate said decline. The fallback
    // reads the run's resolved `eligibility_tier` instead.
    const results = evaluatePolicyBook(
      compiled,
      [{ policy_id: "P3", location_id: "L1", inputs: { building_limit: 20_000_000, bpp_limit: 0 } }],
      { rollupFields: ROLLUP, policyGates: [TIV_FLOOR] },
    );
    const p3 = results[0]!;
    expect(p3.appetite.tier).toBe("decline");
    expect(p3.appetite.deciding?.scope).toBe("row");
    const rowVerdicts = p3.appetite.verdicts.filter((v) => v.scope === "row");
    expect(rowVerdicts).toHaveLength(1);
    expect(rowVerdicts[0]!.location_id).toBe("L1");
  });

  it("G11 — a declared rowVerdictOutput still wins over the resolved tier", () => {
    // A plan may declare a bespoke verdict output that post-processes the
    // gate (e.g. a mapped tier). When the named output resolves to a tier,
    // it is authoritative; the run-resolved tier is only the fallback.
    const results = evaluatePolicyBook(
      compiled,
      [{ policy_id: "P4", location_id: "L1", inputs: { building_limit: 800_000, bpp_limit: 50_000 } }],
      // Points at an output that doesn't exist → falls back to the run's
      // resolved eligibility_tier (standard), never silently zero verdicts.
      { rollupFields: ROLLUP, rowVerdictOutput: "nonexistent_output" },
    );
    const p4 = results[0]!;
    const rowVerdicts = p4.appetite.verdicts.filter((v) => v.scope === "row");
    expect(rowVerdicts).toHaveLength(1);
    expect(rowVerdicts[0]!.tier).toBe("standard");
  });

  it("groups multiple policies in one book, first-seen order", () => {
    const results = evaluatePolicyBook(
      compiled,
      [
        { policy_id: "P1", location_id: "L1", inputs: { building_limit: 800_000, bpp_limit: 50_000 } },
        { policy_id: "P2", location_id: "L1", inputs: { building_limit: 240_000, bpp_limit: 20_000 } },
        { policy_id: "P1", location_id: "L2", inputs: { building_limit: 180_000, bpp_limit: 30_000 } },
      ],
      { rollupFields: ROLLUP, policyGates: [TIV_FLOOR], rowVerdictOutput: "row_tier" },
    );
    expect(results.map((r) => r.policy_id)).toEqual(["P1", "P2"]);
    expect(results[0]!.appetite.tier).toBe("standard");
    expect(results[1]!.appetite.tier).toBe("decline");
  });
});

describe("evaluatePolicyBook — computed fields injected pre-run", () => {
  const compiled = compilePlan(PLAN);

  it("a derived field (not output by the plan) is merged into inputs and rolls up", () => {
    const computedFields: readonly ComputedField[] = [
      {
        name: "derived_sum",
        expr: {
          kind: "op",
          op: "+",
          left: { kind: "input", name: "building_limit" },
          right: { kind: "input", name: "bpp_limit" },
        },
      },
    ];
    const results = evaluatePolicyBook(
      compiled,
      [
        { policy_id: "P1", location_id: "L1", inputs: { building_limit: 800_000, bpp_limit: 50_000 } },
        { policy_id: "P1", location_id: "L2", inputs: { building_limit: 180_000, bpp_limit: 30_000 } },
      ],
      {
        computedFields,
        rollupFields: [{ field: "derived_sum", reducer: "sum", as: "policy_derived" }],
      },
    );
    // derived_sum rolled up from the INJECTED field, even though the plan
    // never outputs it.
    expect(results[0]!.rollup.rolled.policy_derived).toBe(1_060_000);
  });
});

describe("evaluatePolicyBook — wire-string inputs coerce at the seam (Phase F 2026-07-17)", () => {
  const compiled = compilePlan(PLAN);

  it("string-typed numbers reach the POLICY-scope gate typed: the rolled total and the verdict match the typed run byte-for-byte", () => {
    // The same 2-location $1.06M policy the acceptance oracle proves —
    // but every input arrives in the wire-string form CSVs produce.
    // Before the seam coercion the raw strings leaked into the book-row
    // `values`, and only `rollUpBook`'s local numeric tolerance kept the
    // roll-up alive; the seam now types the record ONCE, so the policy
    // gate, the roll-up, and the per-row run all read the same value.
    const typed = evaluatePolicyBook(
      compiled,
      [
        { policy_id: "P1", location_id: "L1", inputs: { building_limit: 800_000, bpp_limit: 50_000 } },
        { policy_id: "P1", location_id: "L2", inputs: { building_limit: 180_000, bpp_limit: 30_000 } },
      ],
      { rollupFields: ROLLUP, policyGates: [TIV_FLOOR], rowVerdictOutput: "row_tier" },
    );
    const wire = evaluatePolicyBook(
      compiled,
      [
        { policy_id: "P1", location_id: "L1", inputs: { building_limit: "800000", bpp_limit: "50000" } },
        { policy_id: "P1", location_id: "L2", inputs: { building_limit: "180000", bpp_limit: "30000" } },
      ],
      { rollupFields: ROLLUP, policyGates: [TIV_FLOOR], rowVerdictOutput: "row_tier" },
    );
    expect(wire[0]!.rollup.rolled.policy_tiv).toBe(1_060_000);
    expect(wire[0]!.appetite.tier).toBe("standard"); // IN appetite — gate saw 1.06M, not a string
    expect(wire).toEqual(typed); // Law 1: one risk, one verdict, whatever the JSON typing
  });

  it("string-typed booleans reach the row gate coerced — the tier no longer depends on JSON typing (the Phase F Meridian repro)", () => {
    // The repro shape: a boolean-ported input whose appetite rule says
    // `eq true`. The gate reads ctx.externalInputs (it has no wire
    // ports), so before the seam coercion the wire spelling "true"
    // priced identically but silently missed the rule and dropped the
    // policy from preferred to standard — with NO issue emitted.
    const boolPlan: Plan = {
      id: "policy-book-bool",
      version: "1.0.0",
      name: "Boolean-gated location",
      nodes: [
        { id: "flag", kind: "input", params: { fieldName: "sprinklered", fieldType: "boolean" } },
        { id: "flag_out", kind: "output", params: { fieldName: "sprinklered_rated", fieldType: "string" } },
        {
          id: "gate",
          kind: "eligibility.gate",
          params: {
            rules: [
              {
                rule_id: "protected",
                variable: "sprinklered",
                op: "eq",
                value: true,
                tier: "preferred",
                reasoning: "Sprinklered risk.",
              },
            ],
            default_tier: "standard",
            default_reasoning: "Location in appetite.",
            scope: "row",
          },
        },
        { id: "gate_out", kind: "output", params: { fieldName: "row_tier", fieldType: "string" } },
      ],
      edges: [
        { from: { node: "flag", port: "value" }, to: { node: "flag_out", port: "value" } },
        { from: { node: "gate", port: "tier" }, to: { node: "gate_out", port: "value" } },
      ],
    };
    const boolCompiled = compilePlan(boolPlan);
    const run = (sprinklered: unknown) =>
      evaluatePolicyBook(
        boolCompiled,
        [{ policy_id: "P1", location_id: "L1", inputs: { sprinklered } }],
        { rollupFields: [], rowVerdictOutput: "row_tier" },
      );
    const typed = run(true);
    const wire = run("true");
    expect(typed[0]!.appetite.tier).toBe("preferred");
    expect(wire[0]!.appetite.tier).toBe("preferred"); // was "standard" pre-fix
    expect(wire).toEqual(typed);
  });

  it("a gate-ONLY boolean variable (no consumer, so no input port) still coerces — the rule's own RHS types it at the seam", () => {
    // The residual of the same-day fix above: input ports are created
    // ON DEMAND by consumers, so a declared-bool field that ONLY the
    // appetite gate reads gets no input node — and the record coercion
    // had no port to key from. Numeric strings survived via the
    // comparator's E3 widening; the boolean wire spelling "true"
    // strictly missed `eq true` and the tier silently flipped — the
    // SAME Law 2 violation class, alive in the port-less shape (the
    // preflight already treats gate variables as consumed-but-never-
    // required, so the shape is legitimate authoring). The gate rule's
    // RHS is the one type declaration the compiled plan still carries
    // for such a variable; the seam types from it. Ports, where one
    // exists, always win.
    const portless: Plan = {
      id: "policy-book-portless",
      version: "1.0.0",
      name: "Gate-only boolean variable",
      nodes: [
        { id: "base", kind: "input", params: { fieldName: "base_premium", fieldType: "money" } },
        { id: "base_out", kind: "output", params: { fieldName: "premium", fieldType: "money" } },
        {
          id: "gate",
          kind: "eligibility.gate",
          params: {
            rules: [
              {
                rule_id: "sprinklered_only",
                variable: "sprinklered_only_gate",
                op: "eq",
                value: true,
                tier: "preferred",
                reasoning: "Fully sprinklered occupancy.",
              },
            ],
            default_tier: "standard",
            default_reasoning: "Location in appetite.",
            scope: "row",
          },
        },
        { id: "gate_out", kind: "output", params: { fieldName: "row_tier", fieldType: "string" } },
      ],
      edges: [
        { from: { node: "base", port: "value" }, to: { node: "base_out", port: "value" } },
        { from: { node: "gate", port: "tier" }, to: { node: "gate_out", port: "value" } },
      ],
    };
    const portlessCompiled = compilePlan(portless);
    const run = (sprinklered_only_gate: unknown) =>
      evaluatePolicyBook(
        portlessCompiled,
        [{ policy_id: "P1", location_id: "L1", inputs: { base_premium: 500, sprinklered_only_gate } }],
        { rollupFields: [], rowVerdictOutput: "row_tier" },
      );
    const typed = run(true);
    const wire = run("true");
    expect(typed[0]!.appetite.tier).toBe("preferred");
    expect(wire[0]!.appetite.tier).toBe("preferred"); // was "standard" pre-fix — the tier flipped on JSON typing
    expect(wire).toEqual(typed);
  });

  it("mixed-type references to a port-less variable cancel — the record stays raw", () => {
    // The fallback's conservatism guard (the conflicting-ports rule,
    // applied to rule RHS evidence): when the SAME port-less variable
    // is compared against a boolean in one rule and a mixed string
    // list in another, the authoring is ambiguous — the seam refuses
    // to guess and the record value stays raw. Since the FCA boolean
    // widening, the comparator itself bridges the LITERAL spellings
    // ('true' matches `eq true` raw or typed — that's the dead-knock-
    // out fix), so the cancellation's observable effect lives in the
    // NON-literal spellings: 'yes' would coerce to true under an
    // unambiguous boolean gate, but stays raw — and matches nothing —
    // here.
    const mixed: Plan = {
      id: "policy-book-mixed-rhs",
      version: "1.0.0",
      name: "Ambiguously-typed gate variable",
      nodes: [
        {
          id: "gate",
          kind: "eligibility.gate",
          params: {
            rules: [
              {
                rule_id: "bool_authored",
                variable: "flag",
                op: "eq",
                value: true,
                tier: "preferred",
                reasoning: "Boolean-authored rule.",
              },
              {
                rule_id: "string_authored",
                variable: "flag",
                op: "in",
                value: ["true", "maybe"],
                tier: "submit",
                reasoning: "String-authored rule.",
              },
            ],
            default_tier: "standard",
            default_reasoning: "No rule matched.",
            scope: "row",
          },
        },
        { id: "gate_out", kind: "output", params: { fieldName: "row_tier", fieldType: "string" } },
      ],
      edges: [
        { from: { node: "gate", port: "tier" }, to: { node: "gate_out", port: "value" } },
      ],
    };
    const mixedCompiled = compilePlan(mixed);
    const run = (flag: unknown) =>
      evaluatePolicyBook(
        mixedCompiled,
        [{ policy_id: "P1", location_id: "L1", inputs: { flag } }],
        { rollupFields: [], rowVerdictOutput: "row_tier" },
      );
    // Typed caller: the boolean rule fires first — byte-identical to before.
    expect(run(true)[0]!.appetite.tier).toBe("preferred");
    // Wire caller, literal spelling: the comparator's boolean seam
    // matches `eq true` against 'true' (first rule in walk order) —
    // the workbook-built knock-out fires with or without coercion.
    expect(run("true")[0]!.appetite.tier).toBe("preferred");
    // Wire caller, NON-literal spelling: ambiguous evidence means no
    // coercion — 'yes' stays raw and matches neither rule (under an
    // unambiguous boolean gate it would coerce and match).
    expect(run("yes")[0]!.appetite.tier).toBe("standard");
  });
});
