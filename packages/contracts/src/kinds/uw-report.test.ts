/**
 * `uw.report` kind tests (M1.4, Brief 7).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { UwReportKind } from "./uw-report";
import { OutputKind } from "./output";
import { executePlan } from "../runtime";
import { _clearRegistryForTests, globalRegistry } from "../registry";
import type { Plan } from "../plan-types";
import type { UwReport } from "../report-types";

const REPORT: UwReport = {
  report_id: "uw_test_001",
  generated_at: "2026-05-19T18:00:00Z",
  account_id: "acct_001",
  summary: "Test restaurant",
  adjustments: [
    {
      adjustment_id: "adj_1",
      category: "Safety devices",
      value_pct: -5,
      reasoning: "Monitored sprinklers",
      accepted: true,
    },
    {
      adjustment_id: "adj_2",
      category: "Premises maintenance",
      value_pct: 3,
      reasoning: "Tired interior",
      accepted: false,
    },
  ],
  sources: [
    { name: "google_business_profile", fetched_at: "2026-05-19T17:30:00Z" },
  ],
};

describe("UwReportKind — contract surface", () => {
  it("has correct id + category + ports + defaults", () => {
    expect(UwReportKind.id).toBe("uw.report");
    expect(UwReportKind.category).toBe("input");
    expect(UwReportKind.inputs).toHaveLength(0);
    expect(UwReportKind.outputs).toHaveLength(1);
    expect(UwReportKind.outputs[0]?.name).toBe("report");
    expect(UwReportKind.defaultParams.reportFieldName).toBe("uw_report");
  });

  it("validate rejects empty reportFieldName", () => {
    const r = UwReportKind.validate?.({ reportFieldName: "  " });
    expect(r?.valid).toBe(false);
    expect(r?.issues?.[0]?.field).toBe("reportFieldName");
  });

  it("validate accepts default + custom reportFieldName", () => {
    expect(
      UwReportKind.validate?.(UwReportKind.defaultParams),
    ).toEqual({ valid: true, issues: [] });
    expect(
      UwReportKind.validate?.({ reportFieldName: "uw_report_property" }),
    ).toEqual({ valid: true, issues: [] });
  });
});

describe("uw.report — runtime", () => {
  function makePlan(fieldName = "uw_report"): Plan {
    return {
      id: "test.uw.report",
      version: "0.1.0",
      name: "Test",
      nodes: [
        {
          id: "rpt",
          kind: "uw.report",
          params: { reportFieldName: fieldName },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "report", fieldType: "record" },
        },
      ],
      edges: [
        {
          from: { node: "rpt", port: "report" },
          to: { node: "out", port: "value" },
        },
      ],
    };
  }

  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(UwReportKind);
    globalRegistry.register(OutputKind);
  });

  it("loads a valid report from externalInputs", () => {
    const result = executePlan(makePlan(), { uw_report: REPORT });
    expect(result.outputs.report).toEqual(REPORT);
    expect(result.trace["rpt"]?.explanation).toMatch(
      /UW Report uw_test_001 loaded: 2 adjustments \(1 accepted\), 1 source/,
    );
  });

  it("returns null when report missing from externalInputs", () => {
    const result = executePlan(makePlan(), {});
    expect(result.outputs.report).toBeNull();
    expect(result.trace["rpt"]?.explanation).toMatch(/No UW Report supplied/);
  });

  it("returns null when value is malformed (not a UwReport)", () => {
    const result = executePlan(makePlan(), { uw_report: { not: "a report" } });
    expect(result.outputs.report).toBeNull();
  });

  it("respects a custom reportFieldName", () => {
    const result = executePlan(makePlan("uw_report_property"), {
      uw_report_property: REPORT,
      uw_report: { wrong: "report" }, // should not be picked
    });
    expect(result.outputs.report).toEqual(REPORT);
  });
});
