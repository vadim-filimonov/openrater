/**
 * `chain.dim_sum` kind tests (Brief 35 PR 35.1).
 *
 * Two layers, mirroring `chain.lob_sum`:
 *
 *   1. Pure kind tests — execute() sums numeric inputs; defensive
 *      coercion of NaN / non-numeric / non-array; validate() enforces
 *      `dim_slug`; explainStep() reports the dim + a missing-level
 *      gap when expected > wired.
 *
 *   2. Runtime integration — wire two constants → dim_sum → output,
 *      confirm fan-in works the same way `lob_sum`'s integration does
 *      and that explainStep produces a clean sentence.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ChainDimSumKind,
  DEFAULT_DIM_SUM_OUTPUT_FIELD,
} from "./chain-dim-sum";
import { ConstantKind } from "./constant";
import { OutputKind } from "./output";
import { executePlan } from "../runtime";
import { _clearRegistryForTests, globalRegistry } from "../registry";
import type { Plan } from "../plan-types";

describe("ChainDimSumKind — contract surface", () => {
  it("has the correct id, category, label, ports, defaults", () => {
    expect(ChainDimSumKind.id).toBe("chain.dim_sum");
    expect(ChainDimSumKind.category).toBe("chain");
    expect(ChainDimSumKind.inputs).toHaveLength(1);
    expect(ChainDimSumKind.inputs[0]?.name).toBe("level_outputs");
    expect(ChainDimSumKind.inputs[0]?.cardinality).toBe("N");
    expect(ChainDimSumKind.outputs).toHaveLength(1);
    expect(ChainDimSumKind.outputs[0]?.name).toBe("value");
    expect(ChainDimSumKind.defaultParams.dim_slug).toBe("coverage");
    expect(ChainDimSumKind.defaultParams.output_field).toBe(
      DEFAULT_DIM_SUM_OUTPUT_FIELD,
    );
    expect(ChainDimSumKind.defaultParams.level_field_map).toEqual({});
  });

  it("execute sums all numeric level outputs", () => {
    const result = ChainDimSumKind.execute(
      { level_outputs: [1_247_438, 382_915, 294_012] },
      {
        dim_slug: "coverage",
        level_field_map: {
          building: "building_premium",
          bpp: "bpp_premium",
          bi: "bi_premium",
        },
      },
    );
    expect(result.value).toBe(1_924_365);
  });

  it("execute returns 0 for empty level_outputs", () => {
    expect(
      ChainDimSumKind.execute(
        { level_outputs: [] },
        { dim_slug: "coverage", level_field_map: {} },
      ).value,
    ).toBe(0);
  });

  it("execute skips non-numeric + NaN/Infinity values", () => {
    const result = ChainDimSumKind.execute(
      {
        level_outputs: [
          100,
          NaN as unknown as number,
          200,
          "ignored" as unknown as number,
          Infinity as unknown as number,
          300,
        ],
      },
      { dim_slug: "coverage", level_field_map: {} },
    );
    expect(result.value).toBe(600);
  });

  it("execute handles non-array input defensively (returns 0)", () => {
    const result = ChainDimSumKind.execute(
      {
        level_outputs:
          undefined as unknown as readonly number[],
      },
      { dim_slug: "coverage", level_field_map: {} },
    );
    expect(result.value).toBe(0);
  });

  it("validate accepts any non-empty dim_slug", () => {
    expect(
      ChainDimSumKind.validate?.({
        dim_slug: "coverage",
        level_field_map: {},
      }),
    ).toEqual({ valid: true, issues: [] });
    expect(
      ChainDimSumKind.validate?.({
        dim_slug: "territory",
        level_field_map: { ter1: "ter1_premium" },
      }),
    ).toEqual({ valid: true, issues: [] });
  });

  it("validate rejects empty/missing dim_slug", () => {
    // `dim_slug` is typed as `string`, so the empty string is legal
    // at the type level — the validator's job is the runtime check
    // that an actuary never ends up with a Total tower wired to "".
    const r = ChainDimSumKind.validate?.({
      dim_slug: "",
      level_field_map: {},
    });
    expect(r?.valid).toBe(false);
    expect(r?.issues?.[0]?.field).toBe("dim_slug");
  });

  it("explainStep renders dim + count + total for plural levels", () => {
    const explanation = ChainDimSumKind.explainStep?.(
      { level_outputs: [100, 200, 300] },
      {
        dim_slug: "coverage",
        level_field_map: {
          building: "building_premium",
          bpp: "bpp_premium",
          bi: "bi_premium",
        },
      },
      { value: 600 },
    );
    expect(explanation).toMatch(/Total coverage premium/);
    expect(explanation).toMatch(/sum of 3 level chains/);
    expect(explanation).toMatch(/→ 600$/);
  });

  it("explainStep uses singular 'level chain' for 1 wired output", () => {
    const explanation = ChainDimSumKind.explainStep?.(
      { level_outputs: [500] },
      {
        dim_slug: "coverage",
        level_field_map: { building: "building_premium" },
      },
      { value: 500 },
    );
    expect(explanation).toMatch(/sum of 1 level chain[^s]/);
  });

  it("explainStep surfaces a missing-level gap when expected > wired", () => {
    const explanation = ChainDimSumKind.explainStep?.(
      { level_outputs: [100, 200] },
      {
        dim_slug: "coverage",
        level_field_map: {
          building: "building_premium",
          bpp: "bpp_premium",
          bi: "bi_premium",
          gl: "gl_premium",
        },
      },
      { value: 300 },
    );
    // 4 expected, 2 wired → 2 missing
    expect(explanation).toMatch(/2 levels missing/);
  });

  it("explainStep uses singular 'level' when exactly 1 is missing", () => {
    const explanation = ChainDimSumKind.explainStep?.(
      { level_outputs: [100, 200] },
      {
        dim_slug: "coverage",
        level_field_map: {
          building: "building_premium",
          bpp: "bpp_premium",
          bi: "bi_premium",
        },
      },
      { value: 300 },
    );
    expect(explanation).toMatch(/1 level missing\)/);
  });
});

describe("chain.dim_sum — runtime integration (fan-in)", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(ConstantKind);
    globalRegistry.register(ChainDimSumKind);
    globalRegistry.register(OutputKind);
  });

  it("sums two constants wired into the dim_sum's N-cardinality port", () => {
    const plan: Plan = {
      id: "test.dim.sum",
      version: "0.1.0",
      name: "Test plan",
      nodes: [
        {
          id: "c_building",
          kind: "constant",
          params: { value: 1_247_438, type: "money" },
        },
        {
          id: "c_bpp",
          kind: "constant",
          params: { value: 382_915, type: "money" },
        },
        {
          id: "sum",
          kind: "chain.dim_sum",
          params: {
            dim_slug: "coverage",
            level_field_map: {
              building: "building_premium",
              bpp: "bpp_premium",
            },
            output_field: "total_premium",
          },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "total_premium", fieldType: "money" },
        },
      ],
      edges: [
        {
          from: { node: "c_building", port: "value" },
          to: { node: "sum", port: "level_outputs" },
        },
        {
          from: { node: "c_bpp", port: "value" },
          to: { node: "sum", port: "level_outputs" },
        },
        {
          from: { node: "sum", port: "value" },
          to: { node: "out", port: "value" },
        },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.outputs.total_premium).toBe(1_630_353);
    expect(result.trace["sum"]?.explanation).toMatch(
      /Total coverage premium/,
    );
    expect(result.trace["sum"]?.explanation).toMatch(
      /sum of 2 level chains/,
    );
  });

  it("sums zero per-level chains to 0 (degenerate but valid)", () => {
    const plan: Plan = {
      id: "test.dim.sum.empty",
      version: "0.1.0",
      name: "Test plan",
      nodes: [
        {
          id: "sum",
          kind: "chain.dim_sum",
          params: {
            dim_slug: "coverage",
            level_field_map: {},
          },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "total_premium", fieldType: "money" },
        },
      ],
      edges: [
        {
          from: { node: "sum", port: "value" },
          to: { node: "out", port: "value" },
        },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.outputs.total_premium).toBe(0);
  });
});
