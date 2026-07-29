/**
 * Brief 64 PR 64.5 — <ExecutiveSummary> tests.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutiveSummary } from "./ExecutiveSummary";

describe("<ExecutiveSummary>", () => {
  it("leads with the rate change when a comparison is bound", () => {
    render(
      <ExecutiveSummary
        planLabel="ISO BOP · Kansas"
        totalPremium={4_730_000}
        policyCount={412}
        avgPremium={11480}
        comparison={{
          baselineLabel: "v2",
          comparisonLabel: "draft",
          weightedAvg: 0.056,
          pctWithin10: 0.84,
          maxUp: 0.38,
          totalDelta: 251000,
        }}
      />,
    );
    expect(screen.getByTestId("rater-exec").textContent).toMatch(
      /Proposed rate change/i,
    );
    expect(screen.getByTestId("rater-exec").textContent).toContain("+5.6%");
    expect(screen.getByTestId("rater-exec-context").textContent).toMatch(
      /412 policies/,
    );
  });

  it("leads with the book premium when there is no comparison", () => {
    render(
      <ExecutiveSummary
        planLabel="ISO BOP · Kansas"
        totalPremium={4_730_000}
        policyCount={412}
        avgPremium={11480}
      />,
    );
    const text = screen.getByTestId("rater-exec").textContent ?? "";
    expect(text).toMatch(/book premium/i);
    expect(text).not.toMatch(/Proposed rate change/i);
  });

  it("renders top movers — and NO publish affordance (Ship owns publish, Brief 76)", () => {
    render(
      <ExecutiveSummary
        planLabel="ISO BOP · Kansas"
        totalPremium={4_730_000}
        policyCount={412}
        avgPremium={11480}
        topIncreases={[{ label: "Day care (5345)", delta: 0.24 }]}
        topDecreases={[{ label: "Fire-resistive", delta: -0.09 }]}
      />,
    );
    expect(screen.getByTestId("rater-exec-increases").textContent).toMatch(
      /Day care/,
    );
    expect(screen.getByTestId("rater-exec-decreases").textContent).toMatch(
      /Fire-resistive/,
    );
    expect(screen.queryByTestId("rater-exec-publish")).toBeNull();
  });
});
