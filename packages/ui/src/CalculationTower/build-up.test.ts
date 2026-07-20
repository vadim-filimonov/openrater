import { describe, expect, it } from "vitest";
import { computeTowerBuildUp, type ValueResolver } from "./build-up";
import type { NodeCategory, Operator, Tower, TowerEntry, TowerNode } from "./types";

// ── Fixtures ──────────────────────────────────────────────────────

function node(id: string, category: NodeCategory): TowerNode {
  return { id, category, title: id, valueChip: { primary: "" }, icon: "Circle" };
}

function tower(
  nodeSpec: ReadonlyArray<readonly [string, NodeCategory]>,
  entryOps: readonly Operator[],
  finalOp?: Operator,
): { tower: Tower; nodes: Map<string, TowerNode> } {
  const nodes = new Map<string, TowerNode>();
  const entries: TowerEntry[] = [];
  for (const [id, cat] of nodeSpec) {
    nodes.set(id, node(id, cat));
    entries.push({ kind: "node", nodeId: id });
  }
  const t: Tower = {
    id: "t",
    name: "T",
    outputField: "premium",
    entries,
    entryOps,
    ...(finalOp ? { finalOp } : {}),
  };
  return { tower: t, nodes };
}

/** A resolver backed by a plain id→value map. */
function fromMap(m: Record<string, number | undefined>): ValueResolver {
  return (n) => m[n.id];
}

// ── Tests ─────────────────────────────────────────────────────────

describe("computeTowerBuildUp", () => {
  it("folds a multiplicative chain into running products", () => {
    // base 600 × 1.2 × 0.95 × 1.5(lcm), max 250(min) → 1026
    const { tower: t, nodes } = tower(
      [
        ["base", "input"],
        ["f1", "lookup"],
        ["f2", "lookup"],
        ["lcm", "math"],
        ["min", "math"],
        ["out", "output"],
      ],
      ["multiply", "multiply", "multiply", "max", "multiply"],
    );
    const r = computeTowerBuildUp(
      t,
      nodes,
      fromMap({ base: 600, f1: 1.2, f2: 0.95, lcm: 1.5, min: 250, out: undefined }),
    );

    expect(r.scored).toBe(true);
    expect(r.premium).toBeCloseTo(1026, 6);
    // running margin, line by line
    expect(r.steps.map((s) => s.running)).toEqual([600, 720, 684, 1026, 1026, 1026]);
    // each line's own value (the cap has none)
    expect(r.steps.map((s) => s.value)).toEqual([600, 1.2, 0.95, 1.5, 250, undefined]);
    // the operators that fold each line
    expect(r.steps.map((s) => s.op)).toEqual([
      undefined, // base seeds; no op
      "multiply",
      "multiply",
      "multiply",
      "max",
      undefined, // the output cap is not folded
    ]);
  });

  it("the output cap carries the premium, not a multiplier", () => {
    const { tower: t, nodes } = tower(
      [["base", "input"], ["f1", "lookup"], ["out", "output"]],
      ["multiply", "multiply"],
    );
    const r = computeTowerBuildUp(t, nodes, fromMap({ base: 600, f1: 2 }));
    const cap = r.steps.at(-1)!;
    expect(cap.category).toBe("output");
    expect(cap.value).toBeUndefined();
    expect(cap.running).toBe(1200);
    expect(r.premium).toBe(1200);
  });

  it("applies a binding minimum-premium floor (max)", () => {
    // base 100 × 1.0, then max 250 → floored to 250
    const { tower: t, nodes } = tower(
      [["base", "input"], ["lcm", "math"], ["min", "math"], ["out", "output"]],
      ["multiply", "max", "multiply"],
    );
    const r = computeTowerBuildUp(
      t,
      nodes,
      fromMap({ base: 100, lcm: 1.0, min: 250, out: undefined }),
    );
    expect(r.premium).toBe(250);
    expect(r.scored).toBe(true);
  });

  it("propagates undefined + reports unscored when a value is missing", () => {
    const { tower: t, nodes } = tower(
      [["base", "input"], ["f1", "lookup"], ["f2", "lookup"], ["out", "output"]],
      ["multiply", "multiply", "multiply"],
    );
    const r = computeTowerBuildUp(
      t,
      nodes,
      fromMap({ base: 600, f1: 1.2, f2: undefined }),
    );
    expect(r.scored).toBe(false);
    expect(r.premium).toBeUndefined();
    // running goes undefined from the missing factor onward
    expect(r.steps.map((s) => s.running)).toEqual([600, 720, undefined, undefined]);
  });

  it("honors a trailing finalOp (round)", () => {
    const { tower: t, nodes } = tower(
      [["base", "input"], ["f1", "lookup"], ["out", "output"]],
      ["multiply", "multiply"],
      "round",
    );
    const r = computeTowerBuildUp(t, nodes, fromMap({ base: 600, f1: 1.333 }));
    // 600 × 1.333 = 799.8 → round → 800
    expect(r.premium).toBe(800);
  });

  it("guards divide-by-zero (→ unscored, not Infinity)", () => {
    // entryOps[0] is the gap ABOVE `d`, so `divide` here folds the base by
    // d's value — exercising the zero guard (base ÷ 0 → undefined).
    const { tower: t, nodes } = tower(
      [["base", "input"], ["d", "math"], ["out", "output"]],
      ["divide", "multiply"],
    );
    const r = computeTowerBuildUp(t, nodes, fromMap({ base: 600, d: 0 }));
    expect(r.premium).toBeUndefined();
    expect(r.scored).toBe(false);
  });

  it("collapses (unscored) when a group entry is present (v1 doesn't expand)", () => {
    const nodes = new Map<string, TowerNode>([
      ["base", node("base", "input")],
      ["out", node("out", "output")],
    ]);
    const t: Tower = {
      id: "t",
      name: "T",
      outputField: "premium",
      entries: [
        { kind: "node", nodeId: "base" },
        { kind: "group", groupId: "g1" },
        { kind: "node", nodeId: "out" },
      ],
      entryOps: ["multiply", "multiply"],
    };
    const r = computeTowerBuildUp(t, nodes, fromMap({ base: 600 }));
    expect(r.scored).toBe(false);
  });

  it("ignores a trailing drop-slot entry", () => {
    const nodes = new Map<string, TowerNode>([
      ["base", node("base", "input")],
      ["out", node("out", "output")],
    ]);
    const t: Tower = {
      id: "t",
      name: "T",
      outputField: "premium",
      entries: [
        { kind: "node", nodeId: "base" },
        { kind: "node", nodeId: "out" },
        { kind: "drop-slot" },
      ],
      entryOps: ["multiply", "multiply"],
    };
    const r = computeTowerBuildUp(t, nodes, fromMap({ base: 600 }));
    expect(r.scored).toBe(true);
    expect(r.premium).toBe(600);
    expect(r.steps).toHaveLength(2); // drop-slot produced no step
  });
});
