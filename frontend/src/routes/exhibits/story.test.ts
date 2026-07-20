/**
 * Exhibits story — deterministic annotation-template tests over counted
 * facts in both moods.
 */

import { describe, expect, it } from "vitest";
import { stageStory } from "./story";

const terr = [
  { id: "t1", label: "Territory 1", value: 0.94 },
  { id: "t3", label: "Territory 3", value: 1.12 },
  { id: "t5", label: "Territory 5", value: 0.91 },
];

describe("stageStory — portrait", () => {
  it("bars name the extremes", () => {
    expect(
      stageStory({
        kind: "bars",
        values: terr,
        bValues: null,
        cells: {},
        bCells: null,
      }),
    ).toBe(
      "Territory 3 carries the highest factor (×1.12); Territory 5 the lowest (×0.91).",
    );
  });
  it("curves read direction from the filed order", () => {
    expect(
      stageStory({
        kind: "curve",
        values: [
          { id: "lo", label: "$0–$100K", value: 1.0 },
          { id: "hi", label: "$1M+", value: 0.78 },
        ],
        bValues: null,
        cells: {},
        bCells: null,
      }),
    ).toBe("Slides from ×1.00 at $0–$100K to ×0.78 at $1M+.");
  });
  it("grids name the peak and the floor", () => {
    expect(
      stageStory({
        kind: "grid",
        values: [],
        bValues: null,
        cells: { "fr::p1_4": 0.72, "frame::p9_10": 1.42 },
        bCells: null,
      }),
    ).toBe(
      "Tops out at frame × p9_10 (×1.42); the floor is fr × p1_4 (×0.72).",
    );
  });
});

describe("stageStory — compare", () => {
  it("names the biggest move and the scope", () => {
    expect(
      stageStory({
        kind: "bars",
        values: terr,
        bValues: new Map([
          ["t1", 0.94],
          ["t3", 1.22],
          ["t5", 0.89],
        ]),
        cells: {},
        bCells: null,
      }),
    ).toBe(
      "Biggest move: Territory 3 ×1.12 → ×1.22 (+8.9%) — 2 of 3 levels move.",
    );
  });
  it("says so plainly when nothing moved", () => {
    expect(
      stageStory({
        kind: "bars",
        values: terr,
        bValues: new Map(terr.map((t) => [t.id, t.value])),
        cells: {},
        bCells: null,
      }),
    ).toBe("Identical on both sides, cell for cell.");
  });
});
