/**
 * premium-resolution — the ONE answer to "what does this plan call its
 * premium?", pinned at the @openrater/ui layer.
 *
 * These cases mirror the scoring service's `totalLessPremium.test.ts`
 * end-to-end expectations. That is the point: the resolver is shared
 * (derive.ts re-exports THIS module), so a green suite here is the
 * browser's proof that its surfaces classify a plan exactly the way
 * /score, /score-policy, and the book runner will.
 */

import { describe, expect, it } from "vitest";

import {
  COVERAGE_SUM_COLUMN,
  declaredPremiumRollup,
  extraPolicyRollupFields,
  isCoverageSumBook,
  isTotalLessMultiCoverage,
  premiumBasisField,
  resolvePlanPremiumContext,
  rolledPolicyPremium,
  sumMoneyFields,
  totalLessTailRefusalMessage,
  type PlanPremiumContext,
  type PremiumPlanLike,
  type PremiumStageLike,
} from "./premium-resolution";

/** An `output` node as the projector emits it. */
function out(fieldName: string, fieldType?: string): {
  id: string;
  kind: string;
  params: Record<string, unknown>;
} {
  return {
    id: `out_${fieldName}`,
    kind: "output",
    params: { fieldName, ...(fieldType ? { fieldType } : {}) },
  };
}

/** The live repro's shape: two exposure-rated towers, each tip carrying
 *  its own ISO `round` NODE, and NO round STAGE (no filed total). */
const TWO_TOWER_PLAN: PremiumPlanLike = {
  nodes: [
    { id: "chain_building", kind: "chain.mult" },
    { id: "round_building_tip", kind: "round" },
    out("building_premium", "money"),
    { id: "chain_contents", kind: "chain.mult" },
    { id: "round_contents_tip", kind: "round" },
    out("contents_premium", "money"),
  ],
};

const ROUND_STAGE: PremiumStageLike = {
  stage_kind: "round",
  config_json: { output_field: "package_premium" },
};

describe("resolvePlanPremiumContext", () => {
  it("⭐ two exposure-rated towers with per-tip round NODES declare NO total", () => {
    // THE trap (#482): every tower output is round-fed, so a graph-side
    // "round-fed output is the total" detector crowns the LAST tower —
    // the live bug headlined $72 (contents) for a $267 risk. Only a
    // round STAGE is the D8 plan-total-rounder, and there is none here.
    const ctx = resolvePlanPremiumContext(TWO_TOWER_PLAN, []);
    expect(ctx.aggregateField).toBeNull();
    expect(ctx.moneyFields).toEqual(["building_premium", "contents_premium"]);
    expect(isTotalLessMultiCoverage(ctx)).toBe(true);
  });

  it("a round STAGE names the plan total whatever the workbook called it", () => {
    const ctx = resolvePlanPremiumContext(
      {
        nodes: [...(TWO_TOWER_PLAN.nodes ?? []), out("package_premium", "money")],
      },
      [ROUND_STAGE],
    );
    expect(ctx.aggregateField).toBe("package_premium");
    // A declared total resolves ALONE — the parts never rebuild it.
    expect(isTotalLessMultiCoverage(ctx)).toBe(false);
  });

  it("a round stage with a blank output_field falls back to the convention", () => {
    const ctx = resolvePlanPremiumContext(TWO_TOWER_PLAN, [
      { stage_kind: "round", config_json: { output_field: "  " } },
    ]);
    expect(ctx.aggregateField).toBe("total_premium");
  });

  it("reads a round stage whose config_json arrived as a JSON string", () => {
    const ctx = resolvePlanPremiumContext(TWO_TOWER_PLAN, [
      { stage_kind: "round", config_json: '{"output_field":"filed_premium"}' },
    ]);
    expect(ctx.aggregateField).toBe("filed_premium");
  });

  it("the total_premium / final_premium name convention wins without stages", () => {
    for (const name of ["total_premium", "final_premium"]) {
      const ctx = resolvePlanPremiumContext({
        nodes: [out("building_premium", "money"), out(name, "money")],
      });
      expect(ctx.aggregateField).toBe(name);
      expect(isTotalLessMultiCoverage(ctx)).toBe(false);
    }
  });

  it("WITHOUT stages a custom-named round total is indistinguishable from a tower", () => {
    // The honest limit: no stages (raw source:"plan") ⇒ name-convention
    // leg only. Callers that HAVE stages must pass them — summing here
    // would double-count the filing's own total.
    const ctx = resolvePlanPremiumContext({
      nodes: [...(TWO_TOWER_PLAN.nodes ?? []), out("package_premium", "money")],
    });
    expect(ctx.aggregateField).toBeNull();
    expect(ctx.moneyFields).toHaveLength(3);
  });

  it("a lone money output is not the total-less case", () => {
    const ctx = resolvePlanPremiumContext({
      nodes: [out("bop_premium", "money"), out("model_factor_used", "number")],
    });
    expect(ctx.aggregateField).toBeNull();
    expect(ctx.moneyFields).toEqual(["bop_premium"]);
    expect(isTotalLessMultiCoverage(ctx)).toBe(false);
  });

  it("non-money and field-less outputs never enter moneyFields", () => {
    const ctx = resolvePlanPremiumContext({
      nodes: [
        out("building_premium", "money"),
        out("territory_factor", "number"),
        out("tier"),
        { id: "not_an_output", kind: "chain.mult", params: { fieldName: "x" } },
      ],
    });
    expect(ctx.moneyFields).toEqual(["building_premium"]);
  });

  it("an empty plan resolves to nothing rather than throwing", () => {
    expect(resolvePlanPremiumContext({})).toEqual({
      aggregateField: null,
      moneyFields: [],
    });
  });
});

describe("sumMoneyFields — the ONE summing rule", () => {
  it("sums the dec-page parts", () => {
    expect(
      sumMoneyFields(
        { building_premium: 195, contents_premium: 72, tier: "standard" },
        ["building_premium", "contents_premium"],
      ),
    ).toBe(267);
  });

  it("sums the finite parts and ignores the rest", () => {
    expect(
      sumMoneyFields({ a: 10, b: "nope", c: Number.NaN, d: 5 }, [
        "a",
        "b",
        "c",
        "d",
      ]),
    ).toBe(15);
  });

  it("is null when nothing resolves — never a silent 0", () => {
    expect(sumMoneyFields({ a: "x" }, ["a", "missing"])).toBeNull();
    expect(sumMoneyFields({}, [])).toBeNull();
  });
});

describe("totalLessTailRefusalMessage", () => {
  it("names the coverage count and the two ways out", () => {
    const msg = totalLessTailRefusalMessage(2);
    expect(msg).toMatch(/prices 2 coverages/);
    expect(msg).toMatch(/declares no total output/);
    expect(msg).toMatch(/remove the tail/);
  });
});

// ── The book's premium basis ────────────────────────────────────────
// The cluster the browser's local composition and the service's two
// composers now share. These cases mirror the service's
// `totalLessRollups.test.ts` end-to-end expectations exactly.

/** The legal total-less transcription: two towers, no total. */
const TOTAL_LESS: PlanPremiumContext = {
  aggregateField: null,
  moneyFields: ["building_premium", "contents_premium"],
};
/** A plan that declares its own total (a round stage published it). */
const WITH_TOTAL: PlanPremiumContext = {
  aggregateField: "total_premium",
  moneyFields: ["building_premium", "contents_premium", "total_premium"],
};
/** One tower, no total — the premium IS the lone money output. */
const SINGLE: PlanPremiumContext = {
  aggregateField: null,
  moneyFields: ["building_premium"],
};
/** Total-less, but the workbook named its towers something that does
 *  NOT read like a premium — the only shape where a declared coverage
 *  and the dec-page sum coexist. */
const TOTAL_LESS_ODD_NAMES: PlanPremiumContext = {
  aggregateField: null,
  moneyFields: ["building_charge", "contents_charge"],
};

describe("declaredPremiumRollup", () => {
  it("finds a premium-named declaration and ignores the rest", () => {
    expect(declaredPremiumRollup(["tiv", "contents_premium"])).toBe(
      "contents_premium",
    );
    expect(declaredPremiumRollup(["tiv", "sqft"])).toBeNull();
    expect(declaredPremiumRollup([])).toBeNull();
  });
});

describe("isCoverageSumBook", () => {
  it("is true for a total-less plan whose mapping declares no premium", () => {
    expect(isCoverageSumBook([], TOTAL_LESS)).toBe(true);
    expect(isCoverageSumBook(["tiv"], TOTAL_LESS)).toBe(true);
  });

  it("⭐ a declared premium roll-up is an explicit basis and wins", () => {
    // THE regression this whole change exists to kill: the authoring
    // side used to volunteer `contents_premium` here, which reads as
    // "the author chose contents" and skips the sum.
    expect(isCoverageSumBook(["contents_premium"], TOTAL_LESS)).toBe(false);
  });

  it("is false for any plan that declares its own total", () => {
    expect(isCoverageSumBook([], WITH_TOTAL)).toBe(false);
  });

  it("is false for a single-coverage plan (nothing to sum)", () => {
    expect(isCoverageSumBook([], SINGLE)).toBe(false);
  });
});

describe("premiumBasisField", () => {
  it("prefers the declared basis over the plan's own answer", () => {
    expect(premiumBasisField(["contents_premium"], TOTAL_LESS)).toBe(
      "contents_premium",
    );
  });

  it("resolves the plan's declared aggregate", () => {
    expect(premiumBasisField([], WITH_TOTAL)).toBe("total_premium");
  });

  it("resolves the lone money output", () => {
    expect(premiumBasisField([], SINGLE)).toBe("building_premium");
  });

  it("names the synthesized column for the total-less transcription", () => {
    expect(premiumBasisField([], TOTAL_LESS)).toBe(COVERAGE_SUM_COLUMN);
  });

  it("falls back to the legacy convention with no plan context", () => {
    expect(premiumBasisField([])).toBe("total_premium");
  });
});

describe("extraPolicyRollupFields — Law 1", () => {
  it("rolls every coverage for a coverage-sum book", () => {
    expect(extraPolicyRollupFields([], TOTAL_LESS, COVERAGE_SUM_COLUMN)).toEqual(
      ["building_premium", "contents_premium"],
    );
  });

  it("never re-declares a coverage the mapping already rolls", () => {
    // The dedup only ever bites for a money output whose name does NOT
    // read like a premium — declaring `building_premium` would itself
    // be an explicit basis (see the case below), so this is the shape
    // that reaches the filter: a workbook that called its towers
    // something else.
    expect(
      extraPolicyRollupFields(["building_charge"], TOTAL_LESS_ODD_NAMES, COVERAGE_SUM_COLUMN),
    ).toEqual(["contents_charge"]);
  });

  it("⭐ declaring ONE coverage makes it the basis — no sum, nothing added", () => {
    // Why the authoring side may not volunteer `contents_premium`: the
    // name alone flips the book off the dec-page sum and files one
    // tower of the dec page.
    expect(
      extraPolicyRollupFields(["contents_premium"], TOTAL_LESS, "contents_premium"),
    ).toEqual([]);
  });

  it("adds the basis when the mapping declared nothing at all", () => {
    expect(extraPolicyRollupFields([], WITH_TOTAL, "total_premium")).toEqual([
      "total_premium",
    ]);
  });

  it("adds nothing when the mapping already declares the total", () => {
    expect(
      extraPolicyRollupFields(["total_premium"], WITH_TOTAL, "total_premium"),
    ).toEqual([]);
  });
});

describe("rolledPolicyPremium", () => {
  it("sums every coverage for a coverage-sum book", () => {
    expect(
      rolledPolicyPremium(
        { building_premium: 195, contents_premium: 72, tiv: 500_000 },
        TOTAL_LESS,
        ["tiv"],
      ),
    ).toBe(267);
  });

  it("reads the declared basis alone when one is declared", () => {
    expect(
      rolledPolicyPremium(
        { building_premium: 195, contents_premium: 72 },
        TOTAL_LESS,
        ["contents_premium"],
      ),
    ).toBe(72);
  });

  it("reads the plan's own total — never the sum of its parts", () => {
    // Double-counting guard: moneyFields carries the towers AND the
    // total; a plan with a total must read the total alone.
    expect(
      rolledPolicyPremium(
        { building_premium: 195, contents_premium: 72, total_premium: 267 },
        WITH_TOTAL,
        [],
      ),
    ).toBe(267);
  });

  it("is null when nothing resolves", () => {
    expect(rolledPolicyPremium({}, TOTAL_LESS, [])).toBeNull();
    expect(rolledPolicyPremium({ total_premium: "nope" }, WITH_TOTAL, [])).toBeNull();
  });
});
