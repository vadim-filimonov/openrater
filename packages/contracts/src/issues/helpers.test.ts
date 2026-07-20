/**
 * Issue helpers tests (M1.6, Brief 13).
 */

import { describe, it, expect } from "vitest";
import {
  countSeverities,
  defaultFilingBlocking,
  deriveIssueId,
  filingReadiness,
  rankIssues,
} from "./helpers";
import type { Issue } from "./types";

function issue(o: Partial<Issue>): Issue {
  return {
    id: o.id ?? "iss_test",
    severity: o.severity ?? "info",
    source: o.source ?? "compile",
    message: o.message ?? "Test message.",
    location: o.location ?? { section: "risk-inputs" },
    filing_blocking: o.filing_blocking ?? false,
    ...(o.fix_hint ? { fix_hint: o.fix_hint } : {}),
    ...(o.citation ? { citation: o.citation } : {}),
  };
}

describe("deriveIssueId", () => {
  it("produces a stable id from canonical input", () => {
    const a = deriveIssueId({
      source: "compile",
      location: { section: "risk-inputs", entity: "n1" },
      message_template: "unknown_kind",
      format_args: ["unknown.x"],
    });
    const b = deriveIssueId({
      source: "compile",
      location: { section: "risk-inputs", entity: "n1" },
      message_template: "unknown_kind",
      format_args: ["unknown.x"],
    });
    expect(a).toBe(b);
  });

  it("produces different ids for different sources", () => {
    const compile = deriveIssueId({
      source: "compile",
      location: { section: "s" },
      message_template: "t",
    });
    const runtime = deriveIssueId({
      source: "runtime",
      location: { section: "s" },
      message_template: "t",
    });
    expect(compile).not.toBe(runtime);
  });

  it("produces different ids for different format_args", () => {
    const a = deriveIssueId({
      source: "compile",
      location: { section: "s" },
      message_template: "t",
      format_args: ["arg1"],
    });
    const b = deriveIssueId({
      source: "compile",
      location: { section: "s" },
      message_template: "t",
      format_args: ["arg2"],
    });
    expect(a).not.toBe(b);
  });

  it("ids start with the iss_ prefix and have 8 hex chars", () => {
    const id = deriveIssueId({
      source: "compile",
      location: { section: "s" },
      message_template: "t",
    });
    expect(id).toMatch(/^iss_[0-9a-f]{8}$/);
  });
});

describe("rankIssues", () => {
  it("ranks errors before warnings before info", () => {
    const error = issue({ severity: "error" });
    const warning = issue({ severity: "warning" });
    const info = issue({ severity: "info" });
    const sorted = [info, warning, error].sort(rankIssues);
    expect(sorted.map((i) => i.severity)).toEqual([
      "error",
      "warning",
      "info",
    ]);
  });

  it("ranks compile before runtime before authoring (within same severity)", () => {
    const compile = issue({ severity: "error", source: "compile" });
    const runtime = issue({ severity: "error", source: "runtime" });
    const authoring = issue({ severity: "error", source: "authoring" });
    const sorted = [authoring, runtime, compile].sort(rankIssues);
    expect(sorted.map((i) => i.source)).toEqual([
      "compile",
      "runtime",
      "authoring",
    ]);
  });

  it("ranks by spine section order within same severity + source", () => {
    // risk-inputs (1st) should come before outputs (12th)
    const inputs = issue({
      severity: "error",
      source: "compile",
      location: { section: "risk-inputs" },
    });
    const outputs = issue({
      severity: "error",
      source: "compile",
      location: { section: "outputs" },
    });
    const sorted = [outputs, inputs].sort(rankIssues);
    expect(sorted[0]?.location.section).toBe("risk-inputs");
  });

  it("ranks alphabetically by entity within same section", () => {
    const a = issue({
      severity: "error",
      source: "compile",
      location: { section: "risk-inputs", entity: "abc" },
    });
    const b = issue({
      severity: "error",
      source: "compile",
      location: { section: "risk-inputs", entity: "xyz" },
    });
    const sorted = [b, a].sort(rankIssues);
    expect(sorted[0]?.location.entity).toBe("abc");
  });
});

describe("countSeverities", () => {
  it("counts each severity", () => {
    const issues = [
      issue({ severity: "error" }),
      issue({ severity: "error" }),
      issue({ severity: "warning" }),
      issue({ severity: "info" }),
    ];
    expect(countSeverities(issues)).toEqual({ error: 2, warning: 1, info: 1 });
  });

  it("returns zeros for an empty list", () => {
    expect(countSeverities([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe("filingReadiness", () => {
  it("returns 'filing_ready' for an empty list", () => {
    expect(filingReadiness([])).toBe("filing_ready");
  });

  it("returns 'filing_ready' when only info issues exist", () => {
    expect(
      filingReadiness([issue({ severity: "info", filing_blocking: false })]),
    ).toBe("filing_ready");
  });

  it("returns 'filing_ready_with_warnings' when warnings (non-blocking) exist", () => {
    expect(
      filingReadiness([
        issue({ severity: "warning", filing_blocking: false }),
      ]),
    ).toBe("filing_ready_with_warnings");
  });

  it("returns 'blocked' when any filing_blocking issue exists", () => {
    expect(
      filingReadiness([
        issue({ severity: "warning", filing_blocking: false }),
        issue({ severity: "error", filing_blocking: true }),
      ]),
    ).toBe("blocked");
  });

  it("'blocked' beats 'filing_ready_with_warnings' regardless of order", () => {
    expect(
      filingReadiness([
        issue({ severity: "error", filing_blocking: true }),
        issue({ severity: "warning", filing_blocking: false }),
      ]),
    ).toBe("blocked");
  });
});

describe("defaultFilingBlocking", () => {
  it("returns true for errors from compile + reference + runtime", () => {
    expect(defaultFilingBlocking("error", "compile")).toBe(true);
    expect(defaultFilingBlocking("error", "reference")).toBe(true);
    expect(defaultFilingBlocking("error", "runtime")).toBe(true);
  });

  it("returns false for errors from authoring + conformance (caller decides)", () => {
    expect(defaultFilingBlocking("error", "authoring")).toBe(false);
    expect(defaultFilingBlocking("error", "conformance")).toBe(false);
  });

  it("returns false for warnings + info regardless of source", () => {
    expect(defaultFilingBlocking("warning", "compile")).toBe(false);
    expect(defaultFilingBlocking("warning", "runtime")).toBe(false);
    expect(defaultFilingBlocking("info", "compile")).toBe(false);
    expect(defaultFilingBlocking("info", "conformance")).toBe(false);
  });
});
