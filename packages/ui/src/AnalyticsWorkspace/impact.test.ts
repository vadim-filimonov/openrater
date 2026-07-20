import { describe, it, expect } from "vitest";
import { computeImpactByVariable } from "./impact";
import { ANALYTICS_KPIS } from "./analytics-types";
import type { AnalyticsScoredRow } from "./exhibit-math";
import type { OverviewVariableSpec } from "./overview-math";

const PREMIUM = "final_premium";
const AVG = ANALYTICS_KPIS.find((k) => k.id === "avg")!;
const row = (inputs: Record<string, unknown>, prem: number): AnalyticsScoredRow => ({
  inputs,
  outputs: { [PREMIUM]: prem },
});

// 12 aligned policies. cls A/B/C; region X for all.
// baseline premium: A 1000, B 2000, C 1000.  comparison: A 1100, B 2000, C 1500.
function dataset() {
  const base: AnalyticsScoredRow[] = [];
  const comp: AnalyticsScoredRow[] = [];
  const add = (cls: string, basePrem: number, compPrem: number) => {
    base.push(row({ cls, region: "X" }, basePrem));
    comp.push(row({ cls, region: "X" }, compPrem));
  };
  for (let i = 0; i < 4; i += 1) add("A", 1000, 1100);
  for (let i = 0; i < 4; i += 1) add("B", 2000, 2000);
  for (let i = 0; i < 4; i += 1) add("C", 1000, 1500);
  return { base, comp };
}

const VARS: OverviewVariableSpec[] = [
  { id: "cls", label: "Class", kind: "categorical" },
  { id: "region", label: "Region", kind: "categorical" },
];

describe("computeImpactByVariable", () => {
  it("ranks by differential spread; a non-differentiating variable is flat", () => {
    const { base, comp } = dataset();
    const r = computeImpactByVariable({
      baselineRows: base,
      comparisonRows: comp,
      variables: VARS,
      premiumColumn: PREMIUM,
      kpi: AVG,
    });
    // Class differentiates (A +10%, B 0%, C +50%); Region moves uniformly.
    expect(r.variables.map((v) => v.id)).toEqual(["cls", "region"]);
    const cls = r.variables[0]!;
    expect(cls.minLevelDelta).toBeCloseTo(0, 6);
    expect(cls.maxLevelDelta).toBeCloseTo(0.5, 6);
    expect(cls.deltaSpread).toBeCloseTo(0.5, 6);
    expect(cls.maxAbsDelta).toBeCloseTo(0.5, 6);
    expect(cls.flat).toBe(false);

    const region = r.variables[1]!;
    expect(region.flat).toBe(true);
    expect(region.deltaSpread).toBeNull();
  });

  it("computes the book-wide delta over the variable's rows", () => {
    const { base, comp } = dataset();
    const r = computeImpactByVariable({
      baselineRows: base,
      comparisonRows: comp,
      variables: VARS,
      premiumColumn: PREMIUM,
      kpi: AVG,
    });
    // base avg 1333.33 → comp avg 1533.33.
    expect(r.variables.find((v) => v.id === "cls")!.bookDelta).toBeCloseTo(0.15, 4);
  });

  it("excludes thin levels from the deltas (a 1-policy outlier can't crown it)", () => {
    const { base, comp } = dataset();
    base.push(row({ cls: "D", region: "X" }, 1000));
    comp.push(row({ cls: "D", region: "X" }, 9000)); // +800% on 1 policy
    const r = computeImpactByVariable({
      baselineRows: base,
      comparisonRows: comp,
      variables: VARS,
      premiumColumn: PREMIUM,
      kpi: AVG,
    });
    const cls = r.variables.find((v) => v.id === "cls")!;
    expect(cls.levelCount).toBe(4); // A, B, C, D present
    expect(cls.rankedLevelCount).toBe(3); // D excluded (1 < threshold 2)
    expect(cls.maxAbsDelta).toBeCloseTo(0.5, 6); // not 8.0
  });

  it("bins a numeric variable and detects a differential move across bins", () => {
    const base: AnalyticsScoredRow[] = [];
    const comp: AnalyticsScoredRow[] = [];
    for (let age = 1; age <= 12; age += 1) {
      base.push(row({ age }, 1000));
      comp.push(row({ age }, age <= 6 ? 1000 : 1500)); // young flat, old +50%
    }
    const r = computeImpactByVariable({
      baselineRows: base,
      comparisonRows: comp,
      variables: [{ id: "age", label: "Age", kind: "numeric" }],
      premiumColumn: PREMIUM,
      kpi: AVG,
    });
    const age = r.variables[0]!;
    expect(age.flat).toBe(false);
    expect(age.deltaSpread).toBeCloseTo(0.5, 6);
  });
});
