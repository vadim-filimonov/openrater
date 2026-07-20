/**
 * Exhibits export — rows + CSV tests (current Exhibits design).
 */

import { describe, expect, it } from "vitest";
import type { PlanDimension, PlanFactorTable } from "@openrater/api-client";
import type { ExhibitTile } from "./anatomy";
import { orderedLevelValues } from "./anatomy";
import { tileCsv, tileRows, wallCsv } from "./export";

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

const terr = dim({
  dim_id: "territory",
  dimension_type: "geographic",
  geo_territories: [
    { id: "t1", label: "Territory 1", members: ["68001"] },
    { id: "t3", label: "Territory 3", members: ["68502"] },
  ],
});
const terrA = table({
  table_id: "territory_prop",
  key_dimensions: ["territory"],
  cells: { t1: 0.94, t3: 1.12 },
});
const terrB = table({
  table_id: "territory_prop",
  key_dimensions: ["territory"],
  cells: { t1: 0.94, t3: 1.22 },
});

function tileFor(t: PlanFactorTable): ExhibitTile {
  return {
    table: t,
    kind: "bars",
    span: null,
    dim: terr,
    values: orderedLevelValues(t, terr),
    monotonicity: null,
  };
}

describe("tileRows", () => {
  it("mirrors the drawing's order and computes Δ% only where changed", () => {
    const tile = tileFor(terrA);
    const rows = tileRows(tile, tile.values, terrB);
    expect(rows).toEqual([
      { id: "t1", label: "Territory 1", a: 0.94, b: 0.94, deltaPct: null },
      {
        id: "t3",
        label: "Territory 3",
        a: 1.12,
        b: 1.22,
        deltaPct: expect.closeTo(8.93, 1) as number,
      },
    ]);
  });
  it("portrait rows carry no B column", () => {
    const tile = tileFor(terrA);
    expect(tileRows(tile, tile.values, null)[0]).toEqual({
      id: "t1",
      label: "Territory 1",
      a: 0.94,
      b: null,
      deltaPct: null,
    });
  });
  it("2-D tables row per cell with a readable × label", () => {
    const grid = table({
      table_id: "constr_x_prot",
      cells: { "frame::p9_10": 1.42 },
    });
    const tile: ExhibitTile = {
      table: grid,
      kind: "grid",
      span: null,
      dim: null,
      values: [],
      monotonicity: null,
    };
    expect(tileRows(tile, [], null)[0]).toMatchObject({
      id: "frame::p9_10",
      label: "frame × p9_10",
      a: 1.42,
    });
  });
});

describe("csv", () => {
  it("tileCsv is exactly the table, with quoting where needed", () => {
    const rows = [
      { id: "t1", label: 'Omaha, "metro"', a: 0.94, b: null, deltaPct: null },
    ];
    expect(tileCsv("territory_prop", rows, false)).toBe(
      'table,level_id,label,factor\nterritory_prop,t1,"Omaha, ""metro""",0.94\n',
    );
  });
  it("compare CSV carries both sides and the delta", () => {
    const tile = tileFor(terrA);
    const csv = tileCsv(
      "territory_prop",
      tileRows(tile, tile.values, terrB),
      true,
    );
    expect(csv).toContain(
      "table,level_id,label,factor_a,factor_b,delta_pct",
    );
    expect(csv).toContain("territory_prop,t3,Territory 3,1.12,1.22,8.93");
    // Unchanged rows leave the delta EMPTY, never 0.00 (nothing moved).
    expect(csv).toContain("territory_prop,t1,Territory 1,0.94,0.94,\n");
  });
  it("wallCsv stacks every table under one header", () => {
    const tile = tileFor(terrA);
    const csv = wallCsv(
      [{ slug: "territory_prop", rows: tileRows(tile, tile.values, null) }],
      false,
    );
    expect(csv.split("\n")[0]).toBe("table,level_id,label,factor");
    expect(csv).toContain("territory_prop,t1,Territory 1,0.94");
  });
});
