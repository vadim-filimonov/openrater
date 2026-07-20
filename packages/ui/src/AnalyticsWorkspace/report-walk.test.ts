/**
 * report-walk + report-facts — Brief 93 §1.1.3 (the reference-risk
 * walk) and §1.1.2 (the counted lede facts).
 *
 * The walk tests run REAL plans through the production engine
 * (compilePlan/runPlan via computeReferenceWalk) — no mocked traces.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { registerBuiltinKinds, type Plan } from "@openrater/contracts";
import { computeReferenceWalk } from "./report-walk";

beforeAll(() => registerBuiltinKinds());
import {
  buildProvenanceClause,
  buildReportMetaLine,
  computePlanReportFacts,
} from "./report-facts";

/** base 1000 × 1.32 (Construction) × 0.9 (Sprinkler) → round → output. */
function linearPlan(): Plan {
  return {
    id: "walk-test",
    version: "1.0.0",
    name: "Walk test",
    nodes: [
      {
        id: "base",
        kind: "constant",
        label: "Base rate — building",
        params: { value: 1000, type: "money" },
      },
      {
        id: "cls",
        kind: "constant",
        label: "Construction class",
        params: { value: 1.32, type: "factor" },
      },
      {
        id: "spr",
        kind: "constant",
        label: "Sprinkler credit",
        params: { value: 0.9, type: "factor" },
      },
      { id: "chain", kind: "chain.mult", label: "Premium chain", params: {} },
      { id: "rnd", kind: "round", label: "Rounding", params: { decimals: 0 } },
      {
        id: "out",
        kind: "output",
        params: { fieldName: "total_premium", fieldType: "money" },
      },
    ],
    edges: [
      {
        from: { node: "base", port: "value" },
        to: { node: "chain", port: "base" },
      },
      {
        from: { node: "cls", port: "value" },
        to: { node: "chain", port: "factors" },
      },
      {
        from: { node: "spr", port: "value" },
        to: { node: "chain", port: "factors" },
      },
      {
        from: { node: "chain", port: "result" },
        to: { node: "rnd", port: "value" },
      },
      {
        from: { node: "rnd", port: "value" },
        to: { node: "out", port: "value" },
      },
    ],
  } as unknown as Plan;
}

/** Two towers summed (chain.add) → output: the composite stop. */
function compositePlan(): Plan {
  return {
    id: "walk-composite",
    version: "1.0.0",
    name: "Composite walk test",
    nodes: [
      {
        id: "t1",
        kind: "constant",
        label: "Property tower",
        params: { value: 800, type: "money" },
      },
      {
        id: "t2",
        kind: "constant",
        label: "Liability tower",
        params: { value: 450, type: "money" },
      },
      { id: "sum", kind: "chain.add", label: "Coverage sum", params: {} },
      {
        id: "out",
        kind: "output",
        params: { fieldName: "total_premium", fieldType: "money" },
      },
    ],
    edges: [
      {
        from: { node: "t1", port: "value" },
        to: { node: "sum", port: "addends" },
      },
      {
        from: { node: "t2", port: "value" },
        to: { node: "sum", port: "addends" },
      },
      {
        from: { node: "sum", port: "result" },
        to: { node: "out", port: "value" },
      },
    ],
  } as unknown as Plan;
}

/**
 * Two coverage towers, each tip carrying its OWN ISO `round` node, and
 * NO declared total — the legal Brief-92 transcription, and the shape
 * of the live 2026-07-15 repro. Building 130 × 1.5 = $195; contents
 * 60 × 1.2 = $72; the risk costs $267.
 */
function twoTowerTotalLessPlan(): Plan {
  const tower = (
    tag: string,
    base: number,
    factor: number,
    factorLabel: string,
    field: string,
  ) => ({
    nodes: [
      { id: `${tag}_base`, kind: "constant", params: { value: base, type: "money" } },
      {
        id: `${tag}_f`,
        kind: "constant",
        label: factorLabel,
        params: { value: factor, type: "factor" },
      },
      {
        id: `${tag}_chain`,
        kind: "chain.mult",
        params: { factorNames: [factorLabel], stopOnZero: false },
      },
      // The per-tip ISO round — NOT a plan total (registry r2: only a
      // round STAGE is the D8 plan-total-rounder).
      { id: `${tag}_rnd`, kind: "round", label: "Round to dollar", params: { decimals: 0 } },
      { id: `${tag}_out`, kind: "output", params: { fieldName: field, fieldType: "money" } },
    ],
    edges: [
      { from: { node: `${tag}_base`, port: "value" }, to: { node: `${tag}_chain`, port: "base" } },
      { from: { node: `${tag}_f`, port: "value" }, to: { node: `${tag}_chain`, port: "factors" } },
      { from: { node: `${tag}_chain`, port: "result" }, to: { node: `${tag}_rnd`, port: "value" } },
      { from: { node: `${tag}_rnd`, port: "value" }, to: { node: `${tag}_out`, port: "value" } },
    ],
  });
  const b = tower("b", 130, 1.5, "Construction class", "building_premium");
  const c = tower("c", 60, 1.2, "Class group", "contents_premium");
  return {
    id: "walk-total-less",
    version: "1.0.0",
    name: "Two towers, no total",
    nodes: [...b.nodes, ...c.nodes],
    edges: [...b.edges, ...c.edges],
  } as unknown as Plan;
}

describe("computeReferenceWalk · total-less multi-coverage (93.4)", () => {
  it("⭐ headlines the dec-page SUM and walks EVERY tower — never the last tip", () => {
    // The live repro: anchoring on one output headlined $72 (contents)
    // for a risk that costs $267.
    const walk = computeReferenceWalk({
      plan: twoTowerTotalLessPlan(),
      pins: {},
      stages: [],
    });
    expect(walk).not.toBeNull();
    expect(walk!.premium).toBe(267);
    expect(walk!.coverageSum).toBe(true);
    expect(walk!.premiumColumn).toBe("coverage_sum_premium");
    expect(walk!.refusal).toBeNull();

    // Both towers walked, each closing on its own subtotal.
    const subtotals = walk!.rows.filter((r) => r.kind === "subtotal");
    expect(subtotals.map((r) => [r.label, r.running])).toEqual([
      ["Building premium", 195],
      ["Contents premium", 72],
    ]);

    // CT-4 (amended) — the subtotals ADD to the headline exactly.
    expect(subtotals.reduce((a, r) => a + (r.running ?? 0), 0)).toBe(
      walk!.premium,
    );

    // Each tower is a real build-up, not a bare number.
    expect(walk!.rows.map((r) => r.kind)).toEqual([
      "base", "factor", "step", "subtotal",
      "base", "factor", "step", "subtotal",
    ]);
  });

  it("an unlabeled base row names its coverage, so each group opens self-identified", () => {
    const walk = computeReferenceWalk({
      plan: twoTowerTotalLessPlan(),
      pins: {},
      stages: [],
    });
    const bases = walk!.rows.filter((r) => r.kind === "base");
    expect(bases.map((r) => r.label)).toEqual([
      "Building premium — base rate",
      "Contents premium — base rate",
    ]);
    expect(bases.map((r) => r.running)).toEqual([130, 60]);
  });

  it("a round STAGE declares the total — the towers are NOT summed (no double-count)", () => {
    // Same two towers, but the filing HAS a total row. Its stage names
    // the field; the walk must anchor on it, never re-add the parts.
    const base = twoTowerTotalLessPlan();
    const plan = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: "pkg_sum", kind: "chain.add", label: "Package total", params: {} },
        {
          id: "pkg_out",
          kind: "output",
          params: { fieldName: "package_premium", fieldType: "money" },
        },
      ],
      edges: [
        ...base.edges,
        { from: { node: "b_rnd", port: "value" }, to: { node: "pkg_sum", port: "addends" } },
        { from: { node: "c_rnd", port: "value" }, to: { node: "pkg_sum", port: "addends" } },
        { from: { node: "pkg_sum", port: "result" }, to: { node: "pkg_out", port: "value" } },
      ],
    } as unknown as Plan;

    const walk = computeReferenceWalk({
      plan,
      pins: {},
      stages: [
        { stage_kind: "round", config_json: { output_field: "package_premium" } },
      ],
    });
    expect(walk!.coverageSum).toBe(false);
    expect(walk!.premiumColumn).toBe("package_premium");
    // 267 — the declared total, NOT 195 + 72 + 267.
    expect(walk!.premium).toBe(267);
    expect(walk!.rows.filter((r) => r.kind === "subtotal")).toHaveLength(0);
  });

  it("an explicit premiumColumn is a contract — it never falls through to the sum", () => {
    const walk = computeReferenceWalk({
      plan: twoTowerTotalLessPlan(),
      pins: {},
      stages: [],
      premiumColumn: "contents_premium",
    });
    expect(walk!.coverageSum).toBe(false);
    expect(walk!.premium).toBe(72);
  });

  it("Law 2 / G8 — an error row never sums the towers that DID resolve", () => {
    // Contents' base comes from an input the reference risk can't
    // supply. Summing building's surviving $195 would rebuild the exact
    // silently-wrong number the engine's refusal withheld.
    const base = twoTowerTotalLessPlan();
    const plan = {
      ...base,
      nodes: base.nodes.map((n) =>
        (n as { id: string }).id === "c_base"
          ? { id: "c_base", kind: "input", params: { fieldName: "bpp_rate" } }
          : n,
      ),
    } as unknown as Plan;

    const walk = computeReferenceWalk({ plan, pins: {}, stages: [] });
    expect(walk).not.toBeNull();
    expect(walk!.run.row_status).toBe("error");
    expect(walk!.refusal).not.toBeNull();
    // The guard is load-bearing, not incidental: the refused run STILL
    // carries building's $195 in outputs (partials survive for
    // diagnosis), so an unguarded sum would headline $195 — a real
    // number that is not this risk's price.
    expect(walk!.run.outputs["building_premium"]).toBe(195);
    expect(walk!.premium).toBeNull();
  });
});

describe("computeReferenceWalk (Brief 93 §1.1.3)", () => {
  it("walks base → named factors → post-chain steps to the exact premium", () => {
    const walk = computeReferenceWalk({
      plan: linearPlan(),
      pins: {},
      premiumColumn: "total_premium",
    });
    expect(walk).not.toBeNull();
    // 1000 × 1.32 × 0.9 = 1188
    expect(walk!.premium).toBe(1188);
    expect(walk!.refusal).toBeNull();

    const kinds = walk!.rows.map((r) => r.kind);
    expect(kinds).toEqual(["base", "factor", "factor", "step"]);

    const [base, f1, f2, step] = walk!.rows;
    expect(base!.label).toBe("Base rate — building");
    expect(base!.running).toBe(1000);
    // Factor labels come from the wired source nodes, in wiring order.
    expect(f1!.label).toBe("Construction class");
    expect(f1!.op).toBe("× 1.32");
    expect(f1!.running).toBeCloseTo(1320, 6);
    expect(f2!.label).toBe("Sprinkler credit");
    expect(f2!.op).toBe("× 0.9");
    expect(f2!.running).toBeCloseTo(1188, 6);
    expect(step!.label).toBe("Rounding");
    expect(step!.op).toBe("round");
    expect(step!.running).toBe(1188);

    // The walk's arithmetic lands on the headline premium exactly (CT-4).
    expect(walk!.rows.at(-1)!.running).toBe(walk!.premium);
  });

  it("a multi-tower composition stops honestly — one labeled base row, never a fake linear chain", () => {
    const walk = computeReferenceWalk({
      plan: compositePlan(),
      pins: {},
      premiumColumn: "total_premium",
    });
    expect(walk).not.toBeNull();
    expect(walk!.premium).toBe(1250);
    expect(walk!.rows).toHaveLength(1);
    expect(walk!.rows[0]!.kind).toBe("base");
    expect(walk!.rows[0]!.label).toContain("Coverage sum");
    expect(walk!.rows[0]!.label).toContain("2 components");
    expect(walk!.rows[0]!.running).toBe(1250);
  });

  it("degrades to null on an uncompilable plan instead of throwing", () => {
    const walk = computeReferenceWalk({
      plan: {
        id: "x",
        version: "1",
        name: "x",
        nodes: [{ id: "bad", kind: "no.such.kind", params: {} }],
        edges: [],
      } as unknown as Plan,
      pins: {},
      premiumColumn: "total_premium",
    });
    expect(walk).toBeNull();
  });
});

describe("report facts (Brief 93 §1.1.2)", () => {
  //  — stepCount is THE public counting (the Rating tab's rows:
  // chain build-up steps + tail-adjustment rows), never the wire stage
  // count. One chain (base + 1 factor) + a round = 3 steps.
  const stages = [
    { stage_id: "s1", stage_kind: "input_node" },
    { stage_id: "s2", stage_kind: "input_node" },
    {
      stage_id: "s3",
      stage_kind: "multiplicative_chain",
      config_json: {
        output_total_field: "premium",
        chains: [
          {
            name: "building premium",
            base_value: 0.5,
            output_field: "building_premium",
            factor_lookups: [{ name: "cls", factor_kind: "cls" }],
          },
        ],
      },
    },
    { stage_id: "s4", stage_kind: "round" },
    { stage_id: "s5", stage_kind: "eligibility.gate" },
    { stage_id: "s6", stage_kind: "interpolate" },
  ];

  it("counts inputs / steps / tables / curves / gates from the substrate", () => {
    const facts = computePlanReportFacts(stages, [{}, {}, {}]);
    expect(facts).toEqual({
      inputCount: 2,
      stepCount: 3,
      chainCount: 1,
      tableCount: 3,
      curveCount: 1,
      gateCount: 1,
    });
  });

  it("meta line leads with the public counting and omits zero counts", () => {
    expect(
      buildReportMetaLine(computePlanReportFacts(stages, [{}, {}, {}])),
    ).toBe("1 chain · 3 steps · 2 inputs · 3 tables");
    expect(
      buildReportMetaLine(
        computePlanReportFacts(
          [
            { stage_id: "a", stage_kind: "input_node" },
            { stage_id: "b", stage_kind: "multiplicative_chain" },
          ],
          [],
        ),
      ),
    ).toBe("0 steps · 1 input");
  });

  it("provenance clause exists only for workbook-built plans", () => {
    // "transcribed", never "filed" — the workbook is always transcribed
    // but not always from a regulatory filing (Brief 94 U11).
    expect(buildProvenanceClause({ workbookBuilt: true })).toContain(
      "transcribed workbook",
    );
    expect(buildProvenanceClause({ workbookBuilt: true })).not.toContain(
      "filed",
    );
    expect(buildProvenanceClause({ workbookBuilt: false })).toBeNull();
  });
});
