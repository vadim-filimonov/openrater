/**
 * inferCsvAxes tests — Brief 67 §3.1 (CSV-first creation).
 *
 * The inference answers "which dim is this CSV keyed on?" by
 * level-label matching. These pin: 1-D by label AND by id, 2-D
 * column-dim detection, the honest skip counts, the sub-threshold
 * refusal, and the col-headers-match-nothing refusal.
 */

import { describe, expect, it } from "vitest";
import type { DimensionRow } from "../DimensionsTable";
import { parseCsv2D } from "../CsvImportPreview2D";
import { inferCsvAxes } from "./inferCsvAxes";

const CONSTRUCTION: DimensionRow = {
  id: "construction",
  slug: "construction",
  display_name: "Construction class",
  data_type: "string",
  role: "rating-input",
  shape: "categorical",
  levels: [
    { kind: "categorical", id: "frame", label: "Frame" },
    { kind: "categorical", id: "masonry", label: "Masonry" },
    { kind: "categorical", id: "fire_resistive", label: "Fire resistive" },
  ],
};

const COVERAGE: DimensionRow = {
  id: "coverage",
  slug: "coverage",
  display_name: "Coverage",
  data_type: "string",
  role: "rating-input",
  shape: "categorical",
  levels: [
    { kind: "categorical", id: "building", label: "Building" },
    { kind: "categorical", id: "bpp", label: "BPP" },
  ],
};

const DIMS = [CONSTRUCTION, COVERAGE];

function csv(raw: string) {
  return parseCsv2D(raw.trim(), { fileName: "test.csv" });
}

describe("inferCsvAxes (Brief 67 — CSV-first creation)", () => {
  it("infers a 1-D table from row LABELS, cells keyed by level id", () => {
    const result = inferCsvAxes(
      csv(`construction,Factor
Frame,1.25
Masonry,1.00
Fire resistive,0.85`),
      DIMS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.axes).toEqual({
      rowDimSlug: "construction",
      colDimSlug: null,
    });
    expect(result.rowDimName).toBe("Construction class");
    expect(result.cells.get("frame")).toBe(1.25);
    expect(result.cells.get("fire_resistive")).toBe(0.85);
    expect(result.matchedRows).toBe(3);
    expect(result.skippedRows).toBe(0);
  });

  it("infers from row IDS too (the export round-trip)", () => {
    const result = inferCsvAxes(
      csv(`key,value
frame,1.1
masonry,0.9`),
      DIMS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.axes.rowDimSlug).toBe("construction");
    expect(result.cells.get("masonry")).toBe(0.9);
  });

  it("detects the 2-D column dim and keys cells row::col", () => {
    const result = inferCsvAxes(
      csv(`construction,Building,BPP
Frame,1.2,1.1
Masonry,1.0,0.95`),
      DIMS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.axes).toEqual({
      rowDimSlug: "construction",
      colDimSlug: "coverage",
    });
    expect(result.colDimName).toBe("Coverage");
    expect(result.cells.get("frame::building")).toBe(1.2);
    expect(result.cells.get("masonry::bpp")).toBe(0.95);
  });

  it("counts skipped rows HONESTLY (unmatched labels never silently key)", () => {
    const result = inferCsvAxes(
      csv(`construction,Factor
Frame,1.25
Masonry,1.00
Fire resistive,0.85
Mystery material,2.00`),
      DIMS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matchedRows).toBe(3);
    expect(result.skippedRows).toBe(1);
    expect(result.cells.has("Mystery material")).toBe(false);
    expect(result.cells.size).toBe(3);
  });

  it("refuses when fewer than 60% of row labels match any dim", () => {
    const result = inferCsvAxes(
      csv(`zone,Factor
A,1.0
B,1.1
C,1.2
Frame,1.3`),
      DIMS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/No dimension/i);
  });

  it("refuses a multi-column CSV whose headers match no second dim", () => {
    const result = inferCsvAxes(
      csv(`construction,Q1,Q2,Q3
Frame,1.0,1.1,1.2
Masonry,0.9,0.95,1.0`),
      DIMS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no second dimension/i);
    expect(result.reason).toMatch(/single value column/i);
  });
});
