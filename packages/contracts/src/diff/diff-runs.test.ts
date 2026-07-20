/**
 * `diffRuns` tests (M1.5, Brief 12).
 */

import { describe, it, expect } from "vitest";
import { diffRuns } from "./diff-runs";
import type { RunResult } from "../plan-types";

function makeRun(
  outputs: Record<string, unknown>,
  trace: Record<string, unknown> = {},
): RunResult {
  return {
    outputs,
    trace: trace as RunResult["trace"],
    startedAt: 0,
    durationMs: 1,
    as_of: "2026-05-20",
    row_status: "ok",
  };
}

describe("diffRuns — identity", () => {
  it("returns no impact for identical runs", () => {
    const r = makeRun(
      { total_premium: 5000 },
      { step1: { kindId: "constant", inputs: {}, outputs: { value: 5000 } } },
    );
    const result = diffRuns(r, r);
    expect(result.total_impact).toEqual({ dollars: 0, pct: 0 });
    expect(result.summary.changed).toBe(0);
    expect(result.trace.firstDivergingNodeId).toBeNull();
  });
});

describe("diffRuns — outputs comparison", () => {
  it("detects a total_premium change", () => {
    const a = makeRun({ total_premium: 5000 });
    const b = makeRun({ total_premium: 5500 });
    const result = diffRuns(a, b);
    expect(result.total_impact?.dollars).toBe(500);
    expect(result.total_impact?.pct).toBeCloseTo(10, 4);
  });

  it("returns null total_impact when one side lacks total_premium", () => {
    const a = makeRun({ other_field: 100 });
    const b = makeRun({ total_premium: 5500 });
    expect(diffRuns(a, b).total_impact).toBeNull();
  });

  it("returns null total_impact when total_premium is non-numeric", () => {
    const a = makeRun({ total_premium: "5000" });
    const b = makeRun({ total_premium: 5500 });
    expect(diffRuns(a, b).total_impact).toBeNull();
  });

  it("decorates output leaves with rate_impact when numeric", () => {
    const a = makeRun({ liability_premium: 1000, property_premium: 2000 });
    const b = makeRun({ liability_premium: 1100, property_premium: 1900 });
    const result = diffRuns(a, b);
    const liabLeaf = result.outputs.children?.find(
      (c) => c.label === "liability_premium",
    );
    const propLeaf = result.outputs.children?.find(
      (c) => c.label === "property_premium",
    );
    expect(liabLeaf?.rate_impact?.dollars).toBe(100);
    expect(propLeaf?.rate_impact?.dollars).toBe(-100);
  });
});

describe("diffRuns — trace integration", () => {
  it("delegates trace diffing to diffTraces (first-divergence works)", () => {
    const a = makeRun(
      { total_premium: 1000 },
      {
        step1: { kindId: "op", inputs: {}, outputs: { x: 5 } },
        step2: { kindId: "op", inputs: {}, outputs: { x: 10 } },
      },
    );
    const b = makeRun(
      { total_premium: 1200 },
      {
        step1: { kindId: "op", inputs: {}, outputs: { x: 5 } },
        step2: { kindId: "op", inputs: {}, outputs: { x: 99 } },
      },
    );
    const result = diffRuns(a, b);
    expect(result.trace.firstDivergingNodeId).toBe("step2");
    expect(result.total_impact?.dollars).toBe(200);
  });
});

describe("diffRuns — topoOrder forwarding (M1.5 polish)", () => {
  it("forwards topoOrder to diffTraces", () => {
    const a = makeRun(
      { total_premium: 100 },
      {
        bbb: { kindId: "op", inputs: {}, outputs: { v: 1 } },
        aaa: { kindId: "op", inputs: {}, outputs: { v: 1 } },
      },
    );
    const b = makeRun(
      { total_premium: 200 },
      {
        bbb: { kindId: "op", inputs: {}, outputs: { v: 9 } },
        aaa: { kindId: "op", inputs: {}, outputs: { v: 9 } },
      },
    );
    const lex = diffRuns(a, b);
    const topo = diffRuns(a, b, undefined, { topoOrder: ["bbb", "aaa"] });
    expect(lex.trace.firstDivergingNodeId).toBe("aaa");
    expect(topo.trace.firstDivergingNodeId).toBe("bbb");
  });
});

describe("diffRuns — summary aggregation", () => {
  it("counts both outputs and trace deltas", () => {
    const a = makeRun(
      { total_premium: 1000, other: 50 },
      { step1: { kindId: "op", inputs: {}, outputs: { x: 1 } } },
    );
    const b = makeRun(
      { total_premium: 1100, other: 60 },
      { step1: { kindId: "op", inputs: {}, outputs: { x: 2 } } },
    );
    const result = diffRuns(a, b);
    // Both output keys changed + the trace step's output changed
    expect(result.summary.changed).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic — repeat calls produce identical JSON", () => {
    const a = makeRun({ p: 100 }, { s: { kindId: "k", inputs: {}, outputs: {} } });
    const b = makeRun({ p: 200 }, { s: { kindId: "k", inputs: {}, outputs: {} } });
    expect(JSON.stringify(diffRuns(a, b))).toBe(JSON.stringify(diffRuns(a, b)));
  });
});
