/**
 * `chain.lob_sum` kind tests (M1.2, Brief 17).
 *
 * Two layers:
 *
 *   1. Pure kind tests — execute() sums numeric inputs; coerces NaN /
 *      non-numeric to skip; produces a deterministic value.
 *
 *   2. Runtime integration — wire two constants → lob_sum → output,
 *      confirm fan-in works and explainStep produces a clean sentence.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ChainLobSumKind } from "./chain-lob-sum";
import { ConstantKind } from "./constant";
import { OutputKind } from "./output";
import { executePlan } from "../runtime";
import { _clearRegistryForTests, globalRegistry } from "../registry";
import type { Plan } from "../plan-types";

describe("ChainLobSumKind — contract surface", () => {
  it("has the correct id, category, label, ports, defaults", () => {
    expect(ChainLobSumKind.id).toBe("chain.lob_sum");
    expect(ChainLobSumKind.category).toBe("chain");
    expect(ChainLobSumKind.inputs).toHaveLength(1);
    expect(ChainLobSumKind.inputs[0]?.name).toBe("premiums");
    expect(ChainLobSumKind.inputs[0]?.cardinality).toBe("N");
    expect(ChainLobSumKind.outputs).toHaveLength(1);
    expect(ChainLobSumKind.defaultParams.lob_tag).toBe("liability");
  });

  it("execute sums all numeric premiums", () => {
    const result = ChainLobSumKind.execute(
      { premiums: [100, 200, 300] },
      { lob_tag: "property" },
    );
    expect(result.value).toBe(600);
  });

  it("execute returns 0 for empty premiums", () => {
    expect(
      ChainLobSumKind.execute({ premiums: [] }, { lob_tag: "wc" }).value,
    ).toBe(0);
  });

  it("execute skips non-numeric + NaN/Infinity values", () => {
    const result = ChainLobSumKind.execute(
      {
        premiums: [
          100,
          NaN as unknown as number,
          200,
          "ignored" as unknown as number,
          Infinity as unknown as number,
          300,
        ],
      },
      { lob_tag: "liability" },
    );
    expect(result.value).toBe(600);
  });

  it("execute handles non-array input defensively (returns 0)", () => {
    const result = ChainLobSumKind.execute(
      { premiums: undefined as unknown as readonly number[] },
      { lob_tag: "liability" },
    );
    expect(result.value).toBe(0);
  });

  it("validate accepts any non-empty opaque tag", () => {
    expect(
      ChainLobSumKind.validate?.({ lob_tag: "liability" }),
    ).toEqual({ valid: true, issues: [] });
    expect(
      ChainLobSumKind.validate?.({ lob_tag: "property" }),
    ).toEqual({ valid: true, issues: [] });
    // Opaque post-ADR-0033: a coverage_id outside the old LineCode
    // vocabulary is equally valid.
    expect(
      ChainLobSumKind.validate?.({ lob_tag: "side_a" }),
    ).toEqual({ valid: true, issues: [] });
  });

  it("validate rejects empty/missing lob_tag", () => {
    const r = ChainLobSumKind.validate?.({ lob_tag: "" });
    expect(r?.valid).toBe(false);
    expect(r?.issues?.[0]?.field).toBe("lob_tag");
  });

  it("explainStep renders the LOB label + count + total", () => {
    const explanation = ChainLobSumKind.explainStep?.(
      { premiums: [100, 200] },
      { lob_tag: "property" },
      { value: 300 },
    );
    expect(explanation).toMatch(/Property LOB premium/);
    expect(explanation).toMatch(/sum of 2 coverage chains/);
    expect(explanation).toMatch(/→ 300$/);
  });

  it("explainStep uses singular 'chain' for 1 premium", () => {
    const explanation = ChainLobSumKind.explainStep?.(
      { premiums: [500] },
      { lob_tag: "wc" },
      { value: 500 },
    );
    expect(explanation).toMatch(/sum of 1 coverage chain[^s]/);
  });
});

describe("chain.lob_sum — runtime integration (fan-in)", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(ConstantKind);
    globalRegistry.register(ChainLobSumKind);
    globalRegistry.register(OutputKind);
  });

  it("sums two constants wired into the lob_sum's N-cardinality port", () => {
    const plan: Plan = {
      id: "test.lob.sum",
      version: "0.1.0",
      name: "Test plan",
      nodes: [
        { id: "c1", kind: "constant", params: { value: 5200, type: "money" } },
        { id: "c2", kind: "constant", params: { value: 3250, type: "money" } },
        {
          id: "sum",
          kind: "chain.lob_sum",
          params: { lob_tag: "property" },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "property_premium", fieldType: "money" },
        },
      ],
      edges: [
        { from: { node: "c1", port: "value" }, to: { node: "sum", port: "premiums" } },
        { from: { node: "c2", port: "value" }, to: { node: "sum", port: "premiums" } },
        { from: { node: "sum", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.outputs.property_premium).toBe(8450);
    expect(result.trace["sum"]?.explanation).toMatch(/Property LOB premium/);
    expect(result.trace["sum"]?.explanation).toMatch(/sum of 2 coverage chains/);
  });

  it("sums zero coverage chains to 0 (degenerate but valid)", () => {
    const plan: Plan = {
      id: "test.lob.sum.empty",
      version: "0.1.0",
      name: "Test plan",
      nodes: [
        {
          id: "sum",
          kind: "chain.lob_sum",
          params: { lob_tag: "wc" },
        },
        {
          id: "out",
          kind: "output",
          params: { fieldName: "wc_premium", fieldType: "money" },
        },
      ],
      edges: [
        { from: { node: "sum", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.outputs.wc_premium).toBe(0);
  });
});
