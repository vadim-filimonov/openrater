/**
 * Exhibits comparison — derivation tests (current Exhibits design).
 *
 * Side A mirrors the seeded Meridian values; side B is the brief's
 * fictional "2027 rev": t3 buys rate, the sprinkler credit deepens,
 * one class (c117) leaves, roof age arrives.
 */

import { describe, expect, it } from "vitest";
import type { PlanDimension, PlanFactorTable } from "@openrater/api-client";
import {
  cellDelta,
  compareFacts,
  formatSideRef,
  pairChanged,
  pairTables,
  parseSideRef,
  parseSnapshotSubstrate,
  territoryVerdict,
} from "./compare";

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

const terrA = dim({
  dim_id: "territory",
  dimension_type: "geographic",
  geo_territories: [
    { id: "t1", label: "T1", members: ["68001", "68002"] },
    { id: "t3", label: "T3", members: ["68502", "68503"] },
    { id: "t5", label: "T5", members: ["68801"] },
  ],
});
const terrTableA = table({
  table_id: "territory_prop",
  display_name: "Territory factor (property)",
  cells: { t1: 0.94, t3: 1.12, t5: 0.91 },
});
// B redraws nothing but re-rates t3 up and t5 down; 68801 leaves B.
const terrB = dim({
  dim_id: "territory",
  dimension_type: "geographic",
  geo_territories: [
    { id: "t1", label: "T1", members: ["68001", "68002"] },
    { id: "t3", label: "T3", members: ["68502", "68503"] },
  ],
});
const terrTableB = table({
  table_id: "territory_prop",
  display_name: "Territory factor (property)",
  cells: { t1: 0.94, t3: 1.22 },
});

const sprinklerA = table({
  table_id: "sprinkler_prop",
  display_name: "Sprinkler credit (property)",
  cells: { true: 0.92, false: 1.0 },
});
const sprinklerB = table({
  table_id: "sprinkler_prop",
  display_name: "Sprinkler credit (property)",
  cells: { true: 0.88, false: 1.0 },
});
const liabIlf = table({
  table_id: "liab_ilf",
  display_name: "Liability sales ILF",
  cells: { sb_0_250k: 0.9, sb_250k_1m: 1.0 },
});
const roofB = table({
  table_id: "roof_age_prop",
  display_name: "Roof age (property)",
  cells: { "0_15": 1.0, "16_25": 1.05, "26_plus": 1.12 },
});

const classA = dim({
  dim_id: "class_code",
  levels: [
    { kind: "categorical", id: "c101", label: "Retail", aliases: [] },
    { kind: "categorical", id: "c117", label: "Bookstore", aliases: [] },
  ],
});
const classB = dim({
  dim_id: "class_code",
  levels: [{ kind: "categorical", id: "c101", label: "Retail", aliases: [] }],
});
const roofDimB = dim({ dim_id: "roof_age_band", display_name: "Roof age band" });

describe("pairTables", () => {
  it("pairs by slug and flanks the rest", () => {
    const { pairs, onlyA, onlyB } = pairTables(
      [terrTableA, sprinklerA, liabIlf],
      [terrTableB, sprinklerB, roofB],
    );
    expect(pairs.map((p) => p.a.slug)).toEqual([
      "territory_prop",
      "sprinkler_prop",
    ]);
    expect(onlyA.map((t) => t.slug)).toEqual(["liab_ilf"]);
    expect(onlyB.map((t) => t.slug)).toEqual(["roof_age_prop"]);
  });
});

describe("cellDelta", () => {
  it("counts moves and names the largest", () => {
    const delta = cellDelta(terrTableA.cells, terrTableB.cells);
    // t3 moved, t5 exists only in A → 2 changed of 3 keys.
    expect(delta.total).toBe(3);
    expect(delta.changed).toBe(2);
    expect(delta.largest).toEqual({ key: "t3", from: 1.12, to: 1.22 });
  });
  it("is zero for identical maps", () => {
    expect(cellDelta(liabIlf.cells, liabIlf.cells).changed).toBe(0);
    expect(pairChanged({ a: liabIlf, b: liabIlf })).toBe(false);
  });
});

describe("territoryVerdict", () => {
  it("joins on members and speaks in counts", () => {
    const verdict = territoryVerdict(terrA, terrTableA, terrB, terrTableB);
    expect(verdict).toEqual({
      shared: 4, // 68001, 68002, 68502, 68503
      onlyA: 1, // 68801 (t5) left B
      onlyB: 0,
      identical: 2, // t1 pair
      cheaperInB: 0,
      costlierInB: 2, // the two t3 ZIPs
      largest: {
        member: "68502",
        from: 1.12,
        to: 1.22,
        pct: expect.closeTo(8.93, 1) as number,
      },
    });
  });
  it("is null when either side has no grouped members", () => {
    const flat = dim({ dim_id: "territory", dimension_type: "geographic" });
    expect(territoryVerdict(flat, terrTableA, terrB, terrTableB)).toBeNull();
  });
});

describe("compareFacts", () => {
  it("counts the change story for the lede", () => {
    const facts = compareFacts(
      [terrA, classA],
      [terrTableA, sprinklerA, liabIlf],
      [terrB, classB, roofDimB],
      [terrTableB, sprinklerB, liabIlf, roofB],
    );
    expect(facts.sharedTables).toBe(3);
    expect(facts.changedTables).toBe(2); // territory + sprinkler
    expect(facts.onlyBTables).toEqual(["Roof age (property)"]);
    expect(facts.newDims).toEqual(["Roof age band"]);
    expect(facts.removedDims).toEqual([]);
    expect(facts.removedLevels).toEqual([
      { dim: "class_code", ids: ["c117"] },
    ]);
    // t3 +8.9% beats sprinkler −4.3%.
    expect(facts.biggest).toEqual({
      table: "Territory factor (property)",
      key: "t3",
      from: 1.12,
      to: 1.22,
    });
  });
});

describe("side refs + snapshot bodies", () => {
  it("round-trips plan and plan@snapshot refs", () => {
    expect(parseSideRef("plan_a")).toEqual({ planId: "plan_a", snapshotId: null });
    expect(parseSideRef("plan_a@ps_1")).toEqual({
      planId: "plan_a",
      snapshotId: "ps_1",
    });
    expect(parseSideRef("@ps_1")).toBeNull();
    expect(formatSideRef({ planId: "p", snapshotId: "s" })).toBe("p@s");
  });
  it("parses a snapshot body through the api-client schemas", () => {
    const substrate = parseSnapshotSubstrate({
      dimensions: [JSON.parse(JSON.stringify(terrA))],
      factor_tables: [JSON.parse(JSON.stringify(terrTableA))],
      extra_key_the_runtime_owns: { ignored: true },
    });
    expect(substrate.dims[0]?.dim_id).toBe("territory");
    expect(substrate.tables[0]?.cells["t3"]).toBe(1.12);
  });
});
