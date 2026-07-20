/**
 * Brief 64 PR 64.6 — <AnalyticsWorkspaceV2> orchestrator tests.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The geographic detail can mount MapPanel → UsChoropleth; stub it so the
// jsdom test doesn't load the us-atlas geometry.
vi.mock("../UsChoropleth", () => ({ UsChoropleth: () => null }));

import {
  AnalyticsWorkspaceV2,
  type AnalyticsWorkspaceV2Props,
} from "./AnalyticsWorkspaceV2";
import type { ScoredBatchResult } from "./exhibit-math";
import type { OverviewVariableSpec } from "./overview-math";

const PREMIUM = "final_premium";

function scored(): ScoredBatchResult {
  const rows = [
    { inputs: { cls: "A", age: 1 }, outputs: { [PREMIUM]: 1000 } },
    { inputs: { cls: "A", age: 2 }, outputs: { [PREMIUM]: 1100 } },
    { inputs: { cls: "B", age: 9 }, outputs: { [PREMIUM]: 3000 } },
    { inputs: { cls: "B", age: 12 }, outputs: { [PREMIUM]: 3200 } },
  ];
  return {
    scoredAt: "2026-06-08T00:00:00Z",
    rowCount: rows.length,
    rows,
    premiumColumn: PREMIUM,
  };
}

const VARS: OverviewVariableSpec[] = [
  { id: "cls", label: "Class", kind: "categorical" },
  { id: "age", label: "Building age", kind: "numeric" },
];

function renderWs(overrides: Partial<AnalyticsWorkspaceV2Props> = {}) {
  const props = {
    hasScoredResult: true,
    hasSnapshots: false,
    hasGeographicDim: false,
    onFreezeVersion: vi.fn(),
    scoredResult: scored(),
    variables: VARS,
    premiumColumn: PREMIUM,
    planLabel: "Meridian BOP · Kansas",
    snapshots: [],
    onExport: vi.fn(),
    // Brief 93 — the report is the landing view; these acts tests
    // exercise the BOOK view behind it.
    reportSlot: <div data-testid="ws-report-slot">report</div>,
    view: "book" as const,
    onViewChange: vi.fn(),
    ...overrides,
  };
  render(<AnalyticsWorkspaceV2 {...props} />);
  return props;
}

describe("<AnalyticsWorkspaceV2>", () => {
  it("a missing scored result lands on the report — the Book view gates on one (ADR-0041, Brief 93 §1.3)", () => {
    renderWs({ hasScoredResult: false, scoredResult: null, view: "book" });
    expect(screen.getByTestId("ws-report-slot")).toBeInTheDocument();
    expect(screen.queryByTestId("rater-analytics-band")).not.toBeInTheDocument();
  });

  it("renders the executive band + Overview drivers when scored", () => {
    renderWs();
    expect(screen.getByTestId("rater-analytics-band")).toBeInTheDocument();
    expect(screen.getByTestId("rater-analytics-overview")).toBeInTheDocument();
    expect(screen.getByTestId("rater-analytics-drivers")).toBeInTheDocument();
    // Drivers are ranked; Class differentiates premium more than age here.
    expect(
      screen.getByTestId("rater-analytics-drivers-row-cls"),
    ).toBeInTheDocument();
  });

  it("drills into a variable's detail when a driver is clicked", () => {
    renderWs();
    fireEvent.click(screen.getByTestId("rater-analytics-drivers-row-cls"));
    expect(screen.getByTestId("rater-analytics-detail")).toBeInTheDocument();
  });

  it("switches to Compare and shows the pick-two-versions hint without a baseline", () => {
    renderWs();
    fireEvent.click(screen.getByTestId("rater-analytics-act-compare"));
    expect(screen.getByTestId("rater-analytics-compare")).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-analytics-compare-hint"),
    ).toBeInTheDocument();
  });

  it("shows dislocation + impact in Compare when a comparison is bound", () => {
    const comparison: ScoredBatchResult = {
      ...scored(),
      rows: scored().rows.map((r) => ({
        ...r,
        outputs: { [PREMIUM]: (r.outputs[PREMIUM] as number) * 1.1 },
      })),
    };
    renderWs({ baselineResult: scored(), comparisonResult: comparison });
    fireEvent.click(screen.getByTestId("rater-analytics-act-compare"));
    expect(
      screen.getByTestId("rater-analytics-dislocation"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rater-analytics-impact")).toBeInTheDocument();
  });

  it("switches to Present and renders the executive summary", () => {
    renderWs();
    fireEvent.click(screen.getByTestId("rater-analytics-act-present"));
    expect(screen.getByTestId("rater-analytics-exec")).toBeInTheDocument();
  });

  it("renders NO publish affordance — publish lives on the Ship tab (Brief 76 D-F)", () => {
    renderWs({
      hasSnapshots: true,
      snapshots: [{ snapshot_id: "ps_1", display_name: "v1" }],
      baselineSnapshotId: "ps_1",
    });
    expect(screen.queryByTestId("rater-analytics-publish")).toBeNull();
  });
});
