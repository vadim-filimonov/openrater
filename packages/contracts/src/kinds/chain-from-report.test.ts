/**
 * `chain.from_report` kind tests (M1.4, Brief 7).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ChainFromReportKind } from "./chain-from-report";
import { UwReportKind } from "./uw-report";
import { OutputKind } from "./output";
import { executePlan } from "../runtime";
import { _clearRegistryForTests, globalRegistry } from "../registry";
import type { Plan } from "../plan-types";
import type { UwReport } from "../report-types";

const REPORT: UwReport = {
  report_id: "uw_test",
  generated_at: "2026-05-19T18:00:00Z",
  account_id: "acct_001",
  summary: "Test",
  adjustments: [
    {
      adjustment_id: "a1",
      category: "Safety",
      value_pct: -5,
      reasoning: "Sprinklers",
      accepted: true,
    },
    {
      adjustment_id: "a2",
      category: "Maintenance",
      value_pct: 3,
      reasoning: "Worn",
      accepted: true,
    },
    {
      adjustment_id: "a3",
      category: "Management",
      value_pct: -5,
      reasoning: "Veteran owner",
      accepted: false, // Not accepted!
    },
  ],
  sources: [],
};

describe("ChainFromReportKind — contract surface", () => {
  it("has correct id + category + outputs", () => {
    expect(ChainFromReportKind.id).toBe("chain.from_report");
    expect(ChainFromReportKind.category).toBe("chain");
    expect(ChainFromReportKind.outputs.map((p) => p.name)).toEqual([
      "factor",
      "applied_pct",
      "applied",
      "cap_hit",
    ]);
  });

  it("default params require_acceptance is true (the no-gimmicks line)", () => {
    expect(ChainFromReportKind.defaultParams.require_acceptance).toBe(true);
  });

  it("validate rejects negative total_cap_pct", () => {
    const r = ChainFromReportKind.validate?.({ total_cap_pct: -1 });
    expect(r?.valid).toBe(false);
    expect(r?.issues?.[0]?.field).toBe("total_cap_pct");
  });
});

describe("ChainFromReportKind — execute semantics", () => {
  it("returns factor 1 when report is null", () => {
    const result = ChainFromReportKind.execute(
      { report: null },
      { require_acceptance: true, total_cap_pct: 100 },
    );
    expect(result.factor).toBe(1);
    expect(result.applied_pct).toBe(0);
    expect(result.applied).toEqual([]);
    expect(result.cap_hit).toBe(false);
  });

  it("applies only accepted adjustments by default (no-gimmicks line)", () => {
    const result = ChainFromReportKind.execute(
      { report: REPORT },
      { require_acceptance: true, total_cap_pct: 100 },
    );
    // -5 + 3 = -2 (a3 has accepted=false, excluded)
    expect(result.applied_pct).toBe(-2);
    expect(result.factor).toBeCloseTo(0.98, 4);
    expect(result.applied).toHaveLength(2);
    expect(result.applied.find((a) => a.adjustment_id === "a3")).toBeUndefined();
  });

  it("applies ALL adjustments when require_acceptance is false (what-if mode)", () => {
    const result = ChainFromReportKind.execute(
      { report: REPORT },
      { require_acceptance: false, total_cap_pct: 100 },
    );
    // -5 + 3 + -5 = -7
    expect(result.applied_pct).toBe(-7);
    expect(result.factor).toBeCloseTo(0.93, 4);
    expect(result.applied).toHaveLength(3);
  });

  it("filters by category_filter", () => {
    const result = ChainFromReportKind.execute(
      { report: REPORT },
      {
        require_acceptance: true,
        total_cap_pct: 100,
        category_filter: ["Safety"],
      },
    );
    // Only Safety: -5
    expect(result.applied_pct).toBe(-5);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.category).toBe("Safety");
  });

  it("clamps to total_cap_pct when sum exceeds it", () => {
    const result = ChainFromReportKind.execute(
      { report: REPORT },
      { require_acceptance: false, total_cap_pct: 5 },
    );
    // Sum is -7, cap 5 → clamped to -5
    expect(result.applied_pct).toBe(-5);
    expect(result.factor).toBeCloseTo(0.95, 4);
    expect(result.cap_hit).toBe(true);
  });

  it("respects citation on applied adjustments", () => {
    const reportWithCite: UwReport = {
      ...REPORT,
      adjustments: [
        {
          adjustment_id: "with_cite",
          category: "X",
          value_pct: -5,
          reasoning: "r",
          citation: "google_business_profile.X",
          accepted: true,
        },
      ],
    };
    const result = ChainFromReportKind.execute(
      { report: reportWithCite },
      { require_acceptance: true, total_cap_pct: 100 },
    );
    expect(result.applied[0]?.citation).toBe("google_business_profile.X");
  });

  it("explainStep summarizes count + cap + factor", () => {
    const result = ChainFromReportKind.execute(
      { report: REPORT },
      { require_acceptance: true, total_cap_pct: 100 },
    );
    const exp = ChainFromReportKind.explainStep?.(
      { report: REPORT },
      { require_acceptance: true, total_cap_pct: 100 },
      result,
    );
    expect(exp).toMatch(/UW Report → 2 adjustments \(accepted-only\)/);
    expect(exp).toMatch(/factor 0\.98/);
  });

  it("explainStep cites no adjustments when none applied", () => {
    const result = ChainFromReportKind.execute(
      { report: null },
      { require_acceptance: true, total_cap_pct: 100 },
    );
    const exp = ChainFromReportKind.explainStep?.(
      { report: null },
      { require_acceptance: true, total_cap_pct: 100 },
      result,
    );
    expect(exp).toMatch(/No UW Report adjustments applied/);
  });
});

describe("chain.from_report — runtime integration with uw.report", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(UwReportKind);
    globalRegistry.register(ChainFromReportKind);
    globalRegistry.register(OutputKind);
  });

  it("wires uw.report → chain.from_report → output", () => {
    const plan: Plan = {
      id: "test.from.report",
      version: "0.1.0",
      name: "Test",
      nodes: [
        { id: "rpt", kind: "uw.report", params: {} },
        {
          id: "expand",
          kind: "chain.from_report",
          params: { require_acceptance: true, total_cap_pct: 100 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "uw_factor", fieldType: "factor" },
        },
      ],
      edges: [
        {
          from: { node: "rpt", port: "report" },
          to: { node: "expand", port: "report" },
        },
        {
          from: { node: "expand", port: "factor" },
          to: { node: "out", port: "value" },
        },
      ],
    };
    const result = executePlan(plan, { uw_report: REPORT });
    // Only accepted (-5 + 3 = -2) → factor 0.98
    expect(result.outputs.uw_factor).toBeCloseTo(0.98, 4);
  });

  it("emits factor 1 when no report is supplied (graceful degrade)", () => {
    const plan: Plan = {
      id: "test.no.report",
      version: "0.1.0",
      name: "Test",
      nodes: [
        { id: "rpt", kind: "uw.report", params: {} },
        {
          id: "expand",
          kind: "chain.from_report",
          params: { require_acceptance: true, total_cap_pct: 100 },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "uw_factor", fieldType: "factor" },
        },
      ],
      edges: [
        {
          from: { node: "rpt", port: "report" },
          to: { node: "expand", port: "report" },
        },
        {
          from: { node: "expand", port: "factor" },
          to: { node: "out", port: "value" },
        },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.outputs.uw_factor).toBe(1);
  });
});
