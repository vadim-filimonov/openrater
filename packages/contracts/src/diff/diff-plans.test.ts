/**
 * `diffPlans` tests (M1.5, Brief 12).
 */

import { describe, it, expect } from "vitest";
import { diffPlans, diffValue } from "./diff-plans";
import type { Plan } from "../plan-types";
import type { DiffNode } from "./types";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "test.plan",
    version: "0.1.0",
    name: "Test plan",
    nodes: [],
    edges: [],
    ...overrides,
  };
}

describe("diffPlans — identity case", () => {
  it("returns unchanged for two identical plans", () => {
    const p = makePlan({
      nodes: [{ id: "n1", kind: "constant", params: { value: 1 } }],
      edges: [
        { from: { node: "n1", port: "value" }, to: { node: "out", port: "x" } },
      ],
    });
    const result = diffPlans(p, p);
    expect(result.tree.state).toBe("unchanged");
    expect(result.summary.changed).toBe(0);
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
  });

  it("returns identical output on repeated calls (determinism)", () => {
    const a = makePlan({ name: "A" });
    const b = makePlan({ name: "B" });
    const r1 = JSON.stringify(diffPlans(a, b));
    const r2 = JSON.stringify(diffPlans(a, b));
    expect(r1).toBe(r2);
  });
});

describe("diffPlans — primitive field changes", () => {
  it("detects a top-level name change", () => {
    const a = makePlan({ name: "Plan A" });
    const b = makePlan({ name: "Plan B" });
    const result = diffPlans(a, b);
    expect(result.tree.state).toBe("changed");
    expect(result.summary.changed).toBeGreaterThanOrEqual(1);
    const nameNode = result.tree.children?.find((c) => c.path === "name");
    expect(nameNode?.state).toBe("changed");
    expect(nameNode?.a_value).toBe("Plan A");
    expect(nameNode?.b_value).toBe("Plan B");
  });

  it("detects a version change", () => {
    const a = makePlan({ version: "1.0.0" });
    const b = makePlan({ version: "1.1.0" });
    const result = diffPlans(a, b);
    expect(result.summary.changed).toBeGreaterThanOrEqual(1);
    const versionNode = result.tree.children?.find((c) => c.path === "version");
    expect(versionNode?.state).toBe("changed");
  });

  it("detects a changed top-level scalar field (line)", () => {
    // `line` is an opaque metadata shim; the diff is structural and
    // field-agnostic — it reports the change regardless of which field.
    const a = makePlan({ line: "bop" });
    const b = makePlan({ line: "cgl" });
    const result = diffPlans(a, b);
    const lineNode = result.tree.children?.find((c) => c.path === "line");
    expect(lineNode?.state).toBe("changed");
  });
});

describe("diffPlans — nodes diff", () => {
  it("detects an added node", () => {
    const a = makePlan({ nodes: [] });
    const b = makePlan({
      nodes: [{ id: "new", kind: "constant", params: { value: 1 } }],
    });
    const result = diffPlans(a, b);
    expect(result.summary.added).toBeGreaterThan(0);
    const nodes = result.tree.children?.find((c) => c.path === "nodes");
    const added = nodes?.children?.find((c) => c.path === "nodes.new");
    expect(added?.state).toBe("added");
  });

  it("detects a removed node", () => {
    const a = makePlan({
      nodes: [{ id: "gone", kind: "constant", params: { value: 1 } }],
    });
    const b = makePlan({ nodes: [] });
    const result = diffPlans(a, b);
    expect(result.summary.removed).toBeGreaterThan(0);
    const nodes = result.tree.children?.find((c) => c.path === "nodes");
    const removed = nodes?.children?.find((c) => c.path === "nodes.gone");
    expect(removed?.state).toBe("removed");
  });

  it("detects a changed node param value", () => {
    const a = makePlan({
      nodes: [{ id: "n1", kind: "constant", params: { value: 1.20 } }],
    });
    const b = makePlan({
      nodes: [{ id: "n1", kind: "constant", params: { value: 1.35 } }],
    });
    const result = diffPlans(a, b);
    expect(result.summary.changed).toBeGreaterThan(0);
  });

  it("does NOT suppress tiny float deltas (regulator-grade)", () => {
    const a = makePlan({
      nodes: [{ id: "n1", kind: "constant", params: { value: 1.0001 } }],
    });
    const b = makePlan({
      nodes: [{ id: "n1", kind: "constant", params: { value: 1.0002 } }],
    });
    const result = diffPlans(a, b);
    expect(result.summary.changed).toBeGreaterThan(0);
  });
});

describe("diffPlans — edges diff", () => {
  it("detects an added edge", () => {
    const a = makePlan({ edges: [] });
    const b = makePlan({
      edges: [
        { from: { node: "src", port: "v" }, to: { node: "dst", port: "x" } },
      ],
    });
    const result = diffPlans(a, b);
    expect(result.summary.added).toBeGreaterThan(0);
  });

  it("detects a removed edge", () => {
    const edge = {
      from: { node: "src", port: "v" },
      to: { node: "dst", port: "x" },
    };
    const a = makePlan({ edges: [edge] });
    const b = makePlan({ edges: [] });
    const result = diffPlans(a, b);
    expect(result.summary.removed).toBeGreaterThan(0);
  });

  it("reordered edges produce unchanged diff (canonical sorting)", () => {
    const e1 = {
      from: { node: "a", port: "v" },
      to: { node: "b", port: "x" },
    };
    const e2 = {
      from: { node: "c", port: "v" },
      to: { node: "d", port: "x" },
    };
    const planA = makePlan({ edges: [e1, e2] });
    const planB = makePlan({ edges: [e2, e1] });
    const result = diffPlans(planA, planB);
    expect(result.tree.state).toBe("unchanged");
  });
});

describe("diffPlans — sides metadata", () => {
  it("echoes sides labels through to the result", () => {
    const a = makePlan();
    const b = makePlan();
    const result = diffPlans(a, b, {
      a: { version: 1, label: "v1 filed" },
      b: { version: 2, label: "v2 draft" },
    });
    expect(result.a.label).toBe("v1 filed");
    expect(result.b.version).toBe(2);
  });
});

describe("diffValue — generic walker", () => {
  it("handles deep objects", () => {
    const node = diffValue(
      "root",
      "root",
      { a: { b: { c: 1 } } },
      { a: { b: { c: 2 } } },
    );
    expect(node.state).toBe("changed");
    // The leaf at root.a.b.c should be changed
    let cursor: DiffNode | undefined = node;
    for (const k of ["a", "b", "c"]) {
      cursor = cursor?.children?.find((ch) => ch.label === k);
    }
    expect(cursor?.state).toBe("changed");
    expect(cursor?.a_value).toBe(1);
    expect(cursor?.b_value).toBe(2);
  });

  it("handles arrays positionally", () => {
    const node = diffValue("root", "root", [1, 2, 3], [1, 9, 3]);
    expect(node.state).toBe("changed");
    const second = node.children?.[1];
    expect(second?.state).toBe("changed");
    expect(second?.a_value).toBe(2);
    expect(second?.b_value).toBe(9);
  });

  it("treats NaN === NaN as equal", () => {
    const node = diffValue("root", "root", NaN, NaN);
    expect(node.state).toBe("unchanged");
  });

  it("returns unchanged for two identical primitives", () => {
    expect(diffValue("p", "p", 42, 42).state).toBe("unchanged");
    expect(diffValue("p", "p", "hello", "hello").state).toBe("unchanged");
  });

  it("returns added when a is undefined", () => {
    const r = diffValue("p", "p", undefined, "new");
    expect(r.state).toBe("added");
    expect(r.b_value).toBe("new");
  });

  it("returns removed when b is undefined", () => {
    const r = diffValue("p", "p", "old", undefined);
    expect(r.state).toBe("removed");
    expect(r.a_value).toBe("old");
  });
});
