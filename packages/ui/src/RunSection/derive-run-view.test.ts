/**
 * deriveRunView — V4 audit G2 regression tests.
 *
 * The live bug (verified 2026-07-05): the Test tab summed EVERY numeric
 * output for its headline, so the Sample BOP sample showed $1,672 while
 * its own breakdown read building $640 + bpp $196 + liability $0 =
 * total $836.
 */

import { describe, it, expect } from "vitest";
import {
  deriveRunView,
  formatRunPremium,
} from "./derive-run-view";

/** A projected-plan shape: money outputs per coverage + the aggregate. */
const moneyOutput = (fieldName: string) => ({
  kind: "output",
  params: { fieldName, fieldType: "money" },
});

const SAMPLE_BOP_PLAN = {
  nodes: [
    { kind: "input", params: {} },
    moneyOutput("building_premium"),
    moneyOutput("bpp_premium"),
    moneyOutput("liability_premium"),
    // Diagnostics never enter the premium math.
    { kind: "output", params: { fieldName: "irpm_factor_used", fieldType: "number" } },
    // The round tail's aggregate — emitted last by the projector.
    moneyOutput("total_premium"),
  ],
};

const SAMPLE_BOP_OUTPUTS: Record<string, unknown> = {
  building_premium: 640,
  bpp_premium: 196,
  liability_premium: 0,
  irpm_factor_used: 1.05,
  total_premium: 836,
};

describe("deriveRunView", () => {
  it("headline == total_premium for a multi-output plan (no double-count)", () => {
    const view = deriveRunView(SAMPLE_BOP_PLAN, SAMPLE_BOP_OUTPUTS);
    expect(view).not.toBeNull();
    expect(view!.premium).toBe(836);
    expect(view!.premiumLabel).toBe("$836");
    // The regression: the old sum-everything headline read $1,672.
    expect(view!.premium).not.toBe(1672);
  });

  it("lists per-coverage rows in tower order, without the aggregate", () => {
    const view = deriveRunView(SAMPLE_BOP_PLAN, SAMPLE_BOP_OUTPUTS)!;
    expect(view.outputs.map((o) => o.field)).toEqual([
      "building_premium",
      "bpp_premium",
      "liability_premium",
    ]);
  });

  it("formats every row with the same currency rule ($0, not $0.00)", () => {
    const view = deriveRunView(SAMPLE_BOP_PLAN, SAMPLE_BOP_OUTPUTS)!;
    expect(view.outputs.map((o) => o.valueLabel)).toEqual([
      "$640",
      "$196",
      "$0",
    ]);
  });

  it("excludes non-money diagnostics from rows and math", () => {
    const view = deriveRunView(SAMPLE_BOP_PLAN, SAMPLE_BOP_OUTPUTS)!;
    expect(view.outputs.some((o) => o.field === "irpm_factor_used")).toBe(
      false,
    );
  });

  it("sums the coverage outputs when the plan has no aggregate", () => {
    const plan = {
      nodes: [moneyOutput("building_premium"), moneyOutput("bpp_premium")],
    };
    const view = deriveRunView(plan, {
      building_premium: 640,
      bpp_premium: 196,
    })!;
    expect(view.premium).toBe(836);
    expect(view.outputs).toHaveLength(2);
  });

  it("honors a custom aggregate field name from the round tail", () => {
    const plan = {
      nodes: [moneyOutput("do_premium"), moneyOutput("policy_total")],
    };
    const view = deriveRunView(
      plan,
      { do_premium: 500, policy_total: 500 },
      "policy_total",
    )!;
    expect(view.premium).toBe(500);
    expect(view.outputs.map((o) => o.field)).toEqual(["do_premium"]);
  });

  it("falls back to numeric outputs when no output node is money-typed", () => {
    const view = deriveRunView({ nodes: [] }, {
      do_premium: 450,
      total_premium: 450,
      notes: "unrated",
    })!;
    // The aggregate exclusion still guards the double-count.
    expect(view.premium).toBe(450);
    expect(view.outputs.map((o) => o.field)).toEqual(["do_premium"]);
  });

  it("returns null when the run produced nothing numeric", () => {
    expect(deriveRunView(SAMPLE_BOP_PLAN, {})).toBeNull();
    expect(deriveRunView(SAMPLE_BOP_PLAN, { note: "n/a" })).toBeNull();
  });
});

describe("formatRunPremium", () => {
  it("whole dollars by default, cents only when present", () => {
    expect(formatRunPremium(836)).toBe("$836");
    expect(formatRunPremium(0)).toBe("$0");
    expect(formatRunPremium(12.5)).toBe("$12.50");
    expect(formatRunPremium(4731)).toBe("$4,731");
  });
});
