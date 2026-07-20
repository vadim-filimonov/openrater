/**
 * <InputsPanelV2> — Phase C premium-preview tests.
 *
 * The dev DB has no plan with a rating chain, so the live premium render
 * can't be browser-verified there. This test closes that gap: it renders
 * the panel with a minimal multiplicative plan (base × 1.10 × 0.95 × 1.32
 * = base × 1.3794 → output "premium", the same V3.chain-mult fixture the
 * ScoringPreviewPane suite uses) + a connected book + a column map, and
 * asserts the projected → executePlanBatch → premium pipeline renders.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { _clearRegistryForTests, registerBuiltinKinds } from "@openrater/contracts";
import type { Plan } from "@openrater/contracts";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** base × 1.10 × 0.95 × 1.32 = base × 1.3794 → "premium". */
const PLAN: Plan = {
  id: "test.inputs-v2-score",
  version: "1.0.0",
  name: "Inputs v2 scoring test",
  line: "bop",
  effective: "2026-01-01",
  nodes: [
    { id: "in_base", kind: "input", params: { fieldName: "base", fieldType: "money" } },
    { id: "k_lcm", kind: "constant", params: { value: 1.1, type: "factor" } },
    { id: "k_disc", kind: "constant", params: { value: 0.95, type: "factor" } },
    { id: "k_load", kind: "constant", params: { value: 1.32, type: "factor" } },
    { id: "mul", kind: "chain.mult", params: { stopOnZero: false } },
    { id: "out_p", kind: "output", params: { fieldName: "premium", fieldType: "money" } },
  ],
  edges: [
    { from: { node: "in_base", port: "value" }, to: { node: "mul", port: "base" } },
    { from: { node: "k_lcm", port: "value" }, to: { node: "mul", port: "factors" } },
    { from: { node: "k_disc", port: "value" }, to: { node: "mul", port: "factors" } },
    { from: { node: "k_load", port: "value" }, to: { node: "mul", port: "factors" } },
    { from: { node: "mul", port: "result" }, to: { node: "out_p", port: "value" } },
  ],
};

const MAPPING: PlanInputMapping = {
  source: {
    kind: "csv",
    columns: ["base"],
    sample_rows: [{ base: "1000" }, { base: "2000" }],
  },
  column_map: { base: "base" },
};

const REQUIRED: readonly RequiredInputEntry[] = [
  { id: "base", name: "Base rate", dtype: "number", category: "inputs" },
];

describe("<InputsPanelV2> — Phase C premium preview", () => {
  it("scores the sample rows and renders live premiums + the average", () => {
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

    // 1000 × 1.3794 = 1379.4 → $1,379 ; 2000 × 1.3794 = 2758.8 → $2,759.
    // avg = 2069.1 → $2,069.
    expect(screen.getByText("Premium preview")).toBeInTheDocument();
    expect(screen.getByText("$2,069")).toBeInTheDocument();
    expect(screen.getByText("$1,379")).toBeInTheDocument();
    expect(screen.getByText("$2,759")).toBeInTheDocument();
  });

  it("hides the preview when the plan has no rating chain (echo plan)", () => {
    const echoPlan: Plan = {
      ...PLAN,
      nodes: PLAN.nodes.filter((n) => n.kind !== "chain.mult"),
      edges: [],
    };
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={echoPlan}
        inputDtypes={{ base: "number" }}
      />,
    );
    expect(screen.queryByText("Premium preview")).not.toBeInTheDocument();
  });

  it("offers the Run pointer when onOpenRun is provided (execution lives on Run — Brief 75 phase 4)", () => {
    const onOpenRun = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base: "number" }}
        onOpenRun={onOpenRun}
      />,
    );
    // No execution trigger on Inputs anymore — only navigation.
    expect(screen.queryByText(/Score all/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Score in Run/ }));
    expect(onOpenRun).toHaveBeenCalled();
  });

  it("shows range + median only when the sample premiums spread (P2.8)", () => {
    // MAPPING scores 1000→$1,379 and 2000→$2,759 — a real spread.
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
    expect(screen.getByText(/range \$1,379/)).toBeInTheDocument();
    expect(screen.getByText(/median \$2,069/)).toBeInTheDocument();
  });

  it("hides the spread stats when all sample premiums are equal", () => {
    // A single row → min === max → no spread → the plain caption.
    const oneRow: PlanInputMapping = {
      ...MAPPING,
      source: { kind: "csv", columns: ["base"], sample_rows: [{ base: "1000" }] },
    };
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={oneRow}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base: "number" }}
      />,
    );
    expect(screen.queryByText(/range/)).not.toBeInTheDocument();
    expect(screen.getByText(/rows? previewed/)).toBeInTheDocument();
  });
});

describe("<InputsPanelV2> — book truncation honesty (G12)", () => {
  const truncated: PlanInputMapping = {
    ...MAPPING,
    source: {
      kind: "csv",
      columns: ["base"],
      sample_rows: [{ base: "1000" }, { base: "2000" }],
      totalRowCount: 5,
    },
  };

  it("surfaces the parse cap: banner, 'N of M rows loaded' meta, honest Score-all", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={truncated}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base: "number" }}
      />,
    );
    expect(screen.getByText(/Book capped at upload/)).toBeInTheDocument();
    expect(
      screen.getByText(/3 rows beyond the cap were discarded/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 of 5 rows loaded/)).toBeInTheDocument();
  });

  it("stays silent when the whole file was loaded", () => {
    const complete: PlanInputMapping = {
      ...MAPPING,
      source: { ...truncated.source, totalRowCount: 2 } as PlanInputMapping["source"],
    };
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={complete}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base: "number" }}
      />,
    );
    expect(screen.queryByText(/Book capped at upload/)).not.toBeInTheDocument();
  });

  it("stays silent on a legacy mapping with no totalRowCount", () => {
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
    expect(screen.queryByText(/Book capped at upload/)).not.toBeInTheDocument();
  });
});
