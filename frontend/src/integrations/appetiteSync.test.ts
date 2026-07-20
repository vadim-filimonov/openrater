/**
 * appetiteSync tests — Brief 70 §3.
 *
 * Pins the document model: scope split, the consolidated flag, the
 * MOST-RESTRICTIVE-FIRST consolidation order (verdict-preserving by
 * construction — the 70 skeptic's landmine), and the config writer's
 * coercion round-trip.
 */

import { describe, expect, it } from "vitest";
import {
  appetiteScopeConfig,
  consolidationOrder,
  planStagesToAppetite,
  type AppetiteRule,
} from "./appetiteSync";

/** Brief 81 — a single-clause rule VM (conditions mirrors the triple). */
function vmRule(r: {
  id: string;
  tier: AppetiteRule["tier"];
  variable: string;
  op: string;
  value: string;
  reasoning?: string;
  citation?: string;
}): AppetiteRule {
  return {
    reasoning: "",
    citation: "",
    ...r,
    conditions: [{ variable: r.variable, op: r.op, value: r.value }],
  };
}

const gate = (
  id: string,
  scope: "row" | "policy",
  rules: Array<Partial<AppetiteRule> & { tier: AppetiteRule["tier"] }>,
  defaultTier = "standard",
) => ({
  stage_id: id,
  stage_kind: "eligibility.gate",
  config_json: {
    scope,
    rules: rules.map((r, i) => ({
      rule_id: r.id ?? `${id}_r${i}`,
      variable: r.variable ?? "x",
      op: r.op ?? "eq",
      value: r.value ?? "1",
      tier: r.tier,
      reasoning: "",
    })),
    default_tier: defaultTier,
    default_reasoning: "none",
  },
});

describe("planStagesToAppetite (Brief 70 §3)", () => {
  it("one stage per scope = consolidated; rules keep STAGE order (first match)", () => {
    const m = planStagesToAppetite([
      gate("g_row", "row", [{ tier: "preferred" }, { tier: "decline" }]),
      gate("g_pol", "policy", [{ tier: "decline" }]),
    ]);
    expect(m.consolidated).toBe(true);
    expect(m.row.stageId).toBe("g_row");
    expect(m.row.rules.map((r) => r.tier)).toEqual([
      "preferred",
      "decline",
    ]);
    expect(m.policy.rules).toHaveLength(1);
  });

  it("multiple stages per scope = LEGACY: the projection orders most-restrictive-first", () => {
    const m = planStagesToAppetite([
      gate("g1", "row", [{ tier: "preferred" }]),
      gate("g2", "row", [{ tier: "decline" }]),
      gate("g3", "row", [{ tier: "submit" }]),
    ]);
    expect(m.consolidated).toBe(false);
    expect(m.row.stageId).toBeNull();
    // The honest read: what resolveEligibilityTier would compose.
    expect(m.row.rules.map((r) => r.tier)).toEqual([
      "decline",
      "submit",
      "preferred",
    ]);
  });

  it("consolidationOrder is verdict-preserving by construction", () => {
    const rules = [
      { id: "a", tier: "preferred" },
      { id: "b", tier: "decline" },
      { id: "c", tier: "standard" },
      { id: "d", tier: "submit" },
    ] as AppetiteRule[];
    expect(consolidationOrder(rules).map((r) => r.tier)).toEqual([
      "decline",
      "submit",
      "standard",
      "preferred",
    ]);
  });

  it("appetiteScopeConfig without a dtype keeps a would-be-mixed list ALL strings (E3)", () => {
    // The old per-entry guess persisted ["0521", 1000000] — a mixed
    // list that could never match consistently (the E3 decline leak).
    const cfg = appetiteScopeConfig(
      "row",
      [
        vmRule({
          id: "r1",
          tier: "decline",
          variable: "class_code",
          op: "in",
          value: "0521, 1000000",
          }),
      ],
      "standard",
    );
    const rule = (cfg.rules as Array<Record<string, unknown>>)[0]!;
    expect(rule.value).toEqual(["0521", "1000000"]);
    expect(cfg.default_tier).toBe("standard");
    expect(cfg.scope).toBe("row");
  });

  it("appetiteScopeConfig still numbers a homogeneous list when no dtype is declared", () => {
    const cfg = appetiteScopeConfig(
      "row",
      [
        vmRule({
          id: "r1",
          tier: "decline",
          variable: "risk_score",
          op: "in",
          value: "9, 10",
          }),
      ],
      "standard",
    );
    const rule = (cfg.rules as Array<Record<string, unknown>>)[0]!;
    expect(rule.value).toEqual([9, 10]);
  });

  it("appetiteScopeConfig persists values AS the declared dtype (E3)", () => {
    const dtypeOf = (variable: string) =>
      variable === "class_code"
        ? "class_code"
        : variable === "tiv"
          ? "money"
          : undefined;
    const cfg = appetiteScopeConfig(
      "row",
      [
        vmRule({
          id: "r1",
          tier: "decline",
          variable: "class_code",
          op: "in",
          // A declared string-ish field keeps EVERY entry verbatim —
          // numeric-looking codes included.
          value: "0521, 60989",
          }),
        vmRule({
          id: "r2",
          tier: "decline",
          variable: "tiv",
          op: "ge",
          value: "1000000",
          }),
      ],
      "standard",
      dtypeOf,
    );
    const rules = cfg.rules as Array<Record<string, unknown>>;
    expect(rules[0]!.value).toEqual(["0521", "60989"]);
    expect(rules[1]!.value).toBe(1000000);
  });

  it("a declared number dtype keeps a non-parsing entry as a string (honest fallback)", () => {
    const cfg = appetiteScopeConfig(
      "row",
      [
        vmRule({
          id: "r1",
          tier: "submit",
          variable: "building_age",
          op: "gt",
          value: "sixty",
          }),
      ],
      "standard",
      () => "int",
    );
    const rule = (cfg.rules as Array<Record<string, unknown>>)[0]!;
    expect(rule.value).toBe("sixty");
  });
});

// ── Brief 81 — compound conditions round-trip ─────────────────────

describe("appetiteSync — compound conditions (Brief 81)", () => {
  it("reads a compound config rule into clauses (first clause mirrored)", () => {
    const m = planStagesToAppetite([
      {
        stage_id: "appetite_location",
        stage_kind: "eligibility.gate",
        config_json: {
          scope: "row",
          rules: [
            {
              rule_id: "contractor_receipts_payroll",
              conditions: [
                { variable: "contractor_receipts", op: "gt", value: 300000 },
                { variable: "liab_exposure_base", op: "eq", value: "payroll" },
              ],
              tier: "decline",
              reasoning: "Filed contractor gate.",
            },
          ],
          default_tier: "standard",
          default_reasoning: "none",
        },
      },
    ]);
    const r = m.row.rules[0]!;
    expect(r.conditions).toHaveLength(2);
    expect(r.conditions[0]).toEqual({
      variable: "contractor_receipts",
      op: "gt",
      value: "300000",
    });
    // The first clause mirrors onto the top-level triple.
    expect(r.variable).toBe("contractor_receipts");
    expect(r.op).toBe("gt");
    expect(r.value).toBe("300000");
  });

  it("writes ≥2 clauses as conditions[] with PER-CLAUSE dtype coercion", () => {
    const dtypeOf = (v: string) =>
      v === "contractor_receipts" ? "money" : v === "liab_exposure_base" ? "string" : undefined;
    const cfg = appetiteScopeConfig(
      "row",
      [
        {
          id: "contractor_receipts_payroll",
          tier: "decline",
          variable: "contractor_receipts",
          op: "gt",
          value: "300000",
          conditions: [
            { variable: "contractor_receipts", op: "gt", value: "300000" },
            { variable: "liab_exposure_base", op: "eq", value: "payroll" },
          ],
          reasoning: "Filed contractor gate.",
          citation: "",
        },
      ],
      "standard",
      dtypeOf,
    );
    const rule = (cfg.rules as Array<Record<string, unknown>>)[0]!;
    // The compound shape persists — no inline triple.
    expect(rule.variable).toBeUndefined();
    expect(rule.conditions).toEqual([
      { variable: "contractor_receipts", op: "gt", value: 300000 },
      { variable: "liab_exposure_base", op: "eq", value: "payroll" },
    ]);
  });

  it("ONE clause persists the V1 bytes (Brief 81 D-B — no shape rewrite)", () => {
    const cfg = appetiteScopeConfig(
      "row",
      [
        vmRule({
          id: "r1",
          tier: "decline",
          variable: "class_code",
          op: "in",
          value: "0521, 0522",
        }),
      ],
      "standard",
      () => "class_code",
    );
    const rule = (cfg.rules as Array<Record<string, unknown>>)[0]!;
    expect(rule.variable).toBe("class_code");
    expect(rule.op).toBe("in");
    expect(rule.conditions).toBeUndefined();
  });

  it("a compound rule round-trips read → write byte-equal", () => {
    const stage = {
      stage_id: "appetite_location",
      stage_kind: "eligibility.gate",
      config_json: {
        scope: "row",
        rules: [
          {
            rule_id: "cr",
            conditions: [
              { variable: "contractor_receipts", op: "gt", value: 300000 },
              { variable: "liab_exposure_base", op: "eq", value: "payroll" },
            ],
            tier: "decline",
            reasoning: "Filed contractor gate.",
          },
        ],
        default_tier: "standard",
        default_reasoning: "No appetite rule matched.",
      },
    };
    const m = planStagesToAppetite([stage]);
    const dtypeOf = (v: string) =>
      v === "contractor_receipts" ? "money" : "string";
    const rewritten = appetiteScopeConfig(
      "row",
      m.row.rules,
      m.defaultTier,
      dtypeOf,
    );
    const rule = (rewritten.rules as Array<Record<string, unknown>>)[0]!;
    expect(rule.conditions).toEqual(
      (stage.config_json.rules[0] as Record<string, unknown>).conditions,
    );
    expect(rule.tier).toBe("decline");
  });
});
