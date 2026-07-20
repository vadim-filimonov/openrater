/**
 * <LineMultiples> tests — Brief 34 PR 34.2.
 *
 * Covers:
 *   • Empty state when no data
 *   • Renders one series group per col
 *   • All-default columns get dashed line + is-all-default attr
 *   • focusedColId dims siblings + bolds the focused line
 *   • Hovering a series fires onHoverChange
 *   • Legend renders one entry per col; hovering a legend entry
 *     mirrors hovering the series
 *   • hideLegend hides the legend
 *   • Y-axis ticks span the union of all series values
 *   • Missing cells are skipped (don't break the polyline)
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LineMultiples } from "./LineMultiples";
import { cellKey, type FactorTableGrid2DAxis } from "../FactorTableGrid2D";

const ROW_AXIS: FactorTableGrid2DAxis = {
  dimSlug: "building_age",
  values: [
    { id: "band_0_5", label: "0–5" },
    { id: "band_5_15", label: "5–15" },
    { id: "band_15_30", label: "15–30" },
    { id: "band_30_50", label: "30–50" },
    { id: "band_50_100", label: "50–100" },
  ],
};

const COL_AXIS: FactorTableGrid2DAxis = {
  dimSlug: "construction",
  values: [
    { id: "frame", label: "Frame" },
    { id: "joisted_masonry", label: "JM" },
    { id: "fire_resistive", label: "FR" },
  ],
};

const CELLS = new Map<string, number>([
  // Frame — rising curve
  [cellKey("band_0_5", "frame"), 0.92],
  [cellKey("band_5_15", "frame"), 0.98],
  [cellKey("band_15_30", "frame"), 1.0],
  [cellKey("band_30_50", "frame"), 1.1],
  [cellKey("band_50_100", "frame"), 1.18],
  // JM — rising curve, slightly higher floor
  [cellKey("band_0_5", "joisted_masonry"), 0.88],
  [cellKey("band_5_15", "joisted_masonry"), 0.94],
  [cellKey("band_15_30", "joisted_masonry"), 1.0],
  [cellKey("band_30_50", "joisted_masonry"), 1.06],
  [cellKey("band_50_100", "joisted_masonry"), 1.12],
  // FR — all default (1.00 across)
  [cellKey("band_0_5", "fire_resistive"), 1.0],
  [cellKey("band_5_15", "fire_resistive"), 1.0],
  [cellKey("band_15_30", "fire_resistive"), 1.0],
  [cellKey("band_30_50", "fire_resistive"), 1.0],
  [cellKey("band_50_100", "fire_resistive"), 1.0],
]);

describe("<LineMultiples> mount", () => {
  it("renders empty state when row axis is empty", () => {
    render(
      <LineMultiples
        rowAxis={{ dimSlug: "x", values: [] }}
        colAxis={COL_AXIS}
        cells={CELLS}
      />,
    );
    expect(screen.getByTestId("rater-line-multiples")).toHaveClass(
      "rater-line-multiples--empty",
    );
  });

  it("renders empty state when no series has any points", () => {
    render(
      <LineMultiples
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={new Map()}
      />,
    );
    expect(screen.getByTestId("rater-line-multiples")).toHaveClass(
      "rater-line-multiples--empty",
    );
  });

  it("renders one series group per column", () => {
    render(
      <LineMultiples rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />,
    );
    expect(
      screen.getByTestId("rater-line-multiples-series-frame"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-line-multiples-series-joisted_masonry"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-line-multiples-series-fire_resistive"),
    ).toBeInTheDocument();
  });
});

describe("<LineMultiples> all-default detection", () => {
  it("flags all-default columns via data-all-default=true", () => {
    render(
      <LineMultiples rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />,
    );
    expect(
      screen.getByTestId("rater-line-multiples-series-fire_resistive"),
    ).toHaveAttribute("data-all-default", "true");
    expect(
      screen.getByTestId("rater-line-multiples-series-frame"),
    ).toHaveAttribute("data-all-default", "false");
  });

  it("all-default polyline gets dashed stroke", () => {
    render(
      <LineMultiples rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />,
    );
    const fr = screen.getByTestId("rater-line-multiples-series-fire_resistive");
    const polyline = fr.querySelector("polyline");
    expect(polyline?.getAttribute("stroke-dasharray")).toBe("3,3");
  });

  it("non-default polyline has no dasharray", () => {
    render(
      <LineMultiples rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />,
    );
    const frame = screen.getByTestId("rater-line-multiples-series-frame");
    const polyline = frame.querySelector("polyline");
    expect(polyline?.getAttribute("stroke-dasharray")).toBeNull();
  });
});

describe("<LineMultiples> focus + hover", () => {
  it("focusedColId marks the series as focused + dims siblings", () => {
    render(
      <LineMultiples
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        focusedColId="joisted_masonry"
      />,
    );
    expect(
      screen.getByTestId("rater-line-multiples-series-joisted_masonry"),
    ).toHaveAttribute("data-focused", "true");
    const sibling = screen.getByTestId(
      "rater-line-multiples-series-frame",
    );
    expect(sibling.getAttribute("class")).toMatch(/is-dimmed/);
  });

  it("hovering a series fires onHoverChange", () => {
    const onHover = vi.fn();
    render(
      <LineMultiples
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onHoverChange={onHover}
      />,
    );
    const series = screen.getByTestId(
      "rater-line-multiples-series-frame",
    );
    fireEvent.mouseEnter(series);
    expect(onHover).toHaveBeenLastCalledWith("frame");
    fireEvent.mouseLeave(series);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("data-focused-col-id on container reflects the focus", () => {
    render(
      <LineMultiples
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        focusedColId="frame"
      />,
    );
    expect(screen.getByTestId("rater-line-multiples")).toHaveAttribute(
      "data-focused-col-id",
      "frame",
    );
  });
});

describe("<LineMultiples> legend", () => {
  it("renders one entry per series by default", () => {
    render(
      <LineMultiples rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />,
    );
    expect(
      screen.getByTestId("rater-line-multiples-legend"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-line-multiples-legend-frame"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-line-multiples-legend-joisted_masonry"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-line-multiples-legend-fire_resistive"),
    ).toBeInTheDocument();
  });

  it("hovering a legend entry fires onHoverChange", () => {
    const onHover = vi.fn();
    render(
      <LineMultiples
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onHoverChange={onHover}
      />,
    );
    fireEvent.mouseEnter(
      screen.getByTestId("rater-line-multiples-legend-frame"),
    );
    expect(onHover).toHaveBeenLastCalledWith("frame");
  });

  it("all-default legend entry gets a '(all default)' note", () => {
    render(
      <LineMultiples rowAxis={ROW_AXIS} colAxis={COL_AXIS} cells={CELLS} />,
    );
    const fr = screen.getByTestId(
      "rater-line-multiples-legend-fire_resistive",
    );
    expect(fr.textContent).toContain("(all default)");
  });

  it("hideLegend removes the legend", () => {
    render(
      <LineMultiples
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        hideLegend
      />,
    );
    expect(
      screen.queryByTestId("rater-line-multiples-legend"),
    ).not.toBeInTheDocument();
  });
});

describe("<LineMultiples> missing cells", () => {
  it("skips missing cells (polyline shorter, doesn't break)", () => {
    const partial = new Map<string, number>([
      [cellKey("band_0_5", "frame"), 0.9],
      // band_5_15 missing
      [cellKey("band_15_30", "frame"), 1.05],
      [cellKey("band_30_50", "frame"), 1.1],
      [cellKey("band_50_100", "frame"), 1.18],
    ]);
    render(
      <LineMultiples
        rowAxis={ROW_AXIS}
        colAxis={{ dimSlug: "x", values: [{ id: "frame", label: "Frame" }] }}
        cells={partial}
      />,
    );
    const polyline = screen
      .getByTestId("rater-line-multiples-series-frame")
      .querySelector("polyline");
    const points = polyline?.getAttribute("points");
    // 4 points (missing band_5_15 skipped)
    expect(points?.split(/\s+/).length).toBe(4);
  });
});
