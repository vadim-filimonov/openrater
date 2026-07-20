/**
 * `coverage.election` — Brief 95 C4. The election matrix (§5 of the
 * brief), plus the runtime-level guard behavior it drives: an
 * elected-out tower's nodes skip via the reserved `__guard__` port
 * and never execute, never issue, never refuse.
 */

import { describe, it, expect } from "vitest";
import { CoverageElectionKind } from "./coverage-election";
import { compilePlan, runPlan, GUARD_PORT } from "../runtime";
import type { Plan } from "../plan-types";
import { KindRegistry } from "../registry";
import { ConstantKind } from "./constant";
import { InputKind } from "./input";
import { OutputKind } from "./output";
import { BranchKind } from "./branch";
import { DirectLookupKind } from "./lookup-direct";
import { MathOpKind } from "./math-op";

const P = { coverage: "building", elective: true };

describe("CoverageElectionKind — the election matrix", () => {
  it("elective + explicit 0 → elected OUT", () => {
    const out = CoverageElectionKind.execute({ exposure: 0 }, P);
    expect(out).toEqual({ elected: false, elected_out: true });
  });

  it('elective + explicit "0" (CSV string) → elected OUT', () => {
    const out = CoverageElectionKind.execute({ exposure: "0" }, P);
    expect(out.elected_out).toBe(true);
  });

  it("elective + positive exposure → elected", () => {
    const out = CoverageElectionKind.execute({ exposure: 300000 }, P);
    expect(out).toEqual({ elected: true, elected_out: false });
  });

  it("elective + ABSENT exposure → elected (absence is never an election)", () => {
    const out = CoverageElectionKind.execute({ exposure: undefined }, P);
    expect(out).toEqual({ elected: true, elected_out: false });
  });

  it("required + explicit 0 → PRICES the $0 and WARNS (the KS oracle's TV-28 law)", () => {
    const params = { coverage: "building", elective: false };
    const out = CoverageElectionKind.execute({ exposure: 0 }, params);
    // The tower still runs — the audited filed behavior is a $0
    // contribution (TV-28 floors it to the book minimum), never a
    // refusal.
    expect(out).toEqual({ elected: true, elected_out: false });
    const issues = CoverageElectionKind.collectRowIssues!(
      { exposure: 0 },
      params,
      out,
    );
    expect(issues?.[0]).toMatchObject({
      severity: "warning",
      code: "zero_exposure_required",
    });
  });

  it("required + positive or absent exposure → elected (today's law)", () => {
    expect(
      CoverageElectionKind.execute(
        { exposure: 100 },
        { coverage: "building", elective: false },
      ).elected,
    ).toBe(true);
    expect(
      CoverageElectionKind.execute(
        { exposure: undefined },
        { coverage: "building", elective: false },
      ).elected,
    ).toBe(true);
  });

  it("explains each state honestly (P-N5)", () => {
    expect(
      CoverageElectionKind.explainStep!(
        { exposure: 0 },
        P,
        { elected: false, elected_out: true },
      ),
    ).toMatch(/not elected/);
    expect(
      CoverageElectionKind.explainStep!(
        { exposure: 300000 },
        P,
        { elected: true, elected_out: false },
      ),
    ).toMatch(/elected — exposure 300000/);
  });
});

// ── The runtime guard: skipped nodes never execute, never refuse ──────

function registry(): KindRegistry {
  const r = new KindRegistry();
  for (const k of [
    ConstantKind,
    InputKind,
    OutputKind,
    BranchKind,
    DirectLookupKind,
    MathOpKind,
    CoverageElectionKind,
  ]) {
    r.register(k as never);
  }
  return r;
}

/**
 * A miniature elective tower, wired the way the projector wires one:
 *
 *   exposure input ─→ coverage.election
 *   election.elected ──(__guard__)──→ lookup (throws on missing key)
 *   lookup ─→ mult ←─ exposure         (mult also guarded)
 *   branch(elected_out ? 0 : mult) ─→ output
 */
function electiveTowerPlan(): Plan {
  return {
    id: "test.elective-tower",
    version: "1.0.0",
    name: "elective tower",
    nodes: [
      { id: "in_limit", kind: "input", params: { fieldName: "building_limit", fieldType: "money" } },
      { id: "in_group", kind: "input", params: { fieldName: "loi_group", fieldType: "string" } },
      { id: "elect", kind: "coverage.election", params: { coverage: "building", elective: true } },
      // Throws RowIssueError on a missing key (no defaultValue).
      { id: "lk", kind: "lookup.direct", params: { table: { c: 1.5 }, tableName: "LOI group" } },
      { id: "mult", kind: "math.op", params: { op: "mul" } },
      { id: "zero", kind: "constant", params: { value: 0, type: "money" } },
      { id: "el_branch", kind: "branch", params: {} },
      { id: "out", kind: "output", params: { fieldName: "building_premium", fieldType: "money" } },
    ],
    edges: [
      { from: { node: "in_limit", port: "value" }, to: { node: "elect", port: "exposure" } },
      { from: { node: "in_group", port: "value" }, to: { node: "lk", port: "key" } },
      // The guards — the tower's own nodes gate on `elected`.
      { from: { node: "elect", port: "elected" }, to: { node: "lk", port: GUARD_PORT } },
      { from: { node: "elect", port: "elected" }, to: { node: "mult", port: GUARD_PORT } },
      { from: { node: "lk", port: "value" }, to: { node: "mult", port: "x" } },
      { from: { node: "in_limit", port: "value" }, to: { node: "mult", port: "y" } },
      // output = branch(elected_out ? 0 : mult)
      { from: { node: "elect", port: "elected_out" }, to: { node: "el_branch", port: "predicate" } },
      { from: { node: "zero", port: "value" }, to: { node: "el_branch", port: "then" } },
      { from: { node: "mult", port: "result" }, to: { node: "el_branch", port: "else" } },
      { from: { node: "el_branch", port: "result" }, to: { node: "out", port: "value" } },
    ],
    outputs: [],
    testCases: [],
  } as unknown as Plan;
}

describe("the __guard__ port — elected-out towers skip", () => {
  it("elected: the tower runs exactly as before", () => {
    const res = runPlan(compilePlan(electiveTowerPlan(), registry()), {
      building_limit: 200,
      loi_group: "c",
    });
    expect(res.row_status).toBe("ok");
    expect(res.outputs.building_premium).toBe(300); // 1.5 × 200
    expect(res.trace.lk?.skipped).toBeUndefined();
  });

  it("elected OUT (explicit 0): premium 0, lookups skipped, NO refusal — even with the axis input absent", () => {
    const res = runPlan(compilePlan(electiveTowerPlan(), registry()), {
      building_limit: 0,
      // loi_group ABSENT — the lookup would throw if it executed.
    });
    expect(res.row_status).toBe("ok");
    expect(res.outputs.building_premium).toBe(0);
    expect(res.trace.lk?.skipped).toBe(true);
    expect(res.trace.lk?.explanation).toMatch(/Skipped — gated off/);
    expect(res.trace.mult?.skipped).toBe(true);
    // The election itself explains the $0 (the acceptance's trace line).
    expect(res.trace.elect?.explanation).toMatch(/not elected/);
  });

  it("ABSENT exposure: the tower still runs and withholds (absence ≠ election)", () => {
    const res = runPlan(compilePlan(electiveTowerPlan(), registry()), {
      loi_group: "c",
    });
    expect(res.row_status).toBe("error");
    expect(res.outputs.building_premium).toBeUndefined();
  });

  it("a required tower with explicit 0 prices $0 and warns (never refuses)", () => {
    const plan = electiveTowerPlan();
    const elect = plan.nodes.find((n) => n.id === "elect")!;
    (elect.params as { elective: boolean }).elective = false;
    const res = runPlan(compilePlan(plan, registry()), {
      building_limit: 0,
      loi_group: "c",
    });
    expect(res.row_status).toBe("ok");
    expect(res.outputs.building_premium).toBe(0); // 1.5 × 0
    const warn = res.issues?.find((i) => i.code === "zero_exposure_required");
    expect(warn?.severity).toBe("warning");
  });

  it("multiple guards: the node runs while ANY is truthy", () => {
    const plan = electiveTowerPlan();
    // A second, always-true guard on the lookup: the shared-node rule.
    plan.nodes.push({
      id: "always",
      kind: "constant",
      params: { value: true, type: "bool" },
    } as never);
    plan.edges.push({
      from: { node: "always", port: "value" },
      to: { node: "lk", port: GUARD_PORT },
    } as never);
    const res = runPlan(compilePlan(plan, registry()), {
      building_limit: 0,
      loi_group: "c",
    });
    // The lookup executed (guarded true by `always`) — but the tower
    // output still resolves $0 through the election branch.
    expect(res.trace.lk?.skipped).toBeUndefined();
    expect(res.outputs.building_premium).toBe(0);
  });
});
