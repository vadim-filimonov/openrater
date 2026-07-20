/**
 * matchCsv2D tests — Brief 33 PR 33.5.
 *
 * Covers:
 *   • Exact id / label / alias matching
 *   • Case-insensitive + trim normalization
 *   • Substring + edit-distance suggestions for warn rows
 *   • Bad rows (no suggestion)
 *   • User overrides short-circuit auto-match
 *   • 1-D and 2-D table shapes
 *   • cellsWillChange / cellsUnchanged counts
 *   • Missing dim levels (in dim but not in CSV)
 *   • Resolved-changes map only contains differences
 */

import { describe, expect, it } from "vitest";
import { matchCsv2D, type CsvImport2D } from "./matchCsv";
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
    {
      kind: "categorical",
      id: "frame",
      label: "Frame",
      aliases: ["wood", "wood frame"],
    },
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

// ──────────────────────────────────────────────────────────────────
// 2-D matching
// ──────────────────────────────────────────────────────────────────

describe("matchCsv2D — 2-D matching", () => {
  const csv: CsvImport2D = {
    fileName: "construction_factor.csv",
    colLabels: ["owner", "tenant"],
    rows: [
      { keyLabel: "frame", cells: { owner: 1.05, tenant: 1.15 } },
      {
        keyLabel: "joisted_masonry",
        cells: { owner: 0.97, tenant: 1.07 },
      },
      {
        keyLabel: "fire_resistive",
        cells: { owner: 0.82, tenant: 0.9 },
      },
    ],
  };

  it("matches every CSV row by id and produces cell diffs", () => {
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, new Map());
    expect(preview.matchedRows.length).toBe(3);
    expect(preview.unmatchedRows.length).toBe(0);
    expect(preview.matchedRows[0]!.rowId).toBe("frame");
    expect(preview.matchedRows[0]!.cellDiffs.length).toBe(2);
  });

  it("counts cellsWillChange against the empty current cells map", () => {
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, new Map());
    // 3 rows × 2 cols = 6 cells, all changing from undefined → CSV value
    expect(preview.cellsWillChange).toBe(6);
    expect(preview.cellsUnchanged).toBe(0);
  });

  it("counts cellsUnchanged when CSV matches current values", () => {
    const current = new Map<string, number>([
      ["frame::owner", 1.05],
      ["frame::tenant", 1.15],
    ]);
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, current);
    expect(preview.cellsUnchanged).toBe(2);
    expect(preview.cellsWillChange).toBe(4);
  });

  it("resolvedChanges contains only the cells that differ", () => {
    const current = new Map<string, number>([
      ["frame::owner", 1.05], // unchanged
      ["frame::tenant", 0.5], // changes
    ]);
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, current);
    expect(preview.resolvedChanges.has("frame::owner")).toBe(false);
    expect(preview.resolvedChanges.get("frame::tenant")).toBe(1.15);
  });
});

// ──────────────────────────────────────────────────────────────────
// Label matching (case + alias)
// ──────────────────────────────────────────────────────────────────

describe("matchCsv2D — label matching", () => {
  it("is case-insensitive on row keys", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["owner"],
      rows: [{ keyLabel: "FRAME", cells: { owner: 1.5 } }],
    };
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, new Map());
    expect(preview.matchedRows[0]!.rowId).toBe("frame");
  });

  it("matches via display label", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["owner"],
      rows: [
        { keyLabel: "Joisted masonry", cells: { owner: 1.0 } },
      ],
    };
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, new Map());
    expect(preview.matchedRows[0]!.rowId).toBe("joisted_masonry");
  });

  it("matches via alias", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["owner"],
      rows: [{ keyLabel: "wood", cells: { owner: 1.0 } }],
    };
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, new Map());
    expect(preview.matchedRows[0]!.rowId).toBe("frame");
  });

  it("matches col labels by label as well as id", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["Owner", "Tenant"],
      rows: [
        { keyLabel: "frame", cells: { Owner: 1.05, Tenant: 1.15 } },
      ],
    };
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, new Map());
    const diffs = preview.matchedRows[0]!.cellDiffs;
    expect(diffs.map((d) => d.colId)).toEqual(["owner", "tenant"]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Warn + bad rows
// ──────────────────────────────────────────────────────────────────

describe("matchCsv2D — unmatched rows", () => {
  it("flags close-but-not-exact CSV keys as warn with suggestions", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["owner"],
      rows: [
        { keyLabel: "framed", cells: { owner: 1.5 } }, // typo
      ],
    };
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, new Map());
    expect(preview.unmatchedRows.length).toBe(1);
    expect(preview.unmatchedRows[0]!.quality).toBe("warn");
    expect(preview.unmatchedRows[0]!.suggestions).toContain("frame");
  });

  it("flags completely-unknown CSV keys as bad with no suggestion", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["owner"],
      rows: [{ keyLabel: "xyz_unrelated_thing", cells: { owner: 1.5 } }],
    };
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, new Map());
    expect(preview.unmatchedRows[0]!.quality).toBe("bad");
    expect(preview.unmatchedRows[0]!.suggestions.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// Missing dim levels
// ──────────────────────────────────────────────────────────────────

describe("matchCsv2D — missing dim levels", () => {
  it("reports dim levels not present in the CSV", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["owner"],
      rows: [
        { keyLabel: "frame", cells: { owner: 1.0 } },
        // joisted_masonry + fire_resistive omitted
      ],
    };
    const preview = matchCsv2D(csv, CONSTRUCTION, OWNERSHIP, new Map());
    expect(preview.missingDimLevels.map((m) => m.rowId).sort()).toEqual([
      "fire_resistive",
      "joisted_masonry",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// User overrides
// ──────────────────────────────────────────────────────────────────

describe("matchCsv2D — user overrides", () => {
  it("honors override → maps the unmatched CSV key to the chosen level", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["owner"],
      rows: [
        { keyLabel: "framed", cells: { owner: 1.5 } }, // typo
      ],
    };
    const preview = matchCsv2D(
      csv,
      CONSTRUCTION,
      OWNERSHIP,
      new Map(),
      { overrides: new Map([["framed", "frame"]]) },
    );
    expect(preview.matchedRows.length).toBe(1);
    expect(preview.matchedRows[0]!.rowId).toBe("frame");
    expect(preview.unmatchedRows.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 1-D mode
// ──────────────────────────────────────────────────────────────────

describe("matchCsv2D — 1-D mode (no colAxis)", () => {
  it("treats the first body column as the single factor column", () => {
    const csv: CsvImport2D = {
      fileName: "x.csv",
      colLabels: ["factor"],
      rows: [
        { keyLabel: "frame", cells: { factor: 1.25 } },
        { keyLabel: "joisted_masonry", cells: { factor: 0.9 } },
      ],
    };
    const preview = matchCsv2D(csv, CONSTRUCTION, undefined, new Map());
    expect(preview.matchedRows.length).toBe(2);
    expect(preview.matchedRows[0]!.cellDiffs[0]!.colId).toBe(null);
    expect(preview.resolvedChanges.get("frame")).toBe(1.25);
    expect(preview.resolvedChanges.get("joisted_masonry")).toBe(0.9);
  });
});

// ──────────────────────────────────────────────────────────────────
// Platform-test finding E10a — geographic dims match on the KEYING
// domain (ADR-0038: territory-when-grouped-else-level), never on the
// raw granular levels the grid doesn't key.
// ──────────────────────────────────────────────────────────────────

const TERRITORY: DimensionRow = {
  id: "territory",
  display_name: "Territory",
  slug: "territory",
  dimension_type: "geographic",
  shape: "geographic",
  data_type: "string",
  role: "rating-input",
  levels: [
    { kind: "geographic", id: "66002", label: "66002" },
    { kind: "geographic", id: "66006", label: "66006" },
    { kind: "geographic", id: "67001", label: "67001" },
  ],
  geo_territories: [
    { id: "t1", label: "Territory t1", members: ["66002", "66006"] },
    { id: "t2", label: "Territory t2", members: ["67001"] },
  ],
};

describe("matchCsv2D — geographic keying domain (E10a)", () => {
  it("matches territory-keyed CSV rows against a grouped geo dim", () => {
    const csv: CsvImport2D = {
      fileName: "base_lc.csv",
      colLabels: ["building", "bpp"],
      rows: [
        { keyLabel: "t1", cells: { building: 0.4, bpp: 0.199 } },
        { keyLabel: "t2", cells: { building: 0.4, bpp: 0.18 } },
      ],
    };
    const preview = matchCsv2D(csv, TERRITORY, OWNERSHIP2COL, new Map());
    expect(preview.unmatchedRows).toEqual([]);
    expect(preview.matchedRows.map((r) => r.rowId).sort()).toEqual([
      "t1",
      "t2",
    ]);
    // Cells key on TERRITORY ids — the same keys the grid renders.
    expect(preview.resolvedChanges.get("t1::building")).toBe(0.4);
    expect(preview.resolvedChanges.get("t2::bpp")).toBe(0.18);
  });

  it("does NOT match raw member ZIPs once territories group them", () => {
    const csv: CsvImport2D = {
      fileName: "base_lc.csv",
      colLabels: ["factor"],
      rows: [{ keyLabel: "66002", cells: { factor: 0.4 } }],
    };
    const preview = matchCsv2D(csv, TERRITORY, undefined, new Map());
    // A ZIP row would target a grid row that doesn't exist — it must
    // surface as unmatched, not silently write an orphan cell.
    expect(preview.matchedRows).toEqual([]);
    expect(preview.unmatchedRows.length).toBe(1);
  });

  it("falls back to granular levels when no territory is active", () => {
    const ungrouped: DimensionRow = { ...TERRITORY, geo_territories: [] };
    const csv: CsvImport2D = {
      fileName: "base_lc.csv",
      colLabels: ["factor"],
      rows: [{ keyLabel: "66002", cells: { factor: 0.4 } }],
    };
    const preview = matchCsv2D(csv, ungrouped, undefined, new Map());
    expect(preview.matchedRows.map((r) => r.rowId)).toEqual(["66002"]);
  });
});

// A 2-col categorical axis for the E10a 2-D case.
const OWNERSHIP2COL: DimensionRow = {
  id: "coverage",
  display_name: "Coverage",
  slug: "coverage",
  dimension_type: "standard",
  shape: "categorical",
  data_type: "string",
  role: "rating-input",
  levels: [
    { kind: "categorical", id: "building", label: "Building", aliases: [] },
    { kind: "categorical", id: "bpp", label: "BPP", aliases: [] },
  ],
};
