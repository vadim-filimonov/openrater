/**
 * useConnectorEvaluator — pure-core coverage (Brief 62.6).
 *
 * The hook itself is a thin react-query wrapper; the load-bearing logic is
 * the three pure helpers it composes (the repo's "test the pure core, not the
 * whole hook" pattern, cf. PlansListRoute's matcher test):
 *   - collectConnectorRefs — extract + DEDUP the tail's connector refs
 *   - netFromOutputs        — first-numeric-port → net % mapping
 *   - buildConnectorEvaluator — success → eval; failure → 0-fallback (§3)
 */

import { describe, it, expect } from "vitest";
import type { PolicyAdjustment } from "@openrater/contracts";
import {
  collectConnectorRefs,
  netFromOutputs,
  buildConnectorEvaluator,
  type ConnRef,
} from "./useConnectorEvaluator";

describe("collectConnectorRefs", () => {
  it("extracts connector refs from schedule_rating + endorsement steps", () => {
    const tail: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "irpm", display_name: "IRPM", cap_pct: 25, source: { from: "connector", connector_id: "lossnav", version: "v2" } },
      { kind: "package_factor", id: "p", display_name: "P", factor: 0.9 },
      { kind: "endorsement", id: "endo", display_name: "Endo", effect: { kind: "flat", amount: 0 }, source: { from: "connector", connector_id: "terror_api", version: "v1" } },
    ];
    expect(collectConnectorRefs(tail)).toEqual([
      { connector_id: "lossnav", version: "v2" },
      { connector_id: "terror_api", version: "v1" },
    ]);
  });

  it("ignores non-connector sources + dedups a repeated ref", () => {
    const tail: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "a", display_name: "A", cap_pct: 25, source: { from: "connector", connector_id: "lossnav", version: "v2" } },
      { kind: "schedule_rating", id: "b", display_name: "B", cap_pct: 25, source: { from: "literal", total: 5 } },
      { kind: "endorsement", id: "c", display_name: "C", effect: { kind: "flat", amount: 0 }, source: { from: "connector", connector_id: "lossnav", version: "v2" } },
    ];
    // lossnav@v2 appears twice → one ref; the literal is skipped.
    expect(collectConnectorRefs(tail)).toEqual([{ connector_id: "lossnav", version: "v2" }]);
  });

  it("treats a different version as a distinct ref (no floating latest)", () => {
    const tail: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "a", display_name: "A", cap_pct: 25, source: { from: "connector", connector_id: "lossnav", version: "v2" } },
      { kind: "endorsement", id: "c", display_name: "C", effect: { kind: "flat", amount: 0 }, source: { from: "connector", connector_id: "lossnav", version: "v3" } },
    ];
    expect(collectConnectorRefs(tail)).toHaveLength(2);
  });
});

describe("netFromOutputs", () => {
  it("takes the first numeric output port as the net %", () => {
    expect(netFromOutputs({ irpm_net: -7, note: "ok" })).toBe(-7);
  });
  it("skips non-numeric ports to find the numeric one", () => {
    expect(netFromOutputs({ status: "matched", net_pct: 12 })).toBe(12);
  });
  it("coerces a numeric string, else degrades to 0", () => {
    expect(netFromOutputs({ x: "5.5" })).toBe(5.5);
    expect(netFromOutputs({ x: "n/a" })).toBe(0);
    expect(netFromOutputs({})).toBe(0);
  });
});

describe("buildConnectorEvaluator", () => {
  const refs: ConnRef[] = [{ connector_id: "lossnav", version: "v2" }];

  it("maps a successful call → net + version + snapshot + cost", () => {
    const evaluate = buildConnectorEvaluator(refs, [
      { data: { outputs: { irpm_net: -10 }, snapshot_id: "snap_1", cost_usd: 0.02 } },
    ]);
    expect(evaluate({ connector_id: "lossnav", version: "v2" }, {})).toEqual({
      net: -10,
      version: "v2",
      snapshot_id: "snap_1",
      cost_usd: 0.02,
    });
  });

  it("degrades a failed call to a net-0 fallback carrying the reason (§3)", () => {
    const evaluate = buildConnectorEvaluator(refs, [
      { error: new Error("502 upstream timeout") },
    ]);
    const ev = evaluate({ connector_id: "lossnav", version: "v2" }, {});
    expect(ev.net).toBe(0);
    expect(ev.version).toBe("v2");
    expect(ev.fallback_reason).toBe("502 upstream timeout");
    expect(ev.snapshot_id).toBeUndefined();
  });

  it("falls back for a ref that was never pre-fetched (never throws)", () => {
    const evaluate = buildConnectorEvaluator(refs, [
      { data: { outputs: { irpm_net: -10 }, snapshot_id: "snap_1", cost_usd: 0.02 } },
    ]);
    const ev = evaluate({ connector_id: "unknown", version: "v9" }, {});
    expect(ev).toEqual({ net: 0, version: "v9", fallback_reason: "connector not pre-fetched" });
  });
});
