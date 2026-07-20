/**
 * policyTailStore tests (Brief 62.4 PR3b · ADR-0055) — the API-backed
 * Final-adjustments tail store shared by the editor + the cohort scoring
 * view. localStorage is the write-through cache; `reconcilePolicyTail` is
 * the pure decision the synced hook applies against the server envelope.
 * Uses a self-contained localStorage stub so it runs under the rate-lab
 * default `node` env (no jsdom needed).
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { PolicyAdjustment } from "@openrater/contracts";
import {
  readPolicyTail,
  writePolicyTail,
  reconcilePolicyTail,
} from "./policyTailStore";

// Minimal in-memory localStorage so the store's `window.localStorage`
// reads/writes work under the node test env.
function installLocalStorageStub(): void {
  const map = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  (globalThis as { window?: unknown }).window = { localStorage: stub };
}

const TAIL: PolicyAdjustment[] = [
  { kind: "schedule_rating", id: "irpm", display_name: "IRPM", cap_pct: 25, source: { from: "column", column: "irpm_total_pct" } },
  { kind: "minimum_premium", id: "min", floor: 500 },
];

describe("policyTailStore", () => {
  beforeEach(() => installLocalStorageStub());

  it("round-trips an authored tail by plan id", () => {
    writePolicyTail("plan-a", TAIL);
    expect(readPolicyTail("plan-a")).toEqual(TAIL);
  });

  it("isolates tails per plan id", () => {
    writePolicyTail("plan-a", TAIL);
    expect(readPolicyTail("plan-b")).toEqual([]);
  });

  it("returns [] for an unset plan", () => {
    expect(readPolicyTail("never-written")).toEqual([]);
  });

  it("degrades a corrupt blob to [] (never crashes the runtime plan)", () => {
    window.localStorage.setItem("openrater:policy-tail:v1:plan-x", "{not json");
    expect(readPolicyTail("plan-x")).toEqual([]);
  });

  it("filters out structurally-invalid adjustments on read (validated)", () => {
    window.localStorage.setItem(
      "openrater:policy-tail:v1:plan-y",
      JSON.stringify([{ kind: "minimum_premium", id: "ok", floor: 500 }, { kind: "bogus", id: "x" }]),
    );
    const out = readPolicyTail("plan-y");
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("ok");
  });

  it("ignores a non-array blob", () => {
    window.localStorage.setItem("openrater:policy-tail:v1:plan-z", JSON.stringify({ nope: true }));
    expect(readPolicyTail("plan-z")).toEqual([]);
  });
});

describe("reconcilePolicyTail (ADR-0055 — the sync decision)", () => {
  it("a server envelope is authoritative: adopt, validated per item", () => {
    const decision = reconcilePolicyTail(
      {
        tail: [...TAIL, { kind: "bogus", id: "x" }],
        content_hash: "abc123",
      },
      [], // whatever the cache held is irrelevant — the record wins
      true,
    );
    expect(decision.action).toBe("adopt");
    if (decision.action !== "adopt") return;
    expect(decision.tail).toEqual(TAIL); // the bogus item is filtered
    expect(decision.marker).toBe("abc123");
  });

  it("adopt marker falls back to the tail JSON when the envelope has no hash", () => {
    const decision = reconcilePolicyTail({ tail: [] }, TAIL, true);
    expect(decision.action).toBe("adopt");
    if (decision.action !== "adopt") return;
    // An EMPTY server tail still wins over a non-empty cache — the record
    // says "no adjustments"; a stale cache must not resurrect them.
    expect(decision.tail).toEqual([]);
    expect(decision.marker).toBe("[]");
  });

  it("no server tail + non-empty legacy cache + writable → one-shot migration", () => {
    const decision = reconcilePolicyTail(null, TAIL, true);
    expect(decision.action).toBe("migrate");
    if (decision.action !== "migrate") return;
    expect(decision.tail).toEqual(TAIL);
  });

  it("no server tail + read-only plan → none (a frozen plan is never written)", () => {
    expect(reconcilePolicyTail(null, TAIL, false)).toEqual({ action: "none" });
  });

  it("no server tail + empty cache → none (nothing to migrate)", () => {
    expect(reconcilePolicyTail(null, [], true)).toEqual({ action: "none" });
  });
});
