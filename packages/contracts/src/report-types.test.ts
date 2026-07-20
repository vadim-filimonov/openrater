/**
 * UW Report shape + guard tests (M1.4, Brief 7).
 */

import { describe, it, expect } from "vitest";
import { isUwReport } from "./report-types";
import type { UwReport } from "./report-types";

const VALID_REPORT: UwReport = {
  report_id: "uw_report_abc",
  generated_at: "2026-05-19T18:00:00Z",
  account_id: "acct_001",
  summary: "Restaurant; 18 yrs in business; clean OSHA.",
  adjustments: [
    {
      adjustment_id: "adj_1",
      category: "Management experience",
      value_pct: -5,
      reasoning: "Owner-operator 18 years",
      accepted: true,
    },
  ],
  sources: [
    {
      name: "google_business_profile",
      fetched_at: "2026-05-19T17:30:00Z",
    },
  ],
};

describe("isUwReport", () => {
  it("accepts a valid report", () => {
    expect(isUwReport(VALID_REPORT)).toBe(true);
  });

  it("rejects null / undefined / non-objects", () => {
    expect(isUwReport(null)).toBe(false);
    expect(isUwReport(undefined)).toBe(false);
    expect(isUwReport("string")).toBe(false);
    expect(isUwReport(42)).toBe(false);
  });

  it("rejects objects missing required fields", () => {
    expect(isUwReport({})).toBe(false);
    expect(
      isUwReport({ ...VALID_REPORT, report_id: undefined as unknown as string }),
    ).toBe(false);
    expect(
      isUwReport({ ...VALID_REPORT, adjustments: "not-an-array" }),
    ).toBe(false);
    expect(isUwReport({ ...VALID_REPORT, sources: null })).toBe(false);
  });

  it("rejects objects where adjustments is not an array", () => {
    expect(
      isUwReport({ ...VALID_REPORT, adjustments: { 0: VALID_REPORT.adjustments[0]! } }),
    ).toBe(false);
  });

  it("accepts a report with zero adjustments", () => {
    expect(isUwReport({ ...VALID_REPORT, adjustments: [] })).toBe(true);
  });

  it("accepts a report with zero sources", () => {
    expect(isUwReport({ ...VALID_REPORT, sources: [] })).toBe(true);
  });
});
