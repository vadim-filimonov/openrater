/**
 * chainTraceValues — Brief 48 §3.4 / phase 3.
 *
 * INTEGRATION test: runs a real `stagesToRuntimePlan` → `compilePlan` →
 * `runPlan` round-trip, then proves `buildTowerValueResolver` aligns the
 * resulting trace back to tower nodes BY IDENTITY. Because it exercises the
 * actual projector, any drift in the runtime node-id scheme (the `sanitize`
 * contract) breaks this test — which is the point.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { compilePlan, runPlan, registerBuiltinKinds } from "@openrater/contracts";
import type { Plan } from "@openrater/contracts";
import {
  stagesToRuntimePlan,
  type FactorTableCellsMap,
} from "../InputsWorkspace/stagesToRuntimePlan";
import type {
  StageLike,
  FactorTableLike,
} from "../InputsWorkspace/deriveRequiredInputs";
import {
  buildTowerValueResolver,
  premiumForTower,
  mapRunIssuesToTowerSteps,
} from "./chainTraceValues";
import type { Tower, TowerNode } from "./types";

// A D&O chain mirroring the cold-test: base 600 × NTEE × State × LCM 1.35.
const CHAIN_SPEC = {
  name: "do_premium",
  base_input: "form_input.do_base_rate",
  base_value: 600,
  factor_lookups: [
    {
      name: "ntee_factor_do",
      factor_kind: "ntee_factor_do",
      dimensions: {
        ntee_major: { source: "form_input", path: "form_input.ntee_major" },
      },
    },
    {
      name: "state_factor_do",
      factor_kind: "state_factor_do",
      dimensions: {
        state: { source: "form_input", path: "form_input.state" },
      },
    },
  ],
  lcm: { input_path: "form_input.lcm" },
  output_field: "do_premium",
};

const STAGES: StageLike[] = [
  {
    stage_id: "do_chain_stage",
    stage_kind: "multiplicative_chain",
    config_json: { chains: [CHAIN_SPEC] },
  },
];

const DIMS = [
  { id: "ntee_major", slug: "ntee_major", display_name: "NTEE major", levels: [] },
  { id: "state", slug: "state", display_name: "State", levels: [] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any;

const FACTOR_TABLES: FactorTableLike[] = [
  { id: "ft_ntee", display_name: "NTEE (D&O)", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
  { id: "ft_state", display_name: "State (D&O)", key_dimension: "state", slug: "state_factor_do" } as unknown as FactorTableLike,
];

const CELLS: FactorTableCellsMap = new Map([
  ["ft_ntee", new Map([["religion", 1.2]])],
  ["ft_state", new Map([["CA", 1.05]])],
]);

// The runtime compiles against the registered kind set; register the builtin
// kinds once (same pattern as stagesToRuntimePlan.test.ts) so chain.mult /
// lookup.direct / constant / input / output resolve.
beforeAll(() => {
  registerBuiltinKinds();
});

function scoredRun() {
  const { plan } = stagesToRuntimePlan(STAGES, DIMS, FACTOR_TABLES, CELLS, {
    lcmOverride: 1.35,
  });
  const compiled = compilePlan(plan as unknown as Plan);
  return runPlan(compiled, { ntee_major: "religion", state: "CA" });
}

// Tower nodes as `stages-to-tower-plan` would project them (ref shapes only).
const baseNode: TowerNode = {
  id: "base_do_premium",
  category: "input",
  title: "Base rate",
  valueChip: { primary: "currency" },
  icon: "DollarSign",
  ref: { kind: "chain-base", baseValue: 600 },
};
const nteeNode: TowerNode = {
  id: "n_ntee",
  category: "lookup",
  title: "NTEE factor",
  valueChip: { primary: "× factor" },
  icon: "Boxes",
  ref: { kind: "factor-table", tableId: "ntee_factor_do" },
};
const stateNode: TowerNode = {
  id: "n_state",
  category: "lookup",
  title: "State factor",
  valueChip: { primary: "× factor" },
  icon: "MapPin",
  ref: { kind: "factor-table", tableId: "state_factor_do" },
};
const lcmNode: TowerNode = {
  id: "n_lcm",
  category: "loading",
  title: "Carrier LCM",
  valueChip: { primary: "× factor" },
  icon: "Target",
  ref: { kind: "constant", constantId: "LCM" },
};
const outNode: TowerNode = {
  id: "out_do_premium",
  category: "output",
  title: "D&O premium",
  valueChip: { primary: "premium" },
  icon: "DollarSign",
  ref: { kind: "output", outputField: "do_premium" },
};

describe("buildTowerValueResolver", () => {
  it("resolves the base from the chain.mult inputs", () => {
    const resolve = buildTowerValueResolver(CHAIN_SPEC, scoredRun());
    expect(resolve(baseNode)).toBeCloseTo(600, 6);
  });

  it("resolves each factor BY IDENTITY (tableId → lookup node), not order", () => {
    const resolve = buildTowerValueResolver(CHAIN_SPEC, scoredRun());
    expect(resolve(nteeNode)).toBeCloseTo(1.2, 6);
    expect(resolve(stateNode)).toBeCloseTo(1.05, 6);
  });

  it("resolves the LCM constant", () => {
    const resolve = buildTowerValueResolver(CHAIN_SPEC, scoredRun());
    expect(resolve(lcmNode)).toBeCloseTo(1.35, 6);
  });

  it("returns undefined for the output cap (the fold carries the premium)", () => {
    const resolve = buildTowerValueResolver(CHAIN_SPEC, scoredRun());
    expect(resolve(outNode)).toBeUndefined();
  });

  it("identity-matches — an unknown factor_kind resolves to undefined", () => {
    const resolve = buildTowerValueResolver(CHAIN_SPEC, scoredRun());
    const ghost: TowerNode = {
      ...nteeNode,
      id: "ghost",
      ref: { kind: "factor-table", tableId: "does_not_exist" },
    };
    expect(resolve(ghost)).toBeUndefined();
  });

  it("stays honest (all undefined) when the chain name is missing", () => {
    const resolve = buildTowerValueResolver(
      { output_field: "do_premium" },
      scoredRun(),
    );
    expect(resolve(baseNode)).toBeUndefined();
    expect(resolve(nteeNode)).toBeUndefined();
  });

  it("the resolved factors reproduce the scored premium (600×1.2×1.05×1.35)", () => {
    const run = scoredRun();
    const resolve = buildTowerValueResolver(CHAIN_SPEC, run);
    const product =
      resolve(baseNode)! *
      resolve(nteeNode)! *
      resolve(stateNode)! *
      resolve(lcmNode)!;
    expect(product).toBeCloseTo(600 * 1.2 * 1.05 * 1.35, 4);
    expect(premiumForTower(CHAIN_SPEC, run)).toBeCloseTo(product, 4);
  });
});

describe("premiumForTower", () => {
  it("reads the premium from runResult.outputs[output_field]", () => {
    expect(premiumForTower(CHAIN_SPEC, scoredRun())).toBeCloseTo(
      600 * 1.2 * 1.05 * 1.35,
      4,
    );
  });

  it("returns undefined for an unknown output field", () => {
    expect(
      premiumForTower({ name: "x", output_field: "nope" }, scoredRun()),
    ).toBeUndefined();
  });
});

// ── Brief 78 P5.3 (§3.3-1) — the honest sample column ────────────────

describe("mapRunIssuesToTowerSteps", () => {
  const TOWER: Tower = {
    id: "tower_do",
    name: "D&O",
    outputField: "do_premium",
    entries: [
      { kind: "node", nodeId: baseNode.id },
      { kind: "node", nodeId: nteeNode.id },
      { kind: "node", nodeId: stateNode.id },
      { kind: "node", nodeId: lcmNode.id },
      { kind: "node", nodeId: outNode.id },
    ],
    entryOps: ["multiply", "multiply", "multiply", "multiply"],
  };
  const NODES = new Map<string, TowerNode>(
    [baseNode, nteeNode, stateNode, lcmNode, outNode].map((n) => [n.id, n]),
  );
  const specFor = (outputField: string) =>
    outputField === "do_premium" ? CHAIN_SPEC : undefined;

  function scoredRunMissing(sample: Record<string, unknown>) {
    const { plan } = stagesToRuntimePlan(STAGES, DIMS, FACTOR_TABLES, CELLS, {
      lcmOverride: 1.35,
    });
    const compiled = compilePlan(plan as unknown as Plan);
    return runPlan(compiled, sample);
  }

  it("aligns a real missing-input refusal onto ITS step (integration — the projector id scheme)", () => {
    // ntee_major absent → the ntee lookup refuses; state resolves.
    const run = scoredRunMissing({ state: "CA" });
    expect(run.issues?.length ?? 0).toBeGreaterThan(0);
    const { stepIssues } = mapRunIssuesToTowerSteps({
      towers: [TOWER],
      nodes: NODES,
      chainSpecForOutputField: specFor,
      run,
    });
    expect(stepIssues.has(nteeNode.id)).toBe(true);
    expect(stepIssues.get(nteeNode.id)).toMatch(/NTEE|ntee/);
    // The state step resolved — no refusal may leak onto it.
    expect(stepIssues.has(stateNode.id)).toBe(false);
  });

  it("a clean run maps to empty issue sets", () => {
    const run = scoredRunMissing({ ntee_major: "religion", state: "CA" });
    const { stepIssues, towerIssues } = mapRunIssuesToTowerSteps({
      towers: [TOWER],
      nodes: NODES,
      chainSpecForOutputField: specFor,
      run,
    });
    expect(stepIssues.size).toBe(0);
    expect(towerIssues.size).toBe(0);
  });

  it("chain-scope issues fall to the tower header; foreign nodes are dropped", () => {
    const run = {
      outputs: {},
      trace: {},
      issues: [
        {
          severity: "error" as const,
          nodeId: "chain_do_premium",
          message: "chain-level refusal",
        },
        {
          severity: "error" as const,
          nodeId: "lk_do_premium_projector_only_factor",
          message: "projector-only factor refusal",
        },
        {
          severity: "error" as const,
          nodeId: "derive_territory",
          message: "not this tower's story",
        },
      ],
    };
    const { stepIssues, towerIssues } = mapRunIssuesToTowerSteps({
      towers: [TOWER],
      nodes: NODES,
      chainSpecForOutputField: specFor,
      run,
    });
    expect(stepIssues.size).toBe(0);
    expect(towerIssues.get("tower_do")).toEqual([
      "chain-level refusal",
      "projector-only factor refusal",
    ]);
  });

  it("first message per step wins (execution order = root cause first)", () => {
    const run = {
      outputs: {},
      trace: {},
      issues: [
        {
          severity: "error" as const,
          nodeId: "lk_do_premium_ntee_factor_do",
          message: "root cause",
        },
        {
          severity: "warning" as const,
          nodeId: "lk_do_premium_ntee_factor_do",
          message: "downstream echo",
        },
      ],
    };
    const { stepIssues } = mapRunIssuesToTowerSteps({
      towers: [TOWER],
      nodes: NODES,
      chainSpecForOutputField: specFor,
      run,
    });
    expect(stepIssues.get(nteeNode.id)).toBe("root cause");
  });
});
