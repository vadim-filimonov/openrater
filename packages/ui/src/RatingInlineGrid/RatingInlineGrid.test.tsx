/**
 * <RatingInlineGrid> tests — Brief 82 R2 (D-B).
 *
 * Pins the in-row table editor's contract:
 *   - 2-D tables render the full row × col matrix with axis names
 *     (the dead inspector's "can't hold a matrix honestly" is over);
 *   - 1-D tables render a single Value column;
 *   - edits commit through onCellChange with the cellKey grammar's
 *     (rowId, colId) pair — blank/non-numeric input never commits;
 *   - absent onCellChange renders read-only inputs.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RatingInlineGrid } from "./RatingInlineGrid";

const ROWS = [
  { id: "frame", label: "Frame" },
  { id: "masonry", label: "Masonry" },
] as const;
const COLS = [
  { id: "building", label: "Building" },
  { id: "bpp", label: "BPP" },
] as const;

const keyOf = (r: string, c: string | null): string =>
  c === null ? r : `${r}|${c}`;

describe("<RatingInlineGrid> (Brief 82 R2)", () => {
  it("renders a 2-D matrix with axis names and committed values", () => {
    render(
      <RatingInlineGrid
        rowDimName="Construction"
        rowLevels={ROWS}
        colDimName="Coverage"
        colLevels={COLS}
        cells={
          new Map([
            [keyOf("frame", "building"), 0.94],
            [keyOf("masonry", "bpp"), 0.85],
          ])
        }
        cellKeyOf={keyOf}
        onCellChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Construction")).toBeInTheDocument();
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-rating-inline-grid-cell-frame-building"),
    ).toHaveValue("0.94");
    // the foot names the shape in plan words
    expect(screen.getByText(/2 × 2 · Construction × Coverage/)).toBeInTheDocument();
  });

  it("a 1-D table renders a single Value column", () => {
    render(
      <RatingInlineGrid
        rowDimName="Territory"
        rowLevels={ROWS}
        cells={new Map([[keyOf("frame", null), 1.25]])}
        cellKeyOf={keyOf}
        onCellChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-rating-inline-grid-cell-frame"),
    ).toHaveValue("1.25");
  });

  it("commits edits through onCellChange with (rowId, colId); junk never commits", () => {
    const onCellChange = vi.fn();
    render(
      <RatingInlineGrid
        rowDimName="Construction"
        rowLevels={ROWS}
        colDimName="Coverage"
        colLevels={COLS}
        cells={new Map()}
        cellKeyOf={keyOf}
        onCellChange={onCellChange}
      />,
    );
    const cell = screen.getByTestId(
      "rater-rating-inline-grid-cell-masonry-bpp",
    );
    fireEvent.change(cell, { target: { value: "0.85" } });
    fireEvent.blur(cell);
    expect(onCellChange).toHaveBeenCalledWith("masonry", "bpp", 0.85);
    // Enter commits too (the keyboard path).
    fireEvent.change(cell, { target: { value: "0.9" } });
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(onCellChange).toHaveBeenLastCalledWith("masonry", "bpp", 0.9);
    // Junk + blank never commit.
    onCellChange.mockClear();
    fireEvent.change(cell, { target: { value: "abc" } });
    fireEvent.blur(cell);
    fireEvent.change(cell, { target: { value: "" } });
    fireEvent.blur(cell);
    expect(onCellChange).not.toHaveBeenCalled();
  });

  it("renders read-only without onCellChange", () => {
    render(
      <RatingInlineGrid
        rowDimName="Territory"
        rowLevels={ROWS}
        cells={new Map()}
        cellKeyOf={keyOf}
      />,
    );
    expect(
      screen.getByTestId("rater-rating-inline-grid-cell-frame"),
    ).toBeDisabled();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
  });
});
