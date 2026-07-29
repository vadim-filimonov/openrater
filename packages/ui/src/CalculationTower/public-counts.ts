/**
 * public-counts — THE user-facing counting of a plan's algorithm
 * (MVP-013, mvp-tightness §3.3).
 *
 * The sweep found the algorithm counted five ways (rating towers /
 * wire `stages` / `chain_stages` / report "rating steps" / Rating-tab
 * rows). The one public counting is **chains · steps**, where chains
 * are the per-coverage premium chains and steps are the rows the
 * Rating tab renders: each chain's build-up rows (base + factors,
 * output rows excluded — an output is a result, not a step) plus the
 * Final-adjustments rows projected from the plan's tail stages.
 *
 * Wire counts (`stages`, `chain_stages`) stay wire-only; no surface
 * prints them. Boundary: rows authored in the separate policy-tail
 * table are the Rating tab's live concern, not this ledger fact —
 * workbook-built plans (the MVP path) carry their whole tail as
 * stages, so the countings agree by construction.
 */

import { getPerLevelTowers } from "./plan-mutations";
import {
  stagesToTowerPlan,
  type StageInput,
} from "./stages-to-tower-plan";
import type { TowerPlan } from "./types";

/** The stage kinds the Rating tab's Final-adjustments ledger renders
 *  (the `stagesToAdjustments` projection + the rail's footer count —
 *  keep the three lists identical). */
export const SHEET_TAIL_STAGE_KINDS: ReadonlySet<string> = new Set([
  "modifier.schedule",
  "endorsement.factor",
  "endorsement.additive",
  "endorsement.sublimit",
  "endorsement.rate_branch",
  "clamp",
  "round",
  "flat_factor",
]);

export interface PublicAlgorithmCounts {
  /** Per-coverage premium chains (the Total roll-up is not a chain). */
  readonly chains: number;
  /** Rating-tab rows: chain build-up steps + Final-adjustment rows. */
  readonly steps: number;
}

/** Count a projected TowerPlan's public steps (no adjustments). */
export function countTowerPlanSteps(plan: TowerPlan): PublicAlgorithmCounts {
  const towers = getPerLevelTowers(plan);
  let steps = 0;
  for (const t of towers) {
    for (const e of t.entries) {
      if (e.kind === "drop-slot") continue;
      if (
        e.kind === "node" &&
        plan.nodes.get(e.nodeId)?.category === "output"
      ) {
        continue;
      }
      steps += 1;
    }
  }
  return { chains: towers.length, steps };
}

/** The one public counting, from raw plan stages. */
export function countPublicAlgorithm(
  stages: readonly StageInput[],
): PublicAlgorithmCounts {
  const fromTowers = countTowerPlanSteps(stagesToTowerPlan({ stages }));
  const tailRows = stages.filter((s) =>
    SHEET_TAIL_STAGE_KINDS.has(s.stage_kind),
  ).length;
  return {
    chains: fromTowers.chains,
    steps: fromTowers.steps + tailRows,
  };
}
