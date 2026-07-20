/**
 * <ErrorFilter> + applyErrorFilter tests.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import {
  ErrorFilter,
  EMPTY_FILTER_STATE,
  applyErrorFilter,
  type ErrorFilterState,
} from "./ErrorFilter";
import type { Issue } from "@openrater/contracts";

const ISSUES: readonly Issue[] = [
  {
    id: "iss_1",
    severity: "error",
    source: "compile",
    message: "Compile error in Rating Chains.",
    location: { section: "rating-chains" },
    filing_blocking: true,
  },
  {
    id: "iss_2",
    severity: "warning",
    source: "reference",
    message: "Reference rot in Curves.",
    location: { section: "curves" },
    filing_blocking: false,
  },
  {
    id: "iss_3",
    severity: "error",
    source: "runtime",
    message: "Missing input.",
    location: { section: "risk-inputs" },
    filing_blocking: true,
  },
  {
    id: "iss_4",
    severity: "info",
    source: "conformance",
    message: "V7 passes within tolerance.",
    location: { section: "rate-against-sample" },
    filing_blocking: false,
  },
];

function Harness() {
  const [filters, setFilters] = useState<ErrorFilterState>(EMPTY_FILTER_STATE);
  return (
    <>
      <ErrorFilter
        issues={ISSUES}
        filters={filters}
        onFiltersChange={setFilters}
      />
      <div data-testid="visible-count">
        {applyErrorFilter(ISSUES, filters).length}
      </div>
    </>
  );
}

describe("applyErrorFilter", () => {
  it("returns all issues when no filters are set", () => {
    expect(applyErrorFilter(ISSUES, EMPTY_FILTER_STATE)).toEqual(ISSUES);
  });

  it("filters by severity (single)", () => {
    const filters: ErrorFilterState = {
      ...EMPTY_FILTER_STATE,
      severities: new Set(["error"]),
    };
    expect(applyErrorFilter(ISSUES, filters).map((i) => i.id)).toEqual([
      "iss_1",
      "iss_3",
    ]);
  });

  it("filters by severity (multiple — OR within axis)", () => {
    const filters: ErrorFilterState = {
      ...EMPTY_FILTER_STATE,
      severities: new Set(["warning", "info"]),
    };
    expect(applyErrorFilter(ISSUES, filters).map((i) => i.id)).toEqual([
      "iss_2",
      "iss_4",
    ]);
  });

  it("filters by source", () => {
    const filters: ErrorFilterState = {
      ...EMPTY_FILTER_STATE,
      sources: new Set(["compile"]),
    };
    expect(applyErrorFilter(ISSUES, filters).map((i) => i.id)).toEqual([
      "iss_1",
    ]);
  });

  it("filters by section", () => {
    const filters: ErrorFilterState = {
      ...EMPTY_FILTER_STATE,
      sections: new Set(["risk-inputs"]),
    };
    expect(applyErrorFilter(ISSUES, filters).map((i) => i.id)).toEqual([
      "iss_3",
    ]);
  });

  it("ANDs across axes", () => {
    const filters: ErrorFilterState = {
      severities: new Set(["error"]),
      sources: new Set(["compile"]),
      sections: new Set(),
    };
    expect(applyErrorFilter(ISSUES, filters).map((i) => i.id)).toEqual([
      "iss_1",
    ]);
  });
});

describe("<ErrorFilter>", () => {
  it("renders three filter rows (Severity, Source, Section)", () => {
    render(<Harness />);
    expect(screen.getByText("Severity")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Section")).toBeInTheDocument();
  });

  it("clicking a severity chip toggles the filter", () => {
    render(<Harness />);
    const errorChip = screen.getByRole("button", {
      name: /Filter to.*errors/i,
    });
    fireEvent.click(errorChip);
    expect(screen.getByTestId("visible-count")).toHaveTextContent("2");
    // Click again to clear
    fireEvent.click(errorChip);
    expect(screen.getByTestId("visible-count")).toHaveTextContent("4");
  });

  it("clicking a source chip toggles the filter", () => {
    render(<Harness />);
    const compileChip = screen.getByRole("button", { name: /compile/i });
    fireEvent.click(compileChip);
    expect(screen.getByTestId("visible-count")).toHaveTextContent("1");
  });

  it("clicking multiple chips within an axis ORs them", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /compile/i }));
    fireEvent.click(screen.getByRole("button", { name: /runtime/i }));
    // compile (1) OR runtime (1) → 2 visible
    expect(screen.getByTestId("visible-count")).toHaveTextContent("2");
  });

  it("only shows sections that have issues", () => {
    render(<Harness />);
    // ISSUES contains: rating-chains, curves, risk-inputs, rate-against-sample
    // We expect these 4 section chips (plus the "Section" label)
    const sectionLabels = screen.getAllByRole("button");
    // Should NOT have a chip for sections without issues
    expect(sectionLabels.some((b) => b.textContent?.includes("Eligibility"))).toBe(
      false,
    );
  });

  it("aria-pressed reflects active state", () => {
    render(<Harness />);
    const errorChip = screen.getByRole("button", {
      name: /Filter to.*errors/i,
    });
    expect(errorChip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(errorChip);
    expect(errorChip).toHaveAttribute("aria-pressed", "true");
  });
});
