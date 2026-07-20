/**
 * Exhibits anatomy — derivation tests (current Exhibits design).
 *
 * Values mirror the seeded Meridian NE 2026 fixture so the derivations
 * are pinned against the same numbers the demo renders.
 */

import { describe, expect, it } from "vitest";
import type { PlanDimension, PlanFactorTable } from "@openrater/api-client";
import {
  cellValueForLevel,
  compareDrawnOrder,
  exhibitTiles,
  formatSpan,
  ledeFacts,
  monotonicityVerdict,
  normalizeMonotonicity,
  orderedLevelValues,
  resolveKeyDimension,
  tableSpan,
  tileKindFor,
} from "./anatomy";

const NOW = "2026-07-18T00:00:00Z";

function dim(partial: Partial<PlanDimension> & { dim_id: string }): PlanDimension {
  return {
    rating_plan_id: "plan",
    display_name: partial.dim_id,
    slug: partial.dim_id,
    data_type: "string",
    role: "rating-input",
    levels: [],
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  } as PlanDimension;
}

function table(
  partial: Partial<PlanFactorTable> & {
    table_id: string;
    cells: Record<string, number>;
  },
): PlanFactorTable {
  return {
    rating_plan_id: "plan",
    display_name: partial.table_id,
    slug: partial.table_id,
    key_dimensions: [],
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  } as PlanFactorTable;
}

const buildingBand = dim({
  dim_id: "building_limit_band",
  display_name: "Building limit band",
  data_type: "number",
  shape: "banded",
  monotonicity_expected: "decreasing",
  levels: [
    { kind: "banded", id: "bl_0_100k", label: "0–100k", lo: null, hi: 100_000 },
    { kind: "banded", id: "bl_100_250k", label: "100–250k", lo: 100_000, hi: 250_000 },
    { kind: "banded", id: "bl_250_500k", label: "250–500k", lo: 250_000, hi: 500_000 },
    { kind: "banded", id: "bl_500k_1m", label: "500k–1M", lo: 500_000, hi: 1_000_000 },
    { kind: "banded", id: "bl_1m_plus", label: "1M+", lo: 1_000_000, hi: null },
  ],
});

const buildingIlf = table({
  table_id: "building_ilf",
  display_name: "Building limit ILF",
  key_dimensions: ["building_limit_band"],
  cells: {
    bl_0_100k: 1.0,
    bl_100_250k: 0.93,
    bl_250_500k: 0.87,
    bl_500k_1m: 0.82,
    bl_1m_plus: 0.78,
  },
});

const territory = dim({
  dim_id: "territory",
  display_name: "Territory",
  dimension_type: "geographic",
  geo_granularity: "zip",
  geo_territories: [
    { id: "t1", label: "Territory 1", members: ["68001", "68002"] },
    { id: "t2", label: "Territory 2", members: ["68102"] },
    { id: "t3", label: "Territory 3", members: ["68502"] },
    { id: "t4", label: "Territory 4", members: ["68005"] },
    { id: "t5", label: "Territory 5", members: ["68801"] },
    { id: "t6", label: "Territory 6", members: ["68025"] },
  ],
  // Production shape: the LEVELS are the ZIP members; the territories
  // (above) are the rated grouping the cells key by. The regression this
  // pins: reading cells by level id found nothing ("No data to plot").
  levels: [
    { kind: "geographic", id: "68001", label: "68001", territory_ref: "t1" },
    { kind: "geographic", id: "68002", label: "68002", territory_ref: "t1" },
    { kind: "geographic", id: "68102", label: "68102", territory_ref: "t2" },
    { kind: "geographic", id: "68502", label: "68502", territory_ref: "t3" },
    { kind: "geographic", id: "68005", label: "68005", territory_ref: "t4" },
    { kind: "geographic", id: "68801", label: "68801", territory_ref: "t5" },
    { kind: "geographic", id: "68025", label: "68025", territory_ref: "t6" },
  ],
});

const territoryProp = table({
  table_id: "territory_prop",
  display_name: "Territory factor (property)",
  key_dimensions: ["territory"],
  cells: { t1: 0.94, t2: 1.0, t3: 1.12, t4: 0.97, t5: 0.91, t6: 0.89 },
});

const classCode = dim({
  dim_id: "class_code",
  display_name: "Class code",
  shape: "categorical",
  levels: Array.from({ length: 40 }, (_, i) => ({
    kind: "categorical",
    id: `c${101 + i}`,
    label: `Class ${101 + i}`,
    aliases: [],
  })),
});

const classProp = table({
  table_id: "class_rate_prop",
  display_name: "Class factor (property)",
  key_dimensions: ["class_code"],
  cells: Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [
      `c${101 + i}`,
      // Deterministic spread anchored on the fixture's real extremes.
      i === 0 ? 2.1 : i === 39 ? 0.74 : 2.1 - (i * (2.1 - 0.74)) / 39,
    ]),
  ),
});

const sprinklered = dim({
  dim_id: "sprinklered_level",
  display_name: "Sprinklered",
  shape: "categorical",
  levels: [
    { kind: "categorical", id: "true", label: "Sprinklered", aliases: [] },
    { kind: "categorical", id: "false", label: "Not sprinklered", aliases: [] },
  ],
});

const sprinklerCredit = table({
  table_id: "sprinkler_prop",
  display_name: "Sprinkler credit (property)",
  key_dimensions: ["sprinklered_level"],
  cells: { true: 0.92, false: 1.0 },
});

const constrProt = table({
  table_id: "constr_x_prot",
  display_name: "Construction × Protection",
  key_dimensions: ["construction_class", "protection_class"],
  cells: { "fr::p1_4": 0.72, "frame::p9_10": 1.42 },
});

const ALL_DIMS = [buildingBand, territory, classCode, sprinklered];
const ALL_TABLES = [buildingIlf, territoryProp, classProp, sprinklerCredit, constrProt];

describe("tableSpan", () => {
  it("computes min/max/ratio over cells", () => {
    const span = tableSpan(buildingIlf.cells);
    expect(span).toEqual({ min: 0.78, max: 1.0, ratio: 1.0 / 0.78 });
  });
  it("is null on an empty cell map and ratio-null on non-positive mins", () => {
    expect(tableSpan({})).toBeNull();
    expect(tableSpan({ a: -1, b: 2 })?.ratio).toBeNull();
  });
});

describe("formatSpan", () => {
  it("renders the ×min–max badge", () => {
    expect(formatSpan({ min: 0.74, max: 2.1, ratio: null })).toBe("×0.74–2.10");
  });
});

describe("resolveKeyDimension + cell lookup", () => {
  it("resolves by dim_id and reads bare-id cells", () => {
    const d = resolveKeyDimension(buildingIlf, ALL_DIMS);
    expect(d?.dim_id).toBe("building_limit_band");
    expect(cellValueForLevel(buildingIlf, buildingBand, "bl_1m_plus")).toBe(0.78);
  });
  it("falls back to the dim=level cell encoding", () => {
    const t = table({
      table_id: "ns",
      key_dimensions: ["sprinklered_level"],
      cells: { "sprinklered_level=true": 0.9 },
    });
    expect(cellValueForLevel(t, sprinklered, "true")).toBe(0.9);
    expect(cellValueForLevel(t, sprinklered, "false")).toBeNull();
  });
  it("is null for 2-D tables", () => {
    expect(resolveKeyDimension(constrProt, ALL_DIMS)).toBeNull();
  });
});

describe("orderedLevelValues", () => {
  it("returns values in FILED level order, skipping missing cells", () => {
    const values = orderedLevelValues(buildingIlf, buildingBand);
    expect(values.map((v) => v.value)).toEqual([1.0, 0.93, 0.87, 0.82, 0.78]);
    expect(values[0]?.label).toBe("0–100k");
  });
});

describe("tileKindFor", () => {
  it("classifies the Meridian tables", () => {
    expect(tileKindFor(buildingIlf, ALL_DIMS)).toBe("curve");
    expect(tileKindFor(territoryProp, ALL_DIMS)).toBe("bars");
    expect(tileKindFor(classProp, ALL_DIMS)).toBe("strip");
    expect(tileKindFor(sprinklerCredit, ALL_DIMS)).toBe("dots");
    expect(tileKindFor(constrProt, ALL_DIMS)).toBe("grid");
  });
});

describe("monotonicity", () => {
  it("normalizes the wire forms", () => {
    expect(normalizeMonotonicity("decreasing")).toBe("decreasing");
    expect(normalizeMonotonicity(true)).toBe("monotone");
    expect(normalizeMonotonicity(null)).toBeNull();
    expect(normalizeMonotonicity("sideways")).toBeNull();
  });
  it("verifies the declared expectation against filed order", () => {
    const values = orderedLevelValues(buildingIlf, buildingBand);
    expect(monotonicityVerdict(buildingBand, values)).toEqual({
      expected: "decreasing",
      holds: true,
    });
  });
  it("flags a violation instead of hiding it", () => {
    const broken = table({
      table_id: "broken",
      key_dimensions: ["building_limit_band"],
      cells: { bl_0_100k: 1.0, bl_100_250k: 1.05, bl_250_500k: 0.9 },
    });
    const values = orderedLevelValues(broken, buildingBand);
    expect(monotonicityVerdict(buildingBand, values)?.holds).toBe(false);
  });
  it("stays silent when the filing declares nothing", () => {
    const values = orderedLevelValues(territoryProp, territory);
    expect(monotonicityVerdict(territory, values)).toBeNull();
  });
});

describe("exhibitTiles", () => {
  it("sorts widest lever first — the sort order IS the tornado", () => {
    const tiles = exhibitTiles(ALL_DIMS, ALL_TABLES);
    expect(tiles.map((t) => t.table.table_id)).toEqual([
      "class_rate_prop", // ×2.84
      "constr_x_prot", // ×1.97
      "building_ilf", // ×1.28
      "territory_prop", // ×1.26
      "sprinkler_prop", // ×1.09
    ]);
  });
  it("attaches the monotonicity verdict only to declared curves", () => {
    const tiles = exhibitTiles(ALL_DIMS, ALL_TABLES);
    const ilf = tiles.find((t) => t.table.table_id === "building_ilf");
    const terr = tiles.find((t) => t.table.table_id === "territory_prop");
    expect(ilf?.monotonicity?.holds).toBe(true);
    expect(terr?.monotonicity).toBeNull();
  });
});

describe("ledeFacts", () => {
  it("counts the plan's answers, widest lever, and territory story", () => {
    const tiles = exhibitTiles(ALL_DIMS, ALL_TABLES);
    const facts = ledeFacts(ALL_DIMS, tiles);
    expect(facts.answers).toBe(4);
    expect(facts.widest?.name).toBe("Class factor (property)");
    expect(facts.widest?.ratio).toBeCloseTo(2.1 / 0.74, 5);
    expect(facts.territory).toEqual({
      count: 6,
      grain: "zip",
      tiltPct: expect.closeTo(12, 5) as number,
    });
  });
  it("omits the territory story for non-geographic plans", () => {
    const tiles = exhibitTiles([buildingBand], [buildingIlf]);
    expect(ledeFacts([buildingBand], tiles).territory).toBeNull();
  });
});

describe("compareDrawnOrder", () => {
  const values = [
    { id: "a", label: "A", value: 2.0 },
    { id: "b", label: "B", value: 1.5 },
    { id: "c", label: "C", value: 1.1 },
    { id: "d", label: "D", value: 0.9 },
  ];
  it("surfaces moved levels first, largest relative move leading", () => {
    const bValues = new Map([
      ["a", 2.0], // unchanged
      ["b", 1.5], // unchanged
      ["c", 1.32], // +20%
      ["d", 0.45], // -50% — the biggest move, so it leads
    ]);
    expect(compareDrawnOrder(values, bValues).map((v) => v.id)).toEqual([
      "d",
      "c",
      "a",
      "b",
    ]);
  });
  it("is identity without a B side or without any movement", () => {
    expect(compareDrawnOrder(values, null)).toBe(values);
    const same = new Map(values.map((v) => [v.id, v.value] as const));
    expect(compareDrawnOrder(values, same)).toBe(values);
  });
  it("leaves levels the B side never prices in their filed place", () => {
    const bValues = new Map([["c", 1.21]]); // only c present and moved
    expect(compareDrawnOrder(values, bValues).map((v) => v.id)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });
});
