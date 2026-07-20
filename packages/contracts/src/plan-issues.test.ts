/**
 * Structured row issues and unknown-key policy tests.
 *
 * Pins the engine half of "refuse or resolve, never improvise":
 *   · onMiss error → RowIssueError → row_status "error", premium withheld
 *   · onMiss default(x) → visible warning, authored value applies
 *   · onMiss refer → 1.0 indicative + eligibility escalates to submit
 *   · absent onMiss → LEGACY defaultValue (raw-engine back-compat)
 *   · derive enrichers (territory/class-attr/band) report warnings
 *   · the unresolved-output backstop withholds NaN/undefined numerics
 *   · policy-book: an error row poisons its policy (composed withheld,
 *     row_errors surfaced); one bad row never aborts the batch
 */

import { describe, it, expect, beforeAll } from "vitest";

import type { Plan } from "./plan-types";
import { executePlan, runPlanBatch, compilePlan } from "./runtime";
import { registerBuiltinKinds } from "./kinds";
import { _clearRegistryForTests } from "./registry";
import { evaluatePolicyBook } from "./policy-book";
import { RowIssueError, resolveLookupMiss } from "./plan-issues";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** base 100 × class_rel(class_code), with the given onMiss policy. */
function lookupPlan(onMiss?: unknown): Plan {
  return {
    id: "t.issues",
    version: "1.0.0",
    name: "issues test",
    effective: "2026-01-01",
    nodes: [
      {
        id: "in_cls",
        kind: "input",
        params: { fieldName: "class_code", fieldType: "string" },
      },
      {
        id: "const_base",
        kind: "constant",
        params: { value: 100, type: "money" },
      },
      {
        id: "lkp",
        kind: "lookup.direct",
        params: {
          table: { "c202": 1.25 },
          defaultValue: 1.0,
          tableName: "class_rel",
          keySource: "class_code",
          ...(onMiss !== undefined ? { onMiss } : {}),
        },
      },
      {
        id: "chain",
        kind: "chain.mult",
        params: { factorNames: ["class_rel"], stopOnZero: false },
      },
      {
        id: "out_p",
        kind: "output",
        params: { fieldName: "premium", fieldType: "money" },
      },
    ],
    edges: [
      { from: { node: "in_cls", port: "value" }, to: { node: "lkp", port: "key" } },
      { from: { node: "const_base", port: "value" }, to: { node: "chain", port: "base" } },
      { from: { node: "lkp", port: "value" }, to: { node: "chain", port: "factors" } },
      { from: { node: "chain", port: "result" }, to: { node: "out_p", port: "value" } },
    ],
  } as unknown as Plan;
}

const OPTS = { as_of: "2024-01-01" };

describe("onMiss policies", () => {
  it("known key rates normally under every policy", () => {
    for (const onMiss of [
      undefined,
      { mode: "error" },
      { mode: "default", value: 2 },
      { mode: "refer" },
    ]) {
      const r = executePlan(lookupPlan(onMiss), { class_code: "c202" }, OPTS);
      expect(r.outputs.premium).toBe(125);
      expect(r.row_status).toBe("ok");
      expect(r.issues).toBeUndefined();
    }
  });

  it("an absent policy uses the configured defaultValue", () => {
    const r = executePlan(lookupPlan(undefined), { class_code: "c999" }, OPTS);
    expect(r.outputs.premium).toBe(100);
    expect(r.row_status).toBe("ok");
    expect(r.issues).toBeUndefined();
  });

  it("error policy refuses the row: no premium, structured unknown_key, trace carries the seed", () => {
    const r = executePlan(
      lookupPlan({ mode: "error" }),
      { class_code: "c999" },
      OPTS,
    );
    expect(r.row_status).toBe("error");
    expect(r.outputs).not.toHaveProperty("premium"); // withheld, not NaN
    const codes = (r.issues ?? []).map((i) => `${i.nodeId}:${i.code}`);
    expect(codes).toContain("lkp:unknown_key");
    expect(codes).toContain("out_p:unresolved_output");
    // The lookup's trace entry carries both the error and the seed.
    expect(r.trace["lkp"]?.error?.message).toMatch(/c999/);
    expect(r.trace["lkp"]?.issues?.[0]?.code).toBe("unknown_key");
    expect(r.trace["lkp"]?.issues?.[0]?.detail?.field).toBe("class_code");
  });

  it("a MISSING input under error policy names the field (missing_input)", () => {
    const r = executePlan(lookupPlan({ mode: "error" }), {}, OPTS);
    expect(r.row_status).toBe("error");
    const miss = (r.issues ?? []).find((i) => i.nodeId === "lkp");
    expect(miss?.code).toBe("missing_input");
    expect(miss?.detail?.field).toBe("class_code");
  });

  it("default(x) policy applies the authored value with a visible warning", () => {
    const r = executePlan(
      lookupPlan({ mode: "default", value: 1.5 }),
      { class_code: "c999" },
      OPTS,
    );
    expect(r.outputs.premium).toBe(150);
    expect(r.row_status).toBe("ok");
    const w = (r.issues ?? []).find((i) => i.code === "unknown_key_defaulted");
    expect(w?.severity).toBe("warning");
    expect(w?.detail?.appliedValue).toBe(1.5);
  });

  it("refer policy rates 1.0 indicative and escalates eligibility to submit", () => {
    const r = executePlan(
      lookupPlan({ mode: "refer" }),
      { class_code: "c999" },
      OPTS,
    );
    expect(r.outputs.premium).toBe(100);
    expect(r.row_status).toBe("ok");
    expect(r.eligibility_tier).toBe("submit");
    const w = (r.issues ?? []).find((i) => i.code === "unknown_key_referred");
    expect(w?.severity).toBe("warning");
  });

  it("one poisoned row never aborts the batch", () => {
    const compiled = compilePlan(lookupPlan({ mode: "error" }));
    const rows = [
      { class_code: "c202" },
      { class_code: "c999" },
      { class_code: "c202" },
    ];
    const results = runPlanBatch(compiled, rows, OPTS);
    expect(results.map((r) => r.row_status)).toEqual(["ok", "error", "ok"]);
    expect(results[0]!.outputs.premium).toBe(125);
    expect(results[2]!.outputs.premium).toBe(125);
  });
});

describe("policy-book error facet", () => {
  it("a policy containing an error row withholds composed and surfaces row_errors", () => {
    const compiled = compilePlan(lookupPlan({ mode: "error" }));
    const results = evaluatePolicyBook(
      compiled,
      [
        { policy_id: "P1", location_id: "L1", inputs: { class_code: "c202" } },
        { policy_id: "P1", location_id: "L2", inputs: { class_code: "c999" } },
        { policy_id: "P2", location_id: "L1", inputs: { class_code: "c202" } },
      ],
      {
        rollupFields: [{ field: "premium", reducer: "sum" }],
        premiumRollupField: "premium",
        policyTail: [{ kind: "minimum_premium", id: "min", floor: 50 }],
      },
      OPTS,
    );
    const p1 = results.find((r) => r.policy_id === "P1")!;
    const p2 = results.find((r) => r.policy_id === "P2")!;
    expect(p1.row_errors).toBe(1);
    expect(p1.composed).toBeUndefined(); // no plausible wrong final
    expect(p2.row_errors).toBeUndefined();
    expect(p2.composed?.final).toBeGreaterThan(0);
  });
});

describe("resolveLookupMiss helper", () => {
  it("throws a RowIssueError carrying the structured seed on mode error", () => {
    try {
      resolveLookupMiss({ mode: "error" }, 1.0, {
        key: "x",
        tableName: "t",
        keySource: "f",
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RowIssueError);
      const seed = (e as RowIssueError).seed;
      expect(seed.code).toBe("unknown_key");
      expect(seed.detail?.table).toBe("t");
      expect(seed.detail?.key).toBe("x");
      expect(seed.detail?.field).toBe("f");
    }
  });
});
