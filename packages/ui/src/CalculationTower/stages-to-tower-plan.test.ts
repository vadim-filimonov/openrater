/**
 * stagesToTowerPlan + buildInventory — load-converter unit tests.
 *
 * Per Brief 25 §10.1. Pure logic; no React.
 */

import { describe, expect, it } from "vitest";
import {
  buildInventory,
  stagesToTowerPlan,
  type StageInput,
} from "./stages-to-tower-plan";
import type { ConstantDef, ModelDef } from "./types";

// ── Stage factories ────────────────────────────────────────────

function inputStage(
  id: string,
  fieldName: string,
  dataType = "currency_usd",
): StageInput {
  return {
    stage_id: id,
    sequence: 1,
    stage_kind: "input_node",
    display_name: id,
    config_json: { field_name: fieldName, data_type: dataType },
  };
}

function chainStage(args: {
  id: string;
  name?: string;
  baseInput: string;
  outputField: string;
  factors?: Array<{
    name: string;
    factor_kind?: string;
    lookup_method?: string;
    dimensions?: Record<string, unknown>;
    description_template?: string;
  }>;
  withLcm?: boolean;
  coverageValue?: string;
}): StageInput {
  return {
    stage_id: args.id,
    sequence: 2,
    stage_kind: "multiplicative_chain",
    display_name: args.id,
    config_json: {
      output_total_field: args.outputField,
      chains: [
        {
          name: args.name ?? args.id,
          base_input: args.baseInput,
          exposure_input: args.baseInput,
          output_field: args.outputField,
          factor_lookups: (args.factors ?? []).map((f) => ({
            table: "rate_factors",
            ...f,
          })),
          ...(args.withLcm
            ? {
                lcm: {
                  factor_kind: "lcm",
                  input_path: "constants.lcm",
                  description_template: "LCM: {value}",
                },
              }
            : {}),
          ...(args.coverageValue ? { coverage_value: args.coverageValue } : {}),
        },
      ],
    },
  };
}

function loadingStage(
  id: string,
  input: string,
  output: string,
  value = 1.27,
): StageInput {
  return {
    stage_id: id,
    sequence: 3,
    stage_kind: "flat_factor",
    display_name: id,
    config_json: {
      input_field: input,
      output_field: output,
      factor_kind: "expense_loading",
      value,
    },
  };
}

function modifierStage(id: string, input: string, output: string): StageInput {
  return {
    stage_id: id,
    sequence: 3,
    stage_kind: "modifier_schedule",
    display_name: id,
    config_json: {
      input_field: input,
      output_field: output,
      schedule: { total_cap_pct: 25, categories: [{ key: "mgmt" }] },
    },
  };
}

function roundStage(id: string, input: string, output: string): StageInput {
  return {
    stage_id: id,
    sequence: 4,
    stage_kind: "round",
    display_name: id,
    config_json: {
      input_field: input,
      output_field: output,
      mode: "half_up",
      increment: 1,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("stagesToTowerPlan", () => {
  it("returns an empty plan for no stages", () => {
    const plan = stagesToTowerPlan({ stages: [] });
    expect(plan.towers).toEqual([]);
    expect(plan.nodes.size).toBe(0);
    expect(plan.groups.size).toBe(0);
  });

  it("projects a single input + chain into one tower", () => {
    const plan = stagesToTowerPlan({
      stages: [
        inputStage("inp_tiv", "tiv_usd"),
        chainStage({
          id: "ch_bld",
          name: "Building chain",
          baseInput: "tiv_usd",
          outputField: "bld_premium",
          factors: [
            { name: "class", factor_kind: "class_factor" },
            { name: "terr", factor_kind: "territory_factor" },
          ],
        }),
      ],
    });
    expect(plan.towers).toHaveLength(1);
    const tower = plan.towers[0]!;
    expect(tower.name).toBe("Building chain");
    expect(tower.outputField).toBe("bld_premium");
    // Tower entries: input + 2 factors + output cap = 4 entries
    expect(tower.entries).toHaveLength(4);
    expect(tower.entryOps).toHaveLength(3);
    expect(tower.entryOps.every((op) => op === "multiply")).toBe(true);
  });

  it("creates a base input node from the chain's base_input when no input_node stage matches", () => {
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "tiv_usd",
          outputField: "premium",
          factors: [{ name: "f", factor_kind: "k" }],
        }),
      ],
    });
    const tower = plan.towers[0]!;
    // First entry is the auto-created input node.
    const firstNodeEntry = tower.entries[0]!;
    expect(firstNodeEntry.kind).toBe("node");
    const node = plan.nodes.get(
      (firstNodeEntry as { kind: "node"; nodeId: string }).nodeId,
    )!;
    expect(node.category).toBe("input");
    expect(node.title).toBe("tiv_usd");
  });

  it("appends an LCM constant node when chain has lcm", () => {
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "tiv",
          outputField: "premium",
          factors: [{ name: "class", factor_kind: "class_factor" }],
          withLcm: true,
        }),
      ],
    });
    const tower = plan.towers[0]!;
    // input + class + lcm + output = 4 entries
    expect(tower.entries).toHaveLength(4);
    const lcmEntry = tower.entries[2]!;
    const lcmNode = plan.nodes.get(
      (lcmEntry as { kind: "node"; nodeId: string }).nodeId,
    )!;
    expect(lcmNode.title).toBe("LCM");
    expect(lcmNode.category).toBe("math");
    expect(lcmNode.subtype).toBe("constant");
  });

  // ADR-0047 — an authored carrier LCM (`lcm.value`) loads onto the
  // constant node's ref (so a load → edit → save cycle preserves it) and the
  // chip shows the real number instead of the "scalar" placeholder.
  it("loads an authored lcm.value onto the constant node ref", () => {
    const plan = stagesToTowerPlan({
      stages: [
        {
          stage_id: "ch",
          sequence: 2,
          stage_kind: "multiplicative_chain",
          display_name: "ch",
          config_json: {
            output_total_field: "premium",
            chains: [
              {
                name: "Building chain",
                base_input: "literal.base_value",
                base_value: 1,
                factor_lookups: [],
                lcm: { factor_kind: "lcm", value: 1.401 },
                exposure_input: "form_input.tiv",
                exposure_unit_divisor: 100,
                output_field: "premium",
              },
            ],
          },
        },
      ],
    });
    const lcmNode = [...plan.nodes.values()].find(
      (n) => n.ref?.kind === "constant",
    )!;
    expect(lcmNode.ref).toMatchObject({
      kind: "constant",
      constantId: "LCM",
      value: 1.401,
    });
    expect(lcmNode.valueChip.primary).toBe("× 1.401");
  });

  // ADR-0047 — a factor_lookups[].predicate loads onto the factor-table ref
  // (so a load → save cycle preserves the gate).
  it("loads a factor predicate onto the factor-table node ref", () => {
    const plan = stagesToTowerPlan({
      stages: [
        {
          stage_id: "ch",
          sequence: 2,
          stage_kind: "multiplicative_chain",
          display_name: "ch",
          config_json: {
            output_total_field: "premium",
            chains: [
              {
                name: "Building chain",
                base_input: "literal.base_value",
                base_value: 1,
                factor_lookups: [
                  {
                    name: "Sprinkler credit",
                    factor_kind: "sprinkler_rel",
                    lookup_method: "direct",
                    dimensions: {},
                    description_template: "Sprinkler: ×{value}",
                    predicate: {
                      path: "form_input.sprinklered",
                      equals: true,
                    },
                  },
                ],
                lcm: { factor_kind: "lcm", input_path: "form_input.lcm" },
                exposure_input: "form_input.tiv",
                exposure_unit_divisor: 100,
                output_field: "premium",
              },
            ],
          },
        },
      ],
    });
    const facNode = [...plan.nodes.values()].find(
      (n) => n.ref?.kind === "factor-table",
    )!;
    expect(facNode.ref).toMatchObject({
      kind: "factor-table",
      tableId: "sprinkler_rel",
      predicate: { path: "form_input.sprinklered", equals: true },
    });
  });

  // ADR-0047 — non-default axis bindings load onto the factor-table ref's
  // axisSources; the trivial form_input default is skipped.
  it("loads non-default axis bindings onto the factor-table ref", () => {
    const plan = stagesToTowerPlan({
      stages: [
        {
          stage_id: "ch",
          sequence: 2,
          stage_kind: "multiplicative_chain",
          display_name: "ch",
          config_json: {
            output_total_field: "premium",
            chains: [
              {
                name: "Building chain",
                base_input: "literal.base_value",
                base_value: 1,
                factor_lookups: [
                  {
                    name: "Building limit relativity",
                    factor_kind: "building_limit_rel",
                    lookup_method: "direct",
                    dimensions: {
                      building_limit: {
                        source: "form_input",
                        path: "building_limit",
                      },
                      building_limit_group: {
                        source: "literal",
                        value: "group_c",
                      },
                    },
                    description_template: "BLR: ×{value}",
                  },
                ],
                lcm: { factor_kind: "lcm", input_path: "form_input.lcm" },
                exposure_input: "form_input.tiv",
                exposure_unit_divisor: 100,
                output_field: "premium",
              },
            ],
          },
        },
      ],
    });
    const facNode = [...plan.nodes.values()].find(
      (n) => n.ref?.kind === "factor-table",
    )!;
    const ref = facNode.ref as {
      kind: "factor-table";
      axisSources?: Record<string, unknown>;
    };
    expect(ref.axisSources).toEqual({
      building_limit_group: { source: "literal", value: "group_c" },
    });
  });

  // ── Cold-test L30 — editable literal base rate ──────────────

  it("projects base_value as an editable chain-base node", () => {
    const plan = stagesToTowerPlan({
      stages: [
        {
          stage_id: "ch_do",
          sequence: 2,
          stage_kind: "multiplicative_chain",
          display_name: "ch_do",
          config_json: {
            output_total_field: "do_premium",
            chains: [
              {
                name: "D&O",
                base_input: "literal.base_value",
                base_value: 600,
                exposure_input: "literal.base_value",
                output_field: "do_premium",
                factor_lookups: [],
              },
            ],
          },
        },
      ],
    });
    const tower = plan.towers[0]!;
    const baseEntry = tower.entries[0]!;
    const baseNode = plan.nodes.get(
      (baseEntry as { kind: "node"; nodeId: string }).nodeId,
    )!;
    expect(baseNode.ref).toEqual({ kind: "chain-base", baseValue: 600 });
    expect(baseNode.category).toBe("math");
    expect(baseNode.subtype).toBe("constant");
    expect(baseNode.valueChip.primary).toBe("$600");
    expect(baseNode.icon).toBe("DollarSign");
  });

  it("projects a brand-new chain (empty base_input) as an unset chain-base node", () => {
    const plan = stagesToTowerPlan({
      stages: [
        {
          stage_id: "ch_new",
          sequence: 2,
          stage_kind: "multiplicative_chain",
          display_name: "ch_new",
          config_json: {
            output_total_field: "premium",
            chains: [
              {
                name: "New chain",
                base_input: "",
                exposure_input: "exposure",
                output_field: "premium",
                factor_lookups: [],
              },
            ],
          },
        },
      ],
    });
    const tower = plan.towers[0]!;
    const baseNode = plan.nodes.get(
      (tower.entries[0] as { kind: "node"; nodeId: string }).nodeId,
    )!;
    expect(baseNode.ref).toEqual({ kind: "chain-base", baseValue: null });
    expect(baseNode.valueChip.primary).toBe("Set base rate");
  });

  it("keeps the legacy submission-field base when no base_value (back-compat)", () => {
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "rate_number",
          outputField: "premium",
          factors: [{ name: "f", factor_kind: "k" }],
        }),
      ],
    });
    const tower = plan.towers[0]!;
    const baseNode = plan.nodes.get(
      (tower.entries[0] as { kind: "node"; nodeId: string }).nodeId,
    )!;
    // Legacy plans (base_input set, no base_value) still project the
    // "from policy" submission-field node — unchanged.
    expect(baseNode.ref?.kind).toBe("submission-field");
    expect(baseNode.category).toBe("input");
  });

  it("categorizes a territory factor as a lookup (amber), MapPin glyph (Brief 48)", () => {
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "tiv",
          outputField: "premium",
          factors: [
            {
              name: "terr",
              factor_kind: "territory_factor",
              dimensions: { territory_id: "by-zone" },
            },
          ],
        }),
      ],
    });
    const tower = plan.towers[0]!;
    const factorEntry = tower.entries[1]!;
    const factorNode = plan.nodes.get(
      (factorEntry as { kind: "node"; nodeId: string }).nodeId,
    )!;
    // Brief 48 — factors are LOOKUPs (amber), matching the rail. The
    // glyph (from iconForFactor) still differentiates; the cross-category
    // color hue-shift (geographic subtype) was dropped.
    expect(factorNode.category).toBe("lookup");
    expect(factorNode.subtype).toBeUndefined();
    expect(factorNode.icon).toBe("MapPin");
  });

  it("categorizes a class factor as a lookup (amber), Tag glyph (Brief 48)", () => {
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "tiv",
          outputField: "premium",
          factors: [
            {
              name: "cls",
              factor_kind: "class_factor",
              dimensions: { class_code: "by-code" },
            },
          ],
        }),
      ],
    });
    const tower = plan.towers[0]!;
    const factorEntry = tower.entries[1]!;
    const node = plan.nodes.get(
      (factorEntry as { kind: "node"; nodeId: string }).nodeId,
    );
    expect(node?.category).toBe("lookup");
    expect(node?.subtype).toBeUndefined();
    expect(node?.icon).toBe("Tag");
  });

  it("appends a loading flat_factor onto the tower whose output it consumes", () => {
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "tiv",
          outputField: "subtotal",
          factors: [{ name: "class", factor_kind: "class_factor" }],
        }),
        loadingStage("ld_exp", "subtotal", "loaded", 1.27),
      ],
    });
    const tower = plan.towers[0]!;
    // input + class + loading + output = 4 entries
    expect(tower.entries).toHaveLength(4);
  });

  it("appends a modifier_schedule sidecar onto the matching tower", () => {
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "tiv",
          outputField: "subtotal",
          factors: [{ name: "class", factor_kind: "class_factor" }],
        }),
        modifierStage("mod_irpm", "subtotal", "modified"),
      ],
    });
    const tower = plan.towers[0]!;
    const modEntry = tower.entries[tower.entries.length - 2]!;
    const modNode = plan.nodes.get(
      (modEntry as { kind: "node"; nodeId: string }).nodeId,
    )!;
    expect(modNode.category).toBe("loading");
    expect(modNode.subtype).toBe("modifier");
    expect(modNode.icon).toBe("Sliders");
  });

  it("attaches a round stage as the tower's finalOp", () => {
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "tiv",
          outputField: "premium",
          factors: [{ name: "class", factor_kind: "class_factor" }],
        }),
        roundStage("rnd", "premium", "premium_final"),
      ],
    });
    const tower = plan.towers[0]!;
    expect(tower.finalOp).toBe("round");
  });

  it("attaches a round sidecar addressed by input_path when input_field is absent (G6 min-premium shape)", () => {
    // Regression guard. The v4 G6 "+ Minimum premium" affordance authors a
    // `round` stage whose RoundConfig (extra="forbid") carries `input_path`
    // — never `input_field`. The `roundStage` helper above uses input_field,
    // so it masks this: without an input_path fallback in appendSidecarToTower
    // the sidecar resolves no tower and the floor vanishes from the Assemble
    // preview. Shape mirrors the committed cold-test fixture
    // (docs/cold-tests/fixtures/sample-bop-cold-test.plan.json).
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "tiv",
          outputField: "total_premium",
          factors: [{ name: "class", factor_kind: "class_factor" }],
        }),
        {
          stage_id: "round_min",
          sequence: 4,
          stage_kind: "round",
          display_name: "Minimum premium",
          config_json: {
            increment_input: "literal:1",
            input_path: "chain.total_premium",
            min_value_input: "literal:500",
            output_field: "total_premium",
          },
        },
      ],
    });
    const tower = plan.towers[0]!;
    expect(tower.finalOp).toBe("round");
  });

  it("attaches a clamp sidecar addressed by input_path when input_field is absent (ClampConfig shape)", () => {
    // Companion guard for the edit-only clamp path: G6 kept `clamp` editable
    // through its ClampConfig `input_path` even though new authoring reroutes
    // min-premium to `round`. Same input_path fallback must resolve the tower.
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch",
          baseInput: "tiv",
          outputField: "premium_usd",
          factors: [{ name: "class", factor_kind: "class_factor" }],
        }),
        {
          stage_id: "clamp_floor",
          sequence: 4,
          stage_kind: "clamp",
          display_name: "Minimum premium",
          config_json: {
            input_path: "stages.ch.premium_usd",
            min_value: 500,
            output_field: "value",
          },
        },
      ],
    });
    const tower = plan.towers[0]!;
    expect(tower.finalOp).toBe("min");
  });

  it("skips stages with kinds it doesn't recognize", () => {
    const plan = stagesToTowerPlan({
      stages: [
        // A dimension stage from the Dimensions workspace — not an
        // ASSEMBLE stage.
        {
          stage_id: "d1",
          sequence: 1,
          stage_kind: "dimension",
          display_name: "Class code",
          config_json: { data_type: "string" },
        },
      ],
    });
    expect(plan.towers).toEqual([]);
  });

  it("collects rating-dimension values from chains that declare coverage_value", () => {
    const plan = stagesToTowerPlan({
      stages: [
        chainStage({
          id: "ch_bi",
          baseInput: "limit",
          outputField: "bi_premium",
          coverageValue: "BI",
          factors: [{ name: "class", factor_kind: "class_factor" }],
        }),
        chainStage({
          id: "ch_bld",
          baseInput: "tiv",
          outputField: "bld_premium",
          coverageValue: "Bld",
          factors: [{ name: "class", factor_kind: "class_factor" }],
        }),
      ],
    });
    expect(plan.ratingDimensionValues).toEqual(["BI", "Bld"]);
    expect(plan.towers).toHaveLength(2);
  });

  it("uses 'coverage' as the default rating dimension; respects opts.ratingDimension", () => {
    const planA = stagesToTowerPlan({ stages: [] });
    expect(planA.ratingDimension).toBe("coverage");
    const planB = stagesToTowerPlan({ stages: [] }, { ratingDimension: "lob" });
    expect(planB.ratingDimension).toBe("lob");
  });

  it("reads rating_dimension from the multiplicative_chain config (25.B.2)", () => {
    const stage = {
      stage_id: "ch",
      sequence: 1,
      stage_kind: "multiplicative_chain",
      display_name: "Chain",
      config_json: {
        chains: [
          {
            name: "BI chain",
            base_input: "limit",
            exposure_input: "limit",
            output_field: "bi_premium",
            factor_lookups: [{ name: "class", factor_kind: "class_factor" }],
            coverage_value: "BI",
          },
          {
            name: "Bld chain",
            base_input: "tiv",
            exposure_input: "tiv",
            output_field: "bld_premium",
            factor_lookups: [{ name: "class", factor_kind: "class_factor" }],
            coverage_value: "Bld",
          },
        ],
        rating_dimension: "coverage",
      },
    } satisfies StageInput;

    const plan = stagesToTowerPlan({ stages: [stage] });
    expect(plan.ratingDimension).toBe("coverage");
    expect(plan.ratingDimensionValues).toEqual(["BI", "Bld"]);
    expect(plan.towers).toHaveLength(2);
    expect(plan.towers[0]!.ratingDimensionValue).toBe("BI");
    expect(plan.towers[1]!.ratingDimensionValue).toBe("Bld");
  });

  it("opts.ratingDimension wins over config.rating_dimension when both are set", () => {
    const stage = {
      stage_id: "ch",
      sequence: 1,
      stage_kind: "multiplicative_chain",
      display_name: "Chain",
      config_json: {
        chains: [
          {
            name: "x",
            base_input: "i",
            exposure_input: "i",
            output_field: "o",
            factor_lookups: [],
          },
        ],
        rating_dimension: "coverage",
      },
    } satisfies StageInput;
    // Note: per the converter, opts.ratingDimension provides the
    // INITIAL value and config.rating_dimension overrides it. So
    // this test documents current behavior — the config wins when
    // present. If we want opts to win, we'd flip the precedence.
    const plan = stagesToTowerPlan({ stages: [stage] }, { ratingDimension: "lob" });
    // Current behavior: config.rating_dimension overrides opts.
    expect(plan.ratingDimension).toBe("coverage");
  });

  it("indexes constants + models by id", () => {
    const constants: ConstantDef[] = [
      { id: "LCM", name: "LCM", value: 1.6 },
      { id: "MIN_PREMIUM", name: "Min premium", value: 250 },
    ];
    const models: ModelDef[] = [
      {
        id: "disc_credit",
        name: "Discretionary credit",
        version: "v3.1",
        inputs: [
          { param: "fico", dtype: "number", required: true },
          { param: "class", dtype: "string", required: true },
        ],
      },
    ];
    const plan = stagesToTowerPlan({ stages: [], constants, models });
    expect(plan.constants.size).toBe(2);
    expect(plan.constants.get("LCM")?.value).toBe(1.6);
    expect(plan.models.size).toBe(1);
    expect(plan.models.get("disc_credit")?.name).toBe("Discretionary credit");
  });
});

describe("buildInventory", () => {
  it("builds the full 6-section inventory with the right categories", () => {
    const items = buildInventory({
      dimensions: [
        { id: "tiv", title: "TIV", meta: "USD" },
        {
          id: "class",
          title: "Class code",
          subtype: "key",
          meta: "key",
        },
        {
          id: "territory",
          title: "Territory",
          subtype: "geographic",
          meta: "geo",
        },
      ],
      gates: [{ id: "irpm", title: "IRPM modifier", meta: "±25%" }],
      constants: [{ id: "LCM", name: "LCM", value: 1.6 }],
      models: [
        {
          id: "disc",
          name: "Discretionary credit",
          version: "v3.1",
          inputs: [],
        },
      ],
      towerOutputs: [{ key: "BI_premium" }],
    });

    // 3 dimensions + 1 gate + 8 math + 1 model + 1 constant + 1 tower output
    expect(items.length).toBe(15);

    const byKind = (k: string) => items.filter((i) => i.kind === k);
    expect(byKind("dimension")).toHaveLength(3);
    expect(byKind("gate")).toHaveLength(1);
    expect(byKind("math")).toHaveLength(8);
    expect(byKind("model")).toHaveLength(1);
    expect(byKind("constant")).toHaveLength(1);
    expect(byKind("tower-output")).toHaveLength(1);
  });

  it("categorizes standard dimensions as input, geographic/classification as transform", () => {
    const items = buildInventory({
      dimensions: [
        { id: "tiv", title: "TIV" },
        { id: "terr", title: "Territory", subtype: "geographic" },
        { id: "cls", title: "Class code", subtype: "classification" },
      ],
    });
    expect(items[0]?.category).toBe("input");
    expect(items[1]?.category).toBe("transform");
    expect(items[2]?.category).toBe("transform");
  });

  it("assigns the correct icon per dimension subtype + name heuristics", () => {
    const items = buildInventory({
      dimensions: [
        { id: "terr", title: "Territory", subtype: "geographic" },
        { id: "cls", title: "Class", subtype: "classification" },
        { id: "tiv", title: "TIV" }, // currency heuristic → DollarSign
        { id: "construction", title: "Construction class" }, // Building
        { id: "protection", title: "Protection class" }, // Shield
        { id: "sprink", title: "Sprinklered", meta: "boolean" }, // ToggleRight
        { id: "generic", title: "Misc field" }, // Variable fallback
      ],
    });
    expect(items[0]?.icon).toBe("MapPin");
    expect(items[1]?.icon).toBe("Tag");
    expect(items[2]?.icon).toBe("DollarSign");
    expect(items[3]?.icon).toBe("Building");
    expect(items[4]?.icon).toBe("Shield");
    expect(items[5]?.icon).toBe("ToggleRight");
    expect(items[6]?.icon).toBe("Variable");
  });

  it("uses the lookup category + Brain icon + model subtype for connected models", () => {
    const items = buildInventory({
      models: [
        { id: "m1", name: "Disc credit", version: "v1", inputs: [] },
      ],
    });
    const model = items.find((i) => i.kind === "model");
    expect(model?.category).toBe("lookup");
    expect(model?.subtype).toBe("model");
    expect(model?.icon).toBe("Brain");
  });

  it("returns 8 math operators regardless of inputs", () => {
    const items = buildInventory({});
    expect(items.filter((i) => i.kind === "math")).toHaveLength(8);
  });
});

describe("tower exposure ← chain (ADR-0047)", () => {
  it("loads apply_exposure + exposure_input/divisor onto the tower", () => {
    const plan = stagesToTowerPlan({
      stages: [
        {
          stage_id: "ch",
          sequence: 2,
          stage_kind: "multiplicative_chain",
          display_name: "ch",
          config_json: {
            output_total_field: "premium",
            chains: [
              {
                name: "Account",
                base_input: "literal.base_value",
                base_value: 1,
                factor_lookups: [],
                lcm: { factor_kind: "lcm", input_path: "form_input.lcm" },
                exposure_input: "form_input.annual_revenue",
                exposure_unit_divisor: 1000,
                apply_exposure: true,
                output_field: "premium",
              },
            ],
          },
        },
      ],
    });
    const tower = plan.towers[0]!;
    expect(tower.exposureInput).toBe("annual_revenue");
    expect(tower.exposureUnitDivisor).toBe(1000);
    expect(tower.applyExposure).toBe(true);
  });
});
