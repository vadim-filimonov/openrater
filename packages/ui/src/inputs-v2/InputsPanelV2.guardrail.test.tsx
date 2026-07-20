/**
 * <InputsPanelV2> — parity: the paid-connector cost guardrail (Brief 62.6 PR3).
 *
 * The mount owns the guardrail node + the cohort connector run state; the v2
 * body renders it above the premium preview and surfaces the projected cohort
 * rows (the FULL book, not the 8-row preview slice) so the mount can price +
 * pre-fetch. These tests assert that surfacing.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { _clearRegistryForTests, registerBuiltinKinds } from "@openrater/contracts";
import type { Plan } from "@openrater/contracts";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** base × 1.10 × 0.95 × 1.32 → "premium" (the shared chain fixture). */
const PLAN: Plan = {
  id: "test.inputs-v2-guardrail",
  version: "1.0.0",
  name: "Guardrail test",
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
};

const MAPPING: PlanInputMapping = {
  source: {
    kind: "csv",
    columns: ["base"],
    sample_rows: [{ base: "1000" }, { base: "2000" }, { base: "3000" }],
  },
  column_map: { base: "base" },
};

const REQUIRED: readonly RequiredInputEntry[] = [
  { id: "base", name: "Base rate", dtype: "number", category: "inputs" },
];

describe("<InputsPanelV2> — connector cost guardrail (parity)", () => {
  it("renders the guardrail node above the premium preview", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base: "number" }}
        bookGuardrail={<div data-testid="guardrail">This book hits paid APIs</div>}
      />,
    );
    expect(screen.getByTestId("guardrail")).toBeInTheDocument();
    // It sits inside the premium-preview section (above the headline).
    expect(screen.getByText("Premium preview")).toBeInTheDocument();
  });

  it("renders nothing extra when no guardrail is provided", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base: "number" }}
      />,
    );
    expect(screen.queryByTestId("guardrail")).not.toBeInTheDocument();
    expect(screen.getByText("Premium preview")).toBeInTheDocument();
  });

  it("surfaces the FULL projected book via onCohortRows (not the preview slice)", () => {
    const onCohortRows = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base: "number" }}
        onCohortRows={onCohortRows}
      />,
    );
    expect(onCohortRows).toHaveBeenCalled();
    // All 3 sample rows projected through the column_map (base → base).
    const lastCall = onCohortRows.mock.calls.at(-1);
    const rows = (lastCall?.[0] ?? []) as readonly Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ base: 1000 });
  });
});
