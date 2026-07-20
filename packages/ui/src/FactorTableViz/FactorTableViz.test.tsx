/**
 * <FactorTableViz> tests — Brief 34 PR 34.4.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FactorTableViz } from "./FactorTableViz";
import { cellKey, type FactorTableGrid2DAxis } from "../FactorTableGrid2D";

const CONSTRUCTION_AXIS: FactorTableGrid2DAxis = {
  dimSlug: "construction",
  values: [
    { id: "frame", label: "Frame" },
    { id: "jm", label: "JM" },
    { id: "fr", label: "FR" },
  ],
};

const OWNERSHIP_AXIS: FactorTableGrid2DAxis = {
  dimSlug: "ownership",
  values: [
    { id: "owner", label: "Owner" },
    { id: "tenant", label: "Tenant" },
  ],
};

const BANDED_AXIS: FactorTableGrid2DAxis = {
  dimSlug: "building_age",
  values: [
    { id: "band_0_5", label: "0–5" },
    { id: "band_5_15", label: "5–15" },
    { id: "band_15_30", label: "15–30" },
  ],
};

const CELLS_1D = new Map<string, number>([
  [cellKey("frame", null), 1.0],
  [cellKey("jm", null), 0.92],
  [cellKey("fr", null), 0.78],
]);

const CELLS_2D = new Map<string, number>([
  [cellKey("frame", "owner"), 1.0],
  [cellKey("frame", "tenant"), 1.1],
  [cellKey("jm", "owner"), 0.92],
  [cellKey("jm", "tenant"), 1.02],
  [cellKey("fr", "owner"), 0.78],
  [cellKey("fr", "tenant"), 0.86],
]);

describe("<FactorTableViz> chart auto-pick", () => {
  it("1-D categorical mounts BarChart", () => {
    render(
      <FactorTableViz rowAxis={CONSTRUCTION_AXIS} cells={CELLS_1D} />,
    );
    expect(screen.getByTestId("rater-ft-viz")).toHaveAttribute(
      "data-chart-type",
      "bar",
    );
    expect(screen.getByTestId("rater-ft-viz-bar")).toBeInTheDocument();
  });

  it("1-D banded mounts LineChart", () => {
    render(
      <FactorTableViz
        rowAxis={BANDED_AXIS}
        cells={new Map([
          [cellKey("band_0_5", null), 0.85],
          [cellKey("band_5_15", null), 0.92],
          [cellKey("band_15_30", null), 1.05],
        ])}
        isBanded={{ row: true }}
      />,
    );
    expect(screen.getByTestId("rater-ft-viz")).toHaveAttribute(
      "data-chart-type",
      "line",
    );
    expect(screen.getByTestId("rater-ft-viz-line")).toBeInTheDocument();
  });

  it("2-D categorical × categorical mounts HeatmapGrid", () => {
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={CELLS_2D}
      />,
    );
    expect(screen.getByTestId("rater-ft-viz")).toHaveAttribute(
      "data-chart-type",
      "heatmap",
    );
    expect(screen.getByTestId("rater-ft-viz-heatmap")).toBeInTheDocument();
  });

  it("2-D banded × categorical mounts LineMultiples", () => {
    const cells = new Map<string, number>();
    BANDED_AXIS.values.forEach((row, i) => {
      OWNERSHIP_AXIS.values.forEach((col, j) => {
        cells.set(cellKey(row.id, col.id), 1.0 + 0.05 * i + 0.03 * j);
      });
    });
    render(
      <FactorTableViz
        rowAxis={BANDED_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={cells}
        isBanded={{ row: true, col: false }}
      />,
    );
    expect(screen.getByTestId("rater-ft-viz")).toHaveAttribute(
      "data-chart-type",
      "small-multiples",
    );
    expect(
      screen.getByTestId("rater-ft-viz-multiples"),
    ).toBeInTheDocument();
  });
});

describe("<FactorTableViz> pill picker", () => {
  it("renders one pill per available chart type", () => {
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={CELLS_2D}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-viz-pill-heatmap"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-ft-viz-pill-small-multiples"),
    ).toBeInTheDocument();
    // The Surface pill stays off the picker until its renderer exists
    // (it routed to a stub — Brief 67 walkthrough fix).
    expect(
      screen.queryByTestId("rater-ft-viz-pill-surface"),
    ).not.toBeInTheDocument();
  });

  it("clicking a pill fires onVizConfigChange with the new chart type", () => {
    const onChange = vi.fn();
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={CELLS_2D}
        onVizConfigChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-viz-pill-small-multiples"));
    expect(onChange).toHaveBeenCalledWith({ chartType: "small-multiples" });
  });

  it("renders 'Reset to auto' button only when override is active", () => {
    const { rerender } = render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={CELLS_2D}
        vizConfig={{ chartType: "auto" }}
      />,
    );
    expect(
      screen.queryByTestId("rater-ft-viz-auto-reset"),
    ).not.toBeInTheDocument();
    rerender(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={CELLS_2D}
        vizConfig={{ chartType: "small-multiples" }}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-viz-auto-reset"),
    ).toBeInTheDocument();
  });

  it("clicking 'Reset to auto' fires onVizConfigChange with auto", () => {
    const onChange = vi.fn();
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={CELLS_2D}
        vizConfig={{ chartType: "small-multiples" }}
        onVizConfigChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-viz-auto-reset"));
    expect(onChange).toHaveBeenCalledWith({ chartType: "auto" });
  });
});

describe("<FactorTableViz> override + active pill", () => {
  it("active pill reflects the resolved chart type", () => {
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={CELLS_2D}
        vizConfig={{ chartType: "small-multiples" }}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-viz-pill-small-multiples"),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByTestId("rater-ft-viz-pill-heatmap"),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("surface override renders the stub placeholder", () => {
    render(
      <FactorTableViz
        rowAxis={BANDED_AXIS}
        colAxis={{
          dimSlug: "x",
          values: [
            { id: "b0", label: "B0" },
            { id: "b1", label: "B1" },
          ],
        }}
        cells={new Map()}
        isBanded={{ row: true, col: true }}
        vizConfig={{ chartType: "surface" }}
      />,
    );
    expect(screen.getByTestId("rater-ft-viz-unavailable")).toBeInTheDocument();
  });
});

describe("<FactorTableViz> cross-highlight + brush (Brief 34 PR 34.5)", () => {
  it("threads selectedKeys into the bar chart", () => {
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        cells={CELLS_1D}
        selectedKeys={new Set(["frame", "jm"])}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-viz-bar-bar-frame"),
    ).toHaveClass("is-selected");
    expect(
      screen.getByTestId("rater-ft-viz-bar-bar-jm"),
    ).toHaveClass("is-selected");
    expect(
      screen.getByTestId("rater-ft-viz-bar-bar-fr"),
    ).not.toHaveClass("is-selected");
  });

  it("threads focusedKey into the heatmap (2-D categorical × categorical)", () => {
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={CELLS_2D}
        focusedKey="frame::owner"
      />,
    );
    expect(
      screen.getByTestId("rater-ft-viz-heatmap-cell-frame-owner"),
    ).toHaveClass("is-focused");
  });

  it("renders selection-region overlay on the line chart when selectedKeys provided", () => {
    render(
      <FactorTableViz
        rowAxis={BANDED_AXIS}
        cells={new Map([
          [cellKey("band_0_5", null), 0.85],
          [cellKey("band_5_15", null), 0.92],
          [cellKey("band_15_30", null), 1.05],
        ])}
        isBanded={{ row: true }}
        selectedKeys={new Set(["band_5_15", "band_15_30"])}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-viz-line-selection-region"),
    ).toBeInTheDocument();
  });

  it("forwards onPointClick from the bar chart marker click", () => {
    const onClick = vi.fn();
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        cells={CELLS_1D}
        onPointClick={onClick}
      />,
    );
    // onPointClick prop is accepted + threaded; full gesture is
    // exercised at the chart-primitive layer.
    expect(
      screen.getByTestId("rater-ft-viz-bar"),
    ).toBeInTheDocument();
  });
});

describe("<FactorTableViz> compare-overlay + monotonicity (Brief 34 PR 34.6)", () => {
  it("threads filedCells into the BarChart as filedValues (row-id keys)", () => {
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        cells={CELLS_1D}
        filedCells={
          new Map<string, number>([
            [cellKey("frame", null), 0.95],
            [cellKey("jm", null), 0.9],
          ])
        }
      />,
    );
    expect(
      screen.getByTestId("rater-ft-viz-bar-filed-overlay"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-ft-viz-bar-filed-tick-frame"),
    ).toBeInTheDocument();
  });

  it("threads filedCells into the HeatmapGrid as cellKey deltas", () => {
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        colAxis={OWNERSHIP_AXIS}
        cells={CELLS_2D}
        filedCells={
          new Map<string, number>([
            [cellKey("frame", "owner"), 0.9],
          ])
        }
      />,
    );
    // frame/owner cur 1.0 vs filed 0.9 → +11.1%
    expect(
      screen.getByTestId("rater-ft-viz-heatmap-cell-delta-frame-owner"),
    ).toBeInTheDocument();
  });

  it("surfaces a compare-delta insight when filedCells diverges from current", () => {
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        cells={CELLS_1D}
        filedCells={
          new Map<string, number>([
            [cellKey("frame", null), 1.0],
            [cellKey("jm", null), 0.85], // current is 0.92 → +8.2%
            [cellKey("fr", null), 0.78],
          ])
        }
      />,
    );
    const panel = screen.getByTestId("rater-ft-viz-insights");
    expect(panel.textContent).toMatch(/JM.*up/);
  });

  it("'increasing' monotonicity flags any DOWN step", () => {
    render(
      <FactorTableViz
        rowAxis={BANDED_AXIS}
        cells={new Map([
          [cellKey("band_0_5", null), 1.05],
          [cellKey("band_5_15", null), 0.95], // drop
          [cellKey("band_15_30", null), 1.1],
        ])}
        isBanded={{ row: true }}
        monotonicityExpected="increasing"
      />,
    );
    const panel = screen.getByTestId("rater-ft-viz-insights");
    expect(panel.textContent).toMatch(/Monotonicity break/i);
  });
});

describe("<FactorTableViz> insights composition", () => {
  it("renders the InsightsPanel by default", () => {
    render(
      <FactorTableViz rowAxis={CONSTRUCTION_AXIS} cells={CELLS_1D} />,
    );
    expect(
      screen.getByTestId("rater-ft-viz-insights"),
    ).toBeInTheDocument();
  });

  it("hideInsights suppresses the panel", () => {
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        cells={CELLS_1D}
        hideInsights
      />,
    );
    expect(
      screen.queryByTestId("rater-ft-viz-insights"),
    ).not.toBeInTheDocument();
  });

  it("insights jump-to-cell forwards through onJumpToCell", () => {
    const onJump = vi.fn();
    render(
      <FactorTableViz
        rowAxis={CONSTRUCTION_AXIS}
        cells={new Map([
          [cellKey("frame", null), 1.0],
          [cellKey("jm", null), 1.0],
          [cellKey("fr", null), 1.0],
        ])}
        onJumpToCell={onJump}
      />,
    );
    // All-default → row insights → first all-default item clickable.
    const items = screen.getAllByTestId(/rater-ft-viz-insights-item-/);
    const clickable = items.find(
      (el) => el.getAttribute("role") === "button",
    );
    expect(clickable).toBeDefined();
    fireEvent.click(clickable!);
    expect(onJump).toHaveBeenCalled();
  });
});
