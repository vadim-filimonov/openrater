/**
 * probe-math — Brief 89 §3 (89.3) tests: structural swing from authored
 * spreads, the rep-value shapes per axis level, the bounded cartesian,
 * and the CSV serialization (incl. refusal cells).
 */

import { describe, expect, it } from "vitest";
import {
  analyzeProbeRows,
  axisValueForLevel,
  buildAxis,
  buildDefaultProbeSweep,
  buildProbeSweep,
  buildRateCardCsv,
  buildRateCardGrid,
  computeStructuralDrivers,
  dimInputKeys,
  probeAxisCandidates,
  type ProbeResultRow,
} from "./probe-math";
import type { DimensionRow } from "../DimensionsTable";

const CONSTRUCTION: DimensionRow = {
  id: "construction_class",
  slug: "construction_class",
  display_name: "Construction class",
  data_type: "string",
  levels: [
    { kind: "categorical", id: "frame", label: "Frame" },
    { kind: "categorical", id: "jm", label: "Joisted Masonry" },
    { kind: "categorical", id: "fr", label: "Fire Resistive" },
  ],
};
const TIV_BAND: DimensionRow = {
  id: "tiv_band",
  slug: "tiv_band",
  display_name: "TIV band",
  data_type: "number",
  shape: "banded",
  levels: [
    { kind: "banded", id: "b1", label: "< $250K", lo: 0, hi: 250_000 },
    { kind: "banded", id: "b2", label: "$250K–$1M", lo: 250_000, hi: 1_000_000 },
  ],
} as unknown as DimensionRow;
const EMPTY_DIM: DimensionRow = {
  id: "empty",
  slug: "empty",
  display_name: "No levels",
  data_type: "string",
  levels: [],
};

const TABLES = [
  { id: "ft_constr", display_name: "Construction", key_dimension: "construction_class" },
  { id: "ft_tiv", display_name: "TIV", key_dimension: "tiv_band" },
];

const CELLS = new Map<string, ReadonlyMap<string, number>>([
  [
    "ft_constr",
    new Map([
      ["frame", 1.0],
      ["jm", 0.9],
      ["fr", 0.65],
    ]),
  ],
  [
    "ft_tiv",
    new Map([
      ["b1", 1.0],
      ["b2", 1.0],
    ]),
  ],
]);

describe("computeStructuralDrivers (R9 B2)", () => {
  it("ranks by authored max/min swing; identical cells = flat; tableless dims flat-last", () => {
    const drivers = computeStructuralDrivers(
      [EMPTY_DIM, CONSTRUCTION, TIV_BAND],
      TABLES,
      CELLS,
    );
    expect(drivers[0]!.id).toBe("construction_class");
    expect(drivers[0]!.swing).toBeCloseTo(1.0 / 0.65, 5);
    expect(drivers[0]!.spreadMin).toBe(0.65);
    expect(drivers[0]!.spreadMax).toBe(1.0);
    // tiv table is authored but 1.00 everywhere → flat, honest.
    const tiv = drivers.find((d) => d.id === "tiv_band")!;
    expect(tiv.flat).toBe(true);
    expect(tiv.tableCount).toBe(1);
    // tableless dim is flat too, sorted after by label.
    const empty = drivers.find((d) => d.id === "empty")!;
    expect(empty.flat).toBe(true);
    expect(empty.tableCount).toBe(0);
  });
});

describe("rate-card helpers (R9 B1)", () => {
  it("axis candidates need keyable levels; banded levels carry the raw in-range number", () => {
    const cands = probeAxisCandidates([CONSTRUCTION, TIV_BAND, EMPTY_DIM]);
    expect(cands.map((d) => d.slug)).toEqual([
      "construction_class",
      "tiv_band",
    ]);
    expect(
      axisValueForLevel(TIV_BAND, { id: "b2", lo: 250_000 }),
    ).toBe(250_000);
    expect(axisValueForLevel(CONSTRUCTION, { id: "frame" })).toBe("frame");
  });

  it("dimInputKeys reads the deriver's runtime key, slug fallback otherwise", () => {
    const stages = [
      {
        stage_id: "chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "Premium",
              factor_lookups: [
                {
                  name: "Construction",
                  factor_kind: "construction",
                  dimensions: {
                    construction_class: { path: "form_input.constr_code" },
                  },
                },
              ],
            },
          ],
        },
      },
    ];
    const keys = dimInputKeys(stages, [CONSTRUCTION, TIV_BAND], TABLES);
    // The chain binds the dim to a DIFFERENT column — the card must
    // override THAT key, or the engine keeps reading the pin.
    expect(keys.get("construction_class")).toBe("constr_code");
    expect(keys.get("tiv_band")).toBe("tiv_band");
  });

  it("buildAxis caps levels with an honest truncation count", () => {
    const axis = buildAxis(CONSTRUCTION, "constr_code", 2);
    expect(axis.levels.map((l) => l.id)).toEqual(["frame", "jm"]);
    expect(axis.truncated).toBe(1);
  });

  it("buildRateCardGrid overlays axis values on the pins, row-major", () => {
    const rowAxis = buildAxis(CONSTRUCTION, "construction_class", 10);
    const colAxis = buildAxis(TIV_BAND, "tiv_band", 10);
    const grid = buildRateCardGrid(
      { tiv_band: 100, sprinklered: "yes" },
      rowAxis,
      colAxis,
    );
    expect(grid).toHaveLength(6);
    expect(grid[0]).toEqual({
      rowLevelId: "frame",
      colLevelId: "b1",
      inputs: { sprinklered: "yes", construction_class: "frame", tiv_band: 0 },
    });
    // The axis value WINS over the pin for the same key.
    expect(grid[1]!.inputs["tiv_band"]).toBe(250_000);
  });

  it("buildRateCardCsv writes premiums, declines, and withheld cells honestly", () => {
    const rowAxis = buildAxis(CONSTRUCTION, "construction_class", 10);
    const colAxis = buildAxis(TIV_BAND, "tiv_band", 10);
    const csv = buildRateCardCsv(rowAxis, colAxis, [
      { rowLevelId: "frame", colLevelId: "b1", premium: 1751, tier: null, note: null },
      { rowLevelId: "frame", colLevelId: "b2", premium: null, tier: "decline", note: null },
      { rowLevelId: "jm", colLevelId: "b1", premium: null, tier: null, note: "withheld" },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Construction class,< $250K,$250K–$1M");
    expect(lines[1]).toBe("Frame,1751,declined");
    expect(lines[2]).toBe("Joisted Masonry,withheld,");
  });
});

describe("buildProbeSweep (89.4 B3)", () => {
  const AXIS_A = buildAxis(CONSTRUCTION, "construction_class", 20);
  const AXIS_B = buildAxis(TIV_BAND, "tiv", 20);
  const PINS = { construction_class: "frame", tiv: 0, roof_age: 12 };

  it("row 0 is the pure base; one-at-a-time rows skip the pin-equal level; the top-2 cross follows", () => {
    const sweep = buildProbeSweep(PINS, [AXIS_A, AXIS_B], 500);
    expect(sweep.rows[0]).toEqual(PINS);
    // A: frame(=pin, skipped), jm, fr → 2. B: b1 lo 0 (=pin, skipped),
    // b2 lo 250k → 1. Cross adds the 2 cells not already present
    // (jm×b2, fr×b2 — frame×b1 IS the base, jm×b1/fr×b1 are the
    // one-at-a-time rows, frame×b2 is B's sweep row).
    expect(sweep.rows).toHaveLength(1 + 2 + 1 + 2);
    expect(sweep.rows[1]).toEqual({ ...PINS, construction_class: "jm" });
    expect(sweep.rows[3]).toEqual({ ...PINS, tiv: 250_000 });
    expect(sweep.rows[4]).toEqual({
      ...PINS,
      construction_class: "jm",
      tiv: 250_000,
    });
    expect(sweep.truncated).toBe(0);
    expect(sweep.variables).toEqual(["construction_class", "tiv"]);
  });

  it("caps the sweep with an honest truncation count", () => {
    const sweep = buildProbeSweep(PINS, [AXIS_A, AXIS_B], 3);
    expect(sweep.rows).toHaveLength(3);
    expect(sweep.truncated).toBe(3);
  });

  it("buildDefaultProbeSweep ranks axes by authored swing (the spread dim sweeps first)", () => {
    const sweep = buildDefaultProbeSweep({
      stages: [],
      dimensions: [TIV_BAND, CONSTRUCTION],
      factorTables: TABLES,
      cells: CELLS,
      pins: {},
    });
    // Construction carries the authored spread (1.0/0.9/0.65); the
    // flat TIV table ranks after it.
    expect(sweep.variables[0]).toBe("construction_class");
  });
});

describe("analyzeProbeRows (89.4 B3)", () => {
  const row = (
    inputs: Record<string, unknown>,
    premium: number | null,
    extra: Partial<ProbeResultRow> = {},
  ): ProbeResultRow => ({
    inputs,
    outputs: premium !== null ? { premium } : {},
    ...extra,
  });
  const BASE = { cls: "frame", tiv: "1000" };

  it("derives range, decline share, per-variable swing + decline clusters from the rows alone", () => {
    const rows: ProbeResultRow[] = [
      row(BASE, 100),
      row({ ...BASE, cls: "jm" }, 150),
      row({ ...BASE, cls: "fr" }, 80),
      row({ ...BASE, cls: "bad" }, 999, { eligibility_tier: "decline" }),
      row({ ...BASE, tiv: "2000" }, 100),
      row({ ...BASE, cls: "jm", tiv: "2000" }, 300),
      row({ ...BASE, tiv: "3000" }, null, { row_status: "error" }),
    ];
    const r = analyzeProbeRows(rows, "premium")!;
    expect(r.total).toBe(7);
    expect(r.priced).toBe(5);
    expect(r.declined).toBe(1);
    expect(r.errors).toBe(1);
    // Global range includes the cross cell; the declined 999 does NOT
    // price (the verdict outranks the indicative number).
    expect(r.premiumMin).toBe(80);
    expect(r.premiumMax).toBe(300);
    expect(r.crossCells).toBe(1);
    expect(r.baseDeclined).toBe(false);
    // cls: base 100 ∪ {150, 80} → swing 150/80; declined value named.
    const cls = r.variables.find((v) => v.inputKey === "cls")!;
    expect(cls.swing).toBeCloseTo(150 / 80, 6);
    expect(cls.declined).toBe(1);
    expect(cls.declinedValues).toEqual([{ value: "bad", count: 1 }]);
    // tiv: 100 vs 100 → flat (error row contributes no premium).
    const tiv = r.variables.find((v) => v.inputKey === "tiv")!;
    expect(tiv.swing).toBeNull();
    // Sorted: the swinging variable first.
    expect(r.variables[0]!.inputKey).toBe("cls");
  });

  it("a declining base is called out (every line inherits the verdict)", () => {
    const rows: ProbeResultRow[] = [
      row(BASE, 100, { eligibility_tier: "decline" }),
      row({ ...BASE, cls: "jm" }, 90),
    ];
    const r = analyzeProbeRows(rows, "premium")!;
    expect(r.baseDeclined).toBe(true);
    expect(r.declined).toBe(1);
    expect(r.priced).toBe(1);
  });

  it("empty rows → null (no fabricated readout)", () => {
    expect(analyzeProbeRows([], "premium")).toBeNull();
  });
});
