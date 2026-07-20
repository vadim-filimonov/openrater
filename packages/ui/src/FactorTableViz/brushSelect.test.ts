/**
 * brushSelect tests — Brief 34 PR 34.5.
 */

import { describe, expect, it } from "vitest";
import {
  BRUSH_MIN_WIDTH,
  cellKeysInXExtent2D,
  isBrushSignificant,
  keysInXExtent,
  nearestKeyAtX,
  normalizeBrush,
} from "./brushSelect";

const POSITIONS = [
  { center: 10, slot: 10 },
  { center: 30, slot: 10 },
  { center: 50, slot: 10 },
  { center: 70, slot: 10 },
  { center: 90, slot: 10 },
];
const KEYS = ["a", "b", "c", "d", "e"];

describe("keysInXExtent (1-D brush)", () => {
  it("selects datums whose center falls inside the brush", () => {
    const out = keysInXExtent({
      dataKeys: KEYS,
      xPositions: POSITIONS,
      brush: { x1: 25, x2: 75 },
    });
    expect([...out].sort()).toEqual(["b", "c", "d"]);
  });

  it("handles reversed brush bounds (drag right-to-left)", () => {
    const out = keysInXExtent({
      dataKeys: KEYS,
      xPositions: POSITIONS,
      brush: { x1: 75, x2: 25 },
    });
    expect([...out].sort()).toEqual(["b", "c", "d"]);
  });

  it("is inclusive at both ends", () => {
    const out = keysInXExtent({
      dataKeys: KEYS,
      xPositions: POSITIONS,
      brush: { x1: 30, x2: 70 },
    });
    expect([...out].sort()).toEqual(["b", "c", "d"]);
  });

  it("returns empty when brush doesn't intersect any datum", () => {
    const out = keysInXExtent({
      dataKeys: KEYS,
      xPositions: POSITIONS,
      brush: { x1: 200, x2: 300 },
    });
    expect(out.size).toBe(0);
  });

  it("skips missing positions or keys gracefully", () => {
    const out = keysInXExtent({
      dataKeys: ["a", "b"],
      xPositions: [{ center: 10, slot: 10 }],
      brush: { x1: 0, x2: 100 },
    });
    expect([...out]).toEqual(["a"]);
  });
});

describe("cellKeysInXExtent2D (2-D banded × categorical brush)", () => {
  it("emits cellKey for every (row in extent) × (every col)", () => {
    const out = cellKeysInXExtent2D({
      rowIds: ["band_0_5", "band_5_15", "band_15_30"],
      colIds: ["owner", "tenant"],
      xPositions: [
        { center: 10, slot: 20 },
        { center: 30, slot: 20 },
        { center: 50, slot: 20 },
      ],
      brush: { x1: 20, x2: 60 },
    });
    expect([...out].sort()).toEqual([
      "band_15_30::owner",
      "band_15_30::tenant",
      "band_5_15::owner",
      "band_5_15::tenant",
    ]);
  });

  it("returns empty when no rows fall in extent", () => {
    const out = cellKeysInXExtent2D({
      rowIds: ["band_0_5"],
      colIds: ["owner"],
      xPositions: [{ center: 10, slot: 20 }],
      brush: { x1: 100, x2: 200 },
    });
    expect(out.size).toBe(0);
  });
});

describe("normalizeBrush", () => {
  it("orders x and y bounds", () => {
    expect(normalizeBrush({ x1: 50, x2: 20, y1: 80, y2: 10 })).toEqual({
      x1: 20,
      x2: 50,
      y1: 10,
      y2: 80,
    });
  });

  it("treats missing y bounds as 0", () => {
    expect(normalizeBrush({ x1: 1, x2: 2 })).toEqual({
      x1: 1,
      x2: 2,
      y1: 0,
      y2: 0,
    });
  });
});

describe("nearestKeyAtX (click-to-focus)", () => {
  it("returns the nearest datum within half-slot snap", () => {
    expect(
      nearestKeyAtX({
        dataKeys: KEYS,
        xPositions: POSITIONS,
        x: 32,
      }),
    ).toBe("b");
    expect(
      nearestKeyAtX({
        dataKeys: KEYS,
        xPositions: POSITIONS,
        x: 48,
      }),
    ).toBe("c");
  });

  it("returns null when click is outside any slot's half-width", () => {
    expect(
      nearestKeyAtX({
        dataKeys: KEYS,
        xPositions: POSITIONS,
        x: 200,
      }),
    ).toBe(null);
  });

  it("snaps exactly at the center", () => {
    expect(
      nearestKeyAtX({
        dataKeys: KEYS,
        xPositions: POSITIONS,
        x: 50,
      }),
    ).toBe("c");
  });
});

describe("isBrushSignificant", () => {
  it("treats anything below BRUSH_MIN_WIDTH as insignificant", () => {
    expect(isBrushSignificant({ x1: 10, x2: 10 })).toBe(false);
    expect(
      isBrushSignificant({ x1: 10, x2: 10 + BRUSH_MIN_WIDTH - 0.1 }),
    ).toBe(false);
  });

  it("treats anything at or above BRUSH_MIN_WIDTH as significant", () => {
    expect(
      isBrushSignificant({ x1: 10, x2: 10 + BRUSH_MIN_WIDTH }),
    ).toBe(true);
    expect(isBrushSignificant({ x1: 100, x2: 50 })).toBe(true);
  });
});
