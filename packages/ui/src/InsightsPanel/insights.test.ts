/**
 * insights generators — Brief 34 PR 34.3.
 *
 * Tests each pure generator + the runInsights orchestrator.
 */

import { describe, expect, it } from "vitest";
import {
  generateAllDefault,
  generateAllOnSide,
  generateCompareDelta,
  generateDiagonalSmooth,
  generateMonotonicityBreak,
  generateNarrowSpread,
  generateOutlier,
  generateRange,
  runInsights,
  type InsightInput,
} from "./insights";
import { cellKey, type FactorTableGrid2DAxis } from "../FactorTableGrid2D";

// ──────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────

const ROW_BANDED: FactorTableGrid2DAxis = {
  dimSlug: "building_age",
  values: [
    { id: "band_0_5", label: "0–5" },
    { id: "band_5_15", label: "5–15" },
    { id: "band_15_30", label: "15–30" },
    { id: "band_30_50", label: "30–50" },
    { id: "band_50_100", label: "50–100" },
  ],
};

const COL_CAT: FactorTableGrid2DAxis = {
  dimSlug: "construction",
  values: [
    { id: "frame", label: "Frame" },
    { id: "jm", label: "JM" },
    { id: "fr", label: "FR" },
  ],
};

const ROW_CAT: FactorTableGrid2DAxis = {
  dimSlug: "construction",
  values: [
    { id: "frame", label: "Frame" },
    { id: "jm", label: "JM" },
    { id: "fr", label: "FR" },
  ],
};

function cells2D(
  entries: ReadonlyArray<readonly [string, string, number]>,
): ReadonlyMap<string, number> {
  return new Map(entries.map(([r, c, v]) => [cellKey(r, c), v]));
}

function cells1D(
  entries: ReadonlyArray<readonly [string, number]>,
): ReadonlyMap<string, number> {
  return new Map(entries.map(([r, v]) => [cellKey(r, null), v]));
}

// ──────────────────────────────────────────────────────────────────
// generateRange
// ──────────────────────────────────────────────────────────────────

describe("generateRange", () => {
  it("emits one insight with min/max/spread", () => {
    const out = generateRange({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 0.92],
        ["jm", 0.85],
        ["fr", 1.18],
      ]),
    });
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("range");
    expect(out[0]!.severity).toBe("info");
    expect(out[0]!.message).toContain("0.85");
    expect(out[0]!.message).toContain("1.18");
    expect(out[0]!.message).toContain("0.33");
  });

  it("emits nothing when there are no values", () => {
    const out = generateRange({ rowAxis: ROW_CAT, cells: new Map() });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// generateMonotonicityBreak
// ──────────────────────────────────────────────────────────────────

describe("generateMonotonicityBreak", () => {
  const baseInput: Omit<InsightInput, "cells"> = {
    rowAxis: ROW_BANDED,
    isBanded: { row: true },
    monotonicityExpected: true,
  };

  it("suppresses when monotonicityExpected is false", () => {
    const out = generateMonotonicityBreak({
      rowAxis: ROW_BANDED,
      isBanded: { row: true },
      monotonicityExpected: false,
      cells: cells1D([
        ["band_0_5", 0.85],
        ["band_5_15", 0.7], // would-be break
      ]),
    });
    expect(out).toEqual([]);
  });

  it("suppresses when row axis isn't banded", () => {
    const out = generateMonotonicityBreak({
      rowAxis: ROW_BANDED,
      isBanded: { row: false },
      monotonicityExpected: true,
      cells: cells1D([
        ["band_0_5", 0.85],
        ["band_5_15", 0.7],
      ]),
    });
    expect(out).toEqual([]);
  });

  it("flags an ascending-direction break", () => {
    const out = generateMonotonicityBreak({
      ...baseInput,
      cells: cells1D([
        ["band_0_5", 0.85],
        ["band_5_15", 0.92],
        ["band_15_30", 0.88], // break (dips below 0.92)
        ["band_30_50", 1.05],
        ["band_50_100", 1.18],
      ]),
    });
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("monotonicity-break");
    expect(out[0]!.severity).toBe("warn");
    expect(out[0]!.message).toContain("dips below");
    expect(out[0]!.anchor?.rowId).toBe("band_15_30");
  });

  it("flags a descending-direction break", () => {
    const out = generateMonotonicityBreak({
      ...baseInput,
      cells: cells1D([
        ["band_0_5", 1.18],
        ["band_5_15", 1.05],
        ["band_15_30", 1.12], // break (climbs above 1.05)
        ["band_30_50", 0.92],
        ["band_50_100", 0.85],
      ]),
    });
    expect(out.length).toBe(1);
    expect(out[0]!.message).toContain("climbs above");
    expect(out[0]!.anchor?.rowId).toBe("band_15_30");
  });

  it("emits no break for a perfectly monotone series", () => {
    const out = generateMonotonicityBreak({
      ...baseInput,
      cells: cells1D([
        ["band_0_5", 0.85],
        ["band_5_15", 0.92],
        ["band_15_30", 1.05],
        ["band_30_50", 1.18],
      ]),
    });
    expect(out).toEqual([]);
  });

  it("emits one break per column in a 2-D table", () => {
    const out = generateMonotonicityBreak({
      ...baseInput,
      colAxis: COL_CAT,
      cells: cells2D([
        // Frame — clean ascending
        ["band_0_5", "frame", 0.9],
        ["band_5_15", "frame", 0.95],
        ["band_15_30", "frame", 1.0],
        // JM — break at band_15_30
        ["band_0_5", "jm", 0.85],
        ["band_5_15", "jm", 0.95],
        ["band_15_30", "jm", 0.9],
      ]),
    });
    expect(out.length).toBe(1);
    expect(out[0]!.anchor?.colId).toBe("jm");
  });
});

// ──────────────────────────────────────────────────────────────────
// generateOutlier
// ──────────────────────────────────────────────────────────────────

describe("generateOutlier", () => {
  it("flags a |z| > 2 cell", () => {
    // 9 values near 1.0, 1 spike at 5.0 → big z-score.
    const entries: Array<readonly [string, number]> = [];
    for (let i = 0; i < 9; i++) entries.push([`r${i}`, 1.0 + i * 0.01]);
    entries.push(["r9", 5.0]);
    const axis: FactorTableGrid2DAxis = {
      dimSlug: "x",
      values: entries.map(([id]) => ({ id, label: id })),
    };
    const out = generateOutlier({
      rowAxis: axis,
      cells: cells1D(entries),
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]!.kind).toBe("outlier");
    expect(out[0]!.severity).toBe("warn");
    expect(out[0]!.anchor?.rowId).toBe("r9");
  });

  it("skips when sample size < 5", () => {
    const out = generateOutlier({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 1.0],
        ["jm", 5.0],
      ]),
    });
    expect(out).toEqual([]);
  });

  it("skips when stdev is 0 (all identical)", () => {
    const axis: FactorTableGrid2DAxis = {
      dimSlug: "x",
      values: Array.from({ length: 6 }, (_, i) => ({
        id: `r${i}`,
        label: `r${i}`,
      })),
    };
    const out = generateOutlier({
      rowAxis: axis,
      cells: cells1D(axis.values.map((v) => [v.id, 1.0] as const)),
    });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// generateAllDefault
// ──────────────────────────────────────────────────────────────────

describe("generateAllDefault", () => {
  it("flags a 1-D row at baseline", () => {
    const out = generateAllDefault({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 1.0],
        ["jm", 0.92],
        ["fr", 0.78],
      ]),
    });
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("all-default");
    expect(out[0]!.message).toContain("Frame");
    expect(out[0]!.anchor?.rowId).toBe("frame");
  });

  it("flags both row + col when both are all-default in 2-D", () => {
    const out = generateAllDefault({
      rowAxis: ROW_CAT,
      colAxis: COL_CAT,
      cells: cells2D([
        // Row "frame" is all 1.0 across cols.
        ["frame", "frame", 1.0],
        ["frame", "jm", 1.0],
        ["frame", "fr", 1.0],
        // Col "fr" is all 1.0 across rows.
        ["jm", "fr", 1.0],
        ["fr", "fr", 1.0],
        // Other cells with deviation.
        ["jm", "frame", 0.92],
        ["jm", "jm", 0.95],
        ["fr", "frame", 0.78],
        ["fr", "jm", 0.85],
      ]),
    });
    expect(out.length).toBe(2);
    const kinds = out.map((o) => o.message);
    expect(kinds.some((m) => m.includes("Row"))).toBe(true);
    expect(kinds.some((m) => m.includes("Column"))).toBe(true);
  });

  it("emits nothing when every cell deviates", () => {
    const out = generateAllDefault({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 0.92],
        ["jm", 0.85],
        ["fr", 0.78],
      ]),
    });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// generateDiagonalSmooth
// ──────────────────────────────────────────────────────────────────

describe("generateDiagonalSmooth", () => {
  const rowBanded: FactorTableGrid2DAxis = {
    dimSlug: "r",
    values: ["r0", "r1", "r2", "r3"].map((id) => ({ id, label: id })),
  };
  const colBanded: FactorTableGrid2DAxis = {
    dimSlug: "c",
    values: ["c0", "c1", "c2", "c3"].map((id) => ({ id, label: id })),
  };

  it("flags an additive-shaped table", () => {
    // Cell[r,c] = 1.0 + 0.05*(r+c) — perfectly additive; anti-
    // diagonal stdev = 0.
    const entries: Array<readonly [string, string, number]> = [];
    rowBanded.values.forEach((row, ri) => {
      colBanded.values.forEach((col, ci) => {
        entries.push([row.id, col.id, 1.0 + 0.05 * (ri + ci)]);
      });
    });
    const out = generateDiagonalSmooth({
      rowAxis: rowBanded,
      colAxis: colBanded,
      isBanded: { row: true, col: true },
      cells: cells2D(entries),
    });
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("diagonal-smooth");
    expect(out[0]!.severity).toBe("good");
  });

  it("does NOT flag when cells along the diagonal vary widely", () => {
    // Hand-picked values so each anti-diagonal has wide spread.
    // For k = r + c, we plant cells that span > 0.03 across the
    // diagonal (above DIAGONAL_STDEV_THRESHOLD).
    const entries: Array<readonly [string, string, number]> = [];
    rowBanded.values.forEach((row, ri) => {
      colBanded.values.forEach((col, ci) => {
        // Cell uses a sin-style perturbation so anti-diagonals
        // pick up rows of (alternating high / low) values.
        const v = 1.0 + 0.2 * Math.sin((ri + ci) * 3 + ri * 7);
        entries.push([row.id, col.id, v]);
      });
    });
    const out = generateDiagonalSmooth({
      rowAxis: rowBanded,
      colAxis: colBanded,
      isBanded: { row: true, col: true },
      cells: cells2D(entries),
    });
    expect(out).toEqual([]);
  });

  it("suppresses when either axis isn't banded", () => {
    const out = generateDiagonalSmooth({
      rowAxis: rowBanded,
      colAxis: colBanded,
      isBanded: { row: false, col: true },
      cells: new Map(),
    });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// generateAllOnSide
// ──────────────────────────────────────────────────────────────────

describe("generateAllOnSide", () => {
  it("emits all-discount when every cell is below baseline", () => {
    const out = generateAllOnSide({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 0.95],
        ["jm", 0.85],
        ["fr", 0.78],
      ]),
    });
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("all-discount");
  });

  it("emits all-surcharge when every cell is above baseline", () => {
    const out = generateAllOnSide({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 1.05],
        ["jm", 1.15],
        ["fr", 1.25],
      ]),
    });
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("all-surcharge");
  });

  it("emits nothing when values straddle the baseline", () => {
    const out = generateAllOnSide({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 0.85],
        ["jm", 1.15],
      ]),
    });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// generateNarrowSpread
// ──────────────────────────────────────────────────────────────────

describe("generateNarrowSpread", () => {
  it("flags spreads under 0.05", () => {
    const out = generateNarrowSpread({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 1.0],
        ["jm", 1.02],
        ["fr", 1.03],
      ]),
    });
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("narrow-spread");
  });

  it("does NOT flag spreads ≥ 0.05", () => {
    const out = generateNarrowSpread({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 1.0],
        ["jm", 0.92],
        ["fr", 0.85],
      ]),
    });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// generateMonotonicityBreak — Brief 34 PR 34.6 direction additions
// ──────────────────────────────────────────────────────────────────

describe("generateMonotonicityBreak — explicit direction (PR 34.6)", () => {
  it("'increasing' flags any DOWN step regardless of the inferred direction", () => {
    // Data is all-decreasing — inferred direction would be -1, so
    // no break would fire. With explicit 'increasing', EVERY step
    // is a break.
    const out = generateMonotonicityBreak({
      rowAxis: ROW_BANDED,
      isBanded: { row: true },
      monotonicityExpected: "increasing",
      cells: cells1D([
        ["band_0_5", 1.18],
        ["band_5_15", 1.05],
        ["band_15_30", 0.88],
      ]),
    });
    expect(out.length).toBe(2); // 1.18→1.05 + 1.05→0.88
    expect(out.every((i) => i.kind === "monotonicity-break")).toBe(true);
  });

  it("'decreasing' flags any UP step regardless of inferred direction", () => {
    const out = generateMonotonicityBreak({
      rowAxis: ROW_BANDED,
      isBanded: { row: true },
      monotonicityExpected: "decreasing",
      cells: cells1D([
        ["band_0_5", 0.85],
        ["band_5_15", 0.92],
        ["band_15_30", 1.05],
      ]),
    });
    expect(out.length).toBe(2);
    expect(out.every((i) => i.kind === "monotonicity-break")).toBe(true);
  });

  it("null suppresses (like undefined)", () => {
    const out = generateMonotonicityBreak({
      rowAxis: ROW_BANDED,
      isBanded: { row: true },
      monotonicityExpected: null,
      cells: cells1D([
        ["band_0_5", 0.85],
        ["band_5_15", 1.05],
        ["band_15_30", 0.88],
      ]),
    });
    expect(out).toEqual([]);
  });

  it("'increasing' tolerates equal values (no break on flat step)", () => {
    const out = generateMonotonicityBreak({
      rowAxis: ROW_BANDED,
      isBanded: { row: true },
      monotonicityExpected: "increasing",
      cells: cells1D([
        ["band_0_5", 1.0],
        ["band_5_15", 1.0],
        ["band_15_30", 1.05],
      ]),
    });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// generateCompareDelta — Brief 34 PR 34.6
// ──────────────────────────────────────────────────────────────────

describe("generateCompareDelta", () => {
  it("returns empty when filedCells is omitted", () => {
    expect(
      generateCompareDelta({
        rowAxis: ROW_CAT,
        cells: cells1D([
          ["frame", 1.0],
          ["jm", 1.05],
          ["fr", 0.95],
        ]),
      }),
    ).toEqual([]);
  });

  it("returns empty when filedCells is an empty map", () => {
    expect(
      generateCompareDelta({
        rowAxis: ROW_CAT,
        cells: cells1D([["frame", 1.0]]),
        filedCells: new Map(),
      }),
    ).toEqual([]);
  });

  it("emits per-row delta when |Δ| ≥ 2% (1-D table)", () => {
    const out = generateCompareDelta({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 1.0], // 0% — no insight
        ["jm", 1.05], // +5% — emit
        ["fr", 0.93], // -7% — emit
      ]),
      filedCells: cells1D([
        ["frame", 1.0],
        ["jm", 1.0],
        ["fr", 1.0],
      ]),
    });
    expect(out.length).toBe(2);
    expect(out[0]!.message).toMatch(/JM.*up.*5\.0%/);
    expect(out[1]!.message).toMatch(/FR.*down.*7\.0%/);
    expect(out.every((i) => i.kind === "compare-delta")).toBe(true);
  });

  it("averages deltas across cols for a 2-D row", () => {
    // JM: owner +10%, tenant 0% → mean +5% → emit
    // Frame: both 0% → no insight
    const out = generateCompareDelta({
      rowAxis: ROW_CAT,
      colAxis: COL_CAT,
      cells: cells2D([
        ["frame", "frame", 1.0],
        ["jm", "frame", 1.1],
        ["jm", "jm", 1.0],
      ]),
      filedCells: cells2D([
        ["frame", "frame", 1.0],
        ["jm", "frame", 1.0],
        ["jm", "jm", 1.0],
      ]),
    });
    // Only JM row has a delta crossing threshold.
    const jmInsight = out.find((i) => i.message.includes("JM"));
    expect(jmInsight).toBeDefined();
    expect(jmInsight!.kind).toBe("compare-delta");
  });

  it("honors compareDeltaThreshold override", () => {
    const out = generateCompareDelta({
      rowAxis: ROW_CAT,
      cells: cells1D([["jm", 1.05]]),
      filedCells: cells1D([["jm", 1.0]]),
      compareDeltaThreshold: 0.1, // 10%; 5% < threshold → suppressed
    });
    expect(out).toEqual([]);
  });

  it("anchors to row.id + first col for click-to-jump (2-D)", () => {
    const out = generateCompareDelta({
      rowAxis: ROW_CAT,
      colAxis: COL_CAT,
      cells: cells2D([
        ["jm", "frame", 1.1],
        ["jm", "jm", 1.1],
      ]),
      filedCells: cells2D([
        ["jm", "frame", 1.0],
        ["jm", "jm", 1.0],
      ]),
    });
    const insight = out[0];
    expect(insight?.anchor?.rowId).toBe("jm");
    expect(insight?.anchor?.colId).toBe("frame");
  });

  it("skips cells with no comparable counterpart", () => {
    const out = generateCompareDelta({
      rowAxis: ROW_CAT,
      cells: cells1D([["jm", 1.5]]),
      filedCells: cells1D([["frame", 1.0]]), // no jm → can't compare
    });
    expect(out).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// runInsights — orchestrator composition
// ──────────────────────────────────────────────────────────────────

describe("runInsights", () => {
  it("emits range first + composes downstream insights", () => {
    const out = runInsights({
      rowAxis: ROW_BANDED,
      isBanded: { row: true },
      monotonicityExpected: true,
      cells: cells1D([
        ["band_0_5", 0.85],
        ["band_5_15", 0.92],
        ["band_15_30", 0.88], // break
        ["band_30_50", 1.05],
        ["band_50_100", 1.18],
      ]),
    });
    // First insight = range
    expect(out[0]!.kind).toBe("range");
    // monotonicity-break appears
    expect(out.some((i) => i.kind === "monotonicity-break")).toBe(true);
  });

  it("returns just the range for an undifferentiated 1-D table", () => {
    const out = runInsights({
      rowAxis: ROW_CAT,
      cells: cells1D([
        ["frame", 1.0],
        ["jm", 1.0],
        ["fr", 1.0],
      ]),
    });
    expect(out.find((i) => i.kind === "range")).toBeDefined();
    // narrow-spread also fires
    expect(out.find((i) => i.kind === "narrow-spread")).toBeDefined();
  });
});
