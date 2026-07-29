/**
 * <HeatmapGrid> tests — Brief 34 PR 34.2.
 *
 * Covers:
 *   • Mount: corner + headers + body cells
 *   • Each cell gets the right heat-N bucket attr
 *   • Empty cells get is-empty class + bucket=0
 *   • Focus + hover → row + col headers tint, cell gets is-focused
 *   • onHoverChange fires with (rowId, colId)
 *   • Legend renders 7 swatches; hideLegend hides it
 *   • Title attribute carries the cell value + deviation %
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HeatmapGrid } from "./HeatmapGrid";
import { cellKey, type FactorTableGrid2DAxis } from "../FactorTableGrid2D";

const ROW_AXIS: FactorTableGrid2DAxis = {
  dimSlug: "class",
  values: [
    { id: "91342", label: "91342 · Concrete" },
    { id: "91560", label: "91560 · Electrical" },
    { id: "91585", label: "91585 · Plumbing" },
  ],
};

const COL_AXIS: FactorTableGrid2DAxis = {
  dimSlug: "ownership",
  values: [
    { id: "owner", label: "Owner-occupied" },
    { id: "tenant", label: "Tenant-occupied" },
  ],
};

const CELLS = new Map<string, number>([
  [cellKey("91342", "owner"), 1.35],
  [cellKey("91342", "tenant"), 1.42],
  [cellKey("91560", "owner"), 1.18],
  [cellKey("91560", "tenant"), 1.0],
  [cellKey("91585", "owner"), 0.78],
  // 91585/tenant missing
]);

describe("<HeatmapGrid> mount", () => {
  it("renders the grid + corner + headers + body", () => {
    render(<HeatmapGrid rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />);
    expect(screen.getByTestId("rater-heatmap-grid")).toBeInTheDocument();
    expect(screen.getByTestId("rater-heatmap-grid-corner")).toHaveTextContent(
      "class · ownership",
    );
    expect(screen.getByTestId("rater-heatmap-grid-header-row")).toBeInTheDocument();
    expect(screen.getByTestId("rater-heatmap-grid-header-col")).toBeInTheDocument();
    expect(screen.getByTestId("rater-heatmap-grid-body")).toBeInTheDocument();
  });

  it("data-row-count + data-col-count reflect axis lengths", () => {
    render(<HeatmapGrid rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />);
    const grid = screen.getByTestId("rater-heatmap-grid");
    expect(grid).toHaveAttribute("data-row-count", "3");
    expect(grid).toHaveAttribute("data-col-count", "2");
  });
});

describe("<HeatmapGrid> heat encoding", () => {
  it("assigns the right bucket per cell value", () => {
    render(<HeatmapGrid rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />);
    // 1.35 → 6 (deep surcharge), 1.42 → 6, 1.18 → 5 (15–30% band),
    // 1.0 → 3 (baseline), 0.78 → 2.
    expect(
      screen.getByTestId("rater-heatmap-grid-cell-91342-owner"),
    ).toHaveAttribute("data-bucket", "6");
    expect(
      screen.getByTestId("rater-heatmap-grid-cell-91342-tenant"),
    ).toHaveAttribute("data-bucket", "6");
    expect(
      screen.getByTestId("rater-heatmap-grid-cell-91560-owner"),
    ).toHaveAttribute("data-bucket", "5");
    expect(
      screen.getByTestId("rater-heatmap-grid-cell-91560-tenant"),
    ).toHaveAttribute("data-bucket", "3");
    expect(
      screen.getByTestId("rater-heatmap-grid-cell-91585-owner"),
    ).toHaveAttribute("data-bucket", "2");
  });

  it("missing cells get data-empty=true + data-bucket=0", () => {
    render(<HeatmapGrid rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />);
    const missing = screen.getByTestId(
      "rater-heatmap-grid-cell-91585-tenant",
    );
    expect(missing).toHaveAttribute("data-empty", "true");
    expect(missing).toHaveAttribute("data-bucket", "0");
  });

  it("cell content shows the formatted value (or · for empty)", () => {
    render(<HeatmapGrid rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />);
    expect(
      screen.getByTestId("rater-heatmap-grid-cell-91342-owner"),
    ).toHaveTextContent("1.35");
    expect(
      screen.getByTestId("rater-heatmap-grid-cell-91585-tenant"),
    ).toHaveTextContent("·");
  });
});

describe("<HeatmapGrid> focus + hover", () => {
  it("focusedKey marks the cell + row header + col header", () => {
    render(
      <HeatmapGrid
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        focusedKey={cellKey("91560", "owner")}
      />,
    );
    expect(
      screen.getByTestId("rater-heatmap-grid-cell-91560-owner"),
    ).toHaveAttribute("data-focused", "true");
    expect(
      screen
        .getByTestId("rater-heatmap-grid-row-h-91560")
        .className.includes("is-focused"),
    ).toBe(true);
    expect(
      screen
        .getByTestId("rater-heatmap-grid-col-h-owner")
        .className.includes("is-focused"),
    ).toBe(true);
  });

  it("hovering a cell fires onHoverChange with the (rowId, colId) pair", () => {
    const onHover = vi.fn();
    render(
      <HeatmapGrid
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onHoverChange={onHover}
      />,
    );
    const cell = screen.getByTestId("rater-heatmap-grid-cell-91342-tenant");
    fireEvent.mouseEnter(cell);
    expect(onHover).toHaveBeenCalledWith("91342", "tenant");
  });

  it("local hover applies the focus highlight without a parent round-trip", () => {
    render(<HeatmapGrid rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />);
    const cell = screen.getByTestId("rater-heatmap-grid-cell-91342-tenant");
    fireEvent.mouseEnter(cell);
    expect(cell).toHaveAttribute("data-focused", "true");
    fireEvent.mouseLeave(cell);
    expect(cell).toHaveAttribute("data-focused", "false");
  });
});

describe("<HeatmapGrid> title tooltip", () => {
  it("title carries the deviation percentage", () => {
    render(<HeatmapGrid rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />);
    const cell = screen.getByTestId("rater-heatmap-grid-cell-91342-owner");
    expect(cell.getAttribute("title")).toContain("+35.0%");
  });

  it("title for empty cells says 'no value'", () => {
    render(<HeatmapGrid rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />);
    const missing = screen.getByTestId(
      "rater-heatmap-grid-cell-91585-tenant",
    );
    expect(missing.getAttribute("title")).toContain("no value");
  });
});

describe("<HeatmapGrid> legend", () => {
  it("renders 7 legend entries by default", () => {
    render(<HeatmapGrid rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />);
    expect(screen.getByTestId("rater-heatmap-grid-legend")).toBeInTheDocument();
    for (let i = 1; i <= 7; i++) {
      expect(
        screen.getByTestId(`rater-heatmap-grid-legend-${i}`),
      ).toBeInTheDocument();
    }
  });

  it("hideLegend hides the legend", () => {
    render(
      <HeatmapGrid
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        hideLegend
      />,
    );
    expect(
      screen.queryByTestId("rater-heatmap-grid-legend"),
    ).not.toBeInTheDocument();
  });
});

describe("<HeatmapGrid> filed overlay (Brief 34 PR 34.6)", () => {
  it("renders a delta annotation when filedCells differs", () => {
    render(
      <HeatmapGrid
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        filedCells={
          new Map<string, number>([[cellKey("91342", "owner"), 1.25]])
        }
      />,
    );
    // 1.35 vs 1.25 → +8.0%
    const delta = screen.getByTestId(
      "rater-heatmap-grid-cell-delta-91342-owner",
    );
    expect(delta).toBeInTheDocument();
    expect(delta.textContent).toMatch(/\+?8\.0%/);
  });

  it("does NOT render delta when current matches filed", () => {
    render(
      <HeatmapGrid
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        filedCells={
          new Map<string, number>([[cellKey("91342", "owner"), 1.35]])
        }
      />,
    );
    expect(
      screen.queryByTestId("rater-heatmap-grid-cell-delta-91342-owner"),
    ).not.toBeInTheDocument();
  });
});
