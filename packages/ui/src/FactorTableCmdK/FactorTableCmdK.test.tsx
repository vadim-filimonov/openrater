/**
 * <FactorTableCmdK> tests — Brief 33 PR 33.7.
 *
 * Covers:
 *   • Closed palette renders nothing
 *   • Open palette renders input + match list + foot hints
 *   • Empty query matches every cell (capped at MAX_CELL_MATCHES)
 *   • Typing a row label narrows to that row's cells
 *   • Typing a row + col fragment narrows to a single cell
 *   • Cell values appear inline next to the cell label
 *   • Arrow keys move focus
 *   • Enter on a focused row fires onJumpToCell + onClose
 *   • Escape closes without firing onJumpToCell
 *   • Backdrop click closes
 *   • 1-D mode (no colAxis) renders rowDim-only labels
 *   • Empty state renders when no matches
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FactorTableCmdK } from "./FactorTableCmdK";
import type { FactorTableGrid2DAxis } from "../FactorTableGrid2D";

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

const CELLS = new Map<string, number>([
  ["frame::owner", 1.05],
  ["frame::tenant", 1.15],
  ["joisted_masonry::owner", 0.97],
]);

// ──────────────────────────────────────────────────────────────────
// Open / closed gating
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableCmdK> open state", () => {
  it("renders nothing when closed", () => {
    render(
      <FactorTableCmdK
        open={false}
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId("rater-ft-cmdk")).not.toBeInTheDocument();
  });

  it("renders the palette + input + foot when open", () => {
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-cmdk")).toBeInTheDocument();
    expect(screen.getByTestId("rater-ft-cmdk-input")).toBeInTheDocument();
    expect(screen.getByTestId("rater-ft-cmdk-foot")).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// Match list
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableCmdK> matches", () => {
  it("empty query matches every cell (capped)", () => {
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    // 3 rows × 2 cols = 6 matches.
    for (const r of ["frame", "joisted_masonry", "fire_resistive"]) {
      for (const c of ["owner", "tenant"]) {
        expect(
          screen.getByTestId(`rater-ft-cmdk-row-${r}-${c}`),
        ).toBeInTheDocument();
      }
    }
  });

  it("typing a row label narrows to that row's cells", () => {
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    const input = screen.getByTestId(
      "rater-ft-cmdk-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "frame" } });
    // 2 cells for "frame" row
    expect(
      screen.getByTestId("rater-ft-cmdk-row-frame-owner"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-ft-cmdk-row-frame-tenant"),
    ).toBeInTheDocument();
    // joisted_masonry rows should NOT be present
    expect(
      screen.queryByTestId("rater-ft-cmdk-row-joisted_masonry-owner"),
    ).not.toBeInTheDocument();
  });

  it("typing row + col fragments narrows to a single cell", () => {
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("rater-ft-cmdk-input"), {
      target: { value: "joisted owner" },
    });
    expect(
      screen.getByTestId("rater-ft-cmdk-row-joisted_masonry-owner"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-ft-cmdk-row-frame-owner"),
    ).not.toBeInTheDocument();
  });

  it("renders the cell value inline when present", () => {
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("rater-ft-cmdk-input"), {
      target: { value: "frame owner" },
    });
    const row = screen.getByTestId("rater-ft-cmdk-row-frame-owner");
    expect(row).toHaveTextContent("1.05");
  });

  it("shows the empty state when nothing matches", () => {
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("rater-ft-cmdk-input"), {
      target: { value: "xyz_unmatchable" },
    });
    expect(screen.getByTestId("rater-ft-cmdk-empty")).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// Keyboard navigation
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableCmdK> keyboard nav", () => {
  it("ArrowDown moves focus to the next match", () => {
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    const input = screen.getByTestId("rater-ft-cmdk-input");
    // First row is focused by default
    expect(
      screen.getByTestId("rater-ft-cmdk-row-frame-owner").className,
    ).toMatch(/is-focused/);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      screen.getByTestId("rater-ft-cmdk-row-frame-tenant").className,
    ).toMatch(/is-focused/);
  });

  it("ArrowUp moves focus back", () => {
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    const input = screen.getByTestId("rater-ft-cmdk-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    // Now back at "frame-tenant" (index 1)
    expect(
      screen.getByTestId("rater-ft-cmdk-row-frame-tenant").className,
    ).toMatch(/is-focused/);
  });

  it("Enter fires onJumpToCell with the focused cell + closes", () => {
    const onJump = vi.fn();
    const onClose = vi.fn();
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={onJump}
        onClose={onClose}
      />,
    );
    const input = screen.getByTestId("rater-ft-cmdk-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onJump).toHaveBeenCalledWith("frame", "tenant");
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes without firing onJumpToCell", () => {
    const onJump = vi.fn();
    const onClose = vi.fn();
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={onJump}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("rater-ft-cmdk-input"), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
    expect(onJump).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────
// Mouse + backdrop
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableCmdK> mouse interactions", () => {
  it("clicking a row fires onJumpToCell + onClose", () => {
    const onJump = vi.fn();
    const onClose = vi.fn();
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={onJump}
        onClose={onClose}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-ft-cmdk-row-fire_resistive-tenant"),
    );
    expect(onJump).toHaveBeenCalledWith("fire_resistive", "tenant");
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the backdrop fires onClose", () => {
    const onClose = vi.fn();
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        colAxis={COL_AXIS}
        cells={CELLS}
        onJumpToCell={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-cmdk-overlay"));
    expect(onClose).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────
// 1-D mode
// ──────────────────────────────────────────────────────────────────

describe("<FactorTableCmdK> 1-D mode", () => {
  it("renders row-only labels when colAxis is omitted", () => {
    const cells1D = new Map<string, number>([
      ["frame", 1.25],
      ["joisted_masonry", 0.9],
    ]);
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        cells={cells1D}
        onJumpToCell={() => {}}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-ft-cmdk-row-frame"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-ft-cmdk-row-frame-owner"),
    ).not.toBeInTheDocument();
  });

  it("clicking a 1-D row fires onJumpToCell with null colId", () => {
    const cells1D = new Map<string, number>([["frame", 1.25]]);
    const onJump = vi.fn();
    render(
      <FactorTableCmdK
        open
        rowAxis={ROW_AXIS}
        cells={cells1D}
        onJumpToCell={onJump}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-cmdk-row-frame"));
    expect(onJump).toHaveBeenCalledWith("frame", null);
  });
});
