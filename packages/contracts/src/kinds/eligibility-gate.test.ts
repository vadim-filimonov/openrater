/**
 * `eligibility.gate` kind tests (M1.3, Brief 10).
 *
 * Two layers:
 *   - Kind-level: contract surface, defaults, validate()
 *   - Runtime-level: rule walking semantics, default fallback,
 *     graceful handling of missing variables, integration with
 *     ctx.externalInputs
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  EligibilityGateKind,
  eligibilityRuleMatches,
  ruleConditions,
} from "./eligibility-gate";
import { OutputKind } from "./output";
import { executePlan } from "../runtime";
import { _clearRegistryForTests, globalRegistry } from "../registry";
import type { Plan } from "../plan-types";
import type { EligibilityRule } from "./eligibility-gate";

const RULES: readonly EligibilityRule[] = [
  {
    rule_id: "new_venture",
    variable: "years_in_business",
    op: "lt",
    value: 1,
    tier: "decline",
    reasoning: "New ventures excluded per appetite guidelines.",
  },
  {
    rule_id: "core_market",
    variable: "state",
    op: "in",
    value: ["WI", "MN", "IL"],
    tier: "preferred",
    reasoning: "Core market state.",
  },
  {
    rule_id: "high_revenue",
    variable: "annual_sales",
    op: "gt",
    value: 5_000_000,
    tier: "submit",
    reasoning: "High-revenue accounts require manual review.",
  },
];

describe("EligibilityGateKind — contract surface", () => {
  it("has correct id + category + outputs", () => {
    expect(EligibilityGateKind.id).toBe("eligibility.gate");
    expect(EligibilityGateKind.category).toBe("transform");
    expect(EligibilityGateKind.inputs).toHaveLength(0);
    expect(EligibilityGateKind.outputs).toHaveLength(3);
    expect(EligibilityGateKind.outputs.map((p) => p.name)).toEqual([
      "tier",
      "matched_rule_id",
      "reasoning",
    ]);
  });

  it("default params place a sensible default_tier (submit)", () => {
    expect(EligibilityGateKind.defaultParams.default_tier).toBe("submit");
    expect(EligibilityGateKind.defaultParams.rules).toEqual([]);
  });

  it("E03/D4 — scope is additive: a policy-scope gate is valid + execute is unchanged", () => {
    const params = {
      rules: [],
      default_tier: "standard" as const,
      default_reasoning: "ok",
      scope: "policy" as const,
    };
    expect(EligibilityGateKind.validate?.(params).valid).toBe(true);
    // The per-row execute ignores `scope` (the batch orchestrator evaluates a
    // policy gate); a default-only gate returns its default tier either way.
    const ctx = { as_of: "2026-01-01", externalInputs: {} };
    const withScope = EligibilityGateKind.execute({}, params, ctx);
    const withoutScope = EligibilityGateKind.execute(
      {},
      { rules: [], default_tier: "standard", default_reasoning: "ok" },
      ctx,
    );
    expect(withScope).toEqual(withoutScope);
  });

  it("validate rejects empty default_tier", () => {
    const result = EligibilityGateKind.validate?.({
      rules: [],
      // @ts-expect-error — testing runtime invariant
      default_tier: "",
      default_reasoning: "stub",
    });
    expect(result?.valid).toBe(false);
    expect(result?.issues?.[0]?.field).toBe("default_tier");
  });

  it("validate rejects empty default_reasoning", () => {
    const result = EligibilityGateKind.validate?.({
      rules: [],
      default_tier: "standard",
      default_reasoning: "   ",
    });
    expect(result?.valid).toBe(false);
    expect(result?.issues?.[0]?.field).toBe("default_reasoning");
  });

  it("validate rejects duplicate rule_ids", () => {
    const result = EligibilityGateKind.validate?.({
      rules: [
        {
          rule_id: "dup",
          variable: "x",
          op: "eq",
          value: 1,
          tier: "standard",
          reasoning: "r",
        },
        {
          rule_id: "dup",
          variable: "y",
          op: "eq",
          value: 1,
          tier: "preferred",
          reasoning: "r",
        },
      ],
      default_tier: "standard",
      default_reasoning: "d",
    });
    expect(result?.valid).toBe(false);
    expect(result?.issues?.[0]?.message).toMatch(/Duplicate rule_id/);
  });

  it("validate rejects rules with empty variable", () => {
    const result = EligibilityGateKind.validate?.({
      rules: [
        {
          rule_id: "r1",
          variable: "",
          op: "eq",
          value: 1,
          tier: "standard",
          reasoning: "r",
        },
      ],
      default_tier: "standard",
      default_reasoning: "d",
    });
    expect(result?.valid).toBe(false);
    expect(result?.issues?.[0]?.message).toMatch(/missing a variable name/);
  });
});

describe("eligibility.gate — runtime semantics", () => {
  function makePlan(): Plan {
    return {
      id: "test.eligibility",
      version: "0.1.0",
      name: "Eligibility test",
      nodes: [
        {
          id: "gate",
          kind: "eligibility.gate",
          params: {
            rules: RULES,
            default_tier: "standard",
            default_reasoning: "Standard appetite, no special handling.",
          },
        },
        {
          id: "out_tier",
          kind: "output",
          params: { fieldName: "tier", fieldType: "string" },
        },
        {
          id: "out_reason",
          kind: "output",
          params: { fieldName: "reasoning", fieldType: "string" },
        },
      ],
      edges: [
        {
          from: { node: "gate", port: "tier" },
          to: { node: "out_tier", port: "value" },
        },
        {
          from: { node: "gate", port: "reasoning" },
          to: { node: "out_reason", port: "value" },
        },
      ],
    };
  }

  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(EligibilityGateKind);
    globalRegistry.register(OutputKind);
  });

  it("returns the first matching rule's tier", () => {
    const result = executePlan(makePlan(), {
      years_in_business: 5,
      state: "WI",
      annual_sales: 1_000_000,
    });
    expect(result.outputs.tier).toBe("preferred"); // core_market rule
    expect(result.outputs.reasoning).toBe("Core market state.");
    expect(result.trace["gate"]?.outputs.matched_rule_id).toBe("core_market");
  });

  it("first-match wins — declines a new venture even if state is core", () => {
    // years_in_business < 1 fires BEFORE state in core_market
    const result = executePlan(makePlan(), {
      years_in_business: 0.5,
      state: "WI",
      annual_sales: 1_000_000,
    });
    expect(result.outputs.tier).toBe("decline");
    expect(result.trace["gate"]?.outputs.matched_rule_id).toBe("new_venture");
  });

  it("falls back to default_tier when no rule matches", () => {
    const result = executePlan(makePlan(), {
      years_in_business: 10,
      state: "TX",
      annual_sales: 1_000_000,
    });
    expect(result.outputs.tier).toBe("standard");
    expect(result.outputs.reasoning).toBe(
      "Standard appetite, no special handling.",
    );
    expect(result.trace["gate"]?.outputs.matched_rule_id).toBeNull();
  });

  it("handles missing variables gracefully (skips that rule)", () => {
    // state is missing → core_market rule doesn't fire → falls through
    // to high_revenue
    const result = executePlan(makePlan(), {
      years_in_business: 10,
      annual_sales: 8_000_000,
    });
    expect(result.outputs.tier).toBe("submit");
    expect(result.trace["gate"]?.outputs.matched_rule_id).toBe("high_revenue");
  });

  it("explainStep produces an actuary-readable sentence", () => {
    const result = executePlan(makePlan(), {
      years_in_business: 10,
      state: "WI",
      annual_sales: 1_000_000,
    });
    expect(result.trace["gate"]?.explanation).toMatch(/core_market/);
    expect(result.trace["gate"]?.explanation).toMatch(/Preferred/);
    expect(result.trace["gate"]?.explanation).toMatch(/Core market state/);
  });

  it("explainStep cites 'No rule matched' when default fires", () => {
    const result = executePlan(makePlan(), {
      years_in_business: 10,
      state: "TX",
      annual_sales: 1_000_000,
    });
    expect(result.trace["gate"]?.explanation).toMatch(/No rule matched/);
    expect(result.trace["gate"]?.explanation).toMatch(/Standard/);
  });

  it("handles empty-rules gate gracefully (default always fires)", () => {
    const plan: Plan = {
      id: "test.empty",
      version: "0.1.0",
      name: "Empty rules",
      nodes: [
        {
          id: "gate",
          kind: "eligibility.gate",
          params: {
            rules: [],
            default_tier: "submit",
            default_reasoning: "Manual review required.",
          },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "tier", fieldType: "string" },
        },
      ],
      edges: [
        {
          from: { node: "gate", port: "tier" },
          to: { node: "out", port: "value" },
        },
      ],
    };
    const result = executePlan(plan, { anything: "value" });
    expect(result.outputs.tier).toBe("submit");
  });
});

// ── Brief 81 (finding E8) — compound AND conditions ───────────────

describe("eligibilityRuleMatches — Brief 81 compound conditions", () => {
  const COMPOUND: EligibilityRule = {
    rule_id: "contractor_receipts_payroll",
    conditions: [
      { variable: "contractor_receipts", op: "gt", value: 300000 },
      { variable: "liab_exposure_base", op: "eq", value: "payroll" },
    ],
    tier: "decline",
    reasoning: "Receipts over $300k on a payroll-rated class.",
  };
  const SINGLE: EligibilityRule = {
    rule_id: "new_venture",
    variable: "years_in_business",
    op: "lt",
    value: 1,
    tier: "decline",
    reasoning: "New ventures excluded.",
  };

  it("a compound rule matches only when EVERY condition holds", () => {
    expect(
      eligibilityRuleMatches(COMPOUND, {
        contractor_receipts: 300001,
        liab_exposure_base: "payroll",
      }),
    ).toBe(true);
    // The E8 boundary: receipts at exactly the threshold do NOT fire.
    expect(
      eligibilityRuleMatches(COMPOUND, {
        contractor_receipts: 300000,
        liab_exposure_base: "payroll",
      }),
    ).toBe(false);
    // Receipts alone (loi basis) do NOT fire — this is the AND the
    // N-same-tier-rules projection could never encode.
    expect(
      eligibilityRuleMatches(COMPOUND, {
        contractor_receipts: 5_000_000,
        liab_exposure_base: "loi",
      }),
    ).toBe(false);
  });

  it("a missing variable in ANY condition is a graceful no-match", () => {
    expect(
      eligibilityRuleMatches(COMPOUND, { contractor_receipts: 400000 }),
    ).toBe(false);
    expect(eligibilityRuleMatches(COMPOUND, {})).toBe(false);
  });

  it("a V1 single rule matches exactly as before through the matcher", () => {
    expect(eligibilityRuleMatches(SINGLE, { years_in_business: 0 })).toBe(true);
    expect(eligibilityRuleMatches(SINGLE, { years_in_business: 5 })).toBe(
      false,
    );
    expect(eligibilityRuleMatches(SINGLE, {})).toBe(false);
  });

  it("an EMPTY conditions list never matches", () => {
    const empty: EligibilityRule = {
      rule_id: "degenerate",
      conditions: [],
      tier: "decline",
      reasoning: "",
    };
    expect(eligibilityRuleMatches(empty, { anything: 1 })).toBe(false);
  });

  it("ruleConditions views both shapes as one list", () => {
    expect(ruleConditions(COMPOUND)).toHaveLength(2);
    expect(ruleConditions(SINGLE)).toEqual([
      { variable: "years_in_business", op: "lt", value: 1 },
    ]);
  });

  it("execute fires a compound rule first-match like any other", () => {
    const out = EligibilityGateKind.execute(
      {},
      {
        rules: [COMPOUND, SINGLE],
        default_tier: "standard",
        default_reasoning: "Standard.",
      },
      {
        as_of: "2026-01-01",
        externalInputs: {
          contractor_receipts: 300001,
          liab_exposure_base: "payroll",
          years_in_business: 0,
        },
      },
    );
    expect(out.tier).toBe("decline");
    expect(out.matched_rule_id).toBe("contractor_receipts_payroll");
  });

  it("explainStep reads a compound rule's clauses joined by 'and'", () => {
    const line = EligibilityGateKind.explainStep!(
      {},
      {
        rules: [COMPOUND],
        default_tier: "standard",
        default_reasoning: "Standard.",
      },
      {
        tier: "decline",
        matched_rule_id: "contractor_receipts_payroll",
        reasoning: COMPOUND.reasoning,
      },
    );
    expect(line).toContain("contractor_receipts gt 300000");
    expect(line).toContain(" and ");
    expect(line).toContain('liab_exposure_base eq "payroll"');
  });

  it("validate — exactly one shape; compound needs non-empty, named conditions", () => {
    const base = { default_tier: "standard" as const, default_reasoning: "d" };
    // Both shapes on one rule (runtime data) → error.
    const both = EligibilityGateKind.validate!({
      ...base,
      rules: [
        {
          rule_id: "r",
          variable: "x",
          op: "eq",
          value: 1,
          conditions: [{ variable: "y", op: "eq", value: 2 }],
          tier: "decline",
          reasoning: "",
        } as unknown as EligibilityRule,
      ],
    });
    expect(both.valid).toBe(false);
    // Empty conditions → error.
    const empty = EligibilityGateKind.validate!({
      ...base,
      rules: [
        { rule_id: "r", conditions: [], tier: "decline", reasoning: "" },
      ],
    });
    expect(empty.valid).toBe(false);
    // A condition without a variable → error.
    const unnamed = EligibilityGateKind.validate!({
      ...base,
      rules: [
        {
          rule_id: "r",
          conditions: [{ variable: " ", op: "eq", value: 1 }],
          tier: "decline",
          reasoning: "",
        },
      ],
    });
    expect(unnamed.valid).toBe(false);
    // A well-formed compound rule → valid.
    const ok = EligibilityGateKind.validate!({ ...base, rules: [COMPOUND] });
    expect(ok.valid).toBe(true);
  });
});
