/**
 * Unit tests for `sliceCellsToCoverageColumn` (ADR-0039) — the pure
 * helper that narrows a 2-D factor table's "rowId::colId" cells to a
 * single coverage column, re-keyed by the remaining (risk-input) axis.
 *
 * No engine boot needed — this is a pure data transform.
 */

import { describe, it, expect } from "vitest";

import { sliceCellsToCoverageColumn } from "./stagesToRuntimePlan";

// Sample BOP base_lc_property — territory(row) × coverage(col).
const BASE_LC = new Map<string, number>([
  ["701::building", 0.389],
  ["701::bpp", 0.199],
  ["702::building", 0.389],
  ["702::bpp", 0.18],
]);

describe("sliceCellsToCoverageColumn", () => {
  it("slices the building column, re-keyed by the row (territory) axis", () => {
    expect(sliceCellsToCoverageColumn(BASE_LC, "building")).toEqual({
      "701": 0.389,
      "702": 0.389,
    });
  });

  it("slices the bpp column (the columns genuinely differ)", () => {
    expect(sliceCellsToCoverageColumn(BASE_LC, "bpp")).toEqual({
      "701": 0.199,
      "702": 0.18,
    });
  });

  it("handles coverage on the ROW axis (coverage::risk encoding)", () => {
    const rowCoverage = new Map<string, number>([
      ["building::701", 0.389],
      ["building::702", 0.389],
      ["bpp::701", 0.199],
      ["bpp::702", 0.18],
    ]);
    expect(sliceCellsToCoverageColumn(rowCoverage, "bpp")).toEqual({
      "701": 0.199,
      "702": 0.18,
    });
  });

  it("returns {} when the coverage value matches neither axis", () => {
    // e.g. a 4-level coverage dim ('gl') used against a building/bpp table
    expect(sliceCellsToCoverageColumn(BASE_LC, "gl")).toEqual({});
  });

  it("returns {} for undefined / empty / non-finite cells", () => {
    expect(sliceCellsToCoverageColumn(undefined, "building")).toEqual({});
    expect(sliceCellsToCoverageColumn(new Map(), "building")).toEqual({});
    const dirty = new Map<string, number>([
      ["701::building", Number.NaN],
      ["702::building", 0.389],
    ]);
    expect(sliceCellsToCoverageColumn(dirty, "building")).toEqual({
      "702": 0.389,
    });
  });

  it("ignores 1-D (non-composite) cell keys", () => {
    const oneD = new Map<string, number>([
      ["701", 0.389],
      ["702", 0.41],
    ]);
    expect(sliceCellsToCoverageColumn(oneD, "building")).toEqual({});
  });
});
