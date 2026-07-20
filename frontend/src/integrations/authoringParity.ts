/**
 * authoringParity — v4 audit G6 interim guard (pre-v4 P2).
 *
 * The runtime projector (stagesToRuntimePlan) executes only a subset
 * of the substrate's stage kinds. Anything else it SILENTLY skips —
 * proven 2026-07-05 when a saved ×2.0 flat_factor loading and a $1M
 * clamp floor changed no premium. This module is the single place
 * where the authoring surfaces and the projector are held together:
 *
 *   1. `minPremiumTarget` — the build-up sheet's "+ Minimum premium"
 *      affordance routes to the `round` stage's `min_value_input`
 *      floor (the path the projector executes and the Sample BOP
 *      fixture uses), NEVER to the dead `clamp` kind.
 *   2. `LIVE_ADD_AFFORDANCES` — registry of every affordance that can
 *      CREATE a stage via the stage API, with the kind it creates.
 *   3. `UNPRICED_AUTHORABLE_STAGE_KINDS` — the kinds that remain
 *      authorable but are NOT priced; every surface that authors one
 *      must carry a visible "not yet priced" marking.
 *
 * The authoringParity test pins: every registry entry's kind is either
 * executed by the projector or in the explicitly-marked unpriced set.
 * Teaching the projector a new kind (or adding an affordance) forces a
 * conscious update here — no silent trap can reappear.
 */

import { PROJECTOR_EXECUTED_STAGE_KINDS } from "@openrater/ui";

export interface StageKindLike {
  readonly stage_id: string;
  readonly stage_kind: string;
}

/**
 * Where the "+ Minimum premium" affordance must land: the plan's
 * existing `round` tail stage if there is one (edit its floor), else
 * a fresh `round` stage. The floor value is authored as a literal
 * (e.g., "literal:500" or plain "500") — `form_input.*` paths are not
 * resolved by the live scorer.
 */
export type MinPremiumTarget<S extends StageKindLike> =
  | { readonly action: "edit-round"; readonly stage: S }
  | { readonly action: "add-round" };

export function minPremiumTarget<S extends StageKindLike>(
  stages: readonly S[],
): MinPremiumTarget<S> {
  const round = stages.find((s) => s.stage_kind === "round");
  return round !== undefined
    ? { action: "edit-round", stage: round }
    : { action: "add-round" };
}

/**
 * Stage kinds that live drawers can still author/edit but the
 * projector does NOT execute. Every affordance authoring one of these
 * must visibly say "not yet priced" (drawer banner + sheet row meta).
 * Shrink this set by teaching the projector the kind — never by
 * removing the marking.
 *
 * EMPTY as of P2 G6-full (ADR-0056): `flat_factor` and `clamp` price
 * now (loadings multiply their target output; clamps floor/cap it),
 * so the v4-G6 "not yet priced" markings came off. A kind re-enters
 * this set only with its marking re-added in the same PR.
 */
export const UNPRICED_AUTHORABLE_STAGE_KINDS: ReadonlySet<string> = new Set(
  [],
);

/**
 * Kinds that intentionally carry no premium math — the input
 * dictionary (Brief 52). Not "unpriced traps": they are metadata the
 * projector consumes through the chains, so they need no marking.
 */
export const NON_PRICING_STAGE_KINDS: ReadonlySet<string> = new Set([
  "input_node",
]);

/**
 * Every live affordance that can CREATE a stage, with the stage_kind
 * it creates. Keep in sync with the route handlers it names — the
 * parity test walks this list.
 */
export const LIVE_ADD_AFFORDANCES: ReadonlyArray<{
  readonly affordance: string;
  readonly stage_kind: string;
}> = [
  {
    affordance:
      "build-up sheet › Final adjustments › + Minimum premium (handleAddAdjustment → round drawer)",
    stage_kind: "round",
  },
  {
    affordance:
      "build-up sheet › Final adjustments › + IRPM schedule (handleAddAdjustment → modifier editor)",
    stage_kind: "modifier.schedule",
  },
  {
    affordance:
      "section pane › Loadings / Final adjustments › Add (handleAddStage → flat-factor drawer)",
    stage_kind: "flat_factor",
  },
  {
    affordance: "final-adjustments › add round drawer (handleSaveRound)",
    stage_kind: "round",
  },
  {
    affordance: "gates workspace › add gate (eligibility.gate saves)",
    stage_kind: "eligibility.gate",
  },
  {
    affordance:
      "assemble save › towerPlanToStages (multiplicative_chain towers)",
    stage_kind: "multiplicative_chain",
  },
  {
    affordance: "assemble save › towerPlanToStages (input dictionary)",
    stage_kind: "input_node",
  },
  {
    affordance: "tail editor › endorsement effects (tailEntriesToStages)",
    stage_kind: "endorsement.factor",
  },
  {
    affordance: "tail editor › endorsement additive (tailEntriesToStages)",
    stage_kind: "endorsement.additive",
  },
  {
    affordance: "tail editor › endorsement sublimit (tailEntriesToStages)",
    stage_kind: "endorsement.sublimit",
  },
  {
    affordance: "tail editor › endorsement rate branch (tailEntriesToStages)",
    stage_kind: "endorsement.rate_branch",
  },
];

/** True when the projector prices stages of this kind. */
export function isPricedStageKind(kind: string): boolean {
  return PROJECTOR_EXECUTED_STAGE_KINDS.has(kind);
}
