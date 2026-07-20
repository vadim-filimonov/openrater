/**
 * Brief 64 PR 64.4 — <DislocationExhibit> tests.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DislocationExhibit } from "./DislocationExhibit";
import { computeDislocation } from "./dislocation";
import type { AnalyticsScoredRow } from "./exhibit-math";

const PREMIUM = "final_premium";
const mk = (p: number): AnalyticsScoredRow => ({
  inputs: {},
  outputs: { [PREMIUM]: p },
});
const dislo = (base: number[], comp: number[]) =>
  computeDislocation({
    baselineRows: base.map(mk),
    comparisonRows: comp.map(mk),
    premiumColumn: PREMIUM,
  });

describe("<DislocationExhibit>", () => {
  it("renders the histogram + summary chips", () => {
    render(
      <DislocationExhibit
        dislocation={dislo([1000, 1000, 1000], [1200, 950, 1000])}
        baselineLabel="v2"
        comparisonLabel="draft"
      />,
    );
    expect(screen.getByTestId("rater-dislocation-svg")).toBeInTheDocument();
    const sum = screen.getByTestId("rater-dislocation-summary");
    expect(sum.textContent).toMatch(/increase/i);
    expect(sum.textContent).toMatch(/decrease/i);
    expect(sum.textContent).toMatch(/within ±10%/i);
    expect(sum.textContent).toMatch(/weighted avg/i);
  });

  it("notes beyond-range + new-business counts (no silent drops)", () => {
    // +300% (beyond +200%) and a zero-base row (new business).
    render(
      <DislocationExhibit
        dislocation={dislo([1000, 0], [4000, 500])}
        baselineLabel="v2"
        comparisonLabel="draft"
      />,
    );
    const note = screen.getByTestId("rater-dislocation-note");
    expect(note.textContent).toMatch(/above/i);
    expect(note.textContent).toMatch(/new business/i);
  });

  it("renders an empty state when there is no comparison data", () => {
    render(
      <DislocationExhibit
        dislocation={dislo([], [])}
        baselineLabel="v2"
        comparisonLabel="draft"
      />,
    );
    expect(screen.getByTestId("rater-dislocation-empty")).toBeInTheDocument();
  });
});
