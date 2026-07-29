/**
 * underwriting ledger tests — pins MVP-009: the compare pairs gate
 * RULES, modifiers, endorsements, loadings across sides and speaks
 * each change in the plan's own words (the T1 gate-diff voice) — the
 * exact gap the sweep's Walk 7 hit ("two plans that differ only in
 * who they decline read as no changes").
 */

import { describe, it, expect } from "vitest";
import { underwritingLedger, type UwStageLike } from "./underwriting";

function gate(rules: unknown[]): UwStageLike {
  return {
    stage_id: "gates",
    stage_kind: "eligibility.gate",
    display_name: "Eligibility",
    config_json: { rules },
  };
}

const RULE_A = {
  rule_id: "decline_big_young",
  tier: "decline",
  conditions: [
    { variable: "annual_gross_sales", op: "gt", value: 5_000_000 },
    { variable: "years_in_business", op: "lt", value: 3 },
  ],
};

describe("underwritingLedger", () => {
  it("speaks a threshold move in variables — the sweep's exact case", () => {
    const a = [gate([RULE_A])];
    const b = [
      gate([
        {
          ...RULE_A,
          conditions: [
            { variable: "annual_gross_sales", op: "gt", value: 5_000_000 },
            { variable: "years_in_business", op: "lt", value: 5 },
          ],
        },
      ]),
    ];
    const ledger = underwritingLedger(a, b);
    expect(ledger.rows).toEqual([
      {
        id: "rule:decline_big_young",
        kind: "rule",
        name: "decline_big_young",
        status: "changed",
        change: "years_in_business threshold 3 → 5",
      },
    ]);
    expect(ledger.changedCount).toBe(1);
  });

  it("unchanged endorsements say so; factor moves are named", () => {
    const endorsement = (factor: number): UwStageLike => ({
      stage_id: "endorsement_equip_breakdown",
      stage_kind: "endorsement.factor",
      display_name: "Equipment breakdown",
      config_json: { display_name: "Equipment breakdown", factor },
    });
    const same = underwritingLedger([endorsement(1.08)], [endorsement(1.08)]);
    expect(same.rows[0]).toMatchObject({
      status: "same",
      change: null,
      name: "Equipment breakdown",
    });
    expect(same.changedCount).toBe(0);

    const moved = underwritingLedger([endorsement(1.08)], [endorsement(1.12)]);
    expect(moved.rows[0]).toMatchObject({
      status: "changed",
      change: "× 1.08 → × 1.12",
    });
  });

  it("modifier caps, loadings, and one-sided rules all surface", () => {
    const modifier = (cap: number): UwStageLike => ({
      stage_id: "schedule_irpm",
      stage_kind: "modifier.schedule",
      config_json: {
        schedule: { display_name: "IRPM", total_cap_pct: cap, categories: [] },
      },
    });
    const loading: UwStageLike = {
      stage_id: "loading_expense",
      stage_kind: "flat_factor",
      display_name: "Expense loading",
      config_json: { factor: 1.06 },
    };
    const ledger = underwritingLedger(
      [modifier(25), loading, gate([RULE_A])],
      [modifier(30), gate([])],
    );
    const byId = new Map(ledger.rows.map((r) => [r.id, r]));
    expect(byId.get("modifier:schedule_irpm")).toMatchObject({
      status: "changed",
      change: "cap ±25% → ±30%",
    });
    expect(byId.get("loading:loading_expense")).toMatchObject({
      status: "retired",
    });
    expect(byId.get("rule:decline_big_young")).toMatchObject({
      status: "retired",
    });
    expect(ledger.changedCount).toBe(3);
  });
});
