import { describe, it, expect } from "vitest";
import { computePlanOverview, type OverviewVariableSpec } from "./overview-math";
import type { AnalyticsScoredRow } from "./exhibit-math";

const PREMIUM = "final_premium";

/** A scored row with class / age / region inputs + a premium output. */
function mk(
  cls: string,
  age: number,
  prem: number,
  region = "X",
): AnalyticsScoredRow {
  return {
    inputs: { class_code: cls, building_age: age, region },
    outputs: { [PREMIUM]: prem },
  };
}

// 12 rows: class A/B/C (4 each), premium 1000/2000/4000, age 1..12 tracks class.
const ROWS: AnalyticsScoredRow[] = [
  mk("A", 1, 1000), mk("A", 2, 1000), mk("A", 3, 1000), mk("A", 4, 1000),
  mk("B", 5, 2000), mk("B", 6, 2000), mk("B", 7, 2000), mk("B", 8, 2000),
  mk("C", 9, 4000), mk("C", 10, 4000), mk("C", 11, 4000), mk("C", 12, 4000),
];

const VARS: OverviewVariableSpec[] = [
  { id: "class_code", label: "Class code", kind: "categorical" },
  { id: "building_age", label: "Building age", kind: "numeric" },
  { id: "region", label: "Region", kind: "categorical" },
];

describe("computePlanOverview", () => {
  it("ranks by swing desc, flat variables last, ties broken by label", () => {
    const o = computePlanOverview({ rows: ROWS, variables: VARS, premiumColumn: PREMIUM, kpi: "avg" });
    // class_code & building_age both swing 4.0 → tie → label asc puts
    // "Building age" before "Class code"; flat "Region" sorts last.
    expect(o.variables.map((v) => v.id)).toEqual([
      "building_age",
      "class_code",
      "region",
    ]);
  });

  it("computes the per-level avg-premium swing for a categorical variable", () => {
    const o = computePlanOverview({ rows: ROWS, variables: VARS, premiumColumn: PREMIUM, kpi: "avg" });
    const cls = o.variables.find((v) => v.id === "class_code")!;
    expect(cls.minLevel).toBe(1000);
    expect(cls.maxLevel).toBe(4000);
    expect(cls.swing).toBe(4);
    expect(cls.levelCount).toBe(3);
    expect(cls.rankedLevelCount).toBe(3);
    expect(cls.flat).toBe(false);
    expect(cls.total).toBe(4 * 1000 + 4 * 2000 + 4 * 4000);
  });

  it("equal-count bins a numeric variable and ranks by its bin spread", () => {
    const o = computePlanOverview({ rows: ROWS, variables: VARS, premiumColumn: PREMIUM, kpi: "avg" });
    const age = o.variables.find((v) => v.id === "building_age")!;
    expect(age.kind).toBe("numeric");
    expect(age.bins).toEqual({ requested: 10, formed: 6 }); // 12 distinct → 6 bins of 2
    expect(age.minLevel).toBe(1000);
    expect(age.maxLevel).toBe(4000);
    expect(age.swing).toBe(4);
  });

  it("marks a single-level variable flat (no premium differentiation)", () => {
    const o = computePlanOverview({ rows: ROWS, variables: VARS, premiumColumn: PREMIUM, kpi: "avg" });
    const region = o.variables.find((v) => v.id === "region")!;
    expect(region.flat).toBe(true);
    expect(region.swing).toBeNull();
    expect(region.rankedLevelCount).toBe(1);
  });

  it("treats a uniform KPI (equal counts) as flat", () => {
    // Every class has exactly 4 rows → count KPI is flat for class_code.
    const o = computePlanOverview({ rows: ROWS, variables: VARS, premiumColumn: PREMIUM, kpi: "count" });
    const cls = o.variables.find((v) => v.id === "class_code")!;
    expect(cls.flat).toBe(true);
    expect(cls.swing).toBeNull();
  });

  it("excludes thin (under-populated) levels from the swing", () => {
    // Add a 1-row outlier class D at a huge premium — below the ≥2 threshold,
    // so it must NOT crown the variable.
    const rows = [...ROWS, mk("D", 13, 999999)];
    const o = computePlanOverview({ rows, variables: VARS, premiumColumn: PREMIUM, kpi: "avg" });
    const cls = o.variables.find((v) => v.id === "class_code")!;
    expect(cls.levelCount).toBe(4); // D is present…
    expect(cls.rankedLevelCount).toBe(3); // …but excluded from ranking
    expect(cls.maxLevel).toBe(4000); // not 999999
    expect(cls.swing).toBe(4);
  });

  it("groups a geographic variable by defined territory (match sets)", () => {
    const rows: AnalyticsScoredRow[] = [
      { inputs: { zip: "66101" }, outputs: { [PREMIUM]: 15000 } },
      { inputs: { zip: "66102" }, outputs: { [PREMIUM]: 15000 } },
      { inputs: { zip: "67501" }, outputs: { [PREMIUM]: 9000 } },
      { inputs: { zip: "67502" }, outputs: { [PREMIUM]: 9000 } },
    ];
    const vars: OverviewVariableSpec[] = [
      {
        id: "zip",
        label: "Territory",
        kind: "geographic",
        levels: [
          { id: "T1", label: "Metro", match: ["66101", "66102"] },
          { id: "T2", label: "Rural", match: ["67501", "67502"] },
        ],
      },
    ];
    const o = computePlanOverview({ rows, variables: vars, premiumColumn: PREMIUM, kpi: "avg" });
    const terr = o.variables[0]!;
    expect(terr.rankedLevelCount).toBe(2);
    expect(terr.minLevel).toBe(9000);
    expect(terr.maxLevel).toBe(15000);
    expect(terr.swing).toBeCloseTo(15000 / 9000, 5);
  });

  it("handles an empty book without throwing", () => {
    const o = computePlanOverview({ rows: [], variables: VARS, premiumColumn: PREMIUM, kpi: "avg" });
    expect(o.rowCount).toBe(0);
    for (const v of o.variables) {
      expect(v.total).toBe(0);
      expect(v.flat).toBe(true);
      expect(v.swing).toBeNull();
    }
  });
});
