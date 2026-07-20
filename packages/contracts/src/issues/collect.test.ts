/**
 * `collectIssues` aggregator tests (M1.6, Brief 13).
 *
 * Covers each source path:
 *   - compile errors (PlanCompileError extraction)
 *   - runtime errors (trace.error)
 *   - authoring (kind.validate)
 *   - reference (validatePlanReferences)
 *   - conformance (caller-provided results)
 *   - deterministic ordering
 *   - stable id repeatability
 */

import { describe, it, expect, beforeEach } from "vitest";
import { collectIssues } from "./collect";
import {
  KindRegistry,
  _clearRegistryForTests,
  globalRegistry,
} from "../registry";
import { ConstantKind } from "../kinds/constant";
import { OutputKind } from "../kinds/output";
import { EligibilityGateKind } from "../kinds/eligibility-gate";
import type { Plan, RunResult } from "../plan-types";
import type { PlanEntitiesSnapshot } from "../validation";

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

describe("collectIssues — compile errors", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(ConstantKind);
    globalRegistry.register(OutputKind);
  });

  it("collects compile errors from PlanCompileError", () => {
    // Plan references an unregistered kind → compilePlan throws
    const plan = makePlan({
      nodes: [{ id: "n1", kind: "unknown.kind", params: {} }],
    });
    const issues = collectIssues(plan);
    expect(issues.length).toBeGreaterThan(0);
    const compileIssue = issues.find((i) => i.source === "compile");
    expect(compileIssue).toBeDefined();
    expect(compileIssue?.severity).toBe("error");
    expect(compileIssue?.filing_blocking).toBe(true);
    expect(compileIssue?.message).toMatch(/Unknown block kind/);
  });

  it("emits no compile errors for a valid plan", () => {
    const plan = makePlan({
      nodes: [
        { id: "c", kind: "constant", params: { value: 1, type: "factor" } },
        {
          id: "o",
          kind: "output",
          params: { fieldName: "x", fieldType: "factor" },
        },
      ],
      edges: [{ from: { node: "c", port: "value" }, to: { node: "o", port: "value" } }],
    });
    const issues = collectIssues(plan);
    expect(issues.filter((i) => i.source === "compile")).toHaveLength(0);
  });
});

describe("collectIssues — runtime errors", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(ConstantKind);
    globalRegistry.register(OutputKind);
  });

  it("collects runtime errors from RunResult.trace", () => {
    const plan = makePlan({
      nodes: [
        { id: "c", kind: "constant", params: { value: 1, type: "factor" } },
      ],
      edges: [],
    });
    const run: RunResult = {
      outputs: {},
      trace: {
        c: {
          kindId: "constant",
          inputs: {},
          outputs: {},
          error: { message: "Stub failure", at: "execute" },
        },
      },
      startedAt: 0,
      durationMs: 0,
      as_of: "2026-05-20",
      row_status: "ok",
    };
    const issues = collectIssues(plan, { run });
    const runtimeIssue = issues.find((i) => i.source === "runtime");
    expect(runtimeIssue).toBeDefined();
    expect(runtimeIssue?.message).toMatch(/Stub failure/);
    expect(runtimeIssue?.location.entity).toBe("c");
    expect(runtimeIssue?.filing_blocking).toBe(true);
  });

  it("ignores trace entries without an error", () => {
    const plan = makePlan({
      nodes: [
        { id: "c", kind: "constant", params: { value: 1, type: "factor" } },
      ],
      edges: [],
    });
    const run: RunResult = {
      outputs: {},
      trace: {
        c: { kindId: "constant", inputs: {}, outputs: { value: 1 } },
      },
      startedAt: 0,
      durationMs: 0,
      as_of: "2026-05-20",
      row_status: "ok",
    };
    expect(collectIssues(plan, { run }).filter((i) => i.source === "runtime"))
      .toHaveLength(0);
  });
});

describe("collectIssues — authoring (kind.validate)", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(EligibilityGateKind);
    globalRegistry.register(OutputKind);
  });

  it("collects validate() failures as authoring issues", () => {
    // EligibilityGateKind validates that default_reasoning is non-empty.
    const plan = makePlan({
      nodes: [
        {
          id: "gate",
          kind: "eligibility.gate",
          params: {
            rules: [],
            default_tier: "standard",
            default_reasoning: "", // VIOLATES validate
          },
        },
      ],
    });
    const issues = collectIssues(plan, { registry: globalRegistry });
    const authoringIssue = issues.find((i) => i.source === "authoring");
    expect(authoringIssue).toBeDefined();
    expect(authoringIssue?.location.entity).toBe("gate");
    expect(authoringIssue?.message).toMatch(/required/);
  });
});

describe("collectIssues — reference integrity", () => {
  beforeEach(() => {
    _clearRegistryForTests();
  });

  it("collects reference issues from validatePlanReferences", () => {
    // Snapshot with a chain that references a missing dimension
    const entities: PlanEntitiesSnapshot = {
      chains: [
        {
          coverage_chain_id: "ch1",
          display_name: "Test chain",
          factors: [
            {
              name: "Missing factor",
              type: "dimension",
              ref: "missing_dim",
            },
          ],
        },
      ],
      factorTables: [],
      dimensions: [],
      sources: [],
    };
    const plan = makePlan();
    const issues = collectIssues(plan, { entities });
    const refIssue = issues.find((i) => i.source === "reference");
    expect(refIssue).toBeDefined();
    expect(refIssue?.message).toMatch(/missing_dim|dimension/);
  });
});

describe("collectIssues — conformance", () => {
  it("collects failing conformance vectors as info by default", () => {
    const plan = makePlan();
    const issues = collectIssues(plan, {
      conformance: [
        { vector_id: "V7", passed: false, message: "Curve diverges at step 4." },
      ],
    });
    const conf = issues.find((i) => i.source === "conformance");
    expect(conf).toBeDefined();
    expect(conf?.severity).toBe("info");
    expect(conf?.filing_blocking).toBe(false);
  });

  it("marks regulator-required failures as filing-blocking errors", () => {
    const plan = makePlan();
    const issues = collectIssues(plan, {
      conformance: [
        {
          vector_id: "V_required",
          passed: false,
          message: "Required vector failed.",
          filing_required: true,
        },
      ],
    });
    const conf = issues.find((i) => i.source === "conformance");
    expect(conf?.severity).toBe("error");
    expect(conf?.filing_blocking).toBe(true);
  });

  it("does not surface passing vectors", () => {
    const plan = makePlan();
    const issues = collectIssues(plan, {
      conformance: [
        { vector_id: "V1", passed: true, message: "ok" },
        { vector_id: "V2", passed: true, message: "ok" },
      ],
    });
    expect(issues.filter((i) => i.source === "conformance")).toHaveLength(0);
  });
});

describe("collectIssues — determinism + ordering", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(ConstantKind);
    globalRegistry.register(OutputKind);
  });

  it("produces byte-identical JSON on repeat calls", () => {
    const plan = makePlan({
      nodes: [{ id: "n", kind: "unknown.kind", params: {} }],
    });
    const r1 = JSON.stringify(collectIssues(plan));
    const r2 = JSON.stringify(collectIssues(plan));
    expect(r1).toBe(r2);
  });

  it("returns issues frozen + sorted (errors before warnings before info)", () => {
    const plan = makePlan();
    const issues = collectIssues(plan, {
      conformance: [
        {
          vector_id: "V_req",
          passed: false,
          message: "Required.",
          filing_required: true,
        },
        { vector_id: "V_info", passed: false, message: "Info." },
      ],
    });
    expect(Object.isFrozen(issues)).toBe(true);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[1]?.severity).toBe("info");
  });

  it("returns an isolated registry's collection (doesn't touch global)", () => {
    const reg = new KindRegistry();
    reg.register(ConstantKind);
    reg.register(OutputKind);
    const plan = makePlan({
      nodes: [{ id: "n1", kind: "unknown.kind", params: {} }],
    });
    const issues = collectIssues(plan, { registry: reg });
    expect(issues.some((i) => i.source === "compile")).toBe(true);
  });
});

describe("collectIssues — empty / no-error case", () => {
  beforeEach(() => {
    _clearRegistryForTests();
    globalRegistry.register(ConstantKind);
    globalRegistry.register(OutputKind);
  });

  it("returns empty array for a valid plan with no run + no entities", () => {
    const plan = makePlan({
      nodes: [
        { id: "c", kind: "constant", params: { value: 1, type: "factor" } },
        {
          id: "o",
          kind: "output",
          params: { fieldName: "x", fieldType: "factor" },
        },
      ],
      edges: [{ from: { node: "c", port: "value" }, to: { node: "o", port: "value" } }],
    });
    expect(collectIssues(plan)).toEqual([]);
  });
});
