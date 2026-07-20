/**
 * Runtime tests — compile + run end-to-end with stub kinds.
 *
 * THIS test registers minimal stubs (just enough to exercise compile +
 * run + topo + fan-in + as_of propagation) so the runtime's behavior
 * is verified independently of the kinds themselves.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  compilePlan,
  runPlan,
  executePlan,
  runPlanBatch,
  executePlanBatch,
} from "./runtime";
import {
  registerBlockKind,
  _clearRegistryForTests,
} from "./registry";
import type { BlockKind } from "./block-types";
import type { Plan } from "./plan-types";

// ── Stub kinds — minimum-viable for runtime test ────────────

const INPUT_KIND: BlockKind = {
  id: "input",
  category: "input",
  label: "Input",
  description: "External input substitution (special-cased by runtime)",
  inputs: [],
  outputs: [{ name: "value", type: "factor" }],
  defaultParams: {},
  defaultSize: "regular",
  execute: () => ({ value: undefined }),
};

const OUTPUT_KIND: BlockKind = {
  id: "output",
  category: "output",
  label: "Output",
  description: "Plan output (special-cased by runtime)",
  inputs: [{ name: "value", type: "factor" }],
  outputs: [],
  defaultParams: {},
  defaultSize: "regular",
  execute: () => ({}),
};

/** Multiplication: out = x * y */
const MUL_KIND: BlockKind = {
  id: "test.mul",
  category: "math",
  label: "Multiply",
  description: "out = x * y",
  inputs: [
    { name: "x", type: "factor" },
    { name: "y", type: "factor" },
  ],
  outputs: [{ name: "result", type: "factor" }],
  defaultParams: {},
  defaultSize: "regular",
  execute: (inputs) => {
    const { x, y } = inputs as { x: number; y: number };
    return { result: x * y };
  },
};

/** Cardinality 'N' sum: out = sum(values) */
const SUM_KIND: BlockKind = {
  id: "test.sum",
  category: "math",
  label: "Sum",
  description: "out = sum(values)",
  inputs: [{ name: "values", type: "factor", cardinality: "N" }],
  outputs: [{ name: "result", type: "factor" }],
  defaultParams: {},
  defaultSize: "regular",
  execute: (inputs) => {
    const { values } = inputs as { values: number[] };
    return { result: values.reduce((a, b) => a + b, 0) };
  },
};

/** Reads as_of from ctx, returns it as the output value. */
const ECHO_AS_OF_KIND: BlockKind = {
  id: "test.echo_as_of",
  category: "transform",
  label: "Echo as_of",
  description: "out = ctx.as_of",
  inputs: [],
  outputs: [{ name: "result", type: "string" }],
  defaultParams: {},
  defaultSize: "regular",
  execute: (_inputs, _params, ctx) => ({ result: ctx?.as_of }),
};

beforeEach(() => {
  _clearRegistryForTests();
  registerBlockKind(INPUT_KIND);
  registerBlockKind(OUTPUT_KIND);
  registerBlockKind(MUL_KIND);
  registerBlockKind(SUM_KIND);
  registerBlockKind(ECHO_AS_OF_KIND);
});

// ── compilePlan ─────────────────────────────────────────────

describe("compilePlan", () => {
  it("topologically orders a simple linear plan", () => {
    const plan: Plan = {
      id: "t.linear",
      version: "0.1.0",
      name: "linear",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "in_b", kind: "input", params: { fieldName: "b" } },
        { id: "m", kind: "test.mul", params: {} },
        { id: "out", kind: "output", params: { fieldName: "result" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "m", port: "x" } },
        { from: { node: "in_b", port: "value" }, to: { node: "m", port: "y" } },
        { from: { node: "m", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const compiled = compilePlan(plan);
    expect(compiled.topoOrder.length).toBe(4);
    // Inputs come first (in-degree 0), output last.
    expect(compiled.topoOrder.indexOf("in_a")).toBeLessThan(
      compiled.topoOrder.indexOf("m"),
    );
    expect(compiled.topoOrder.indexOf("m")).toBeLessThan(
      compiled.topoOrder.indexOf("out"),
    );
  });

  it("rejects a plan with an unknown kind", () => {
    const plan: Plan = {
      id: "t.unknown",
      version: "0.1.0",
      name: "unknown-kind",
      nodes: [{ id: "n1", kind: "not.a.real.kind", params: {} }],
      edges: [],
    };
    expect(() => compilePlan(plan)).toThrow(/Unknown block kind/);
  });

  it("rejects a plan with a cycle", () => {
    const plan: Plan = {
      id: "t.cycle",
      version: "0.1.0",
      name: "cycle",
      nodes: [
        { id: "a", kind: "test.mul", params: {} },
        { id: "b", kind: "test.mul", params: {} },
      ],
      edges: [
        { from: { node: "a", port: "result" }, to: { node: "b", port: "x" } },
        { from: { node: "b", port: "result" }, to: { node: "a", port: "x" } },
      ],
    };
    expect(() => compilePlan(plan)).toThrow(/cycle/);
  });

  it("rejects duplicate node ids", () => {
    const plan: Plan = {
      id: "t.dup",
      version: "0.1.0",
      name: "dup",
      nodes: [
        { id: "x", kind: "input", params: { fieldName: "a" } },
        { id: "x", kind: "input", params: { fieldName: "b" } },
      ],
      edges: [],
    };
    expect(() => compilePlan(plan)).toThrow(/Duplicate node id/);
  });

  it("rejects edges to missing nodes", () => {
    const plan: Plan = {
      id: "t.missing",
      version: "0.1.0",
      name: "missing",
      nodes: [{ id: "a", kind: "input", params: { fieldName: "a" } }],
      edges: [
        { from: { node: "a", port: "value" }, to: { node: "ghost", port: "x" } },
      ],
    };
    expect(() => compilePlan(plan)).toThrow(/not found/);
  });
});

// ── runPlan ─────────────────────────────────────────────────

describe("runPlan", () => {
  it("runs a linear plan and returns the correct output", () => {
    const plan: Plan = {
      id: "t.run",
      version: "0.1.0",
      name: "run",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "in_b", kind: "input", params: { fieldName: "b" } },
        { id: "m", kind: "test.mul", params: {} },
        { id: "out", kind: "output", params: { fieldName: "ab" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "m", port: "x" } },
        { from: { node: "in_b", port: "value" }, to: { node: "m", port: "y" } },
        { from: { node: "m", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { a: 6, b: 7 });
    expect(result.outputs.ab).toBe(42);
  });

  it("emits a per-node trace covering every node", () => {
    const plan: Plan = {
      id: "t.trace",
      version: "0.1.0",
      name: "trace",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "in_b", kind: "input", params: { fieldName: "b" } },
        { id: "m", kind: "test.mul", params: {} },
        { id: "out", kind: "output", params: { fieldName: "ab" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "m", port: "x" } },
        { from: { node: "in_b", port: "value" }, to: { node: "m", port: "y" } },
        { from: { node: "m", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { a: 6, b: 7 });
    for (const node of plan.nodes) {
      expect(result.trace[node.id]).toBeDefined();
    }
  });

  it("falls back to params.defaultValue when external input is missing", () => {
    const plan: Plan = {
      id: "t.default",
      version: "0.1.0",
      name: "default",
      nodes: [
        {
          id: "in_a",
          kind: "input",
          params: { fieldName: "missing", defaultValue: 99 },
        },
        { id: "out", kind: "output", params: { fieldName: "passthrough" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.outputs.passthrough).toBe(99);
  });

  it("supports cardinality 'N' fan-in", () => {
    const plan: Plan = {
      id: "t.fanin",
      version: "0.1.0",
      name: "fan-in",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "in_b", kind: "input", params: { fieldName: "b" } },
        { id: "in_c", kind: "input", params: { fieldName: "c" } },
        { id: "s", kind: "test.sum", params: {} },
        { id: "out", kind: "output", params: { fieldName: "sum" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "s", port: "values" } },
        { from: { node: "in_b", port: "value" }, to: { node: "s", port: "values" } },
        { from: { node: "in_c", port: "value" }, to: { node: "s", port: "values" } },
        { from: { node: "s", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { a: 1, b: 2, c: 3 });
    expect(result.outputs.sum).toBe(6);
  });

  it("reports duration in milliseconds", () => {
    const plan: Plan = {
      id: "t.dur",
      version: "0.1.0",
      name: "dur",
      nodes: [{ id: "in_a", kind: "input", params: { fieldName: "a" } }],
      edges: [],
    };
    const result = executePlan(plan, { a: 1 });
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── as_of propagation ──────────────────────────────────────

describe("as_of temporal anchor", () => {
  const PLAN: Plan = {
    id: "t.asof",
    version: "0.1.0",
    name: "asof",
    nodes: [
      { id: "echo", kind: "test.echo_as_of", params: {} },
      { id: "out", kind: "output", params: { fieldName: "anchor" } },
    ],
    edges: [
      { from: { node: "echo", port: "result" }, to: { node: "out", port: "value" } },
    ],
  };

  it("uses caller-supplied as_of verbatim", () => {
    const result = executePlan(PLAN, {}, { as_of: "2024-01-15" });
    expect(result.outputs.anchor).toBe("2024-01-15");
    expect(result.as_of).toBe("2024-01-15");
  });

  it("defaults to today (UTC YYYY-MM-DD) when omitted", () => {
    const result = executePlan(PLAN, {});
    expect(typeof result.as_of).toBe("string");
    expect(result.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.outputs.anchor).toBe(result.as_of);
  });

  it("resolves as_of ONCE per run (every node sees the same anchor)", () => {
    const plan: Plan = {
      id: "t.asof.multi",
      version: "0.1.0",
      name: "asof-multi",
      nodes: [
        { id: "echo1", kind: "test.echo_as_of", params: {} },
        { id: "echo2", kind: "test.echo_as_of", params: {} },
        { id: "out1", kind: "output", params: { fieldName: "a" } },
        { id: "out2", kind: "output", params: { fieldName: "b" } },
      ],
      edges: [
        { from: { node: "echo1", port: "result" }, to: { node: "out1", port: "value" } },
        { from: { node: "echo2", port: "result" }, to: { node: "out2", port: "value" } },
      ],
    };
    const result = executePlan(plan, {}, { as_of: "2026-05-19" });
    expect(result.outputs.a).toBe("2026-05-19");
    expect(result.outputs.b).toBe("2026-05-19");
  });
});

// ── batch mode ──────────────────────────────────────────────

describe("batch mode", () => {
  const PLAN: Plan = {
    id: "t.batch",
    version: "0.1.0",
    name: "batch",
    nodes: [
      { id: "in_a", kind: "input", params: { fieldName: "a" } },
      { id: "in_b", kind: "input", params: { fieldName: "b" } },
      { id: "m", kind: "test.mul", params: {} },
      { id: "out", kind: "output", params: { fieldName: "ab" } },
    ],
    edges: [
      { from: { node: "in_a", port: "value" }, to: { node: "m", port: "x" } },
      { from: { node: "in_b", port: "value" }, to: { node: "m", port: "y" } },
      { from: { node: "m", port: "result" }, to: { node: "out", port: "value" } },
    ],
  };

  it("runs N records and returns N results in order", () => {
    const portfolio = [
      { a: 2, b: 3 },
      { a: 4, b: 5 },
      { a: 6, b: 7 },
    ];
    const results = executePlanBatch(PLAN, portfolio);
    expect(results).toHaveLength(3);
    expect(results[0]!.outputs.ab).toBe(6);
    expect(results[1]!.outputs.ab).toBe(20);
    expect(results[2]!.outputs.ab).toBe(42);
  });

  it("shares one as_of across the entire batch", () => {
    const portfolio = [{ a: 1, b: 1 }, { a: 2, b: 2 }];
    const results = executePlanBatch(PLAN, portfolio, { as_of: "2026-05-19" });
    expect(results[0]!.as_of).toBe("2026-05-19");
    expect(results[1]!.as_of).toBe("2026-05-19");
  });

  it("runPlanBatch on a pre-compiled plan accepts the same shape", () => {
    const compiled = compilePlan(PLAN);
    const results = runPlanBatch(compiled, [{ a: 10, b: 10 }]);
    expect(results).toHaveLength(1);
    expect(results[0]!.outputs.ab).toBe(100);
  });
});

// ── runPlan signature (sanity check) ────────────────────────

describe("runPlan signature", () => {
  it("accepts a pre-compiled plan + external inputs", () => {
    const plan: Plan = {
      id: "t.sig",
      version: "0.1.0",
      name: "sig",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "out", kind: "output", params: { fieldName: "passthrough" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, { a: 42 });
    expect(result.outputs.passthrough).toBe(42);
  });
});

// ── Trace contract (enriched: kindId + citation + explanation + error)

describe("trace contract", () => {
  // Stub that throws on execute — used for partial-trace tests.
  const THROWS_KIND: BlockKind = {
    id: "test.throws",
    category: "math",
    label: "Throws",
    description: "always throws",
    inputs: [{ name: "x", type: "factor" }],
    outputs: [{ name: "result", type: "factor" }],
    defaultParams: {},
    defaultSize: "regular",
    execute: () => {
      throw new Error("intentional test failure");
    },
  };

  // Stub that carries a citation on the kind itself.
  const CITED_KIND: BlockKind = {
    id: "test.cited",
    category: "constant",
    label: "Cited constant",
    description: "constant with a citation",
    inputs: [],
    outputs: [{ name: "value", type: "factor" }],
    defaultParams: {},
    defaultSize: "regular",
    citation: "Meridian Rule MS-R5.2",
    execute: () => ({ value: 1.25 }),
  };

  // Stub that authors an explanation.
  const EXPLAINS_KIND: BlockKind = {
    id: "test.explains",
    category: "math",
    label: "Explains",
    description: "explains itself",
    inputs: [{ name: "x", type: "factor" }],
    outputs: [{ name: "result", type: "factor" }],
    defaultParams: {},
    defaultSize: "regular",
    execute: (inputs) => {
      const { x } = inputs as { x: number };
      return { result: x * 2 };
    },
    explainStep: (inputs, _params, outputs) => {
      const { x } = inputs as { x: number };
      const { result } = outputs as { result: number };
      return `Doubled ${x} → ${result}`;
    },
  };

  // Stub whose explainStep throws — must not crash the run.
  const EXPLAIN_THROWS_KIND: BlockKind = {
    id: "test.explain_throws",
    category: "math",
    label: "Explain throws",
    description: "execute is fine; explainStep throws",
    inputs: [],
    outputs: [{ name: "result", type: "factor" }],
    defaultParams: {},
    defaultSize: "regular",
    execute: () => ({ result: 1 }),
    explainStep: () => {
      throw new Error("intentional explain failure");
    },
  };

  beforeEach(() => {
    registerBlockKind(THROWS_KIND);
    registerBlockKind(CITED_KIND);
    registerBlockKind(EXPLAINS_KIND);
    registerBlockKind(EXPLAIN_THROWS_KIND);
  });

  it("every trace entry carries the kindId", () => {
    const plan: Plan = {
      id: "t.trace.kindid",
      version: "0.1.0",
      name: "kindid",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "m", kind: "test.mul", params: {} },
        { id: "out", kind: "output", params: { fieldName: "result" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "m", port: "x" } },
        { from: { node: "in_a", port: "value" }, to: { node: "m", port: "y" } },
        { from: { node: "m", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { a: 3 });
    expect(result.trace.in_a?.kindId).toBe("input");
    expect(result.trace.m?.kindId).toBe("test.mul");
    expect(result.trace.out?.kindId).toBe("output");
  });

  it("propagates kind-level citation to trace entries", () => {
    const plan: Plan = {
      id: "t.trace.cite_kind",
      version: "0.1.0",
      name: "cite-kind",
      nodes: [
        { id: "k", kind: "test.cited", params: {} },
        { id: "out", kind: "output", params: { fieldName: "v" } },
      ],
      edges: [
        { from: { node: "k", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.trace.k?.citation).toBe("Meridian Rule MS-R5.2");
  });

  it("node-level params.citation overrides kind-level citation", () => {
    const plan: Plan = {
      id: "t.trace.cite_override",
      version: "0.1.0",
      name: "cite-override",
      nodes: [
        {
          id: "k",
          kind: "test.cited",
          params: { citation: "Override · Internal memo 2026-01" },
        },
        { id: "out", kind: "output", params: { fieldName: "v" } },
      ],
      edges: [
        { from: { node: "k", port: "value" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.trace.k?.citation).toBe("Override · Internal memo 2026-01");
  });

  it("trace entry has no citation field when neither node nor kind sets one", () => {
    const plan: Plan = {
      id: "t.trace.no_cite",
      version: "0.1.0",
      name: "no-cite",
      nodes: [
        { id: "m", kind: "test.mul", params: {} },
        { id: "out", kind: "output", params: { fieldName: "result" } },
      ],
      edges: [
        { from: { node: "m", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    // test.mul has no citation; node has no params.citation either
    const result = executePlan(plan, {});
    expect("citation" in (result.trace.m ?? {})).toBe(false);
  });

  it("captures explainStep output on the trace entry", () => {
    const plan: Plan = {
      id: "t.trace.explain",
      version: "0.1.0",
      name: "explain",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "e", kind: "test.explains", params: {} },
        { id: "out", kind: "output", params: { fieldName: "doubled" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "e", port: "x" } },
        { from: { node: "e", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { a: 7 });
    expect(result.trace.e?.explanation).toBe("Doubled 7 → 14");
  });

  it("trace entry has no explanation when kind doesn't implement explainStep", () => {
    const plan: Plan = {
      id: "t.trace.no_explain",
      version: "0.1.0",
      name: "no-explain",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "m", kind: "test.mul", params: {} },
        { id: "out", kind: "output", params: { fieldName: "result" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "m", port: "x" } },
        { from: { node: "in_a", port: "value" }, to: { node: "m", port: "y" } },
        { from: { node: "m", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { a: 3 });
    expect("explanation" in (result.trace.m ?? {})).toBe(false);
  });

  it("a kind whose explainStep throws does not crash the run", () => {
    const plan: Plan = {
      id: "t.trace.bad_explain",
      version: "0.1.0",
      name: "bad-explain",
      nodes: [
        { id: "k", kind: "test.explain_throws", params: {} },
        { id: "out", kind: "output", params: { fieldName: "v" } },
      ],
      edges: [
        { from: { node: "k", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, {});
    // The run completed successfully + outputs are correct
    expect(result.outputs.v).toBe(1);
    // But no explanation was captured (silently dropped)
    expect("explanation" in (result.trace.k ?? {})).toBe(false);
  });
});

// ── Partial traces on execute failure ───────────────────────

describe("partial trace on failure", () => {
  // Re-declare here — beforeEach() at top level registers fresh
  // kinds each test, so we need this throwing kind back.
  const THROWS_KIND: BlockKind = {
    id: "test.throws",
    category: "math",
    label: "Throws",
    description: "always throws",
    inputs: [{ name: "x", type: "factor" }],
    outputs: [{ name: "result", type: "factor" }],
    defaultParams: {},
    defaultSize: "regular",
    execute: () => {
      throw new Error("intentional test failure");
    },
  };

  beforeEach(() => {
    registerBlockKind(THROWS_KIND);
  });

  it("captures the error message in the failing node's trace entry", () => {
    const plan: Plan = {
      id: "t.partial",
      version: "0.1.0",
      name: "partial",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "boom", kind: "test.throws", params: {} },
        { id: "out", kind: "output", params: { fieldName: "result" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "boom", port: "x" } },
        { from: { node: "boom", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { a: 3 });
    expect(result.trace.boom?.error?.message).toBe("intentional test failure");
    expect(result.trace.boom?.error?.at).toBe("execute");
    // The failing node's outputs are an empty object.
    expect(result.trace.boom?.outputs).toEqual({});
  });

  it("downstream nodes still execute, seeing undefined where the failed node would have produced output", () => {
    const plan: Plan = {
      id: "t.partial.downstream",
      version: "0.1.0",
      name: "partial-downstream",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "boom", kind: "test.throws", params: {} },
        { id: "out", kind: "output", params: { fieldName: "result" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "boom", port: "x" } },
        { from: { node: "boom", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, { a: 3 });
    // Downstream output node was still visited; its trace exists.
    expect(result.trace.out).toBeDefined();
    expect(result.trace.out?.kindId).toBe("output");
    // The collected output is undefined (the failed node's result didn't reach it).
    expect(result.outputs.result).toBeUndefined();
  });

  it("a successful sibling branch still produces correct outputs even when a parallel branch failed", () => {
    const plan: Plan = {
      id: "t.partial.sibling",
      version: "0.1.0",
      name: "partial-sibling",
      nodes: [
        { id: "in_a", kind: "input", params: { fieldName: "a" } },
        { id: "in_b", kind: "input", params: { fieldName: "b" } },
        { id: "boom", kind: "test.throws", params: {} },
        { id: "good", kind: "test.mul", params: {} },
        { id: "out_bad", kind: "output", params: { fieldName: "bad" } },
        { id: "out_good", kind: "output", params: { fieldName: "good" } },
      ],
      edges: [
        { from: { node: "in_a", port: "value" }, to: { node: "boom", port: "x" } },
        { from: { node: "boom", port: "result" }, to: { node: "out_bad", port: "value" } },
        { from: { node: "in_a", port: "value" }, to: { node: "good", port: "x" } },
        { from: { node: "in_b", port: "value" }, to: { node: "good", port: "y" } },
        { from: { node: "good", port: "result" }, to: { node: "out_good", port: "value" } },
      ],
    };
    const result = executePlan(plan, { a: 6, b: 7 });
    expect(result.outputs.bad).toBeUndefined();
    expect(result.outputs.good).toBe(42);
    expect(result.trace.boom?.error).toBeDefined();
    expect(result.trace.good?.error).toBeUndefined();
  });

  it("a kind that returns a non-Error throw still captures a string message", () => {
    const STRING_THROWS: BlockKind = {
      id: "test.throws_string",
      category: "math",
      label: "Throws string",
      description: "throws a non-Error value",
      inputs: [],
      outputs: [{ name: "result", type: "factor" }],
      defaultParams: {},
      defaultSize: "regular",
      // Deliberately throws a non-Error value to exercise the runtime's
      // error-normalisation path.
      execute: () => {
        throw "raw string failure";
      },
    };
    registerBlockKind(STRING_THROWS);
    const plan: Plan = {
      id: "t.partial.string",
      version: "0.1.0",
      name: "partial-string",
      nodes: [
        { id: "boom", kind: "test.throws_string", params: {} },
        { id: "out", kind: "output", params: { fieldName: "v" } },
      ],
      edges: [
        { from: { node: "boom", port: "result" }, to: { node: "out", port: "value" } },
      ],
    };
    const result = executePlan(plan, {});
    expect(result.trace.boom?.error?.message).toBe("raw string failure");
  });
});

/** Brief 83.4 — the port TYPE is the contract: wire strings coerce onto
 *  boolean/numeric input ports; everything unambiguous only. */
describe("input port coercion (Brief 83.4)", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    registerBlockKind(INPUT_KIND);
    registerBlockKind(OUTPUT_KIND);
  });

  const plan = (fieldType: string): Plan => ({
    id: "t.coerce",
    version: "0.1.0",
    name: "coerce",
    nodes: [
      { id: "in", kind: "input", params: { fieldName: "flag", fieldType } },
      { id: "out", kind: "output", params: { fieldName: "v" } },
    ],
    edges: [
      { from: { node: "in", port: "value" }, to: { node: "out", port: "value" } },
    ],
  });

  it("boolean port: string spellings coerce, junk passes through", () => {
    const compiled = compilePlan(plan("boolean"));
    expect(runPlan(compiled, { flag: "false" }).outputs.v).toBe(false);
    expect(runPlan(compiled, { flag: "true" }).outputs.v).toBe(true);
    expect(runPlan(compiled, { flag: "0" }).outputs.v).toBe(false);
    expect(runPlan(compiled, { flag: false }).outputs.v).toBe(false);
    expect(runPlan(compiled, { flag: "maybe" }).outputs.v).toBe("maybe");
  });

  it("money port: numeric strings coerce, junk passes through", () => {
    const compiled = compilePlan(plan("money"));
    expect(runPlan(compiled, { flag: "200000" }).outputs.v).toBe(200000);
    expect(runPlan(compiled, { flag: 200000 }).outputs.v).toBe(200000);
    expect(runPlan(compiled, { flag: "20k" }).outputs.v).toBe("20k");
  });

  it("string port: values pass through untouched", () => {
    const compiled = compilePlan(plan("string"));
    expect(runPlan(compiled, { flag: "false" }).outputs.v).toBe("false");
  });
});
