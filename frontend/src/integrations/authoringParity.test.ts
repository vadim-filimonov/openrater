/**
 * authoringParity tests — v4 audit G6 interim guard.
 *
 * Pins that no live add-affordance can create a stage the runtime
 * projector ignores, at three levels:
 *
 *   1. Registry: every declared add-affordance's stage_kind is either
 *      executed by the projector, explicitly in the marked-unpriced
 *      set (drawer banner + sheet "not yet priced" meta), or a
 *      non-pricing metadata kind.
 *   2. Reroute: the Minimum-premium affordance resolves to the round
 *      stage (edit-existing or add) — never to the dead `clamp`.
 *   3. Source tripwire: the route + tail adapters contain no
 *      `stage_kind: "<dead kind>"` CREATION literal. Comparisons
 *      (`=== "clamp"`) stay legal — editing an existing clamp is
 *      allowed; creating one is not.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROJECTOR_EXECUTED_STAGE_KINDS } from "@openrater/ui";
import {
  LIVE_ADD_AFFORDANCES,
  NON_PRICING_STAGE_KINDS,
  UNPRICED_AUTHORABLE_STAGE_KINDS,
  isPricedStageKind,
  minPremiumTarget,
} from "./authoringParity";

describe("live add-affordance registry", () => {
  it("every add-affordance creates a priced, marked-unpriced, or non-pricing kind", () => {
    for (const entry of LIVE_ADD_AFFORDANCES) {
      const ok =
        PROJECTOR_EXECUTED_STAGE_KINDS.has(entry.stage_kind) ||
        UNPRICED_AUTHORABLE_STAGE_KINDS.has(entry.stage_kind) ||
        NON_PRICING_STAGE_KINDS.has(entry.stage_kind);
      expect(
        ok,
        `"${entry.affordance}" creates stage_kind "${entry.stage_kind}", ` +
          `which the projector ignores and no marking covers. Either teach ` +
          `stagesToRuntimePlan the kind (and add it to ` +
          `PROJECTOR_EXECUTED_STAGE_KINDS) or add a visible "not yet ` +
          `priced" marking and list the kind in ` +
          `UNPRICED_AUTHORABLE_STAGE_KINDS.`,
      ).toBe(true);
    }
  });

  it("no add-affordance creates a clamp stage (round.min stays the blessed floor)", () => {
    // clamp PRICES as of G6-full, but the sheet's Minimum-premium
    // affordance still routes to the round stage's floor — one blessed
    // mechanism, no second create path.
    expect(
      LIVE_ADD_AFFORDANCES.filter((e) => e.stage_kind === "clamp"),
    ).toHaveLength(0);
  });

  it("the marked-unpriced set is EMPTY (P2 G6-full: flat_factor + clamp price)", () => {
    // Shrinks only by teaching the projector the kind — which G6-full
    // did for both former members. Growing it means a NEW unpriced
    // authoring surface — think twice.
    expect([...UNPRICED_AUTHORABLE_STAGE_KINDS]).toEqual([]);
    expect(isPricedStageKind("flat_factor")).toBe(true);
    expect(isPricedStageKind("clamp")).toBe(true);
    expect(isPricedStageKind("round")).toBe(true);
  });
});

describe("minPremiumTarget (the Minimum-premium reroute)", () => {
  const round = { stage_id: "final_round", stage_kind: "round" };
  const chain = { stage_id: "c1", stage_kind: "multiplicative_chain" };
  const clamp = { stage_id: "old_clamp", stage_kind: "clamp" };

  it("edits the existing round stage when the plan has one", () => {
    const target = minPremiumTarget([chain, round]);
    expect(target).toEqual({ action: "edit-round", stage: round });
  });

  it("adds a round stage when the plan has none", () => {
    expect(minPremiumTarget([chain])).toEqual({ action: "add-round" });
  });

  it("NEVER routes to a clamp stage, even when the plan carries one", () => {
    const target = minPremiumTarget([chain, clamp]);
    expect(target).toEqual({ action: "add-round" });
  });
});

describe("source tripwire — no dead-kind creation literals", () => {
  // A creation site writes `stage_kind: "x"` (object property).
  // Comparisons (`stage.stage_kind === "x"`) don't match — editing
  // existing stages of a dead kind stays allowed.
  const creationLiteral = (source: string, kind: string): number =>
    (source.match(new RegExp(`stage_kind:\\s*["']${kind}["']`, "g")) ?? [])
      .length;

  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("PlanDetailRoute creates no clamp stages", () => {
    const src = read("../routes/PlanDetailRoute.tsx");
    expect(creationLiteral(src, "clamp")).toBe(0);
  });

  it("tailSync creates no clamp or flat_factor stages", () => {
    const src = read("./tailSync.ts");
    expect(creationLiteral(src, "clamp")).toBe(0);
    expect(creationLiteral(src, "flat_factor")).toBe(0);
  });
});
