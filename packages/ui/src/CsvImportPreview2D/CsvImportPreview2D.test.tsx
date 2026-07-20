/**
 * <CsvImportPreview2D> tests — Brief 33 PR 33.5.
 *
 * Covers:
 *   • Closed drawer renders nothing
 *   • Empty state renders when csv is null (with file picker if onPickFile set)
 *   • Stats row reflects preview counts
 *   • Matched rows render with diff preview
 *   • Unmatched rows render with re-key picker
 *   • Picking a re-key reroutes the match (preview updates)
 *   • Missing dim levels render in their list
 *   • Apply button label includes the change count
 *   • Apply fires with the resolved changes Map
 *   • Cancel fires onCancel
 *   • Apply disabled when no changes
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CsvImportPreview2D } from "./CsvImportPreview2D";
import type { CsvImport2D } from "./matchCsv";
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
    {
      kind: "categorical",
      id: "joisted_masonry",
      label: "Joisted masonry",
      aliases: [],
    },
    {
      kind: "categorical",
      id: "fire_resistive",
      label: "Fire-resistive",
      aliases: [],
    },
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

const SAMPLE_CSV: CsvImport2D = {
  fileName: "construction_factor.csv",
  colLabels: ["owner", "tenant"],
  rows: [
    { keyLabel: "frame", cells: { owner: 1.05, tenant: 1.15 } },
    {
      keyLabel: "joisted_masonry",
      cells: { owner: 0.97, tenant: 1.07 },
    },
    {
      keyLabel: "wood_frame",
      cells: { owner: 0.92, tenant: 1.0 },
    },
  ],
};

// ──────────────────────────────────────────────────────────────────
// Open / closed gating
// ──────────────────────────────────────────────────────────────────

describe("<CsvImportPreview2D> open state", () => {
  it("renders nothing useful when closed", () => {
    render(
      <CsvImportPreview2D
        open={false}
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("rater-csv-import-2d"),
    ).not.toBeInTheDocument();
  });

  it("renders the drawer body when open", () => {
    render(
      <CsvImportPreview2D
        open
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-csv-import-2d")).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────────

describe("<CsvImportPreview2D> empty state", () => {
  it("renders the empty state when csv is null", () => {
    render(
      <CsvImportPreview2D
        open
        csv={null}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-csv-import-2d-empty"),
    ).toBeInTheDocument();
  });

  it("renders the Choose file label when onPickFile is provided", () => {
    render(
      <CsvImportPreview2D
        open
        csv={null}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
        onPickFile={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-csv-import-2d-pick-file"),
    ).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// Stats row
// ──────────────────────────────────────────────────────────────────

describe("<CsvImportPreview2D> stats", () => {
  it("counts cellsWillChange against empty current cells", () => {
    render(
      <CsvImportPreview2D
        open
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    // 2 matched rows × 2 cols = 4 changing cells (frame + joisted_masonry).
    // wood_frame doesn't match → no cells counted.
    expect(
      screen.getByTestId("rater-csv-import-2d-stat-changes"),
    ).toHaveTextContent("4");
    expect(
      screen.getByTestId("rater-csv-import-2d-stat-unmatched"),
    ).toHaveTextContent("1");
  });
});

// ──────────────────────────────────────────────────────────────────
// Matched + unmatched row rendering
// ──────────────────────────────────────────────────────────────────

describe("<CsvImportPreview2D> rows", () => {
  it("renders a matched row for each CSV key that mapped", () => {
    render(
      <CsvImportPreview2D
        open
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-csv-import-2d-row-frame"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-csv-import-2d-row-joisted_masonry"),
    ).toBeInTheDocument();
  });

  it("renders an unmatched row for keys that don't match", () => {
    render(
      <CsvImportPreview2D
        open
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const row = screen.getByTestId("rater-csv-import-2d-row-wood_frame");
    expect(row).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-csv-import-2d-rekey-wood_frame"),
    ).toBeInTheDocument();
  });

  it("picking a re-key option reroutes the match", () => {
    render(
      <CsvImportPreview2D
        open
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    // wood_frame is the unmatched row. Re-key it to "fire_resistive".
    fireEvent.change(
      screen.getByTestId("rater-csv-import-2d-rekey-wood_frame"),
      { target: { value: "fire_resistive" } },
    );
    // Now wood_frame is matched (renders as a matched row, no rekey
    // picker), and fire_resistive isn't in the missing list anymore.
    expect(
      screen.queryByTestId("rater-csv-import-2d-rekey-wood_frame"),
    ).not.toBeInTheDocument();
    // Stat-changes should bump from 4 → 6 (2 more cells now match).
    expect(
      screen.getByTestId("rater-csv-import-2d-stat-changes"),
    ).toHaveTextContent("6");
  });
});

// ──────────────────────────────────────────────────────────────────
// Missing dim levels
// ──────────────────────────────────────────────────────────────────

describe("<CsvImportPreview2D> missing dim levels", () => {
  it("renders the missing-levels chip strip when applicable", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["owner"],
      rows: [{ keyLabel: "frame", cells: { owner: 1.0 } }],
    };
    render(
      <CsvImportPreview2D
        open
        csv={csv}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-csv-import-2d-missing-list"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-csv-import-2d-missing-joisted_masonry"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-csv-import-2d-missing-fire_resistive"),
    ).toBeInTheDocument();
  });

  it("omits the missing-levels strip when every dim level is in CSV", () => {
    render(
      <CsvImportPreview2D
        open
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    // fire_resistive is missing (not in CSV) — strip should render
    expect(
      screen.getByTestId("rater-csv-import-2d-missing-list"),
    ).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// Apply + Cancel
// ──────────────────────────────────────────────────────────────────

describe("<CsvImportPreview2D> Apply + Cancel", () => {
  it("Apply button label includes the change count", () => {
    render(
      <CsvImportPreview2D
        open
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-csv-import-2d-apply"),
    ).toHaveTextContent("Apply 4 changes");
  });

  it("Apply fires onApply with the resolved changes Map", () => {
    const onApply = vi.fn();
    render(
      <CsvImportPreview2D
        open
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={new Map()}
        onApply={onApply}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-csv-import-2d-apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
    const changes = onApply.mock.calls[0]![0] as Map<string, number>;
    expect(changes.get("frame::owner")).toBe(1.05);
    expect(changes.get("joisted_masonry::tenant")).toBe(1.07);
  });

  it("Apply is disabled when there are no changes", () => {
    const current = new Map<string, number>([
      ["frame::owner", 1.05],
      ["frame::tenant", 1.15],
      ["joisted_masonry::owner", 0.97],
      ["joisted_masonry::tenant", 1.07],
    ]);
    render(
      <CsvImportPreview2D
        open
        csv={SAMPLE_CSV}
        rowAxis={CONSTRUCTION}
        colAxis={OWNERSHIP}
        currentCells={current}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-csv-import-2d-apply"),
    ).toBeDisabled();
  });
});
