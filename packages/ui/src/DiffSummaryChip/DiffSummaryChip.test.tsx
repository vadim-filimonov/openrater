/**
 * <DiffSummaryChip> tests.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffSummaryChip } from "./DiffSummaryChip";

describe("<DiffSummaryChip>", () => {
  it("renders 'Identical' when totals are all zero", () => {
    render(
      <DiffSummaryChip
        summary={{ changed: 0, added: 0, removed: 0, inspected: 0 }}
      />,
    );
    expect(screen.getByText("Identical")).toBeInTheDocument();
  });

  it("renders the three counts in changed/added/removed order", () => {
    const { container } = render(
      <DiffSummaryChip
        summary={{ changed: 2, added: 1, removed: 0, inspected: 50 }}
      />,
    );
    const counts = container.querySelectorAll(
      ".rater-diff-summary-chip__count-value",
    );
    expect(counts).toHaveLength(3);
    expect(counts[0]?.textContent).toBe("2");
    expect(counts[1]?.textContent).toBe("1");
    expect(counts[2]?.textContent).toBe("0");
  });

  it("renders count labels", () => {
    render(
      <DiffSummaryChip
        summary={{ changed: 1, added: 1, removed: 1, inspected: 10 }}
      />,
    );
    expect(screen.getByText("changed")).toBeInTheDocument();
    expect(screen.getByText("added")).toBeInTheDocument();
    expect(screen.getByText("removed")).toBeInTheDocument();
  });

  it("renders the totalImpact when provided", () => {
    render(
      <DiffSummaryChip
        summary={{ changed: 1, added: 0, removed: 0, inspected: 5 }}
        totalImpact={{ dollars: 190, pct: 3.7 }}
      />,
    );
    expect(screen.getByText("+$190")).toBeInTheDocument();
    expect(screen.getByText("+3.7%")).toBeInTheDocument();
  });

  it("does NOT render totalImpact when null", () => {
    render(
      <DiffSummaryChip
        summary={{ changed: 1, added: 0, removed: 0, inspected: 5 }}
        totalImpact={null}
      />,
    );
    expect(screen.queryByText(/\+\$/)).toBeNull();
  });

  it("does NOT render totalImpact when omitted", () => {
    render(
      <DiffSummaryChip
        summary={{ changed: 1, added: 0, removed: 0, inspected: 5 }}
      />,
    );
    expect(screen.queryByText(/\+\$/)).toBeNull();
  });

  it("aria-label describes the counts", () => {
    const { container } = render(
      <DiffSummaryChip
        summary={{ changed: 2, added: 1, removed: 0, inspected: 30 }}
      />,
    );
    expect(
      (container.firstChild as HTMLElement).getAttribute("aria-label"),
    ).toMatch(/2 changed, 1 added, 0 removed/);
  });
});
