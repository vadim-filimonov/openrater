/**
 * <InputsPanelV2> — parity: the per-row preview shows the FILED premium
 * (the plan's Final-adjustments tail applied), not just the raw chain output.
 *
 * v1's ScoringPreviewPane applied `applyCohortPolicyTail`; v2 now does the
 * same in its `scored` memo. No-op for no-tail plans (covered by the main
 * scoring test); this asserts a tail-bearing plan files the adjusted premium.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { _clearRegistryForTests, registerBuiltinKinds } from "@openrater/contracts";
import type { Plan } from "@openrater/contracts";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** base × 1.10 → "premium" (a one-factor chain). */
function chainPlan(over: Partial<Plan> = {}): Plan {
  return {
    id: "test.inputs-v2-tail",
    version: "1.0.0",
    name: "Tail test",
    line: "bop",
    effective: "2026-01-01",
    nodes: [
      { id: "in_base", kind: "input", params: { fieldName: "base", fieldType: "money" } },
      { id: "k_lcm", kind: "constant", params: { value: 1.1, type: "factor" } },
      { id: "mul", kind: "chain.mult", params: { stopOnZero: false } },
      { id: "out_p", kind: "output", params: { fieldName: "premium", fieldType: "money" } },
    ],
    edges: [
      { from: { node: "in_base", port: "value" }, to: { node: "mul", port: "base" } },
      { from: { node: "k_lcm", port: "value" }, to: { node: "mul", port: "factors" } },
      { from: { node: "mul", port: "result" }, to: { node: "out_p", port: "value" } },
    ],
    ...over,
  };
}

const MAPPING: PlanInputMapping = {
  source: { kind: "csv", columns: ["base"], sample_rows: [{ base: "1000" }] },
  column_map: { base: "base" },
};

const REQUIRED: readonly RequiredInputEntry[] = [
  { id: "base", name: "Base rate", dtype: "number", category: "inputs" },
];

describe("<InputsPanelV2> — Final-adjustments tail in the preview (parity)", () => {
  it("files the tail-adjusted premium (IRPM −10% → ×0.90)", () => {
    // base 1000 → chain 1100 → IRPM −10% → filed 990.
    const plan = chainPlan({
      policy_tail: [
        {
          kind: "schedule_rating",
          id: "irpm",
          display_name: "IRPM",
          cap_pct: 25,
          source: { from: "literal", total: -10 },
        },
      ],
    } as Partial<Plan>);

    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={plan}
        inputDtypes={{ base: "number" }}
      />,
    );
    // The preview shows the FILED premium (avg headline + per-row chip), not
    // the $1,100 chain output.
    expect(screen.getAllByText("$990").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("$1,100")).toHaveLength(0);
  });

  it("shows the raw chain premium when the plan authors no tail", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={chainPlan()}
        inputDtypes={{ base: "number" }}
      />,
    );
    // No tail → filed === aggregated === the $1,100 chain output.
    expect(screen.getAllByText("$1,100").length).toBeGreaterThan(0);
  });
});
