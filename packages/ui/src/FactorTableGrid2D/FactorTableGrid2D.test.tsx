/**
 * <FactorTableGrid2D> tests — Brief 33 PR 33.3.
 *
 * Covers:
 *   • Mount + corner label (2-D "rowSlug · colSlug" + 1-D "rowSlug")
 *   • Col + row headers render with labels + sublabels
 *   • Cells render values, format three-decimal trimmed
 *   • is-default tint for 1.00, is-empty for missing, is-pending for pending keys
 *   • Click cell → enters edit mode → blur commits → onCellEdit fires
 *   • Enter commits; Escape cancels; Tab commits (default focus moves out)
 *   • 1-D mode (no colAxis) renders a single "Factor" col header
 *   • readOnly mode suppresses edit
 *   • Non-numeric input is rejected (no onCellEdit fire)
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  FactorTableGrid2D,
  cellKey,
  type FactorTableGrid2DAxis,
} from "./FactorTableGrid2D";

// ──────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────

const ROW_AXIS: FactorTableGrid2DAxis = {
  dimSlug: "construction",
  values: [
    { id: "frame", label: "Frame" },
    { id: "joisted_masonry", label: "Joisted masonry" },
    { id: "fire_resistive", label: "Fire-resistive" },
  ],
};

const COL_AXIS: FactorTableGrid2DAxis = {
  dimSlug: "ownership",
  values: [
    { id: "owner", label: "Owner-occupied" },
    { id: "tenant", label: "Tenant-occupied" },
  ],
};

function makeCells(entries: Array<[string, number]>): ReadonlyMap<string, number> {
  return new Map(entries);
}

// ──────────────────────────────────────────────────────────────────
// Mount + structure
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableGrid2D> mount", () => {
  it("renders the grid + corner + header rows in 2-D", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
      />,
    );
    expect(screen.getByTestId("rater-ft-grid-2d")).toBeInTheDocument();
    expect(screen.getByTestId("rater-ft-grid-2d-corner")).toHaveTextContent(
      "construction · ownership",
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-header-row"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-ft-grid-2d-header-col"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rater-ft-grid-2d-body")).toBeInTheDocument();
  });

  it("renders one col-h per col axis value with label + sublabel", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-col-h-owner"),
    ).toHaveTextContent("Owner-occupied");
    expect(
      screen.getByTestId("rater-ft-grid-2d-col-h-owner"),
    ).toHaveTextContent("owner"); // sublabel falls back to id
    expect(
      screen.getByTestId("rater-ft-grid-2d-col-h-tenant"),
    ).toHaveTextContent("Tenant-occupied");
  });

  it("renders one row-h per row axis value", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-row-h-frame"),
    ).toHaveTextContent("Frame");
    expect(
      screen.getByTestId("rater-ft-grid-2d-row-h-joisted_masonry"),
    ).toHaveTextContent("Joisted masonry");
  });

  it("data-row-count and data-col-count reflect axis lengths", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
      />,
    );
    const grid = screen.getByTestId("rater-ft-grid-2d");
    expect(grid).toHaveAttribute("data-row-count", "3");
    expect(grid).toHaveAttribute("data-col-count", "2");
  });
});

// ──────────────────────────────────────────────────────────────────
// Cell rendering + tint states
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableGrid2D> cell rendering", () => {
  it("renders cell values, three-decimal trimmed", () => {
    const cells = makeCells([
      [cellKey("frame", "owner"), 1.25],
      [cellKey("frame", "tenant"), 1.0],
      [cellKey("joisted_masonry", "owner"), 0.875],
    ]);
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={cells}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    ).toHaveTextContent("1.25");
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-tenant"),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-joisted_masonry-owner"),
    ).toHaveTextContent("0.875");
  });

  it("marks value === 1 as default-tinted", () => {
    const cells = makeCells([
      [cellKey("frame", "owner"), 1],
      [cellKey("frame", "tenant"), 1.25],
    ]);
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={cells}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    ).toHaveAttribute("data-default", "true");
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-tenant"),
    ).toHaveAttribute("data-default", "false");
  });

  it("marks missing-value cells as is-empty", () => {
    const cells = makeCells([
      [cellKey("frame", "owner"), 1.25],
      // Other cells missing
    ]);
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={cells}
      />,
    );
    const empty = screen.getByTestId(
      "rater-ft-grid-2d-cell-joisted_masonry-tenant",
    );
    expect(empty.className).toMatch(/is-empty/);
  });

  it("marks cells in pendingKeys as is-pending", () => {
    const cells = makeCells([[cellKey("frame", "owner"), 1.25]]);
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={cells}
        pendingKeys={new Set([cellKey("frame", "owner")])}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    ).toHaveAttribute("data-pending", "true");
  });
});

// ──────────────────────────────────────────────────────────────────
// Edit interaction
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableGrid2D> cell editing", () => {
  it("click cell → enters edit mode → blur commits with onCellEdit", () => {
    const onCellEdit = vi.fn();
    const cells = makeCells([[cellKey("frame", "owner"), 1.0]]);
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={cells}
        onCellEdit={onCellEdit}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    const input = screen.getByTestId(
      "rater-ft-grid-2d-cell-input",
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.blur(input);
    expect(onCellEdit).toHaveBeenCalledWith("frame", "owner", 1.5);
  });

  it("Enter key commits the edit", () => {
    const onCellEdit = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.0]])}
        onCellEdit={onCellEdit}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    const input = screen.getByTestId(
      "rater-ft-grid-2d-cell-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2.0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCellEdit).toHaveBeenCalledWith("frame", "owner", 2.0);
  });

  it("Escape key cancels the edit without firing onCellEdit", () => {
    const onCellEdit = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.0]])}
        onCellEdit={onCellEdit}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    const input = screen.getByTestId(
      "rater-ft-grid-2d-cell-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it("non-numeric input is rejected (no onCellEdit fire)", () => {
    const onCellEdit = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.0]])}
        onCellEdit={onCellEdit}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    const input = screen.getByTestId(
      "rater-ft-grid-2d-cell-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "not-a-number" } });
    fireEvent.blur(input);
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it("readOnly suppresses entering edit mode", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.0]])}
        readOnly
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    expect(
      screen.queryByTestId("rater-ft-grid-2d-cell-input"),
    ).not.toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// 1-D mode (no colAxis)
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableGrid2D> 1-D mode", () => {
  it("renders a single 'Factor' column header when colAxis omitted", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        cells={makeCells([])}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-col-h-factor"),
    ).toHaveTextContent("Factor");
  });

  it("corner label drops the colSlug for 1-D", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        cells={makeCells([])}
      />,
    );
    expect(screen.getByTestId("rater-ft-grid-2d-corner")).toHaveTextContent(
      "construction",
    );
  });

  it("cells use the row id only as the cell key", () => {
    const cells = makeCells([
      [cellKey("frame", null), 1.5],
      [cellKey("joisted_masonry", null), 0.9],
    ]);
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        cells={cells}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-frame"),
    ).toHaveTextContent("1.5");
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-joisted_masonry"),
    ).toHaveTextContent("0.9");
  });

  it("onCellEdit fires with null colId in 1-D", () => {
    const onCellEdit = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        cells={makeCells([[cellKey("frame", null), 1]])}
        onCellEdit={onCellEdit}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame"));
    const input = screen.getByTestId(
      "rater-ft-grid-2d-cell-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.85" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCellEdit).toHaveBeenCalledWith("frame", null, 0.85);
  });
});

// ──────────────────────────────────────────────────────────────────
// Col virtualization flag
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableGrid2D> col virtualization", () => {
  it("data-virtualize-cols is false below threshold", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
      />,
    );
    expect(screen.getByTestId("rater-ft-grid-2d")).toHaveAttribute(
      "data-virtualize-cols",
      "false",
    );
  });

  it("data-virtualize-cols is true once col count crosses threshold", () => {
    const wideCols: FactorTableGrid2DAxis = {
      dimSlug: "wide_col",
      values: Array.from({ length: 60 }, (_, i) => ({
        id: `col_${i}`,
        label: `Col ${i}`,
      })),
    };
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={wideCols}
        cells={makeCells([])}
      />,
    );
    expect(screen.getByTestId("rater-ft-grid-2d")).toHaveAttribute(
      "data-virtualize-cols",
      "true",
    );
  });
});

// ──────────────────────────────────────────────────────────────────
// PR 33.4 — Selection model
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableGrid2D> selection (PR 33.4)", () => {
  it("bare click on a cell selects just that cell (single-cell selection)", () => {
    const onSelectionChange = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const next = onSelectionChange.mock.calls[0]![0] as Set<string>;
    expect(Array.from(next)).toEqual(["frame::owner"]);
  });

  it("Shift+click extends a rectangle from the anchor cell", () => {
    let selection = new Set<string>();
    const onSelectionChange = vi.fn((next: Set<string>) => {
      selection = next;
    });
    const { rerender } = render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={selection}
        onSelectionChange={onSelectionChange}
      />,
    );
    // Anchor on "frame::owner"
    fireEvent.click(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    rerender(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={selection}
        onSelectionChange={onSelectionChange}
      />,
    );
    // Shift+click "joisted_masonry::tenant" → rect of 4 cells
    fireEvent.click(
      screen.getByTestId(
        "rater-ft-grid-2d-cell-joisted_masonry-tenant",
      ),
      { shiftKey: true },
    );
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    const rect = onSelectionChange.mock.calls[1]![0] as Set<string>;
    expect(rect.size).toBe(4);
    expect(rect.has("frame::owner")).toBe(true);
    expect(rect.has("frame::tenant")).toBe(true);
    expect(rect.has("joisted_masonry::owner")).toBe(true);
    expect(rect.has("joisted_masonry::tenant")).toBe(true);
  });

  it("Cmd+click toggles a cell in the existing selection", () => {
    const onSelectionChange = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={new Set(["frame::owner"])}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(
      screen.getByTestId(
        "rater-ft-grid-2d-cell-fire_resistive-tenant",
      ),
      { metaKey: true },
    );
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const next = onSelectionChange.mock.calls[0]![0] as Set<string>;
    expect(next.has("frame::owner")).toBe(true);
    expect(next.has("fire_resistive::tenant")).toBe(true);
  });

  it("Cmd+click on a selected cell removes it from selection", () => {
    const onSelectionChange = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={
          new Set(["frame::owner", "frame::tenant"])
        }
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
      { metaKey: true },
    );
    const next = onSelectionChange.mock.calls[0]![0] as Set<string>;
    expect(next.has("frame::owner")).toBe(false);
    expect(next.has("frame::tenant")).toBe(true);
  });

  it("clicking a row header selects all cells in that row", () => {
    const onSelectionChange = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-row-h-frame"));
    const next = onSelectionChange.mock.calls[0]![0] as Set<string>;
    expect(next.size).toBe(2);
    expect(next.has("frame::owner")).toBe(true);
    expect(next.has("frame::tenant")).toBe(true);
  });

  it("clicking a col header selects all cells in that col", () => {
    const onSelectionChange = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-col-h-owner"));
    const next = onSelectionChange.mock.calls[0]![0] as Set<string>;
    expect(next.size).toBe(3); // 3 rows × 1 col
    expect(next.has("frame::owner")).toBe(true);
    expect(next.has("joisted_masonry::owner")).toBe(true);
    expect(next.has("fire_resistive::owner")).toBe(true);
  });

  it("clicking the corner selects every cell in the grid", () => {
    const onSelectionChange = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-corner"));
    const next = onSelectionChange.mock.calls[0]![0] as Set<string>;
    expect(next.size).toBe(6); // 3 rows × 2 cols
  });

  it("Escape clears selection when grid has focus", () => {
    const onSelectionChange = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={new Set(["frame::owner", "frame::tenant"])}
        onSelectionChange={onSelectionChange}
      />,
    );
    const grid = screen.getByTestId("rater-ft-grid-2d");
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const next = onSelectionChange.mock.calls[0]![0] as Set<string>;
    expect(next.size).toBe(0);
  });

  it("selected cells get the is-selected class + data-selected attribute", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.25]])}
        selectedCells={new Set(["frame::owner"])}
        onSelectionChange={() => {}}
      />,
    );
    const cell = screen.getByTestId("rater-ft-grid-2d-cell-frame-owner");
    expect(cell.className).toMatch(/is-selected/);
    expect(cell).toHaveAttribute("data-selected", "true");
  });

  it("double-click enters edit mode (selection-wired model)", () => {
    const onCellEdit = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1]])}
        onCellEdit={onCellEdit}
        selectedCells={new Set(["frame::owner"])}
        onSelectionChange={() => {}}
      />,
    );
    fireEvent.doubleClick(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    const input = screen.getByTestId(
      "rater-ft-grid-2d-cell-input",
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCellEdit).toHaveBeenCalledWith("frame", "owner", 1.5);
  });

  it("data-selection-size reflects the selection set size", () => {
    const { rerender } = render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={new Set()}
        onSelectionChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-grid-2d")).toHaveAttribute(
      "data-selection-size",
      "0",
    );
    rerender(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([])}
        selectedCells={
          new Set(["frame::owner", "frame::tenant"])
        }
        onSelectionChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-grid-2d")).toHaveAttribute(
      "data-selection-size",
      "2",
    );
  });
});

// ──────────────────────────────────────────────────────────────────
// Brief 34 PR 34.5 — Cross-highlight (focusedKey + onHoverChange)
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableGrid2D> cross-highlight (Brief 34 PR 34.5)", () => {
  it("fires onHoverChange(cellKey) on cell mouse-enter", () => {
    const onHover = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.0]])}
        onHoverChange={onHover}
      />,
    );
    fireEvent.mouseEnter(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    expect(onHover).toHaveBeenCalledWith("frame::owner");
  });

  it("fires onHoverChange(null) on cell mouse-leave", () => {
    const onHover = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.0]])}
        onHoverChange={onHover}
      />,
    );
    fireEvent.mouseLeave(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    expect(onHover).toHaveBeenCalledWith(null);
  });

  it("does NOT attach mouse handlers when onHoverChange is omitted", () => {
    const onHover = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.0]])}
      />,
    );
    fireEvent.mouseEnter(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    );
    // No handler wired, no fire — assert nothing was called.
    expect(onHover).not.toHaveBeenCalled();
  });

  it("focusedKey tints the matching cell + row + col headers (2-D)", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.0]])}
        focusedKey="frame::owner"
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    ).toHaveClass("is-cross-focused");
    expect(
      screen.getByTestId("rater-ft-grid-2d-row-h-frame"),
    ).toHaveClass("is-tinted");
    expect(
      screen.getByTestId("rater-ft-grid-2d-col-h-owner"),
    ).toHaveClass("is-tinted");
    // Non-matching headers are NOT tinted.
    expect(
      screen.getByTestId("rater-ft-grid-2d-row-h-joisted_masonry"),
    ).not.toHaveClass("is-tinted");
    expect(
      screen.getByTestId("rater-ft-grid-2d-col-h-tenant"),
    ).not.toHaveClass("is-tinted");
  });

  it("focusedKey on a 1-D table tints the row header only", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        cells={makeCells([[cellKey("frame", null), 1.0]])}
        focusedKey="frame"
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-frame"),
    ).toHaveClass("is-cross-focused");
    expect(
      screen.getByTestId("rater-ft-grid-2d-row-h-frame"),
    ).toHaveClass("is-tinted");
  });

  it("data-cross-focused attribute reflects the focused cell", () => {
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([[cellKey("frame", "owner"), 1.0]])}
        focusedKey="frame::owner"
      />,
    );
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"),
    ).toHaveAttribute("data-cross-focused", "true");
    expect(
      screen.getByTestId("rater-ft-grid-2d-cell-joisted_masonry-owner"),
    ).toHaveAttribute("data-cross-focused", "false");
  });
});

// ──────────────────────────────────────────────────────────────────
// cellKey helper
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableGrid2D> keyboard layer (Brief 67 §3.2)", () => {
  function setup(over: Record<string, unknown> = {}) {
    const onSelectionChange = vi.fn();
    const onCellEdit = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([["frame::owner", 1.25]])}
        onSelectionChange={onSelectionChange}
        onCellEdit={onCellEdit}
        selectedCells={new Set()}
        {...over}
      />,
    );
    return { onSelectionChange, onCellEdit };
  }
  const grid = () => screen.getByTestId("rater-ft-grid-2d");

  it("ArrowDown from nothing lands on the first cell; arrows rove with clamping", () => {
    const { onSelectionChange } = setup();
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    expect([...onSelectionChange.mock.calls.at(-1)![0]]).toEqual([
      "frame::owner",
    ]);
    // Click an anchor, then arrow right.
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.keyDown(grid(), { key: "ArrowRight" });
    expect([...onSelectionChange.mock.calls.at(-1)![0]]).toEqual([
      "frame::tenant",
    ]);
    // Clamp at the right edge — selection stays put.
    fireEvent.keyDown(grid(), { key: "ArrowRight" });
    expect([...onSelectionChange.mock.calls.at(-1)![0]]).toEqual([
      "frame::tenant",
    ]);
  });

  it("Shift+Arrow extends the rect from the anchor", () => {
    const { onSelectionChange } = setup();
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
    const sel = onSelectionChange.mock.calls.at(-1)![0] as Set<string>;
    expect(sel.has("frame::owner")).toBe(true);
    expect(sel.has("joisted_masonry::owner")).toBe(true);
    expect(sel.size).toBe(2);
  });

  it("Enter on the active cell opens the edit with the current value", () => {
    setup();
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.keyDown(grid(), { key: "Enter" });
    const input = screen.getByTestId(
      "rater-ft-grid-2d-cell-input",
    ) as HTMLInputElement;
    expect(input.value).toBe("1.25");
  });

  it("type-to-replace: a digit opens the edit ALREADY containing it", () => {
    setup();
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.keyDown(grid(), { key: "2" });
    const input = screen.getByTestId(
      "rater-ft-grid-2d-cell-input",
    ) as HTMLInputElement;
    expect(input.value).toBe("2");
  });

  it("a committing Enter advances the active cell DOWN (the Excel contract)", () => {
    const { onSelectionChange, onCellEdit } = setup();
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.keyDown(grid(), { key: "Enter" });
    const input = screen.getByTestId("rater-ft-grid-2d-cell-input");
    fireEvent.change(input, { target: { value: "1.4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCellEdit).toHaveBeenCalledWith("frame", "owner", 1.4);
    expect([...onSelectionChange.mock.calls.at(-1)![0]]).toEqual([
      "joisted_masonry::owner",
    ]);
  });

  it("Tab commits and advances RIGHT; the active cell carries the ring", () => {
    const { onSelectionChange, onCellEdit } = setup();
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.keyDown(grid(), { key: "9" });
    const input = screen.getByTestId("rater-ft-grid-2d-cell-input");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onCellEdit).toHaveBeenCalledWith("frame", "owner", 9);
    expect([...onSelectionChange.mock.calls.at(-1)![0]]).toEqual([
      "frame::tenant",
    ]);
  });

  it("read-only grids never open an edit from the keyboard", () => {
    setup({ readOnly: true });
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.keyDown(grid(), { key: "Enter" });
    fireEvent.keyDown(grid(), { key: "2" });
    expect(
      screen.queryByTestId("rater-ft-grid-2d-cell-input"),
    ).not.toBeInTheDocument();
  });
});

describe("<FactorTableGrid2D> paste + copy (Brief 67 walkthrough fixes)", () => {
  function setup(over: Record<string, unknown> = {}) {
    const onSelectionChange = vi.fn();
    const onCellEdit = vi.fn();
    render(
      <FactorTableGrid2D
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={makeCells([["frame::owner", 1.25]])}
        onSelectionChange={onSelectionChange}
        onCellEdit={onCellEdit}
        selectedCells={new Set()}
        {...over}
      />,
    );
    return { onSelectionChange, onCellEdit };
  }
  const grid = () => screen.getByTestId("rater-ft-grid-2d");

  it("pastes a TSV block row-major from the active cell; overflow + junk skipped", () => {
    const { onCellEdit, onSelectionChange } = setup();
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.paste(grid(), {
      clipboardData: {
        getData: () => "1.1\t1.2\n0.9\tabc\n0.8\t0.7\n5\t6",
      },
    });
    // 3 rows fit (frame/joisted/fire); the 4th row overflows; "abc" skips.
    expect(onCellEdit).toHaveBeenCalledWith("frame", "owner", 1.1);
    expect(onCellEdit).toHaveBeenCalledWith("frame", "tenant", 1.2);
    expect(onCellEdit).toHaveBeenCalledWith("joisted_masonry", "owner", 0.9);
    expect(onCellEdit).toHaveBeenCalledWith("fire_resistive", "owner", 0.8);
    expect(onCellEdit).toHaveBeenCalledWith("fire_resistive", "tenant", 0.7);
    expect(onCellEdit).toHaveBeenCalledTimes(5);
    // The landed rect becomes the selection (visible confirmation).
    const landed = onSelectionChange.mock.calls.at(-1)![0] as Set<string>;
    expect(landed.size).toBe(5);
    expect(landed.has("frame::owner")).toBe(true);
  });

  it("read-only grids ignore paste entirely", () => {
    const { onCellEdit } = setup({ readOnly: true });
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.paste(grid(), {
      clipboardData: { getData: () => "9\t9" },
    });
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it("meta+C serializes the selection bounding rect as TSV", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    setup({
      selectedCells: new Set(["frame::owner", "frame::tenant"]),
    });
    fireEvent.keyDown(grid(), { key: "c", metaKey: true });
    expect(writeText).toHaveBeenCalledWith("1.25\t");
  });

  it("opening a high-precision cell seeds the RAW value (no 3dp corruption)", () => {
    setup({ cells: makeCells([["frame::owner", 1.0125]]) });
    fireEvent.click(screen.getByTestId("rater-ft-grid-2d-cell-frame-owner"));
    fireEvent.keyDown(grid(), { key: "Enter" });
    const input = screen.getByTestId(
      "rater-ft-grid-2d-cell-input",
    ) as HTMLInputElement;
    expect(input.value).toBe("1.0125");
  });
});

describe("cellKey helper", () => {
  it("returns row id only for 1-D", () => {
    expect(cellKey("frame", null)).toBe("frame");
  });
  it("returns row::col for 2-D", () => {
    expect(cellKey("frame", "owner")).toBe("frame::owner");
  });
});
