/**
 * computePlatformAttention tests — pins the Brief 88 (88.0) ranking, the
 * connector GROUPING, and the single-voice phrasing of the Home triage
 * brain. The severity order is the contract:
 *   blocking → drift → incomplete → ready → unconnected → connector
 * (setup never outranks substance — Brief 88 §3.2 / P4).
 */

import { describe, it, expect } from "vitest";
import {
  computePlatformAttention,
  summarizeAttention,
  isAlarm,
  isSetup,
  type PlanFacts,
} from "./computePlatformAttention";
import type { PlanReadiness } from "../PlanReadiness/planReadiness";

const READY: PlanReadiness = {
  hasInputs: true,
  hasAlgorithm: true,
  compiles: true,
  errorIssueCount: 0,
  grade: "structural",
  compileReady: true,
  blockingHint: null,
  undeclaredRequiredInputCount: 0,
  unsetValueStepCount: 0,
  rateReady: true,
  nextStepHint: null,
};
const NOT_READY: PlanReadiness = {
  hasInputs: false,
  hasAlgorithm: false,
  compiles: false,
  errorIssueCount: 0,
  grade: "structural",
  compileReady: false,
  blockingHint: "Build the algorithm first.",
  undeclaredRequiredInputCount: 0,
  unsetValueStepCount: 0,
  rateReady: false,
  nextStepHint: "Build the algorithm first.",
};

function plan(o: Partial<PlanFacts> & { id: string; name: string }): PlanFacts {
  return {
    status: "draft",
    readiness: NOT_READY,
    ...o,
  };
}

describe("computePlatformAttention", () => {
  it("flags an incomplete draft, naming it and the missing checkpoint", () => {
    const groups = computePlatformAttention([
      plan({ id: "p1", name: "Sample BOP" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("incomplete");
    expect(groups[0]?.subject).toBe("Sample BOP");
    expect(groups[0]?.text).toBe(
      " isn't ready to rate yet — build the algorithm first.",
    );
    expect(groups[0]?.count).toBe(1);
    expect(groups[0]?.href).toBe("/rate-lab/p1/workspace/inputs");
  });

  it("nudges a ready draft (info, not an alarm) toward Ship", () => {
    const groups = computePlatformAttention([
      plan({ id: "p2", name: "CA BOP", readiness: READY }),
    ]);
    expect(groups[0]?.kind).toBe("ready");
    expect(isAlarm(groups[0]!.kind)).toBe(false);
    expect(groups[0]?.subject).toBe("CA BOP");
    expect(groups[0]?.text).toBe(" compiles clean — ready to publish.");
    expect(groups[0]?.actionLabel).toBe("Open Ship");
  });

  it("a LIVE, in-sync plan produces no item (Brief 84: live = published)", () => {
    const groups = computePlatformAttention([
      plan({ id: "p3", name: "Live", published: true, readiness: READY }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("an archived plan raises nothing", () => {
    const groups = computePlatformAttention([
      plan({ id: "p4", name: "Old", status: "archived", readiness: READY }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("unconnected (84.3 D-D): live + no app + an integration paired → a NUDGE", () => {
    const groups = computePlatformAttention(
      [
        plan({
          id: "u",
          name: "Live API",
          published: true,
          liveIntegrationCount: 0,
          readiness: READY,
        }),
      ],
      [],
      { anyIntegrationPaired: true },
    );
    expect(groups[0]?.kind).toBe("unconnected");
    expect(isAlarm(groups[0]!.kind)).toBe(false);
    expect(isSetup(groups[0]!.kind)).toBe(false);
    expect(groups[0]?.subject).toBe("Live API");
    expect(groups[0]?.text).toBe(" is live but no app is connected to it yet.");
    expect(groups[0]?.href).toBe("/rate-lab/u/workspace/ship");
  });

  it("unconnected never nags an API-only shop (no pairing platform-wide)", () => {
    const groups = computePlatformAttention(
      [
        plan({
          id: "u2",
          name: "Live API",
          published: true,
          liveIntegrationCount: 0,
          readiness: READY,
        }),
      ],
      [],
      { anyIntegrationPaired: false },
    );
    expect(groups).toHaveLength(0);
  });

  it("a live plan serving an app raises nothing", () => {
    const groups = computePlatformAttention(
      [
        plan({
          id: "s",
          name: "Serving",
          published: true,
          liveIntegrationCount: 1,
          readiness: READY,
        }),
      ],
      [],
      { anyIntegrationPaired: true },
    );
    expect(groups).toHaveLength(0);
  });

  it("drift = published + diverged, phrased per Brief 88 §6, deep-linked to Ship", () => {
    const groups = computePlatformAttention([
      plan({
        id: "d",
        name: "Drifted",
        published: true,
        diverged: true,
        readiness: READY,
      }),
    ]);
    expect(groups[0]?.kind).toBe("drift");
    expect(groups[0]?.subject).toBe("Drifted");
    expect(groups[0]?.text).toBe(
      " is live on an older version than your working draft.",
    );
    expect(groups[0]?.actionLabel).toBe("Review & publish");
    expect(groups[0]?.href).toBe("/rate-lab/d/workspace/ship");
  });

  it("ranks blocking → drift → incomplete → ready → unconnected → connector (setup LAST)", () => {
    const groups = computePlatformAttention(
      [
        plan({ id: "r", name: "Ready", readiness: READY }),
        plan({ id: "i", name: "Incomplete" }),
        plan({
          id: "u",
          name: "Unconnected",
          published: true,
          liveIntegrationCount: 0,
          readiness: READY,
        }),
        plan({
          id: "d",
          name: "Drifted",
          published: true,
          diverged: true,
          readiness: READY,
        }),
        plan({ id: "b", name: "Broken", errorCount: 3 }),
      ],
      [{ id: "c", name: "LightBox", hasKey: false }],
      { anyIntegrationPaired: true },
    );
    expect(groups.map((g) => g.kind)).toEqual([
      "blocking",
      "drift",
      "incomplete",
      "ready",
      "unconnected",
      "connector",
    ]);
  });

  it("blocking wins over incomplete for the same plan, with the Run-tab action", () => {
    const groups = computePlatformAttention([
      plan({ id: "p", name: "Sample BOP", errorCount: 3 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("blocking");
    expect(groups[0]?.subject).toBe("Sample BOP");
    expect(groups[0]?.text).toBe(" can't rate — 3 blocking errors.");
    expect(groups[0]?.actionLabel).toBe("Open Run");
    expect(groups[0]?.href).toBe("/rate-lab/p/workspace/verify");
  });

  it("the connector tier is SETUP, not an alarm (Brief 88 P4)", () => {
    expect(isAlarm("connector")).toBe(false);
    expect(isSetup("connector")).toBe(true);
    expect(isAlarm("blocking")).toBe(true);
    expect(isAlarm("drift")).toBe(true);
    expect(isAlarm("incomplete")).toBe(true);
    expect(isSetup("ready")).toBe(false);
  });

  // MVP-005 — the route is the opt-in: a fresh install (no API Lab
  // route anywhere) never opens on a key nag.
  it("suppresses connector setup rows when no API Lab route exists", () => {
    const groups = computePlatformAttention(
      [],
      [{ id: "gav", name: "Google Address Validation", hasKey: false }],
      { hasApiLabRoutes: false },
    );
    expect(groups).toHaveLength(0);
  });

  it("groups keyless connectors into ONE row carrying every name", () => {
    const groups = computePlatformAttention(
      [],
      [
        { id: "gav", name: "Google Address Validation", hasKey: false },
        { id: "gp", name: "Google Places (Text Search)", hasKey: false },
        { id: "lb", name: "LightBox (Property Structures)", hasKey: false },
      ],
    );
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.id).toBe("connector:keyless");
    expect(g.kind).toBe("connector");
    expect(g.severity).toBe("setup");
    expect(g.subject).toBeUndefined();
    expect(g.text).toBe("3 API Lab connections are missing keys");
    expect(g.names).toEqual([
      "Google Address Validation",
      "Google Places (Text Search)",
      "LightBox (Property Structures)",
    ]);
    expect(g.count).toBe(3);
    expect(g.actionLabel).toBe("Add keys");
    expect(g.href).toBe("/api-lab");
  });

  it("a single keyless connector reads singular, with a singular action", () => {
    const groups = computePlatformAttention(
      [],
      [{ id: "lb", name: "LightBox", hasKey: false }],
    );
    expect(groups[0]?.text).toBe("An API Lab connection is missing its key");
    expect(groups[0]?.names).toEqual(["LightBox"]);
    expect(groups[0]?.actionLabel).toBe("Add key");
  });

  it("keyless and failed-run connectors form two separate groups, keyless first", () => {
    const groups = computePlatformAttention(
      [],
      [
        { id: "a", name: "Alpha", hasKey: false },
        { id: "b", name: "Beta", hasKey: true, lastRunFailed: true },
        { id: "c", name: "Gamma", hasKey: true, lastRunFailed: true },
      ],
    );
    expect(groups.map((g) => g.id)).toEqual([
      "connector:keyless",
      "connector:failed",
    ]);
    expect(groups[1]?.text).toBe("2 API Lab connections failed their last run");
    expect(groups[1]?.names).toEqual(["Beta", "Gamma"]);
    expect(groups[1]?.actionLabel).toBe("Open API Lab");
  });

  it("summarizeAttention counts groups for the hero, members for the suffix", () => {
    const groups = computePlatformAttention(
      [
        plan({
          id: "d",
          name: "Drifted",
          published: true,
          diverged: true,
          readiness: READY,
        }),
        plan({ id: "r", name: "Ready", readiness: READY }),
      ],
      [
        { id: "a", name: "Alpha", hasKey: false },
        { id: "b", name: "Beta", hasKey: false },
        { id: "c", name: "Gamma", hasKey: true, lastRunFailed: true },
      ],
    );
    expect(summarizeAttention(groups)).toEqual({
      alarmGroupCount: 1,
      setupGroupCount: 2,
      needsYouGroupCount: 3,
      keylessConnectorCount: 2,
      failedConnectorCount: 1,
    });
  });
});
