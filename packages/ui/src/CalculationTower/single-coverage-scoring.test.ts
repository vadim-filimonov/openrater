/**
 * E12 regression — "Start single-coverage build" must persist a real,
 * SCOREABLE rating chain (or visibly flag that it won't price).
 *
 * The live stress test (2026-06-02) hit this: an actuary started a
 * single-coverage build, set a base rate, saw "All changes saved", then
 * scored — and got "—" for every row with "No rating chain yet", because
 * the plan still had only `input_node` stages.
 *
 * Root cause: a tower with an UNSET base rate and no factors projects to
 * ZERO chain stages (correctly — it isn't a real chain yet), so the
 * content-dirty signal sees no change and nothing autosaves. The fix makes
 * that gap VISIBLE (towerWillPrice → inspector prompt) and proves the happy
 * path persists + scores end-to-end.
 *
 * This test pins:
 *   1. base SET   → `towerPlanToStages` emits a `multiplicative_chain`, and
 *                   the projected plan compiles + scores a finite premium.
 *   2. base UNSET → ZERO chain stages (the silent-drop) AND `towerWillPrice`
 *                   is false (so the UI prompts instead of lying).
 *
 * towerWillPrice is kept in lockstep with `projectTowerToChain`'s null guard;
 * this test breaks if the two ever diverge.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { compilePlan, runPlan, registerBuiltinKinds } from "@openrater/contracts";
import { stagesToTowerPlan, type StageInput } from "./stages-to-tower-plan";
import { towerPlanToStages } from "./tower-plan-to-stages";
import { addEmptyTower, setChainBaseValue } from "./plan-mutations";
import { towerWillPrice } from "./tower-status";
import { stagesToRuntimePlan } from "../InputsWorkspace/stagesToRuntimePlan";

beforeAll(() => registerBuiltinKinds());

// A plan with inputs/dims but no chain — the repro's starting point.
const serverStages: StageInput[] = [
  {
    stage_id: "input_tiv",
    sequence: 0,
    stage_kind: "input_node",
    display_name: "tiv",
    config_json: {
      name: "tiv",
      data_type: "number",
      source: "form_input",
      source_path: "tiv",
      required: true,
    },
  },
  {
    stage_id: "input_class_code",
    sequence: 1,
    stage_kind: "input_node",
    display_name: "class_code",
    config_json: {
      name: "class_code",
      data_type: "string",
      source: "form_input",
      source_path: "class_code",
      required: true,
    },
  },
];

const preserved = serverStages.map((s) => ({ ...s, config_json: s.config_json ?? {} }));

function startSingleCoverageBuild() {
  const base = stagesToTowerPlan({ stages: serverStages });
  const withTower = addEmptyTower(base, { name: "Premium", outputField: "premium" });
  const baseNode = [...withTower.nodes.values()].find(
    (n) => n.ref?.kind === "chain-base",
  );
  expect(baseNode).toBeDefined();
  return { withTower, baseNodeId: baseNode!.id };
}

describe("E12 — single-coverage build persists a scoreable chain", () => {
  it("base SET → emits a multiplicative_chain that compiles and scores a finite premium", () => {
    const { withTower, baseNodeId } = startSingleCoverageBuild();
    const withBase = setChainBaseValue(withTower, baseNodeId, 600);

    // towerWillPrice flips true once the base is committed.
    const tower = withBase.towers[0]!;
    expect(towerWillPrice(tower, withBase.nodes, withBase.groups)).toBe(true);

    // The save converter emits a real chain stage (not just input_node).
    const desired = towerPlanToStages(withBase, { preservedStages: preserved });
    const chains = desired.filter((s) => s.stage_kind === "multiplicative_chain");
    expect(chains).toHaveLength(1);

    // The persisted plan compiles + scores end-to-end (no separate output_node
    // stage needed — the chain's output_field is the premium writer; the
    // runtime builds the output node from it).
    const { plan: runtime } = stagesToRuntimePlan(desired as never, [], [], new Map(), {
      lcmOverride: 1,
    });
    const chainMult = (runtime.nodes as { kind: string }[]).filter(
      (n) => n.kind === "chain.mult",
    );
    expect(chainMult.length).toBeGreaterThan(0); // hasRatingChain → true

    const compiled = compilePlan(runtime);
    const result = runPlan(compiled, { tiv: 100000, class_code: "c101" });
    const premium = (result.outputs as Record<string, unknown>)["premium"];
    expect(typeof premium).toBe("number");
    expect(Number.isFinite(premium as number)).toBe(true);
    expect(premium).toBe(600); // base 600 × identity LCM (E11) = 600
  });

  it("F01 — a freshly-spawned tower seeds the identity base → it prices + persists (no silent drop)", () => {
    const { withTower } = startSingleCoverageBuild();
    // Right after the build, WITHOUT committing any base value: F01 seeds the
    // identity rate 1.0, so the tower is already a valid, persistable chain
    // (pre-fix this dropped to zero stages and towerWillPrice was false).
    const tower = withTower.towers[0]!;
    expect(towerWillPrice(tower, withTower.nodes, withTower.groups)).toBe(true);

    const desired = towerPlanToStages(withTower, { preservedStages: preserved });
    const chains = desired.filter(
      (s) => s.stage_kind === "multiplicative_chain",
    );
    expect(chains).toHaveLength(1);
    // The single chain carries a valid (non-empty) base_input so the backend
    // accepts it — the whole F01 point.
    const cfg = chains[0]!.config_json as {
      chains: { base_input: string; base_value?: number }[];
    };
    expect(cfg.chains[0]!.base_input.length).toBeGreaterThan(0);
    expect(cfg.chains[0]!.base_value).toBe(1);
  });

  it("F01 — explicitly clearing the base → the chain drops rather than emitting base_input:'' (no 422)", () => {
    const { withTower, baseNodeId } = startSingleCoverageBuild();
    // An author who clears the seeded base leaves the tower unpriceable; it must
    // drop from the projection, NOT emit an empty base_input that 422s the batch.
    const cleared = setChainBaseValue(withTower, baseNodeId, null);
    const desired = towerPlanToStages(cleared, { preservedStages: preserved });
    expect(
      desired.filter((s) => s.stage_kind === "multiplicative_chain"),
    ).toHaveLength(0);
    expect(desired.every((s) => s.stage_kind === "input_node")).toBe(true);
  });
});
