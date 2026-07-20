/**
 * Brief 64 PR 64.4 — <ImpactByVariable> tests.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImpactByVariable } from "./ImpactByVariable";
import type { VariableImpact } from "./impact";

const VARS: VariableImpact[] = [
  {
    id: "cls",
    label: "Class",
    kind: "categorical",
    bookBaseline: 1333,
    bookComparison: 1533,
    bookDelta: 0.15,
    minLevelDelta: 0,
    maxLevelDelta: 0.5,
    maxAbsDelta: 0.5,
    deltaSpread: 0.5,
    levelCount: 3,
    rankedLevelCount: 3,
    flat: false,
  },
  {
    id: "region",
    label: "Region",
    kind: "categorical",
    bookBaseline: 1333,
    bookComparison: 1533,
    bookDelta: 0.15,
    minLevelDelta: 0.15,
    maxLevelDelta: 0.15,
    maxAbsDelta: 0.15,
    deltaSpread: null,
    levelCount: 1,
    rankedLevelCount: 1,
    flat: true,
  },
];

describe("<ImpactByVariable>", () => {
  it("renders a row per variable with the book delta", () => {
    render(
      <ImpactByVariable variables={VARS} baselineLabel="v2" comparisonLabel="draft" />,
    );
    const cls = screen.getByTestId("rater-impact-row-cls");
    expect(cls).toBeInTheDocument();
    expect(cls.textContent).toContain("+15.0%");
  });

  it("marks a non-differentiating variable as uniform", () => {
    render(
      <ImpactByVariable variables={VARS} baselineLabel="v2" comparisonLabel="draft" />,
    );
    const region = screen.getByTestId("rater-impact-row-region");
    expect(region.textContent).toMatch(/uniform · no differential/i);
  });

  it("fires onSelect with the variable id when a row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ImpactByVariable
        variables={VARS}
        baselineLabel="v2"
        comparisonLabel="draft"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-impact-row-cls"));
    expect(onSelect).toHaveBeenCalledWith("cls");
  });

  it("renders an empty state with no variables", () => {
    render(
      <ImpactByVariable variables={[]} baselineLabel="v2" comparisonLabel="draft" />,
    );
    expect(screen.getByTestId("rater-impact-empty")).toBeInTheDocument();
  });
});
