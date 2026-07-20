/**
 * Brief 64 PR 64.2 — <RateDriversList> tests.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RateDriversList, type RateDriversListProps } from "./RateDriversList";
import type { VariableOverview, OverviewVariableKind } from "../AnalyticsWorkspace/overview-math";

function mkVar(
  id: string,
  label: string,
  kind: OverviewVariableKind,
  swing: number | null,
): VariableOverview {
  return {
    id,
    label,
    kind,
    kpi: "avg",
    total: swing === null ? 5000 : swing * 1000,
    avg: 100,
    minLevel: swing === null ? null : 100,
    maxLevel: swing === null ? null : 100 * swing,
    swing,
    levelCount: 3,
    rankedLevelCount: swing === null ? 1 : 3,
    flat: swing === null,
  };
}

const VARS: VariableOverview[] = [
  mkVar("class", "Class code", "categorical", 11),
  mkVar("cov", "Coverage", "categorical", 4.3),
  mkVar("age", "Building age", "numeric", 2.5),
  mkVar("sqft", "Square footage", "numeric", 2.3),
  mkVar("constr", "Construction", "categorical", 1.9),
  mkVar("limit", "Building limit", "numeric", 1.8),
  mkVar("terr", "Territory", "geographic", 1.6),
  mkVar("sprink", "Sprinklered", "categorical", 1.5),
  mkVar("prot", "Protection class", "categorical", 1.4),
  mkVar("region", "Region", "categorical", null), // flat
];

const fmt = (n: number | null): string => (n === null ? "—" : `$${Math.round(n)}`);

function renderList(overrides: Partial<RateDriversListProps> = {}) {
  const onSelect = vi.fn();
  render(
    <RateDriversList
      variables={VARS}
      bookAvg={100}
      kpiLabel="Avg premium"
      formatValue={fmt}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect };
}

describe("<RateDriversList>", () => {
  it("ranks by impact (swing desc) and shows the top N with the rest hidden", () => {
    renderList();
    // Top 8 by swing are visible…
    expect(screen.getByTestId("rater-rate-drivers-row-class")).toBeInTheDocument();
    expect(screen.getByTestId("rater-rate-drivers-row-sprink")).toBeInTheDocument();
    // …prot (1.4×) + the flat region are below the fold.
    expect(screen.queryByTestId("rater-rate-drivers-row-prot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rater-rate-drivers-row-region")).not.toBeInTheDocument();
  });

  it("renders the swing factor + premium range for a driver", () => {
    renderList();
    const row = screen.getByTestId("rater-rate-drivers-row-class");
    expect(row.textContent).toContain("11×");
    expect(row.textContent).toContain("$100");
    expect(row.textContent).toContain("$1100");
  });

  it("expands to show all variables, including the flat one", () => {
    renderList();
    fireEvent.click(screen.getByTestId("rater-rate-drivers-show-all"));
    expect(screen.getByTestId("rater-rate-drivers-row-prot")).toBeInTheDocument();
    const region = screen.getByTestId("rater-rate-drivers-row-region");
    expect(region.textContent).toMatch(/differentiate premium/i);
  });

  it("filters by search query", () => {
    renderList();
    fireEvent.change(screen.getByTestId("rater-rate-drivers-search"), {
      target: { value: "build" },
    });
    // Only the two "Building …" variables survive.
    expect(screen.getByTestId("rater-rate-drivers-row-age")).toBeInTheDocument();
    expect(screen.getByTestId("rater-rate-drivers-row-limit")).toBeInTheDocument();
    expect(screen.queryByTestId("rater-rate-drivers-row-class")).not.toBeInTheDocument();
  });

  it("filters by type chip", () => {
    renderList();
    fireEvent.click(screen.getByTestId("rater-rate-drivers-chip-numeric"));
    expect(screen.getByTestId("rater-rate-drivers-row-age")).toBeInTheDocument();
    expect(screen.getByTestId("rater-rate-drivers-row-sqft")).toBeInTheDocument();
    expect(screen.getByTestId("rater-rate-drivers-row-limit")).toBeInTheDocument();
    // A categorical variable is filtered out.
    expect(screen.queryByTestId("rater-rate-drivers-row-class")).not.toBeInTheDocument();
  });

  it("calls onSelect with the variable id when a row is clicked", () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByTestId("rater-rate-drivers-row-class"));
    expect(onSelect).toHaveBeenCalledWith("class");
  });

  it("re-sorts by premium share when the sort changes", () => {
    renderList();
    fireEvent.change(screen.getByTestId("rater-rate-drivers-sort"), {
      target: { value: "share" },
    });
    // total = swing*1000, so class (11000) still leads; flat region (5000)
    // now ranks above the low-swing drivers by share and becomes visible.
    expect(screen.getByTestId("rater-rate-drivers-row-region")).toBeInTheDocument();
  });
});
