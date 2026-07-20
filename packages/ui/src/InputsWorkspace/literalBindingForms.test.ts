/**
 * Colon-form literal bindings execute (filing-transcription spec §4.6).
 *
 * The ingest builder passes chain-row `input_binding` values straight
 * into the stored chainSpec: a real exposure row lands as
 * `exposure_input: "literal:250"` + `apply_exposure: true`, and an lcm
 * row's binding lands as `lcm.input_path`. The projector used to guard
 * only the DOT form (`literal.`), so a colon-form binding minted an
 * `input.field` node reading `externalInputs["literal:250"]` — and the
 * engine refused every risk of a plan whose filed exposure is a fixed
 * number. These tests pin the seam end-to-end:
 *   builder-shaped chainSpec → stagesToRuntimePlan → compilePlan → runPlan
 * with hand-computed filed premiums (rate→3 dp, premium→nearest $).
 *
 * `context.lcm` is deliberately NOT resolved here: the ingest builder
 * resolves it to `lcm.value` at build time (it needs the plan sheet),
 * so a runtime plan carrying it is hand-authored — the projector keeps
 * the refusal loud by minting the named input (last test).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { compilePlan, runPlan, registerBuiltinKinds } from "@openrater/contracts";
import type { Dimension } from "@openrater/contracts";
import {
  stagesToRuntimePlan,
  type FactorTableCellsMap,
} from "./stagesToRuntimePlan";
import { synthesizeRepresentativeRisk } from "./synthesizeRepresentativeRisk";
import type { StageLike, FactorTableLike } from "./deriveRequiredInputs";

const DIMS: Dimension[] = [
  {
    id: "construction_class",
    slug: "construction_class",
    display_name: "construction_class",
    data_type: "string",
    role: "rating-input",
  } as Dimension,
];

const FACTOR_TABLES: FactorTableLike[] = [
  {
    id: "construction_rel",
    slug: "construction_rel",
    key_dimension: "construction_class",
  } as unknown as FactorTableLike,
];

const CELLS: FactorTableCellsMap = new Map([
  [
    "construction_rel",
    new Map<string, number>([
      ["frame", 1.0],
      ["fire_resistive", 0.78],
    ]),
  ],
]);

const CONSTR_LOOKUP = {
  name: "constr",
  factor_kind: "construction_rel",
  lookup_method: "direct",
  dimensions: {
    construction_class: {
      source: "form_input",
      path: "form_input.construction_class",
    },
  },
};

/** One stored multiplicative_chain stage, shaped exactly like the
 * ingest builder's `_chain_config` emission for a coverage block. */
function chainStage(spec: Record<string, unknown>): StageLike[] {
  return [
    {
      stage_id: "multiplicative_chain_main",
      stage_kind: "multiplicative_chain",
      config_json: {
        chains: [
          {
            name: "building premium",
            base_input: "literal.base_value",
            factor_lookups: [CONSTR_LOOKUP],
            output_field: "building_premium",
            coverage_value: "building",
            ...spec,
          },
        ],
      },
    },
  ];
}

function project(spec: Record<string, unknown>) {
  return stagesToRuntimePlan(chainStage(spec), DIMS, FACTOR_TABLES, CELLS);
}

function score(
  spec: Record<string, unknown>,
  inputs: Record<string, unknown>,
): number {
  const { plan } = project(spec);
  const out = runPlan(compilePlan(plan), inputs).outputs as Record<
    string,
    number
  >;
  return out.building_premium!;
}

/** Every input node's fieldName — ghost bindings show up here. */
function inputFields(plan: { nodes: ReadonlyArray<unknown> }): string[] {
  return (plan.nodes as Array<{ kind: string; params?: { fieldName?: string } }>)
    .filter((n) => n.kind === "input")
    .map((n) => n.params?.fieldName ?? "");
}

beforeAll(() => {
  registerBuiltinKinds();
});

describe("literal:<n> exposure binding (spec §4.6)", () => {
  const SPEC = {
    base_value: 4.0,
    lcm: { value: 1.3 },
    exposure_input: "literal:250",
    exposure_unit_divisor: 100,
    apply_exposure: true,
  };

  it("rates as a constant exposure — no input read, exact filed math", () => {
    // rate 4.000 × frame 1.0 → round3 4.000 → × (250 ÷ 100) → × 1.3 = 13
    expect(score(SPEC, { construction_class: "frame" })).toBe(13);
    // 4.000 × 0.78 = 3.12 → × 2.5 = 7.8 → × 1.3 = 10.14 → nearest $ = 10
    expect(score(SPEC, { construction_class: "fire_resistive" })).toBe(10);
  });

  it("mints a constant node, never externalInputs['literal:250']", () => {
    const { plan } = project(SPEC);
    expect(inputFields(plan)).toEqual(["construction_class"]);
    const constants = (
      plan.nodes as Array<{ kind: string; params?: { value?: unknown } }>
    ).filter((n) => n.kind === "constant");
    expect(constants.some((n) => n.params?.value === 250)).toBe(true);
  });

  it("the builder's dead default (literal:1, apply_exposure false) stays per-account", () => {
    // Per-account mode: base × factor × LCM-as-chain-factor, no
    // exposure step, no rounding — and still no ghost input.
    const { plan } = project({
      base_value: 4.0,
      lcm: { value: 1.3 },
      exposure_input: "literal:1",
      exposure_unit_divisor: 1.0,
      apply_exposure: false,
    });
    expect(inputFields(plan)).toEqual(["construction_class"]);
    const out = runPlan(compilePlan(plan), { construction_class: "frame" })
      .outputs as Record<string, number>;
    expect(out.building_premium).toBeCloseTo(5.2, 9);
  });
});

describe("literal:<n> lcm binding (spec §4.6)", () => {
  it("lcm.input_path 'literal:1.10' is the multiplier, not an input", () => {
    const spec = {
      base_value: 1.5,
      lcm: { input_path: "literal:1.10" },
      exposure_input: "form_input.cv",
      exposure_unit_divisor: 100,
      apply_exposure: true,
    };
    const { plan } = project(spec);
    expect(inputFields(plan).sort()).toEqual(["construction_class", "cv"]);
    // 1.500 × frame 1.0 → × (10000 ÷ 100) = 150 → × 1.10 = 165
    expect(score(spec, { construction_class: "frame", cv: 10000 })).toBe(165);
  });
});

describe("sample-risk seeding on a literal-exposure plan", () => {
  it("never seeds the literal binding as a form field", () => {
    // The Run zone's sample form is fed by synthesizeRepresentativeRisk
    // — a third walker of chain configs. Before the guard it grew a
    // "Literal:250" input seeded 100000 (F07's numeric-exposure seed).
    const risk = synthesizeRepresentativeRisk(
      chainStage({
        base_value: 4.0,
        lcm: { value: 1.3 },
        exposure_input: "literal:250",
        exposure_unit_divisor: 100,
        apply_exposure: true,
      }),
      DIMS,
    );
    expect(Object.keys(risk)).not.toContain("literal:250");
    // A real form-input exposure still gets its numeric seed.
    const withInput = synthesizeRepresentativeRisk(
      chainStage({
        base_value: 1.5,
        lcm: { value: 1.1 },
        exposure_input: "form_input.cv",
        exposure_unit_divisor: 100,
        apply_exposure: true,
      }),
      DIMS,
    );
    expect(typeof withInput.cv).toBe("number");
  });
});

describe("context.lcm reaching the projector (hand-authored plans only)", () => {
  it("stays a loud, named input — the ingest builder resolves it before storage", () => {
    const { plan } = project({
      base_value: 4.0,
      lcm: { input_path: "context.lcm" },
      exposure_input: "literal:250",
      exposure_unit_divisor: 100,
      apply_exposure: true,
    });
    expect(inputFields(plan)).toContain("context.lcm");
  });
});
