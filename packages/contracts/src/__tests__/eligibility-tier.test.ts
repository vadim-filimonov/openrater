/**
 * Brief 55 — RunResult.eligibility_tier + resolveEligibilityTier.
 *
 * The conformance vectors (V39/V40/V41) pin the gate's OUTPUT-node
 * values (portable, integrator-facing). This suite pins the new
 * engine surface the conformance runner doesn't assert on:
 *
 *   - `resolveEligibilityTier(trace)` — the pure resolver (0 / 1 / N
 *     gates; the Brief-42 Q10 precedence; robustness to non-gate +
 *     malformed entries).
 *   - `RunResult.eligibility_tier` — that `runPlan` populates it, and
 *     that a gate-less plan keeps the field `null` (full back-compat).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { executePlan, resolveEligibilityTier } from "../runtime";
import type { TraceEntry } from "../plan-types";
import type { EligibilityTier } from "../tier-types";
import { _clearRegistryForTests } from "../registry";
import { registerBuiltinKinds } from "../kinds";
import type { Plan } from "../plan-types";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** Gate trace entry that fell through to its default (no rule fired). */
function gateEntry(tier: EligibilityTier): TraceEntry {
  return {
    kindId: "eligibility.gate",
    inputs: {},
    outputs: { tier, matched_rule_id: null },
  };
}

/** Gate trace entry whose rule FIRED (matched_rule_id is set). */
function matchedGate(tier: EligibilityTier, ruleId = "r0"): TraceEntry {
  return {
    kindId: "eligibility.gate",
    inputs: {},
    outputs: { tier, matched_rule_id: ruleId },
  };
}

/** A single-gate plan: one rule (variable op value -> tier) + default. */
function gatePlan(
  rule: { variable: string; op: string; value: unknown; tier: EligibilityTier },
  defaultTier: EligibilityTier,
): Plan {
  return {
    id: "t.gate",
    version: "1.0.0",
    name: "gate test",
    lines: ["bop"],
    effective: "2025-10-01",
    nodes: [
      {
        id: "gate",
        kind: "eligibility.gate",
        params: {
          rules: [
            {
              rule_id: "r0",
              variable: rule.variable,
              op: rule.op,
              value: rule.value,
              tier: rule.tier,
              reasoning: "test rule",
            },
          ],
          default_tier: defaultTier,
          default_reasoning: "test default",
        },
        position: { x: 0, y: 0 },
      },
      {
        id: "out_tier",
        kind: "output",
        params: { fieldName: "tier", fieldType: "string" },
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        from: { node: "gate", port: "tier" },
        to: { node: "out_tier", port: "value" },
      },
    ],
  } as Plan;
}

describe("resolveEligibilityTier (pure)", () => {
  it("returns null when there are no eligibility.gate entries", () => {
    const trace: Record<string, TraceEntry> = {
      k: { kindId: "constant", inputs: {}, outputs: { value: 1 } },
      out: { kindId: "output", inputs: { value: 1 }, outputs: {} },
    };
    expect(resolveEligibilityTier(trace)).toBeNull();
  });

  it("returns the single gate's tier verbatim", () => {
    for (const t of ["preferred", "standard", "submit", "decline"] as const) {
      expect(resolveEligibilityTier({ gate: gateEntry(t) })).toBe(t);
    }
  });

  it("resolves multiple gates by precedence decline > submit > standard > preferred", () => {
    expect(
      resolveEligibilityTier({
        a: gateEntry("preferred"),
        b: gateEntry("standard"),
      }),
    ).toBe("standard");
    expect(
      resolveEligibilityTier({
        a: gateEntry("preferred"),
        b: gateEntry("submit"),
        c: gateEntry("standard"),
      }),
    ).toBe("submit");
    expect(
      resolveEligibilityTier({
        a: gateEntry("submit"),
        b: gateEntry("decline"),
        c: gateEntry("preferred"),
      }),
    ).toBe("decline");
  });

  it("is order-independent (precedence, not first-seen)", () => {
    expect(
      resolveEligibilityTier({ a: gateEntry("decline"), b: gateEntry("preferred") }),
    ).toBe("decline");
    expect(
      resolveEligibilityTier({ a: gateEntry("preferred"), b: gateEntry("decline") }),
    ).toBe("decline");
  });

  // Brief 55 §3.3 — a FIRED rule beats a default fallback, so a matched
  // `preferred` credit is not masked by another gate's `standard` default.
  it("a matched verdict is NOT masked by another gate's default fallback", () => {
    expect(
      resolveEligibilityTier({
        floor: gateEntry("standard"), // fell through to default
        credit: matchedGate("preferred", "pref_credit"), // fired
      }),
    ).toBe("preferred");
  });

  it("among FIRED rules the most-restrictive wins (submit beats preferred)", () => {
    expect(
      resolveEligibilityTier({
        floor: matchedGate("submit", "floor_area_cap"),
        credit: matchedGate("preferred", "pref_credit"),
      }),
    ).toBe("submit");
  });

  it("a fired decline dominates a fired preferred", () => {
    expect(
      resolveEligibilityTier({
        knock: matchedGate("decline", "ineligible_class"),
        credit: matchedGate("preferred", "pref_credit"),
      }),
    ).toBe("decline");
  });

  it("falls back to the most-restrictive default only when NO gate fired", () => {
    expect(
      resolveEligibilityTier({ a: gateEntry("standard"), b: gateEntry("standard") }),
    ).toBe("standard");
  });

  it("ignores non-gate entries and malformed/absent tier outputs", () => {
    const trace: Record<string, TraceEntry> = {
      chain: { kindId: "chain.mult", inputs: {}, outputs: { value: 1 } },
      bogus: { kindId: "eligibility.gate", inputs: {}, outputs: { tier: "exotic" } },
      empty: { kindId: "eligibility.gate", inputs: {}, outputs: {} },
      real: gateEntry("submit"),
    };
    expect(resolveEligibilityTier(trace)).toBe("submit");
  });
});

describe("RunResult.eligibility_tier (runPlan integration)", () => {
  it("is populated from the gate when a rule fires", () => {
    const plan = gatePlan(
      { variable: "total_floor_area_sqft", op: "gt", value: 35000, tier: "submit" },
      "standard",
    );
    const r = executePlan(plan, { total_floor_area_sqft: 42000 });
    expect(r.outputs.tier).toBe("submit");
    expect(r.eligibility_tier).toBe("submit");
  });

  it("falls back to the gate's default_tier when no rule matches", () => {
    const plan = gatePlan(
      { variable: "total_floor_area_sqft", op: "gt", value: 35000, tier: "submit" },
      "standard",
    );
    const r = executePlan(plan, { total_floor_area_sqft: 9000 });
    expect(r.outputs.tier).toBe("standard");
    expect(r.eligibility_tier).toBe("standard");
  });

  it("is null for a plan with no eligibility.gate (back-compat)", () => {
    const plan: Plan = {
      id: "t.nogate",
      version: "1.0.0",
      name: "no gate",
      lines: ["bop"],
      effective: "2025-10-01",
      nodes: [
        { id: "k", kind: "constant", params: { value: 1.25, type: "factor" }, position: { x: 0, y: 0 } },
        { id: "out", kind: "output", params: { fieldName: "factor", fieldType: "float" }, position: { x: 200, y: 0 } },
      ],
      edges: [{ from: { node: "k", port: "value" }, to: { node: "out", port: "value" } }],
    } as Plan;
    const r = executePlan(plan, {});
    expect(r.outputs.factor).toBe(1.25);
    expect(r.eligibility_tier).toBeNull();
  });
});
