/**
 * Brief 64 PR 64.2 — <DimensionDetailExhibit> dispatch tests.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// MapPanel renders <UsChoropleth>; mock it (as MapPanel.test does) so the
// geographic branch renders in jsdom without loading the us-atlas geometry.
vi.mock("../UsChoropleth", () => ({ UsChoropleth: () => null }));

import { DimensionDetailExhibit } from "./DimensionDetailExhibit";
import { ANALYTICS_KPIS } from "./analytics-types";
import type { AnalyticsScoredRow } from "./exhibit-math";
import type { OverviewVariableSpec } from "./overview-math";

const PREMIUM = "final_premium";
const AVG = ANALYTICS_KPIS.find((k) => k.id === "avg")!;

function row(inputs: Record<string, unknown>, prem: number): AnalyticsScoredRow {
  return { inputs, outputs: { [PREMIUM]: prem } };
}

function renderDetail(variable: OverviewVariableSpec, rows: AnalyticsScoredRow[]) {
  render(
    <DimensionDetailExhibit
      variable={variable}
      rows={rows}
      kpi={AVG}
      premiumColumn={PREMIUM}
      bookAvg={1000}
    />,
  );
}

describe("<DimensionDetailExhibit>", () => {
  it("dispatches a numeric variable to equal-count bins + the chart", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ building_age: i + 1 }, 1000 + i * 100),
    );
    renderDetail(
      { id: "building_age", label: "Building age", kind: "numeric" },
      rows,
    );
    // The 5/10/20 segmented + the ChartPanel render; no distribution.
    expect(screen.getByTestId("rater-dim-detail-bins-10")).toBeInTheDocument();
    expect(screen.getByTestId("rater-dim-detail-bins-10").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("rater-dim-detail-chart")).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-dim-detail-distribution-histogram"),
    ).not.toBeInTheDocument();
  });

  it("re-bins when the segmented control changes", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({ building_age: i + 1 }, 1000 + i * 50),
    );
    renderDetail(
      { id: "building_age", label: "Building age", kind: "numeric" },
      rows,
    );
    fireEvent.click(screen.getByTestId("rater-dim-detail-bins-20"));
    expect(screen.getByTestId("rater-dim-detail-bins-20").getAttribute("aria-pressed")).toBe("true");
    // Sub-line reflects the bin count (20 distinct-rich values → 20 bins).
    expect(screen.getByTestId("rater-dim-detail-chart")).toBeInTheDocument();
  });

  it("dispatches a small categorical variable to the ranked chart", () => {
    const rows = [
      row({ cls: "A" }, 1000),
      row({ cls: "A" }, 1000),
      row({ cls: "B" }, 2000),
      row({ cls: "B" }, 2000),
      row({ cls: "C" }, 4000),
      row({ cls: "C" }, 4000),
    ];
    renderDetail({ id: "cls", label: "Class", kind: "categorical" }, rows);
    expect(screen.getByTestId("rater-dim-detail-chart")).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-dim-detail-distribution-histogram"),
    ).not.toBeInTheDocument();
  });

  it("dispatches a high-cardinality categorical variable to the distribution", () => {
    // 40 distinct classes (> 30) → FactorDistribution, not a bar carpet.
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({ cls: `C${i}` }, 1000 + i * 25),
    );
    renderDetail({ id: "cls", label: "Class code", kind: "categorical" }, rows);
    expect(
      screen.getByTestId("rater-dim-detail-distribution-histogram"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("rater-dim-detail-chart")).not.toBeInTheDocument();
  });

  it("renders the KPI-aware hero", () => {
    const rows = [row({ cls: "A" }, 1000), row({ cls: "B" }, 3000)];
    renderDetail({ id: "cls", label: "Class", kind: "categorical" }, rows);
    const hero = screen.getByTestId("rater-dim-detail-hero");
    expect(hero.textContent).toMatch(/Book Avg premium/i);
    expect(hero.textContent).toMatch(/Range across levels/i);
  });

  it("dispatches a state-mappable geographic variable to the territory map + ranked chart", () => {
    const rows = [
      row({ st: "CA" }, 5000),
      row({ st: "NV" }, 5000),
      row({ st: "NY" }, 3000),
      row({ st: "NJ" }, 3000),
    ];
    renderDetail(
      {
        id: "st",
        label: "Territory",
        kind: "geographic",
        levels: [
          { id: "T1", label: "West", match: ["CA", "NV"] },
          { id: "T2", label: "East", match: ["NY", "NJ"] },
        ],
      },
      rows,
    );
    // Territory choropleth (MapPanel) + ranked ChartPanel both render.
    expect(screen.getByTestId("rater-dim-detail-map")).toBeInTheDocument();
    expect(screen.getByTestId("rater-dim-detail-chart")).toBeInTheDocument();
    // Chip rail lists the two territories (not 51 states), and the map is
    // in territory mode.
    expect(screen.getByTestId("rater-dim-detail-map-cell-T1")).toBeInTheDocument();
    expect(screen.getByTestId("rater-dim-detail-map-cell-T2")).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-dim-detail-map").getAttribute("data-mode"),
    ).toBe("territory");
  });
});
