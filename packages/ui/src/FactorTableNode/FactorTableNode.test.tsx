/**
 * <FactorTableNode> tests — Brief 33 PR 33.2.
 *
 * Covers:
 *   • Empty + draft states render correctly
 *   • Title is controlled (commits on change)
 *   • Meta string updates with axes
 *   • Status pill states + computed default (empty / draft when at least 1 axis)
 *   • Drop-target activation on dragover; release on drop or leave
 *   • Drop fires onAxesChange with the right axis + slug
 *   • Drop is rejected when dataTransfer doesn't carry the dim MIME
 *   • Drop is rejected when slug doesn't reference a real dim
 *   • Self-pairing is forbidden (same dim on both axes is a no-op)
 *   • ✕ clear button fires onAxesChange with null for that axis
 *   • Generate button: disabled when no axes; enabled when ≥ 1 axis
 *   • onGenerate fires when Generate is clicked
 *   • Filled chip shows display_name + level count
 *
 * 14+ tests per Brief 33 §10 PR 33.2 spec.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  FactorTableNode,
  type FactorTableNodeAxes,
} from "./FactorTableNode";
import type { DimensionRow } from "../DimensionsTable";

// ──────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────

const CONSTRUCTION: DimensionRow = {
  id: "construction",
  display_name: "Construction",
  slug: "construction",
  dimension_type: "standard",
  shape: "categorical",
  data_type: "string",
  role: "rating-input",
  levels: [
    { kind: "categorical", id: "frame", label: "Frame", aliases: [] },
    { kind: "categorical", id: "joisted_masonry", label: "Joisted masonry", aliases: [] },
    { kind: "categorical", id: "fire_resistive", label: "Fire-resistive", aliases: [] },
  ],
};

const OWNERSHIP: DimensionRow = {
  id: "ownership",
  display_name: "Ownership",
  slug: "ownership",
  dimension_type: "standard",
  shape: "categorical",
  data_type: "string",
  role: "rating-input",
  levels: [
    { kind: "categorical", id: "owner", label: "Owner", aliases: [] },
    { kind: "categorical", id: "tenant", label: "Tenant", aliases: [] },
  ],
};

// PR 33.6 fixture — composite dim whose axes are `construction × ownership`.

const DIMS: readonly DimensionRow[] = [CONSTRUCTION, OWNERSHIP];

const EMPTY_AXES: FactorTableNodeAxes = {
  rowDimSlug: null,
  colDimSlug: null,
};

/**
 * Build a dataTransfer-shaped mock that fireEvent will use. JSDOM
 * doesn't implement DataTransfer; we hand-roll a minimal shape that
 * supports getData / setData / types.
 */


// ──────────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableNode> title", () => {
  it("renders the controlled title + fires onTitleChange on input", () => {
    const onTitleChange = vi.fn();
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={EMPTY_AXES}
        title="initial"
        onTitleChange={onTitleChange}
      />,
    );
    const input = screen.getByTestId("rater-ft-node-title") as HTMLInputElement;
    expect(input.value).toBe("initial");
    fireEvent.change(input, { target: { value: "construction_factor" } });
    expect(onTitleChange).toHaveBeenCalledWith("construction_factor");
  });
});

// ──────────────────────────────────────────────────────────────────
// Drag-drop
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableNode> materialized state (PR 33.3)", () => {
  const ROW_AXES_FULL: FactorTableNodeAxes = {
    rowDimSlug: "construction",
    colDimSlug: "ownership",
  };

  it("renders the embedded grid when cells prop is provided", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title="test"
        onTitleChange={() => {}}
        cells={new Map([["frame::owner", 1]])}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-node-grid-wrap"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rater-ft-node-grid")).toBeInTheDocument();
    // The axis-drop frame is HIDDEN
    expect(
      screen.queryByTestId("rater-ft-node-col-slot"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-ft-node-row-slot"),
    ).not.toBeInTheDocument();
  });

  it("data-materialized attribute reflects cells prop presence", () => {
    const { rerender } = render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title="test"
        onTitleChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-node")).toHaveAttribute(
      "data-materialized",
      "false",
    );
    rerender(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title="test"
        onTitleChange={() => {}}
        cells={new Map()}
      />,
    );
    expect(screen.getByTestId("rater-ft-node")).toHaveAttribute(
      "data-materialized",
      "true",
    );
  });


  it("'Edit axes' button is NOT rendered in pre-Generate mode", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title="test"
        onTitleChange={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("rater-ft-node-edit-axes"),
    ).not.toBeInTheDocument();
  });

  it("cell edits propagate via onCellEdit", () => {
    const onCellEdit = vi.fn();
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title="test"
        onTitleChange={() => {}}
        cells={new Map([["frame::owner", 1]])}
        onCellEdit={onCellEdit}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-ft-node-grid-cell-frame-owner"),
    );
    const input = screen.getByTestId(
      "rater-ft-node-grid-cell-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCellEdit).toHaveBeenCalledWith("frame", "owner", 2.5);
  });

  it("renders 1-D grid when only one axis is filled", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={{ rowDimSlug: "construction", colDimSlug: null }}
        title="test"
        onTitleChange={() => {}}
        cells={new Map([["frame", 1]])}
      />,
    );
    // 1-D — the single col header is "Factor"
    expect(
      screen.getByTestId("rater-ft-node-grid-col-h-factor"),
    ).toHaveTextContent("Factor");
  });
});

// ──────────────────────────────────────────────────────────────────
// PR 33.6 — Composite-dim auto-explode (Brief 33 §−1 Q5)
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableNode> chartPane slot (Brief 34 PR 34.4)", () => {
  const ROW_AXES_FULL: FactorTableNodeAxes = {
    rowDimSlug: "construction",
    colDimSlug: "ownership",
  };

  // Brief 34 follow-up — the 60/40 split was replaced by an Apple-
  // style segmented toggle (Table ⇄ Chart). The chart pane now
  // takes the FULL body width when active; the grid takes the
  // full body width when active. Tests below verify the new
  // exclusive-view contract.

  it("co-renders the chart by DEFAULT when materialized (Brief 67)", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        cells={new Map([["frame::owner", 1]])}
        chartPane={<div data-testid="chart-pane-content">CHART</div>}
      />,
    );
    expect(screen.getByTestId("rater-ft-node-grid")).toBeInTheDocument();
    expect(screen.getByTestId("chart-pane-content")).toBeInTheDocument();
  });

  it("renders only the grid when chartPane is omitted (no toggle shown)", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title="test"
        onTitleChange={() => {}}
        cells={new Map()}
      />,
    );
    expect(screen.getByTestId("rater-ft-node-grid")).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-ft-node-view-toggle"),
    ).not.toBeInTheDocument();
  });

  it("chart pane is NOT rendered in pre-Generate (axis-drop) state", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        chartPane={<div data-testid="chart-pane-content">CHART</div>}
      />,
    );
    expect(
      screen.queryByTestId("chart-pane-content"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-ft-node-view-toggle"),
    ).not.toBeInTheDocument();
  });

  it("co-renders the grid AND the chart pane (Brief 67 — the XOR died)", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        cells={new Map([["frame::owner", 1]])}
        chartPane={<div data-testid="chart-pane-content">CHART</div>}
        onChartOpenChange={() => {}}
      />,
    );
    // BOTH halves on screen at once — editing with the shape visible.
    expect(screen.getByTestId("rater-ft-node-grid")).toBeInTheDocument();
    expect(screen.getByTestId("chart-pane-content")).toBeInTheDocument();
    expect(screen.getByTestId("rater-ft-node-body")).toHaveAttribute(
      "data-chart-open",
      "true",
    );
  });

  it("chartOpen=false hides the pane; the toggle fires onChartOpenChange", () => {
    const onChartOpenChange = vi.fn();
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        cells={new Map([["frame::owner", 1]])}
        chartPane={<div data-testid="chart-pane-content">CHART</div>}
        chartOpen={false}
        onChartOpenChange={onChartOpenChange}
      />,
    );
    expect(
      screen.queryByTestId("chart-pane-content"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("rater-ft-node-grid")).toBeInTheDocument();
    const toggle = screen.getByTestId("rater-ft-node-chart-toggle");
    expect(toggle).toHaveTextContent("Show chart");
    fireEvent.click(toggle);
    expect(onChartOpenChange).toHaveBeenCalledWith(true);
  });
});

// ──────────────────────────────────────────────────────────────────
// Brief 34 PR 34.6 — Compare-to-filed toggle button
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableNode> compare-toggle (Brief 34 PR 34.6)", () => {
  const ROW_AXES_FULL: FactorTableNodeAxes = {
    rowDimSlug: "construction",
    colDimSlug: "ownership",
  };

  it("renders the compare-toggle when onCompareModeToggle is provided", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        cells={new Map()}
        onCompareModeToggle={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-node-compare-toggle"),
    ).toBeInTheDocument();
  });

  it("button label reflects compareMode (off → 'Compare to filed', on → 'Comparing')", () => {
    const { rerender } = render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        cells={new Map()}
        onCompareModeToggle={() => {}}
        compareMode={false}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-node-compare-toggle").textContent,
    ).toMatch(/Compare to filed/i);
    rerender(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        cells={new Map()}
        onCompareModeToggle={() => {}}
        compareMode={true}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-node-compare-toggle").textContent,
    ).toMatch(/Comparing/i);
  });

  it("clicking the toggle fires onCompareModeToggle with the next state", () => {
    const onToggle = vi.fn();
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        cells={new Map()}
        onCompareModeToggle={onToggle}
        compareMode={false}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-node-compare-toggle"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("renders the filedLabel suffix when provided + compareMode is active", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        cells={new Map()}
        onCompareModeToggle={() => {}}
        compareMode={true}
        filedLabel="Filed v1"
      />,
    );
    expect(
      screen.getByTestId("rater-ft-node-compare-toggle").textContent,
    ).toContain("Filed v1");
  });

  it("aria-pressed reflects compareMode", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        cells={new Map()}
        onCompareModeToggle={() => {}}
        compareMode={true}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-node-compare-toggle"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("compare-toggle is NOT rendered in pre-Generate (axis-drop) state", () => {
    render(
      <FactorTableNode
        dimensions={DIMS}
        axes={ROW_AXES_FULL}
        title=""
        onTitleChange={() => {}}
        onCompareModeToggle={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("rater-ft-node-compare-toggle"),
    ).not.toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// Territory-keyed grid (cold-test N13 regression)
// ──────────────────────────────────────────────────────────────────
describe("<FactorTableNode> territory-keyed grid (N13)", () => {
  const STATE_GEO: DimensionRow = {
    id: "state",
    display_name: "State",
    slug: "state",
    dimension_type: "geographic",
    shape: "categorical",
    data_type: "string",
    role: "rating-input",
    levels: [
      { kind: "geographic", id: "CA", label: "California" },
      { kind: "geographic", id: "FL", label: "Florida" },
      { kind: "geographic", id: "TX", label: "Texas" },
      { kind: "geographic", id: "NY", label: "New York" },
    ],
    geo_territories: [
      { id: "territory_1", label: "T1", members: ["CA", "FL"] },
      { id: "territory_2", label: "T2", members: ["TX", "NY"] },
    ],
  };

  it("materializes territory rows (T1/T2), NOT the raw state levels", () => {
    render(
      <FactorTableNode
        dimensions={[STATE_GEO]}
        axes={{ rowDimSlug: "state", colDimSlug: null }}
        title="State (D&O)"
        onTitleChange={() => {}}
        cells={
          new Map([
            ["territory_1", 0.85],
            ["territory_2", 1.3],
          ])
        }
        onCellEdit={() => {}}
      />,
    );
    // The raw state list must NOT drive the grid: only the 2 territory
    // rows render, keyed by territory id with T-labels.
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
    expect(screen.queryByText("California")).not.toBeInTheDocument();
    expect(screen.queryByText("Texas")).not.toBeInTheDocument();
  });

  it("reports the keying count (2 territories), not the raw level count", () => {
    render(
      <FactorTableNode
        dimensions={[STATE_GEO]}
        axes={{ rowDimSlug: "state", colDimSlug: null }}
        title="State (D&O)"
        onTitleChange={() => {}}
      />,
    );
    // Meta string uses levelsForKeying(dim).length → "2 × 1", not "4 × 1".
    expect(screen.getByText(/2 rows · one axis/)).toBeInTheDocument();
  });

});

// ──────────────────────────────────────────────────────────────────
// Brief 53 — "+ Coverage split" affordance
// ──────────────────────────────────────────────────────────────────

