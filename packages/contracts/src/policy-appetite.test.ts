/**
 * policy-appetite — computed gate field + policy-level gate + tier
 * precedence (E03). The headline test reproduces the stress-test oracle:
 * a 2-location $1.06M policy is IN appetite without declining either
 * sub-$1M location; a single-location $260k policy declines.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateComputedExpr,
  evaluateComputedFields,
  evaluateAppetiteRules,
  mostRestrictiveTier,
  decidePolicyAppetite,
  type ComputedExpr,
  type ComputedField,
  type ScopedVerdict,
} from "./policy-appetite";
import {
  eligibilityRuleMatches,
  type EligibilityRule,
} from "./kinds/eligibility-gate";

// ── (a) computed field ──────────────────────────────────────────────

describe("evaluateComputedExpr", () => {
  const inputs = { building_limit: 850000, bpp_limit: 210000 };

  it("tiv = building_limit + bpp_limit (the headline derived field)", () => {
    const tiv: ComputedExpr = {
      kind: "op",
      op: "+",
      left: { kind: "input", name: "building_limit" },
      right: { kind: "input", name: "bpp_limit" },
    };
    expect(evaluateComputedExpr(tiv, inputs)).toBe(1060000);
  });

  it("absent / non-numeric input is 0; division by zero is 0 (total)", () => {
    expect(evaluateComputedExpr({ kind: "input", name: "missing" }, inputs)).toBe(0);
    expect(evaluateComputedExpr({ kind: "input", name: "x" }, { x: "nope" })).toBe(0);
    expect(
      evaluateComputedExpr(
        { kind: "op", op: "/", left: { kind: "const", value: 10 }, right: { kind: "const", value: 0 } },
        inputs,
      ),
    ).toBe(0);
  });

  it("coerces a numeric STRING input — CSV/form rows arrive as strings", () => {
    const tiv = {
      kind: "op" as const,
      op: "+" as const,
      left: { kind: "input" as const, name: "building_limit" },
      right: { kind: "input" as const, name: "bpp_limit" },
    };
    // Raw book row values are strings (with thousands commas).
    expect(evaluateComputedExpr(tiv, { building_limit: "800,000", bpp_limit: "50000" })).toBe(
      850_000,
    );
  });

  it("nests + references earlier derived fields in declaration order", () => {
    const fields: ComputedField[] = [
      {
        name: "tiv",
        expr: {
          kind: "op",
          op: "+",
          left: { kind: "input", name: "building_limit" },
          right: { kind: "input", name: "bpp_limit" },
        },
      },
      {
        // tiv_in_millions = tiv / 1_000_000 — references the prior field
        name: "tiv_in_millions",
        expr: {
          kind: "op",
          op: "/",
          left: { kind: "input", name: "tiv" },
          right: { kind: "const", value: 1_000_000 },
        },
      },
    ];
    expect(evaluateComputedFields(fields, inputs)).toEqual({
      tiv: 1060000,
      tiv_in_millions: 1.06,
    });
  });
});

// ── (c) precedence ──────────────────────────────────────────────────

describe("mostRestrictiveTier", () => {
  it("decline > submit > standard > preferred", () => {
    expect(mostRestrictiveTier(["preferred", "standard"])).toBe("standard");
    expect(mostRestrictiveTier(["standard", "submit", "preferred"])).toBe("submit");
    expect(mostRestrictiveTier(["preferred", "decline", "submit"])).toBe("decline");
  });
  it("empty → least-restrictive (preferred)", () => {
    expect(mostRestrictiveTier([])).toBe("preferred");
  });
});

// ── (b) policy gate evaluation ──────────────────────────────────────

const TIV_FLOOR_RULES: readonly EligibilityRule[] = [
  {
    rule_id: "min_policy_tiv",
    variable: "policy_tiv",
    op: "lt",
    value: 1_000_000,
    tier: "decline",
    reasoning: "Policy total insured value below the $1M minimum.",
  },
];

describe("evaluateAppetiteRules", () => {
  it("declines when policy TIV is under the floor; accepts at/above", () => {
    expect(
      evaluateAppetiteRules(TIV_FLOOR_RULES, "standard", "In appetite.", {
        policy_tiv: 260000,
      }).tier,
    ).toBe("decline");
    expect(
      evaluateAppetiteRules(TIV_FLOOR_RULES, "standard", "In appetite.", {
        policy_tiv: 1_060_000,
      }).tier,
    ).toBe("standard");
  });

  it("missing variable skips gracefully → default tier", () => {
    const v = evaluateAppetiteRules(TIV_FLOOR_RULES, "standard", "In appetite.", {});
    expect(v.tier).toBe("standard");
    expect(v.matched_rule_id).toBeNull();
  });
});

// ── End-to-end acceptance (the stress-test oracle) ──────────────────

describe("policy appetite — end-to-end acceptance (E03)", () => {
  // The derived field every location computes: tiv = building + bpp.
  const TIV_FIELD: ComputedField = {
    name: "tiv",
    expr: {
      kind: "op",
      op: "+",
      left: { kind: "input", name: "building_limit" },
      right: { kind: "input", name: "bpp_limit" },
    },
  };

  /** Per-location rows → derive each location's tiv, sum to policy_tiv, run
   *  the policy gate, combine with the (non-declining) per-row verdicts. */
  function decide(locations: readonly Record<string, number>[]) {
    const rowVerdicts: ScopedVerdict[] = locations.map((_loc, i) => ({
      // Per-row appetite is fine for each location individually (no per-row
      // TIV floor) — they return standard. The floor is POLICY-scoped.
      scope: "row",
      location_id: `L${i + 1}`,
      tier: "standard",
      matched_rule_id: null,
      reasoning: "Location in appetite.",
    }));
    const policy_tiv = locations.reduce(
      (sum, loc) => sum + evaluateComputedFields([TIV_FIELD], loc).tiv!,
      0,
    );
    const policyVerdict = evaluateAppetiteRules(
      TIV_FLOOR_RULES,
      "standard",
      "Policy in appetite.",
      { policy_tiv },
    );
    return {
      policy_tiv,
      decision: decidePolicyAppetite([
        ...rowVerdicts,
        { scope: "policy", ...policyVerdict },
      ]),
      rowVerdicts,
    };
  }

  it("2 locations at $850k + $210k → IN appetite ($1.06M), neither location declined", () => {
    const { policy_tiv, decision, rowVerdicts } = decide([
      { building_limit: 800000, bpp_limit: 50000 }, // $850k
      { building_limit: 180000, bpp_limit: 30000 }, // $210k
    ]);
    expect(policy_tiv).toBe(1060000);
    expect(decision.tier).toBe("standard"); // IN appetite
    // The individual sub-$1M locations are NOT declined.
    expect(rowVerdicts.every((v) => v.tier !== "decline")).toBe(true);
  });

  it("single-location $260k policy declines", () => {
    const { policy_tiv, decision } = decide([
      { building_limit: 240000, bpp_limit: 20000 }, // $260k
    ]);
    expect(policy_tiv).toBe(260000);
    expect(decision.tier).toBe("decline");
    expect(decision.deciding?.scope).toBe("policy");
    expect(decision.deciding?.reasoning).toMatch(/\$1M minimum/);
  });
});

// ── Brief 81 (finding E8) — compound rules in the POLICY gate ─────

describe("evaluateAppetiteRules — Brief 81 compound conditions", () => {
  const COMPOUND_POLICY_RULE = {
    rule_id: "big_spread_book",
    conditions: [
      { variable: "tiv", op: "ge" as const, value: 5_000_000 },
      { variable: "location_count", op: "gt" as const, value: 10 },
    ],
    tier: "submit" as const,
    reasoning: "Large TIV across many locations needs review.",
  };

  it("a compound policy rule ANDs its conditions over the rolled totals", () => {
    const hit = evaluateAppetiteRules(
      [COMPOUND_POLICY_RULE],
      "standard",
      "In appetite.",
      { tiv: 6_000_000, location_count: 12 },
    );
    expect(hit.tier).toBe("submit");
    expect(hit.matched_rule_id).toBe("big_spread_book");

    // Either condition alone falls through to the default.
    expect(
      evaluateAppetiteRules([COMPOUND_POLICY_RULE], "standard", "In appetite.", {
        tiv: 6_000_000,
        location_count: 3,
      }).tier,
    ).toBe("standard");
    expect(
      evaluateAppetiteRules([COMPOUND_POLICY_RULE], "standard", "In appetite.", {
        tiv: 100_000,
        location_count: 50,
      }).tier,
    ).toBe("standard");
  });

  it("Law 1 — the policy gate and the row gate agree on the SAME compound rule", () => {
    const inputsHit = { tiv: 6_000_000, location_count: 12 };
    const inputsMiss = { tiv: 6_000_000, location_count: 3 };
    for (const [inputs, expected] of [
      [inputsHit, true],
      [inputsMiss, false],
    ] as const) {
      expect(eligibilityRuleMatches(COMPOUND_POLICY_RULE, inputs)).toBe(
        expected,
      );
      expect(
        evaluateAppetiteRules(
          [COMPOUND_POLICY_RULE],
          "standard",
          "d",
          inputs,
        ).matched_rule_id !== null,
      ).toBe(expected);
    }
  });
});
