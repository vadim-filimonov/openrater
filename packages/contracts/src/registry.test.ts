/**
 * Registry tests — register / get / list / category-filter.
 *
 * Doesn't exercise execute() — that's the runtime test's job. These
 * tests just verify the registry's bookkeeping is correct.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  KindRegistry,
  globalRegistry,
  registerBlockKind,
  getBlockKind,
  listBlockKinds,
  listBlockKindsByCategory,
  findKindsAcceptingType,
  _clearRegistryForTests,
} from "./registry";
import { compilePlan, executePlan, runPlan } from "./runtime";
import type { BlockKind } from "./block-types";
import type { Plan } from "./plan-types";

function makeStubKind(
  id: string,
  category: BlockKind["category"] = "math",
): BlockKind {
  return {
    id,
    category,
    label: id,
    description: `stub kind ${id}`,
    inputs: [{ name: "x", type: "factor" }],
    outputs: [{ name: "result", type: "factor" }],
    defaultParams: {},
    defaultSize: "regular",
    execute: () => ({ result: 1.0 }),
  };
}

describe("registry", () => {
  beforeEach(() => {
    _clearRegistryForTests();
  });

  it("registers + retrieves a kind", () => {
    const k = makeStubKind("test.math");
    registerBlockKind(k);
    expect(getBlockKind("test.math")).toBe(k);
  });

  it("returns undefined for unregistered kinds (does NOT throw)", () => {
    expect(getBlockKind("not.registered")).toBeUndefined();
  });

  it("rejects duplicate registration with a clear error", () => {
    registerBlockKind(makeStubKind("test.dup"));
    expect(() => registerBlockKind(makeStubKind("test.dup"))).toThrow(
      /already registered/,
    );
  });

  it("listBlockKinds returns all registered kinds", () => {
    registerBlockKind(makeStubKind("a"));
    registerBlockKind(makeStubKind("b"));
    registerBlockKind(makeStubKind("c"));
    const all = listBlockKinds();
    expect(all).toHaveLength(3);
    expect(all.map((k) => k.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("listBlockKindsByCategory filters correctly", () => {
    registerBlockKind(makeStubKind("m1", "math"));
    registerBlockKind(makeStubKind("m2", "math"));
    registerBlockKind(makeStubKind("l1", "lookup"));
    expect(listBlockKindsByCategory("math")).toHaveLength(2);
    expect(listBlockKindsByCategory("lookup")).toHaveLength(1);
    expect(listBlockKindsByCategory("input")).toHaveLength(0);
  });

  it("findKindsAcceptingType matches the first input port", () => {
    const factorKind: BlockKind = {
      ...makeStubKind("takes.factor"),
      inputs: [{ name: "x", type: "factor" }],
    };
    const moneyKind: BlockKind = {
      ...makeStubKind("takes.money"),
      inputs: [{ name: "y", type: "money" }],
    };
    registerBlockKind(factorKind);
    registerBlockKind(moneyKind);

    const accepting = findKindsAcceptingType("factor");
    expect(accepting.map((k) => k.id)).toEqual(["takes.factor"]);
  });

  it("findKindsAcceptingType ignores composite types (v0 simple match only)", () => {
    const compositeKind: BlockKind = {
      ...makeStubKind("takes.optional.factor"),
      inputs: [{ name: "x", type: { kind: "optional", of: "factor" } }],
    };
    registerBlockKind(compositeKind);

    // Composite types don't match the simple v0 shape check
    expect(findKindsAcceptingType("factor")).toHaveLength(0);
  });
});

// ── KindRegistry — isolated instance API ─────────────────────

describe("KindRegistry (isolated instance)", () => {
  it("new KindRegistry() is empty", () => {
    const reg = new KindRegistry();
    expect(reg.list()).toHaveLength(0);
    expect(reg.get("any.id")).toBeUndefined();
  });

  it("each instance has its own kind set — no shared state", () => {
    const a = new KindRegistry();
    const b = new KindRegistry();

    a.register(makeStubKind("only.in.a"));
    b.register(makeStubKind("only.in.b"));

    expect(a.get("only.in.a")).toBeDefined();
    expect(a.get("only.in.b")).toBeUndefined();
    expect(b.get("only.in.a")).toBeUndefined();
    expect(b.get("only.in.b")).toBeDefined();
  });

  it("registering into an isolated registry does NOT affect the global", () => {
    _clearRegistryForTests();
    const reg = new KindRegistry();
    reg.register(makeStubKind("isolated.only"));

    expect(reg.get("isolated.only")).toBeDefined();
    expect(getBlockKind("isolated.only")).toBeUndefined();
    expect(globalRegistry.get("isolated.only")).toBeUndefined();
  });

  it("registerBlockKind() targets globalRegistry; instance.register() does not", () => {
    _clearRegistryForTests();
    const reg = new KindRegistry();
    registerBlockKind(makeStubKind("via.module.fn"));

    expect(globalRegistry.get("via.module.fn")).toBeDefined();
    expect(reg.get("via.module.fn")).toBeUndefined();
  });

  it("instance refuses duplicate registration just like the global", () => {
    const reg = new KindRegistry();
    reg.register(makeStubKind("dup.test"));
    expect(() => reg.register(makeStubKind("dup.test"))).toThrow(
      /already registered/,
    );
  });

  it("instance.clear() empties it but leaves the global alone", () => {
    _clearRegistryForTests();
    const reg = new KindRegistry();
    registerBlockKind(makeStubKind("in.global"));
    reg.register(makeStubKind("in.isolated"));

    reg.clear();
    expect(reg.list()).toHaveLength(0);
    // Global is untouched
    expect(getBlockKind("in.global")).toBeDefined();
  });

  it("listByCategory + findAcceptingType work on isolated instances", () => {
    const reg = new KindRegistry();
    reg.register(makeStubKind("m1", "math"));
    // Distinguish l1 by its input type so findAcceptingType filters it out
    reg.register({
      ...makeStubKind("l1", "lookup"),
      inputs: [{ name: "k", type: "class_code" }],
    });
    expect(reg.listByCategory("math")).toHaveLength(1);
    expect(reg.listByCategory("math")[0]?.id).toBe("m1");
    expect(reg.listByCategory("lookup")).toHaveLength(1);
    // Only m1 takes factor on its first port
    expect(reg.findAcceptingType("factor").map((k) => k.id)).toEqual(["m1"]);
    expect(reg.findAcceptingType("class_code").map((k) => k.id)).toEqual([
      "l1",
    ]);
  });
});

// ── compilePlan with an isolated registry ───────────────────

describe("compilePlan + runPlan honor an isolated registry", () => {
  function makeInput(): BlockKind {
    return {
      id: "input",
      category: "input",
      label: "Input",
      description: "stub input",
      inputs: [],
      outputs: [{ name: "value", type: "factor" }],
      defaultParams: {},
      defaultSize: "regular",
      execute: () => ({ value: undefined }),
    };
  }

  function makeOutput(): BlockKind {
    return {
      id: "output",
      category: "output",
      label: "Output",
      description: "stub output",
      inputs: [{ name: "value", type: "factor" }],
      outputs: [],
      defaultParams: {},
      defaultSize: "regular",
      execute: () => ({}),
    };
  }

  function makeDouble(): BlockKind {
    return {
      id: "test.double",
      category: "math",
      label: "Double",
      description: "doubles x",
      inputs: [{ name: "x", type: "factor" }],
      outputs: [{ name: "result", type: "factor" }],
      defaultParams: {},
      defaultSize: "regular",
      execute: (inputs) => {
        const { x } = inputs as { x: number };
        return { result: x * 2 };
      },
    };
  }

  const PLAN: Plan = {
    id: "isolation.test",
    version: "0.1.0",
    name: "iso",
    nodes: [
      { id: "in_x", kind: "input", params: { fieldName: "x" } },
      { id: "d", kind: "test.double", params: {} },
      { id: "out", kind: "output", params: { fieldName: "doubled" } },
    ],
    edges: [
      { from: { node: "in_x", port: "value" }, to: { node: "d", port: "x" } },
      { from: { node: "d", port: "result" }, to: { node: "out", port: "value" } },
    ],
  };

  it("a plan compiles + runs against an isolated registry without touching the global", () => {
    _clearRegistryForTests();
    // Global is empty; the plan would fail against it.
    const isolated = new KindRegistry();
    isolated.register(makeInput());
    isolated.register(makeOutput());
    isolated.register(makeDouble());

    const compiled = compilePlan(PLAN, isolated);
    expect(compiled.registry).toBe(isolated);
    const result = executePlan(PLAN, { x: 21 }, undefined, isolated);
    expect(result.outputs.doubled).toBe(42);
    // Global still empty.
    expect(globalRegistry.list()).toHaveLength(0);
  });

  it("the same plan FAILS to compile against an empty global", () => {
    _clearRegistryForTests();
    expect(() => compilePlan(PLAN)).toThrow(/Unknown block kind/);
  });

  it("CompiledPlan.registry pins the kind set — subsequent global mutations don't affect runs", () => {
    _clearRegistryForTests();
    const isolated = new KindRegistry();
    isolated.register(makeInput());
    isolated.register(makeOutput());
    isolated.register(makeDouble());

    // Compile ONCE against the isolated registry — this binds it.
    const compiled = compilePlan(PLAN, isolated);
    expect(compiled.registry).toBe(isolated);

    // Now register a DIFFERENT version of test.double into the global.
    // If runPlan used the global, this would produce 21000 instead of 42.
    const globalDouble: BlockKind = {
      ...makeDouble(),
      execute: (inputs) => {
        const { x } = inputs as { x: number };
        return { result: x * 1000 };
      },
    };
    registerBlockKind(makeInput());
    registerBlockKind(makeOutput());
    registerBlockKind(globalDouble);

    // Run the previously-compiled plan — must use the isolated registry,
    // not the now-polluted global.
    const result = runPlan(compiled, { x: 21 });
    expect(result.outputs.doubled).toBe(42);
  });
});
