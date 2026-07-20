/**
 * <SectionIssueDot> + helpers tests.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  SectionIssueDot,
  computeSectionCounts,
  formatCountsTooltip,
} from "./SectionIssueDot";
import type { Issue } from "@openrater/contracts";

function issue(o: Partial<Issue>): Issue {
  return {
    id: o.id ?? "x",
    severity: o.severity ?? "error",
    source: o.source ?? "compile",
    message: o.message ?? "stub.",
    location: o.location ?? { section: "risk-inputs" },
    filing_blocking: o.filing_blocking ?? false,
  };
}

const ISSUES: readonly Issue[] = [
  issue({ id: "i1", severity: "error", location: { section: "risk-inputs" } }),
  issue({ id: "i2", severity: "warning", location: { section: "risk-inputs" } }),
  issue({ id: "i3", severity: "info", location: { section: "risk-inputs" } }),
  issue({ id: "i4", severity: "warning", location: { section: "outputs" } }),
  issue({ id: "i5", severity: "info", location: { section: "outputs" } }),
  issue({ id: "i6", severity: "info", location: { section: "trace" } }),
];

describe("computeSectionCounts", () => {
  it("counts issues by severity for a section", () => {
    const c = computeSectionCounts(ISSUES, "risk-inputs");
    expect(c.error).toBe(1);
    expect(c.warning).toBe(1);
    expect(c.info).toBe(1);
    expect(c.total).toBe(3);
    expect(c.tone).toBe("error"); // highest severity present
  });

  it("returns tone=warning when no errors but warnings present", () => {
    const c = computeSectionCounts(ISSUES, "outputs");
    expect(c.tone).toBe("warning");
    expect(c.error).toBe(0);
    expect(c.warning).toBe(1);
    expect(c.info).toBe(1);
  });

  it("returns tone=info when only info present", () => {
    const c = computeSectionCounts(ISSUES, "trace");
    expect(c.tone).toBe("info");
    expect(c.info).toBe(1);
  });

  it("returns tone=null when no issues match", () => {
    const c = computeSectionCounts(ISSUES, "no-section");
    expect(c.tone).toBeNull();
    expect(c.total).toBe(0);
  });
});

describe("formatCountsTooltip", () => {
  it("formats single severity correctly", () => {
    expect(
      formatCountsTooltip({
        error: 0,
        warning: 1,
        info: 0,
        total: 1,
        tone: "warning",
      }),
    ).toBe("1 warning");
  });

  it("pluralizes counts >1", () => {
    expect(
      formatCountsTooltip({
        error: 2,
        warning: 3,
        info: 0,
        total: 5,
        tone: "error",
      }),
    ).toBe("2 errors · 3 warnings");
  });

  it("uses 'info' singular even for >1 (per the closed vocabulary)", () => {
    expect(
      formatCountsTooltip({
        error: 0,
        warning: 0,
        info: 4,
        total: 4,
        tone: "info",
      }),
    ).toBe("4 info");
  });

  it("includes only non-zero severities", () => {
    expect(
      formatCountsTooltip({
        error: 1,
        warning: 0,
        info: 2,
        total: 3,
        tone: "error",
      }),
    ).toBe("1 error · 2 info");
  });
});

describe("<SectionIssueDot>", () => {
  it("renders nothing when section has no issues", () => {
    const { container } = render(
      <SectionIssueDot sectionId="empty-section" issues={ISSUES} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the dot with the highest-severity tone", () => {
    render(<SectionIssueDot sectionId="risk-inputs" issues={ISSUES} />);
    const dot = screen.getByRole("img");
    expect(dot.className).toContain("rater-section-issue-dot--error");
  });

  it("renders warning tone when no errors", () => {
    render(<SectionIssueDot sectionId="outputs" issues={ISSUES} />);
    const dot = screen.getByRole("img");
    expect(dot.className).toContain("rater-section-issue-dot--warning");
  });

  it("uses the aria-label from the formatted counts", () => {
    render(<SectionIssueDot sectionId="risk-inputs" issues={ISSUES} />);
    const dot = screen.getByRole("img");
    expect(dot.getAttribute("aria-label")).toBe(
      "1 error · 1 warning · 1 info",
    );
  });

  it("uses ariaLabel override when provided", () => {
    render(
      <SectionIssueDot
        sectionId="risk-inputs"
        issues={ISSUES}
        ariaLabel="Custom label"
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Custom label",
    );
  });

  it("does not render count badge by default", () => {
    const { container } = render(
      <SectionIssueDot sectionId="risk-inputs" issues={ISSUES} />,
    );
    expect(container.querySelector(".rater-section-issue-dot__count")).toBeNull();
  });

  it("renders count badge when showCounts is true", () => {
    const { container } = render(
      <SectionIssueDot sectionId="risk-inputs" issues={ISSUES} showCounts />,
    );
    const countEl = container.querySelector(".rater-section-issue-dot__count");
    expect(countEl).not.toBeNull();
    expect(countEl?.textContent).toBe("3");
  });
});
