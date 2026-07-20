/**
 * tower-plan-to-stages projection tests.
 *
 * Three concerns:
 *
 *   1. Direct shape — given a hand-rolled TowerPlan with one tower
 *      that references a submission-field + a factor-table + an
 *      LCM + an output, the converter emits the expected
 *      multiplicative_chain config_json shape.
 *
 *   2. Round-trip — `stagesToTowerPlan(towerPlanToStages(plan)) ≈ plan`
 *      against a hand-rolled minimal plan AND against the sample-bop
 *      fixture chain shape. Equivalence is semantic (chain.factor_kind
 *      + factor_lookups[].dimensions[K].path preserved) rather than
 *      structurally identical (display names / sub-titles regenerate
 *      on the load side).
 *
 *   3. Preserved sidecar — when `preservedStages` includes
 *      stage_kinds the converter doesn't reverse-project yet
 *      (modifier_schedule, flat_factor), they flow through
 *      unchanged into the output.
 */

import { describe, it, expect } from "vitest";

import { addTotalTower, isTotalTower } from "./plan-mutations";
import type { StageInput } from "./stages-to-tower-plan";
import { stagesToTowerPlan } from "./stages-to-tower-plan";
import { towerPlanToStages } from "./tower-plan-to-stages";
import type { Tower, TowerNode, TowerPlan } from "./types";

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

function makeNode(partial: Partial<TowerNode> & { id: string }): TowerNode {
  return {
    category: "input",
    title: partial.id,
    valueChip: { primary: "scalar" },
    icon: "FormInput",
    ...partial,
  } as TowerNode;
}

/**
 * Minimal viable plan: one tower with [base · factor · LCM · output].
 * Mirrors the sample-bop "Building chain" shape.
 */
function buildSimpleTowerPlan(): TowerPlan {
  const baseNode = makeNode({
    id: "inp_rate_number",
    category: "input",
    title: "Base rate",
    ref: { kind: "submission-field", field: "rate_number" },
    valueChip: { primary: "scalar" },
    icon: "FormInput",
  });
  const classFactor = makeNode({
    id: "fac_class_factor",
    category: "transform",
    subtype: "key",
    title: "Class factor",
    ref: { kind: "factor-table", tableId: "class_factor" },
    valueChip: { primary: "class_factor", secondary: "direct" },
    icon: "Tag",
  });
  const lcm = makeNode({
    id: "const_lcm",
    category: "math",
    subtype: "constant",
    title: "LCM",
    ref: { kind: "constant", constantId: "LCM" },
    valueChip: { primary: "scalar", secondary: "carrier-set" },
    icon: "Target",
  });
  const output = makeNode({
    id: "out_building_premium_usd",
    category: "output",
    title: "building_premium_usd",
    ref: { kind: "output", outputField: "building_premium_usd" },
    valueChip: { primary: "currency", secondary: "USD" },
    icon: "Circle",
  });
  const tower: Tower = {
    id: "tower_building",
    name: "Building chain",
    outputField: "building_premium_usd",
    ratingDimensionValue: "Bld",
    entries: [
      { kind: "node", nodeId: baseNode.id },
      { kind: "node", nodeId: classFactor.id },
      { kind: "node", nodeId: lcm.id },
      { kind: "node", nodeId: output.id },
    ],
    entryOps: ["multiply", "multiply", "multiply"],
  };
  return {
    ratingDimension: "coverage",
    ratingDimensionValues: ["Bld"],
    towers: [tower],
    nodes: new Map([
      [baseNode.id, baseNode],
      [classFactor.id, classFactor],
      [lcm.id, lcm],
      [output.id, output],
    ]),
    groups: new Map(),
    constants: new Map(),
    models: new Map(),
  };
}

const SAMPLE_BOP_BUILDING_CHAIN_STAGE: StageInput = {
  stage_id: "bop_chain_stage",
  sequence: 0,
  stage_kind: "multiplicative_chain",
  display_name: "BOP rating chains",
  config_json: {
    chains: [
      {
        name: "Building chain",
        base_input: "stages.rate_number.value",
        factor_lookups: [
          {
            name: "Class factor",
            factor_kind: "class_factor",
            table: "rate_factors",
            lookup_method: "direct",
            dimensions: {
              class_code: { source: "form_input", path: "class_code" },
            },
            citation_rule: "Meridian BOP 1.A.2",
            citation_page: "p. 12",
            description_template: "Class factor: ×{value}",
          },
        ],
        lcm: {
          factor_kind: "lcm",
          input_path: "form_input.carrier_lcm",
          citation_rule: "(carrier-set)",
          citation_page: "(carrier-set)",
          description_template: "Loss Cost Multiplier (carrier): {value}",
        },
        exposure_input: "form_input.tiv",
        exposure_unit_divisor: 100,
        output_field: "building_premium_usd",
        coverage_value: "Bld",
      },
    ],
    output_total_field: "subtotal_after_chain_usd",
    rating_dimension: "coverage",
  },
};

// ─────────────────────────────────────────────────────────────────
// 1. Direct shape
// ─────────────────────────────────────────────────────────────────

describe("towerPlanToStages — direct shape", () => {
  it("emits ONE multiplicative_chain stage with chains[]", () => {
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const chainStages = out.filter(
      (s) => s.stage_kind === "multiplicative_chain",
    );
    expect(chainStages.length).toBe(1);
    const cfg = chainStages[0]!.config_json as Record<string, unknown>;
    const chains = cfg["chains"] as readonly Record<string, unknown>[];
    expect(chains.length).toBe(1);
    const chain = chains[0]!;
    expect(chain["name"]).toBe("Building chain");
    expect(chain["output_field"]).toBe("building_premium_usd");
    expect(chain["coverage_value"]).toBe("Bld");
  });

  it("reverse-projects factor-table nodes into factor_lookups with dim binding", () => {
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const cfg = (out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>);
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    const lookups = chain["factor_lookups"] as readonly Record<
      string,
      unknown
    >[];
    expect(lookups.length).toBe(1);
    const lookup = lookups[0]!;
    expect(lookup["factor_kind"]).toBe("class_factor");
    const dims = lookup["dimensions"] as Record<string, unknown>;
    expect(dims["class_code"]).toEqual({
      source: "form_input",
      path: "class_code",
    });
  });

  it("emits one input_node stage per submission-field referenced", () => {
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const inputStages = out.filter((s) => s.stage_kind === "input_node");
    expect(inputStages.length).toBe(1);
    expect(inputStages[0]!.stage_id).toBe("input_rate_number");
    const cfg = inputStages[0]!.config_json as Record<string, unknown>;
    expect(cfg["source_path"]).toBe("rate_number");
    expect(cfg["source"]).toBe("form_input");
  });

  it("base_input points to the input_node via stages.X.value", () => {
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const cfg = (out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>);
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    expect(chain["base_input"]).toBe("stages.input_rate_number.value");
  });

  it("LCM constant node reverse-projects into chain.lcm", () => {
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const cfg = (out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>);
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    const lcm = chain["lcm"] as Record<string, unknown>;
    expect(lcm["factor_kind"]).toBe("lcm");
    expect(lcm["input_path"]).toBe("form_input.lcm");
  });

  // An authored carrier LCM value reverse-projects onto
  // chain.lcm.value (a constant), NOT as a mappable input_path column.
  it("an authored LCM value reverse-projects into chain.lcm.value", () => {
    const baseNode = makeNode({
      id: "base",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      ref: { kind: "chain-base", baseValue: 1 },
      valueChip: { primary: "1", secondary: "base rate" },
      icon: "DollarSign",
    });
    const lcmNode = makeNode({
      id: "const_lcm",
      category: "math",
      subtype: "constant",
      title: "LCM",
      ref: { kind: "constant", constantId: "LCM", value: 1.4 },
      valueChip: { primary: "× 1.4", secondary: "carrier-set" },
      icon: "Target",
    });
    const output = makeNode({
      id: "out_premium",
      category: "output",
      title: "premium",
      ref: { kind: "output", outputField: "premium" },
      valueChip: { primary: "currency", secondary: "USD" },
      icon: "Circle",
    });
    const plan: TowerPlan = {
      ratingDimension: "coverage",
      ratingDimensionValues: ["Bld"],
      towers: [
        {
          id: "t",
          name: "Building chain",
          outputField: "premium",
          entries: [
            { kind: "node", nodeId: baseNode.id },
            { kind: "node", nodeId: lcmNode.id },
            { kind: "node", nodeId: output.id },
          ],
          entryOps: ["multiply", "multiply"],
        },
      ],
      nodes: new Map([
        [baseNode.id, baseNode],
        [lcmNode.id, lcmNode],
        [output.id, output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
    const out = towerPlanToStages(plan, {});
    const cfg = out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>;
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    const lcm = chain["lcm"] as Record<string, unknown>;
    expect(lcm["value"]).toBe(1.4);
    expect(lcm["input_path"]).toBeUndefined();
  });

  // A factor-table node's gate reverse-projects onto
  // factor_lookups[].predicate.
  it("a factor predicate reverse-projects onto the factor lookup", () => {
    const baseNode = makeNode({
      id: "base",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      ref: { kind: "chain-base", baseValue: 1 },
      valueChip: { primary: "1" },
      icon: "DollarSign",
    });
    const sprinkler = makeNode({
      id: "fac_sprinkler",
      category: "lookup",
      subtype: "table",
      title: "Sprinkler credit",
      ref: {
        kind: "factor-table",
        tableId: "sprinkler_rel",
        predicate: { path: "form_input.sprinklered", equals: true },
      },
      valueChip: { primary: "sprinkler_rel", secondary: "direct" },
      icon: "Tag",
    });
    const output = makeNode({
      id: "out_premium",
      category: "output",
      title: "premium",
      ref: { kind: "output", outputField: "premium" },
      valueChip: { primary: "currency" },
      icon: "Circle",
    });
    const plan: TowerPlan = {
      ratingDimension: "coverage",
      ratingDimensionValues: ["Bld"],
      towers: [
        {
          id: "t",
          name: "Building chain",
          outputField: "premium",
          entries: [
            { kind: "node", nodeId: baseNode.id },
            { kind: "node", nodeId: sprinkler.id },
            { kind: "node", nodeId: output.id },
          ],
          entryOps: ["multiply", "multiply"],
        },
      ],
      nodes: new Map([
        [baseNode.id, baseNode],
        [sprinkler.id, sprinkler],
        [output.id, output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
    const out = towerPlanToStages(plan, {
      factorTablesCatalog: [
        { id: "sprinkler_rel", key_dimension: "sprinklered" },
      ],
    });
    const cfg = out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>;
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    const fl = (chain["factor_lookups"] as readonly Record<string, unknown>[])[0]!;
    expect(fl["predicate"]).toEqual({
      path: "form_input.sprinklered",
      equals: true,
    });
  });

  // A 2-D table's per-axis sources reverse-project onto
  // factor_lookups[].dimensions[axis] (literal here; primary stays default).
  it("axis sources reverse-project onto the factor-lookup dimensions", () => {
    const baseNode = makeNode({
      id: "base",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      ref: { kind: "chain-base", baseValue: 1 },
      valueChip: { primary: "1" },
      icon: "DollarSign",
    });
    const table = makeNode({
      id: "fac_blr",
      category: "lookup",
      subtype: "table",
      title: "Building limit relativity",
      ref: {
        kind: "factor-table",
        tableId: "building_limit_rel",
        axisSources: {
          building_limit_group: { source: "literal", value: "group_c" },
        },
      },
      valueChip: { primary: "building_limit_rel", secondary: "2-D" },
      icon: "Tag",
    });
    const output = makeNode({
      id: "out_premium",
      category: "output",
      title: "premium",
      ref: { kind: "output", outputField: "premium" },
      valueChip: { primary: "currency" },
      icon: "Circle",
    });
    const plan: TowerPlan = {
      ratingDimension: "coverage",
      ratingDimensionValues: ["Bld"],
      towers: [
        {
          id: "t",
          name: "Building chain",
          outputField: "premium",
          entries: [
            { kind: "node", nodeId: baseNode.id },
            { kind: "node", nodeId: table.id },
            { kind: "node", nodeId: output.id },
          ],
          entryOps: ["multiply", "multiply"],
        },
      ],
      nodes: new Map([
        [baseNode.id, baseNode],
        [table.id, table],
        [output.id, output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
    const out = towerPlanToStages(plan, {
      factorTablesCatalog: [
        {
          id: "building_limit_rel",
          key_dimensions: ["building_limit", "building_limit_group"],
        },
      ],
    });
    const cfg = out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>;
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    const fl = (chain["factor_lookups"] as readonly Record<string, unknown>[])[0]!;
    const dims = fl["dimensions"] as Record<string, unknown>;
    expect(dims["building_limit_group"]).toEqual({
      source: "literal",
      value: "group_c",
    });
    expect(dims["building_limit"]).toEqual({
      source: "form_input",
      path: "building_limit",
    });
  });

  // An authored axis source persists even with no catalog entry
  // (buildDimensionsForTable unions axisSources keys, so it isn't dropped
  // when the factor-table catalog is absent or lags the table's keys).
  it("persists an axis source with no catalog entry", () => {
    const baseNode = makeNode({
      id: "base",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      ref: { kind: "chain-base", baseValue: 1 },
      valueChip: { primary: "1" },
      icon: "DollarSign",
    });
    const table = makeNode({
      id: "fac_blr",
      category: "lookup",
      subtype: "table",
      title: "Building limit relativity",
      ref: {
        kind: "factor-table",
        tableId: "building_limit_rel",
        axisSources: {
          building_limit_group: { source: "literal", value: "group_c" },
        },
      },
      valueChip: { primary: "building_limit_rel" },
      icon: "Tag",
    });
    const output = makeNode({
      id: "out_premium",
      category: "output",
      title: "premium",
      ref: { kind: "output", outputField: "premium" },
      valueChip: { primary: "currency" },
      icon: "Circle",
    });
    const plan: TowerPlan = {
      ratingDimension: "coverage",
      ratingDimensionValues: ["Bld"],
      towers: [
        {
          id: "t",
          name: "Building chain",
          outputField: "premium",
          entries: [
            { kind: "node", nodeId: baseNode.id },
            { kind: "node", nodeId: table.id },
            { kind: "node", nodeId: output.id },
          ],
          entryOps: ["multiply", "multiply"],
        },
      ],
      nodes: new Map([
        [baseNode.id, baseNode],
        [table.id, table],
        [output.id, output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
    // No factorTablesCatalog passed — the axis source must still survive.
    const out = towerPlanToStages(plan, {});
    const cfg = out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>;
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    const fl = (chain["factor_lookups"] as readonly Record<string, unknown>[])[0]!;
    const dims = fl["dimensions"] as Record<string, unknown>;
    expect(dims["building_limit_group"]).toEqual({
      source: "literal",
      value: "group_c",
    });
  });

  it("returns an empty array when the plan has no factor-table nodes", () => {
    // An empty-tower plan (just input + output, no chain factor) — the
    // user is mid-authoring. Save path emits 0 chains.
    const out = towerPlanToStages({
      ratingDimension: "coverage",
      ratingDimensionValues: [],
      towers: [],
      nodes: new Map(),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    });
    expect(out.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. Round-trip
// ─────────────────────────────────────────────────────────────────

describe("towerPlanToStages — round-trip", () => {
  it("preserves the sample-bop building-chain shape", () => {
    const inputStages: StageInput[] = [
      {
        stage_id: "input_rate_number",
        sequence: 0,
        stage_kind: "input_node",
        display_name: "Base rate",
        config_json: {
          name: "rate_number",
          data_type: "number",
          source: "form_input",
          source_path: "rate_number",
          required: true,
          output_field: "value",
        },
      },
      SAMPLE_BOP_BUILDING_CHAIN_STAGE,
    ];

    const towerPlan = stagesToTowerPlan({ stages: inputStages });

    const recovered = towerPlanToStages(towerPlan, {
      preservedStages: inputStages,
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
      inputDtypeHints: { rate_number: "number" },
    });

    const recoveredChain = recovered.find(
      (s) => s.stage_kind === "multiplicative_chain",
    );
    expect(recoveredChain).toBeDefined();
    const cfg = recoveredChain!.config_json as Record<string, unknown>;
    const chains = cfg["chains"] as readonly Record<string, unknown>[];
    expect(chains.length).toBe(1);
    const chain = chains[0]!;

    // Patch-over-original preserves an untouched chain field
    // round-trips VERBATIM (the old converter regenerated base_input
    // to point at the re-minted input stage, silently rewriting bytes
    // the user never edited). The sheet can only author base_value;
    // base_input is identity and stays the original's.
    expect(chain["base_input"]).toBe("stages.rate_number.value");
    expect(chain["output_field"]).toBe("building_premium_usd");
    expect(chain["coverage_value"]).toBe("Bld");

    const lookups = chain["factor_lookups"] as readonly Record<
      string,
      unknown
    >[];
    expect(lookups.length).toBe(1);
    const dims = lookups[0]!["dimensions"] as Record<string, unknown>;
    expect(dims["class_code"]).toEqual({
      source: "form_input",
      path: "class_code",
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// The last coverage must survive every save.
// ─────────────────────────────────────────────────────────────────

describe("towerPlanToStages — E1: no positional Total misclassification", () => {
  /** A minimal chain spec WITHOUT coverage_value — exactly what every
   *  "+ Add coverage" chain looked like pre-2026-07-10. Its tower
   *  projects with `ratingDimensionValue: undefined`, which the old
   *  positional heuristic misread as the Total tower when it happened
   *  to sit last. */
  const chainWithoutCoverageValue = (n: number): Record<string, unknown> => ({
    name: `Coverage ${n}`,
    base_input: "literal.base_value",
    base_value: 1,
    factor_lookups: [
      {
        name: "Class factor",
        factor_kind: "class_factor",
        table: "rate_factors",
        lookup_method: "direct",
        dimensions: {
          class_code: { source: "form_input", path: "class_code" },
        },
      },
    ],
    output_field: `coverage_${n}_premium`,
  });

  const chainStageWith = (count: number): StageInput => ({
    stage_id: "chain_main",
    sequence: 1,
    stage_kind: "multiplicative_chain",
    display_name: "Multiplicative chain",
    config_json: {
      chains: Array.from({ length: count }, (_, i) =>
        chainWithoutCoverageValue(i + 1),
      ),
      output_total_field: "subtotal_after_chain_usd",
      rating_dimension: "coverage",
    },
  });

  it.each([2, 3, 4])(
    "%i chains without coverage_value round-trip to the SAME count",
    (count) => {
      const stages = [chainStageWith(count)];
      const plan = stagesToTowerPlan({ stages });
      expect(plan.towers.length).toBe(count);

      const recovered = towerPlanToStages(plan, { preservedStages: stages });
      const chainStage = recovered.find(
        (s) => s.stage_kind === "multiplicative_chain",
      );
      const chains = (chainStage!.config_json as Record<string, unknown>)[
        "chains"
      ] as readonly Record<string, unknown>[];
      // The old heuristic emitted count − 1 here (the last chain was
      // "the Total tower" by position) — a 3-coverage plan decayed to
      // 1 across routine autosaves.
      expect(chains.map((c) => c["name"])).toEqual(
        Array.from({ length: count }, (_, i) => `Coverage ${i + 1}`),
      );
    },
  );

  it("a REAL Total tower (stable id) is still skipped on save", () => {
    const stages = [chainStageWith(2)];
    const plan = addTotalTower(stagesToTowerPlan({ stages }));
    expect(plan.towers.length).toBe(3);
    expect(plan.towers.some(isTotalTower)).toBe(true);

    const recovered = towerPlanToStages(plan, { preservedStages: stages });
    const chainStage = recovered.find(
      (s) => s.stage_kind === "multiplicative_chain",
    );
    const chains = (chainStage!.config_json as Record<string, unknown>)[
      "chains"
    ] as readonly Record<string, unknown>[];
    expect(chains.length).toBe(2);
    expect(chains.map((c) => c["name"])).toEqual([
      "Coverage 1",
      "Coverage 2",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Operator-representation canary.
// ─────────────────────────────────────────────────────────────────

describe("towerPlanToStages — typed constant roles", () => {
  it("a RENAMED carrier constant with role:'lcm' still persists (the name-regex bug, dead)", () => {
    const baseNode = makeNode({
      id: "base",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      ref: { kind: "chain-base", baseValue: 0.35 },
      valueChip: { primary: "0.35", secondary: "base rate" },
      icon: "DollarSign",
    });
    const renamed = makeNode({
      id: "const_mult",
      category: "math",
      subtype: "constant",
      title: "Carrier multiplier",
      // The display id no longer says "lcm" anywhere — the ROLE carries.
      ref: {
        kind: "constant",
        constantId: "carrier_multiplier",
        role: "lcm",
        value: 1.4,
      },
      valueChip: { primary: "× 1.4", secondary: "carrier-set" },
      icon: "Target",
    });
    const output = makeNode({
      id: "out",
      category: "output",
      title: "premium",
      ref: { kind: "output", outputField: "premium" },
      valueChip: { primary: "currency", secondary: "USD" },
      icon: "Circle",
    });
    const plan: TowerPlan = {
      ratingDimension: "coverage",
      ratingDimensionValues: ["Bld"],
      towers: [
        {
          id: "t",
          name: "Building chain",
          outputField: "premium",
          entries: [
            { kind: "node", nodeId: baseNode.id },
            { kind: "node", nodeId: renamed.id },
            { kind: "node", nodeId: output.id },
          ],
          entryOps: ["multiply", "multiply"],
        },
      ],
      nodes: new Map([
        [baseNode.id, baseNode],
        [renamed.id, renamed],
        [output.id, output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
    const stages = towerPlanToStages(plan, { factorTablesCatalog: [] });
    const chain = stages.find((s) => s.stage_kind === "multiplicative_chain");
    expect(chain).toBeDefined();
    const spec = (chain!.config_json as { chains: Array<Record<string, unknown>> })
      .chains[0]!;
    expect((spec.lcm as { value?: number }).value).toBe(1.4);
  });

  it("the loader stamps role:'lcm' so the round-trip is typed end to end", () => {
    const towerPlan = stagesToTowerPlan({
      stages: [SAMPLE_BOP_BUILDING_CHAIN_STAGE],
    });
    const lcmNode = [...towerPlan.nodes.values()].find(
      (n) => n.ref?.kind === "constant",
    );
    expect(lcmNode).toBeDefined();
    expect(
      (lcmNode!.ref as { role?: string }).role,
    ).toBe("lcm");
  });
});

describe("towerPlanToStages — operator canary", () => {
  // The substrate is multiplicative by contract: the save converter
  // cannot persist a non-× entryOp or a group reduction, which is why
  // the operator picker and Group/Max/Min are intentionally absent from the
  // canvas. This canary pins the constraint: a load-converted tower
  // carries ONLY multiply ops — if ChainSpec ever grows an operator
  // representation, this test must be replaced by
  // a true operations round-trip test when the picker is reintroduced.
  it("every load-converted entryOp is multiply (nothing else can persist)", () => {
    const towerPlan = stagesToTowerPlan({
      stages: [SAMPLE_BOP_BUILDING_CHAIN_STAGE],
    });
    for (const tower of towerPlan.towers) {
      for (const op of tower.entryOps) {
        expect(op).toBe("multiply");
      }
    }
    // …and no group reductions survive a load either (groups are
    // plan-level, keyed by id).
    expect(towerPlan.groups.size).toBe(0);
  });

  it("authored non-multiply ops do NOT survive a save round-trip (the documented gap)", () => {
    const towerPlan = stagesToTowerPlan({
      stages: [SAMPLE_BOP_BUILDING_CHAIN_STAGE],
    });
    const tower = towerPlan.towers[0]!;
    // Simulate what the (removed) picker used to author:
    const authored: TowerPlan = {
      ...towerPlan,
      towers: [
        {
          ...tower,
          entryOps: tower.entryOps.map(() => "max" as const),
        },
        ...towerPlan.towers.slice(1),
      ],
    };
    const stages = towerPlanToStages(authored, {
      preservedStages: [SAMPLE_BOP_BUILDING_CHAIN_STAGE],
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const reloaded = stagesToTowerPlan({ stages });
    for (const t of reloaded.towers) {
      for (const op of t.entryOps) {
        expect(op).toBe("multiply");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. Sidecar passthrough
// ─────────────────────────────────────────────────────────────────

describe("towerPlanToStages — sidecar passthrough", () => {
  it("emits preserved sidecar stages (modifier_schedule, flat_factor) unchanged", () => {
    const modifierStage: StageInput = {
      stage_id: "irpm_schedule",
      sequence: 99,
      stage_kind: "modifier_schedule",
      display_name: "IRPM schedule",
      config_json: { input_field: "subtotal_after_chain_usd", rows: [] },
    };
    const flatFactorStage: StageInput = {
      stage_id: "expense_loading",
      sequence: 98,
      stage_kind: "flat_factor",
      display_name: "Expense loading",
      config_json: {
        input_field: "subtotal_after_chain_usd",
        value: 1.25,
      },
    };
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      preservedStages: [modifierStage, flatFactorStage],
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const modifier = out.find((s) => s.stage_kind === "modifier_schedule");
    const flatFactor = out.find((s) => s.stage_kind === "flat_factor");
    expect(modifier?.stage_id).toBe("irpm_schedule");
    expect(flatFactor?.stage_id).toBe("expense_loading");
    // config_json passes through verbatim.
    expect(modifier?.config_json).toEqual(modifierStage.config_json);
    expect(flatFactor?.config_json).toEqual(flatFactorStage.config_json);
  });

  it("patches over a preserved multiplicative_chain — identity and envelope kept, chains re-emitted", () => {
    const oldChain: StageInput = {
      stage_id: "old_chain",
      sequence: 0,
      stage_kind: "multiplicative_chain",
      display_name: "Stale chain",
      config_json: { chains: [], output_total_field: "x", rating_dimension: "coverage" },
    };
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      preservedStages: [oldChain],
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    // Still exactly one multiplicative_chain in output — but the save
    // path now KEEPS the preserved stage's identity + config envelope
    // (stage_id, output_total_field, …) and re-emits only the chains
    // array (the old converter re-minted the whole stage, churning
    // stage identity on every save).
    const chains = out.filter((s) => s.stage_kind === "multiplicative_chain");
    expect(chains.length).toBe(1);
    expect(chains[0]!.stage_id).toBe("old_chain");
    const cfg = chains[0]!.config_json as Record<string, unknown>;
    expect(cfg["output_total_field"]).toBe("x");
    expect((cfg["chains"] as unknown[]).length).toBe(1);
  });

  // Platform-test finding E10e — "set a value" on the LCM must persist
  // even when the ORIGINAL chain's lcm is COLUMN-shaped (input_path
  // only). The old patch guard required the original to already carry
  // a numeric value, so the sheet's edit saved a NO-OP while the pill
  // said "Saved" (the carrier constant had to ride every book row).
  it("persists a newly-set LCM value onto a COLUMN-shaped original (E10e)", () => {
    const originalChain = (
      (SAMPLE_BOP_BUILDING_CHAIN_STAGE.config_json as Record<string, unknown>)[
        "chains"
      ] as readonly Record<string, unknown>[]
    )[0]!;
    const base = buildSimpleTowerPlan();
    const lcmNode = base.nodes.get("const_lcm")!;
    const nodes = new Map(base.nodes);
    nodes.set("const_lcm", {
      ...lcmNode,
      ref: { kind: "constant", constantId: "LCM", value: 1.4 },
    });
    // The load path stamps every loaded chain's original bytes onto
    // the tower (Tower.chainVerbatim) — that's the patch target.
    const plan: TowerPlan = {
      ...base,
      nodes,
      towers: [{ ...base.towers[0]!, chainVerbatim: originalChain }],
    };
    const out = towerPlanToStages(plan, {
      preservedStages: [SAMPLE_BOP_BUILDING_CHAIN_STAGE],
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const cfg = out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>;
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    const lcm = chain["lcm"] as Record<string, unknown>;
    // The authored constant lands…
    expect(lcm["value"]).toBe(1.4);
    // …ON the original envelope (input_path + citations preserved; the
    // projector prefers the authored value, so the stale
    // column reference is inert).
    expect(lcm["input_path"]).toBe("form_input.carrier_lcm");
    expect(lcm["citation_rule"]).toBe("(carrier-set)");
  });

  it("leaves a column-shaped original LCM byte-identical when no value is set", () => {
    const originalChain = (
      (SAMPLE_BOP_BUILDING_CHAIN_STAGE.config_json as Record<string, unknown>)[
        "chains"
      ] as readonly Record<string, unknown>[]
    )[0]!;
    const base = buildSimpleTowerPlan();
    const plan: TowerPlan = {
      ...base,
      towers: [{ ...base.towers[0]!, chainVerbatim: originalChain }],
    };
    const out = towerPlanToStages(plan, {
      preservedStages: [SAMPLE_BOP_BUILDING_CHAIN_STAGE],
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const cfg = out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>;
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    // The untouched LCM keeps the ORIGINAL object (same reference —
    // byte fidelity), never the rebuilt default envelope.
    expect(chain["lcm"]).toBe(originalChain["lcm"]);
  });

  it("reuses existing input_node stage_id when one matches source_path", () => {
    // The "preservedStages" includes an input_node with source_path
    // "rate_number" but a non-default stage_id. The converter should
    // emit that stage_id verbatim (not re-mint "input_rate_number").
    const existingInput: StageInput = {
      stage_id: "custom_rate_node_xyz",
      sequence: 0,
      stage_kind: "input_node",
      display_name: "Custom base",
      config_json: {
        name: "rate_number",
        data_type: "number",
        source: "form_input",
        source_path: "rate_number",
        required: true,
        output_field: "value",
      },
    };
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      preservedStages: [existingInput],
      factorTablesCatalog: [
        { id: "class_factor", key_dimension: "class_code" },
      ],
    });
    const input = out.find((s) => s.stage_kind === "input_node");
    expect(input?.stage_id).toBe("custom_rate_node_xyz");
  });
});

// ─────────────────────────────────────────────────────────────────
// The input dictionary must survive every save.
// ─────────────────────────────────────────────────────────────────

describe("towerPlanToStages — input-dictionary preservation", () => {
  function inputNode(field: string, seq: number): StageInput {
    return {
      stage_id: `input_${field}`,
      sequence: seq,
      stage_kind: "input_node",
      display_name: field,
      config_json: {
        name: field,
        data_type: "string",
        source: "form_input",
        source_path: field,
        required: true,
        output_field: "value",
      },
    };
  }

  function emptyTowerPlan(): TowerPlan {
    return {
      ratingDimension: "coverage",
      ratingDimensionValues: [],
      towers: [],
      nodes: new Map(),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
  }

  it("preserves a declared input the chain does not reference as base/exposure", () => {
    // `class_code` is a factor-table DIMENSION key, never a chain
    // base/exposure — so the pre-fix "emit only inputFields" rule
    // dropped it and the caller's diff deleted it on save.
    const dict = [inputNode("rate_number", 0), inputNode("class_code", 1)];
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      preservedStages: dict,
      factorTablesCatalog: [{ id: "class_factor", key_dimension: "class_code" }],
    });
    const inputIds = out
      .filter((s) => s.stage_kind === "input_node")
      .map((s) => s.stage_id);
    expect(inputIds).toContain("input_class_code");
    expect(inputIds).toContain("input_rate_number");
  });

  it("does NOT delete the input dictionary when an empty tower is saved (the 29→1 repro)", () => {
    // Live repro: spawning one tower took a 29-stage plan (28 inputs +
    // a gate) to 1 (only the gate survived). As a unit: an empty
    // TowerPlan + a preserved dictionary must round-trip the dictionary.
    const dict = [
      inputNode("class_code", 0),
      inputNode("territory", 1),
      inputNode("building_limit", 2),
    ];
    const gate: StageInput = {
      stage_id: "g_filter_1",
      sequence: 3,
      stage_kind: "eligibility.gate",
      display_name: "Eligibility gate",
      config_json: { rules: [] },
    };
    const out = towerPlanToStages(emptyTowerPlan(), {
      preservedStages: [...dict, gate],
    });
    expect(out.filter((s) => s.stage_kind === "input_node")).toHaveLength(3);
    expect(out.find((s) => s.stage_kind === "eligibility.gate")).toBeDefined();
    // An empty tower emits no chain — but it must not be destructive.
    expect(
      out.filter((s) => s.stage_kind === "multiplicative_chain"),
    ).toHaveLength(0);
  });

  it("preserves each input's config_json verbatim (dtype / source_path intact)", () => {
    const declared: StageInput = {
      stage_id: "input_annual_gross_sales",
      sequence: 0,
      stage_kind: "input_node",
      display_name: "annual_gross_sales",
      config_json: {
        name: "annual_gross_sales",
        data_type: "number",
        source: "form_input",
        source_path: "annual_gross_sales",
        required: true,
        output_field: "value",
      },
    };
    const out = towerPlanToStages(emptyTowerPlan(), {
      preservedStages: [declared],
    });
    const recovered = out.find((s) => s.stage_id === "input_annual_gross_sales");
    expect(recovered?.config_json).toEqual(declared.config_json);
  });

  it("round-trips a plan with unreferenced inputs without losing any", () => {
    const stages: StageInput[] = [
      inputNode("rate_number", 0),
      inputNode("class_code", 1),
      inputNode("territory", 2),
      inputNode("sprinklered", 3),
      SAMPLE_BOP_BUILDING_CHAIN_STAGE,
    ];
    const plan = stagesToTowerPlan({ stages });
    const recovered = towerPlanToStages(plan, {
      preservedStages: stages,
      factorTablesCatalog: [{ id: "class_factor", key_dimension: "class_code" }],
    });
    const recoveredInputIds = recovered
      .filter((s) => s.stage_kind === "input_node")
      .map((s) => s.stage_id)
      .sort();
    expect(recoveredInputIds).toEqual([
      "input_class_code",
      "input_rate_number",
      "input_sprinklered",
      "input_territory",
    ]);
  });

  it("survives a build-tower → navigate-away → return cycle (tower AND inputs persist)", () => {
    // The data-layer mirror of the acceptance walkthrough. "Navigate
    // away" = the autosave (towerPlanToStages → server stages); "return"
    // = the reload (stagesToTowerPlan). Both the tower's chain AND the
    // full declared dictionary must come back — and a SECOND cycle must
    // be idempotent (no input bleed across navigations). Uses the
    // realistic literal base the actuary authors via the BaseRateEditor.
    const dict = [
      inputNode("rate_number", 0),
      inputNode("class_code", 1),
      inputNode("territory", 2),
    ];
    const catalog = [{ id: "class_factor", key_dimension: "class_code" }];

    // Build a tower: literal base 600 · class_factor · output.
    const baseNode = makeNode({
      id: "base_premium",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      ref: { kind: "chain-base", baseValue: 600 },
      valueChip: { primary: "$600", secondary: "base rate" },
      icon: "DollarSign",
    });
    const classFactor = makeNode({
      id: "fac_class",
      category: "lookup",
      title: "Class factor",
      ref: { kind: "factor-table", tableId: "class_factor" },
      valueChip: { primary: "× factor" },
      icon: "Tag",
    });
    const output = makeNode({
      id: "out_premium",
      category: "output",
      title: "premium",
      ref: { kind: "output", outputField: "premium" },
      valueChip: { primary: "currency", secondary: "USD" },
      icon: "Circle",
    });
    const tower: Tower = {
      id: "tower_premium",
      name: "Premium",
      outputField: "premium",
      entries: [
        { kind: "node", nodeId: baseNode.id },
        { kind: "node", nodeId: classFactor.id },
        { kind: "node", nodeId: output.id },
      ],
      entryOps: ["multiply", "multiply"],
    };
    const plan: TowerPlan = {
      ratingDimension: "coverage",
      ratingDimensionValues: [],
      towers: [tower],
      nodes: new Map([
        [baseNode.id, baseNode],
        [classFactor.id, classFactor],
        [output.id, output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };

    // Navigate away (autosave).
    const saved = towerPlanToStages(plan, {
      preservedStages: dict,
      factorTablesCatalog: catalog,
    });
    // The tower persisted as a chain…
    expect(saved.filter((s) => s.stage_kind === "multiplicative_chain")).toHaveLength(1);
    // …and not one declared input was deleted.
    expect(
      saved.filter((s) => s.stage_kind === "input_node").map((s) => s.stage_id).sort(),
    ).toEqual(["input_class_code", "input_rate_number", "input_territory"]);

    // Return (reload), then navigate away again — idempotent, no bleed.
    const reloaded = stagesToTowerPlan({ stages: saved });
    expect(reloaded.towers).toHaveLength(1);
    const resaved = towerPlanToStages(reloaded, {
      preservedStages: saved,
      factorTablesCatalog: catalog,
    });
    expect(resaved.filter((s) => s.stage_kind === "input_node")).toHaveLength(3);
    expect(resaved.filter((s) => s.stage_kind === "multiplicative_chain")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// Cold-test L30 — editable literal base rate
// ─────────────────────────────────────────────────────────────────

describe("towerPlanToStages — base_value (cold-test L30)", () => {
  /** A tower whose base is an editable chain-base node + one factor. */
  function buildLiteralBasePlan(baseValue: number | null): TowerPlan {
    const baseNode = makeNode({
      id: "base_do",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      ref: { kind: "chain-base", baseValue },
      valueChip: { primary: "$600", secondary: "base rate" },
      icon: "DollarSign",
    });
    const classFactor = makeNode({
      id: "fac_class",
      category: "transform",
      subtype: "key",
      title: "Class factor",
      ref: { kind: "factor-table", tableId: "class_factor" },
      valueChip: { primary: "class_factor", secondary: "direct" },
      icon: "Tag",
    });
    const output = makeNode({
      id: "out_do_premium",
      category: "output",
      title: "do_premium",
      ref: { kind: "output", outputField: "do_premium" },
      valueChip: { primary: "currency", secondary: "USD" },
      icon: "Circle",
    });
    const tower: Tower = {
      id: "tower_do",
      name: "D&O",
      outputField: "do_premium",
      entries: [
        { kind: "node", nodeId: baseNode.id },
        { kind: "node", nodeId: classFactor.id },
        { kind: "node", nodeId: output.id },
      ],
      entryOps: ["multiply", "multiply"],
    };
    return {
      ratingDimension: "coverage",
      ratingDimensionValues: [],
      towers: [tower],
      nodes: new Map([
        [baseNode.id, baseNode],
        [classFactor.id, classFactor],
        [output.id, output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
  }

  it("reverse-projects a chain-base node onto ChainSpec.base_value", () => {
    const out = towerPlanToStages(buildLiteralBasePlan(600), {
      factorTablesCatalog: [{ id: "class_factor", key_dimension: "class_code" }],
    });
    const chainStage = out.find(
      (s) => s.stage_kind === "multiplicative_chain",
    )!;
    const chains = (chainStage.config_json as { chains: Array<Record<string, unknown>> })
      .chains;
    expect(chains[0]!["base_value"]).toBe(600);
  });

  it("round-trips a literal base through stagesToTowerPlan → towerPlanToStages", () => {
    const stages = towerPlanToStages(buildLiteralBasePlan(600), {
      factorTablesCatalog: [{ id: "class_factor", key_dimension: "class_code" }],
    });
    // Re-load + re-save; base_value must survive untouched.
    const reloaded = stagesToTowerPlan({ stages });
    const reExported = towerPlanToStages(reloaded, {
      factorTablesCatalog: [{ id: "class_factor", key_dimension: "class_code" }],
    });
    const chains = (
      reExported.find((s) => s.stage_kind === "multiplicative_chain")!
        .config_json as { chains: Array<Record<string, unknown>> }
    ).chains;
    expect(chains[0]!["base_value"]).toBe(600);
  });

  it("emits a chain with ONLY a literal base + LCM (no factor tables)", () => {
    // Cold-test happy path: base × LCM with zero factor lookups must
    // still produce a savable chain (pre-L30 this returned null).
    const baseNode = makeNode({
      id: "base_gl",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      ref: { kind: "chain-base", baseValue: 300 },
      valueChip: { primary: "$300" },
      icon: "DollarSign",
    });
    const output = makeNode({
      id: "out_gl_premium",
      category: "output",
      title: "gl_premium",
      ref: { kind: "output", outputField: "gl_premium" },
      valueChip: { primary: "currency" },
      icon: "Circle",
    });
    const tower: Tower = {
      id: "tower_gl",
      name: "GL",
      outputField: "gl_premium",
      entries: [
        { kind: "node", nodeId: baseNode.id },
        { kind: "node", nodeId: output.id },
      ],
      entryOps: ["multiply"],
    };
    const plan: TowerPlan = {
      ratingDimension: "coverage",
      ratingDimensionValues: [],
      towers: [tower],
      nodes: new Map([
        [baseNode.id, baseNode],
        [output.id, output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
    const out = towerPlanToStages(plan, {});
    const chainStage = out.find((s) => s.stage_kind === "multiplicative_chain");
    expect(chainStage).toBeDefined();
    const chains = (chainStage!.config_json as { chains: Array<Record<string, unknown>> })
      .chains;
    expect(chains).toHaveLength(1);
    expect(chains[0]!["base_value"]).toBe(300);
  });

  it("does NOT emit base_value when the base node is a legacy submission-field", () => {
    const out = towerPlanToStages(buildSimpleTowerPlan(), {
      factorTablesCatalog: [{ id: "class_factor", key_dimension: "class_code" }],
    });
    const chains = (
      out.find((s) => s.stage_kind === "multiplicative_chain")!
        .config_json as { chains: Array<Record<string, unknown>> }
    ).chains;
    expect(chains[0]!["base_value"]).toBeUndefined();
  });
});

describe("tower exposure to chain", () => {
  it("reverse-projects exposure input / divisor / apply_exposure", () => {
    const baseNode = makeNode({
      id: "base",
      category: "math",
      subtype: "constant",
      title: "Base rate",
      ref: { kind: "chain-base", baseValue: 1 },
      valueChip: { primary: "1" },
      icon: "DollarSign",
    });
    const output = makeNode({
      id: "out_premium",
      category: "output",
      title: "premium",
      ref: { kind: "output", outputField: "premium" },
      valueChip: { primary: "currency" },
      icon: "Circle",
    });
    const plan: TowerPlan = {
      ratingDimension: "coverage",
      ratingDimensionValues: ["acct"],
      towers: [
        {
          id: "t",
          name: "Account",
          outputField: "premium",
          entries: [
            { kind: "node", nodeId: baseNode.id },
            { kind: "node", nodeId: output.id },
          ],
          entryOps: ["multiply"],
          exposureInput: "annual_revenue",
          exposureUnitDivisor: 1000,
          applyExposure: true,
        },
      ],
      nodes: new Map([
        [baseNode.id, baseNode],
        [output.id, output],
      ]),
      groups: new Map(),
      constants: new Map(),
      models: new Map(),
    };
    const out = towerPlanToStages(plan, {});
    const cfg = out.find((s) => s.stage_kind === "multiplicative_chain")!
      .config_json as Record<string, unknown>;
    const chain = (cfg["chains"] as readonly Record<string, unknown>[])[0]!;
    expect(chain["exposure_input"]).toBe("form_input.annual_revenue");
    expect(chain["exposure_unit_divisor"]).toBe(1000);
    expect(chain["apply_exposure"]).toBe(true);
  });
});
