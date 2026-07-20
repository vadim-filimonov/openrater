/**
 * tower-status — unit tests (Brief 35.9 PR 35.9.1).
 *
 * Verifies the pure helpers behave on the documented branches:
 *
 *   1. Empty tower → "empty"
 *   2. Output-cap-only tower → "empty" (cap doesn't count)
 *   3. Drop-slot-only tower → "empty" (drop-slot doesn't count)
 *   4. Tower with a non-output node → "draft"
 *   5. Tower with a group → "draft" (groups always substantive)
 *   6. Tower with mixed substantive + output cap → "draft"
 *   7. Tower with completedAt (future field) → "complete"
 *   8. Dangling node ref (entry points at missing node) → not substantive
 *   9. computeAllTowerStatuses keys by tower id
 *
 * The fixtures inline minimal Tower / TowerNode shapes — only the
 * fields the helpers actually read.
 */

import { describe, it, expect } from "vitest";
import type { Operator, Tower, TowerEntry, TowerNode } from "./types";
import {
  computeTowerStatus,
  computeAllTowerStatuses,
  isSubstantiveEntry,
} from "./tower-status";

// ── Fixture helpers ─────────────────────────────────────────────

function makeNode(
  id: string,
  category: TowerNode["category"],
  overrides: Partial<TowerNode> = {},
): TowerNode {
  return {
    id,
    category,
    title: id,
    valueChip: { primary: "—" },
    icon: "Square",
    ...overrides,
  };
}

function makeTower(
  id: string,
  entries: readonly TowerEntry[],
  entryOps: readonly Operator[] = [],
): Tower {
  return {
    id,
    name: id,
    outputField: `${id}_premium`,
    entries,
    entryOps,
  };
}

function nodesMap(...nodes: TowerNode[]): ReadonlyMap<string, TowerNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

// ── computeTowerStatus ──────────────────────────────────────────

describe("computeTowerStatus", () => {
  it("returns 'empty' for a tower with zero entries", () => {
    const tower = makeTower("t1", []);
    expect(computeTowerStatus(tower, nodesMap())).toBe("empty");
  });

  it("returns 'empty' for an output-cap-only tower", () => {
    const out = makeNode("out", "output");
    const tower = makeTower("t1", [{ kind: "node", nodeId: "out" }]);
    expect(computeTowerStatus(tower, nodesMap(out))).toBe("empty");
  });

  it("returns 'empty' for a drop-slot-only tower", () => {
    const tower = makeTower("t1", [{ kind: "drop-slot" }]);
    expect(computeTowerStatus(tower, nodesMap())).toBe("empty");
  });

  it("returns 'draft' for a tower with a non-output node", () => {
    const factor = makeNode("factor", "lookup");
    const tower = makeTower("t1", [{ kind: "node", nodeId: "factor" }]);
    expect(computeTowerStatus(tower, nodesMap(factor))).toBe("draft");
  });

  it("returns 'draft' for a tower with a group entry", () => {
    const tower = makeTower("t1", [{ kind: "group", groupId: "g1" }]);
    // groups are always substantive — no need to wire a group lookup
    expect(computeTowerStatus(tower, nodesMap())).toBe("draft");
  });

  it("returns 'draft' for a mix of substantive + output cap", () => {
    const factor = makeNode("factor", "lookup");
    const out = makeNode("out", "output");
    const tower = makeTower("t1", [
      { kind: "node", nodeId: "factor" },
      { kind: "node", nodeId: "out" },
    ]);
    expect(computeTowerStatus(tower, nodesMap(factor, out))).toBe(
      "draft",
    );
  });

  it("returns 'complete' when the future `completedAt` field is set", () => {
    const factor = makeNode("factor", "lookup");
    const tower = makeTower("t1", [{ kind: "node", nodeId: "factor" }]);
    // Inject the future field via cast — same path the helper reads.
    const withCompleted = {
      ...tower,
      completedAt: "2026-05-24T17:00:00Z",
    } as Tower;
    expect(computeTowerStatus(withCompleted, nodesMap(factor))).toBe(
      "complete",
    );
  });

  it("treats dangling node refs as non-substantive (empty)", () => {
    // entry points at a node id that doesn't exist in nodesById
    const tower = makeTower("t1", [
      { kind: "node", nodeId: "missing" },
    ]);
    expect(computeTowerStatus(tower, nodesMap())).toBe("empty");
  });
});

// ── isSubstantiveEntry (spot-check helper) ──────────────────────

describe("isSubstantiveEntry", () => {
  it("returns false for drop-slot", () => {
    const entry: TowerEntry = { kind: "drop-slot" };
    expect(isSubstantiveEntry(entry, nodesMap())).toBe(false);
  });

  it("returns true for a group entry", () => {
    const entry: TowerEntry = { kind: "group", groupId: "g1" };
    expect(isSubstantiveEntry(entry, nodesMap())).toBe(true);
  });

  it("returns true for a non-output node", () => {
    const node = makeNode("n", "lookup");
    const entry: TowerEntry = { kind: "node", nodeId: "n" };
    expect(isSubstantiveEntry(entry, nodesMap(node))).toBe(true);
  });

  it("returns false for an output-cap node", () => {
    const node = makeNode("n", "output");
    const entry: TowerEntry = { kind: "node", nodeId: "n" };
    expect(isSubstantiveEntry(entry, nodesMap(node))).toBe(false);
  });

  it("returns false for a dangling node ref", () => {
    const entry: TowerEntry = { kind: "node", nodeId: "missing" };
    expect(isSubstantiveEntry(entry, nodesMap())).toBe(false);
  });
});

// ── computeAllTowerStatuses ─────────────────────────────────────

describe("computeAllTowerStatuses", () => {
  it("returns a status per tower keyed by id", () => {
    const factor = makeNode("f", "lookup");
    const out = makeNode("o", "output");
    const t1 = makeTower("empty_tower", []);
    const t2 = makeTower("output_only", [{ kind: "node", nodeId: "o" }]);
    const t3 = makeTower("substantive", [
      { kind: "node", nodeId: "f" },
    ]);
    const result = computeAllTowerStatuses([t1, t2, t3], nodesMap(factor, out));
    expect(result.get("empty_tower")).toBe("empty");
    expect(result.get("output_only")).toBe("empty");
    expect(result.get("substantive")).toBe("draft");
    expect(result.size).toBe(3);
  });

  it("returns an empty map when given no towers", () => {
    expect(computeAllTowerStatuses([], nodesMap()).size).toBe(0);
  });
});
