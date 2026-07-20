/**
 * `diffTraces` tests (M1.5, Brief 12).
 */

import { describe, it, expect } from "vitest";
import { diffTraces } from "./diff-traces";
import type { TraceEntry } from "../plan-types";

function entry(
  kindId: string,
  outputs: Record<string, unknown>,
  extras: Partial<TraceEntry> = {},
): TraceEntry {
  return {
    kindId,
    inputs: {},
    outputs,
    ...extras,
  };
}

describe("diffTraces — identity", () => {
  it("returns unchanged for identical traces", () => {
    const a = {
      step1: entry("constant", { value: 1.20 }),
      step2: entry("output", {}),
    };
    const result = diffTraces(a, a);
    expect(result.tree.state).toBe("unchanged");
    expect(result.firstDivergingNodeId).toBeNull();
    expect(result.summary.changed).toBe(0);
  });

  it("is deterministic — same inputs produce identical JSON", () => {
    const a = { step1: entry("constant", { value: 5 }) };
    const b = { step1: entry("constant", { value: 7 }) };
    const r1 = JSON.stringify(diffTraces(a, b));
    const r2 = JSON.stringify(diffTraces(a, b));
    expect(r1).toBe(r2);
  });
});

describe("diffTraces — first-divergence detection", () => {
  it("marks the first diverging step", () => {
    const a = {
      step1: entry("constant", { value: 1 }),
      step2: entry("math.op", { result: 2 }),
      step3: entry("output", {}),
    };
    const b = {
      step1: entry("constant", { value: 1 }),
      step2: entry("math.op", { result: 99 }), // diverges here
      step3: entry("output", {}),
    };
    const result = diffTraces(a, b);
    expect(result.firstDivergingNodeId).toBe("step2");
    expect(result.summary.changed).toBeGreaterThan(0);
  });

  it("returns null when traces are identical", () => {
    const a = { s: entry("constant", { value: 1 }) };
    expect(diffTraces(a, a).firstDivergingNodeId).toBeNull();
  });

  it("citation/explanation differences don't count as outputs divergence", () => {
    const a = {
      s1: entry("constant", { value: 1 }, { citation: "Meridian Rule MS-R1" }),
    };
    const b = {
      s1: entry("constant", { value: 1 }, { citation: "Meridian Rule MS-R2" }),
    };
    const result = diffTraces(a, b);
    // The diff is still "changed" overall (citation differs) but
    // the outputs are unchanged → first-divergence remains null
    expect(result.firstDivergingNodeId).toBeNull();
    expect(result.summary.changed).toBeGreaterThan(0);
  });

  it("picks the lexicographically-first diverging step", () => {
    // Multiple divergences — first-divergence should be the lex-min
    // node id among divergences.
    const a = {
      bbb: entry("op", { v: 1 }),
      aaa: entry("op", { v: 1 }),
    };
    const b = {
      bbb: entry("op", { v: 999 }),
      aaa: entry("op", { v: 999 }),
    };
    const result = diffTraces(a, b);
    expect(result.firstDivergingNodeId).toBe("aaa");
  });
});

describe("diffTraces — rate impact on outputs", () => {
  it("attaches rate_impact to numeric output diff leaves", () => {
    const a = { step: entry("op", { value: 100 }) };
    const b = { step: entry("op", { value: 110 }) };
    const result = diffTraces(a, b);
    const stepDiff = result.tree.children?.find((c) => c.label === "Step 'step'");
    const outputsField = stepDiff?.children?.find((c) => c.label === "outputs");
    const valueLeaf = outputsField?.children?.find((c) => c.label === "value");
    expect(valueLeaf?.rate_impact?.dollars).toBe(10);
    expect(valueLeaf?.rate_impact?.pct).toBeCloseTo(10, 4);
  });

  it("rate_impact.pct is 0 when A's value is 0 (no divide-by-zero)", () => {
    const a = { step: entry("op", { value: 0 }) };
    const b = { step: entry("op", { value: 5 }) };
    const result = diffTraces(a, b);
    const stepDiff = result.tree.children?.[0];
    const outputsField = stepDiff?.children?.find((c) => c.label === "outputs");
    const valueLeaf = outputsField?.children?.find((c) => c.label === "value");
    expect(valueLeaf?.rate_impact?.dollars).toBe(5);
    expect(valueLeaf?.rate_impact?.pct).toBe(0);
  });

  it("no rate_impact for non-numeric outputs", () => {
    const a = { step: entry("op", { tag: "old" }) };
    const b = { step: entry("op", { tag: "new" }) };
    const result = diffTraces(a, b);
    const stepDiff = result.tree.children?.[0];
    const outputsField = stepDiff?.children?.find((c) => c.label === "outputs");
    const valueLeaf = outputsField?.children?.find((c) => c.label === "tag");
    expect(valueLeaf?.rate_impact).toBeUndefined();
  });
});

describe("diffTraces — topoOrder option (M1.5 polish)", () => {
  it("uses topoOrder for first-divergence detection when provided", () => {
    // Lex order: aaa < bbb. Topological order: bbb first, aaa second.
    // Both steps diverge. Without topoOrder → firstDiv = aaa.
    // With topoOrder = ["bbb", "aaa"] → firstDiv = bbb.
    const a = {
      bbb: entry("op", { v: 1 }),
      aaa: entry("op", { v: 1 }),
    };
    const b = {
      bbb: entry("op", { v: 999 }),
      aaa: entry("op", { v: 999 }),
    };
    const lex = diffTraces(a, b);
    const topo = diffTraces(a, b, undefined, { topoOrder: ["bbb", "aaa"] });
    expect(lex.firstDivergingNodeId).toBe("aaa");
    expect(topo.firstDivergingNodeId).toBe("bbb");
  });

  it("falls back to lex order when topoOrder is empty", () => {
    const a = { bbb: entry("op", { v: 1 }), aaa: entry("op", { v: 1 }) };
    const b = { bbb: entry("op", { v: 9 }), aaa: entry("op", { v: 9 }) };
    const result = diffTraces(a, b, undefined, { topoOrder: [] });
    // Empty topoOrder → no steps "in topo" → all appended to tail
    // (lex sorted) → firstDiv is lex-first
    expect(result.firstDivergingNodeId).toBe("aaa");
  });

  it("appends steps not present in topoOrder (preserves completeness)", () => {
    // topoOrder only mentions "first"; trace has additional step "second"
    const a = { first: entry("op", { v: 1 }), second: entry("op", { v: 1 }) };
    const b = { first: entry("op", { v: 1 }), second: entry("op", { v: 9 }) };
    const result = diffTraces(a, b, undefined, { topoOrder: ["first"] });
    // "second" diverges; "first" doesn't. firstDiv should be "second".
    expect(result.firstDivergingNodeId).toBe("second");
    // Both steps should appear in the tree
    const stepIds = result.tree.children?.map((c) => c.path.replace("trace.", ""));
    expect(stepIds).toContain("first");
    expect(stepIds).toContain("second");
  });

  it("preserves topo position for tree ordering when topoOrder is supplied", () => {
    const a = { z: entry("op", { v: 1 }), a: entry("op", { v: 2 }) };
    const b = { z: entry("op", { v: 1 }), a: entry("op", { v: 2 }) };
    const result = diffTraces(a, b, undefined, { topoOrder: ["z", "a"] });
    // Children should be in topoOrder, not lex
    expect(result.tree.children?.[0]?.path).toBe("trace.z");
    expect(result.tree.children?.[1]?.path).toBe("trace.a");
  });

  it("is still deterministic with topoOrder (same input → same JSON)", () => {
    const a = { x: entry("op", { v: 1 }), y: entry("op", { v: 2 }) };
    const b = { x: entry("op", { v: 9 }), y: entry("op", { v: 8 }) };
    const opts = { topoOrder: ["y", "x"] };
    const r1 = JSON.stringify(diffTraces(a, b, undefined, opts));
    const r2 = JSON.stringify(diffTraces(a, b, undefined, opts));
    expect(r1).toBe(r2);
  });
});

describe("diffTraces — added/removed steps", () => {
  it("detects an added step in B", () => {
    const a = { s1: entry("op", { v: 1 }) };
    const b = { s1: entry("op", { v: 1 }), s2: entry("op", { v: 2 }) };
    const result = diffTraces(a, b);
    expect(result.summary.added).toBe(1);
    const s2 = result.tree.children?.find((c) => c.path === "trace.s2");
    expect(s2?.state).toBe("added");
  });

  it("detects a removed step in B", () => {
    const a = { s1: entry("op", { v: 1 }), s2: entry("op", { v: 2 }) };
    const b = { s1: entry("op", { v: 1 }) };
    const result = diffTraces(a, b);
    expect(result.summary.removed).toBe(1);
    const s2 = result.tree.children?.find((c) => c.path === "trace.s2");
    expect(s2?.state).toBe("removed");
  });
});
