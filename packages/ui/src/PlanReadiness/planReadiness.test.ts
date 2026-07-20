/**
 * computePlanReadiness — P2 G13 (ADR-0056, D1 ruled): readiness gates
 * on the dry compile, not stage buckets or a factor-table count.
 */

import { describe, expect, it } from "vitest";
import { computePlanReadiness } from "./planReadiness";

describe("computePlanReadiness (G13 · compile-based, D1)", () => {
  it("COMPILED grade: runnable + issue-free ⇒ ready — with zero factor tables", () => {
    const r = computePlanReadiness({
      declaredInputCount: 3,
      chainStageCount: 1,
      projection: { hasRunnableChain: true, errorIssueCount: 0 },
    });
    expect(r.grade).toBe("compiled");
    expect(r.compileReady).toBe(true);
    expect(r.blockingHint).toBeNull();
  });

  it("COMPILED grade: severity-error projection issues BLOCK, named in the hint", () => {
    const r = computePlanReadiness({
      declaredInputCount: 3,
      chainStageCount: 1,
      projection: { hasRunnableChain: true, errorIssueCount: 2 },
    });
    expect(r.compileReady).toBe(false);
    expect(r.blockingHint).toBe("Fix 2 authoring issues first.");
  });

  it("COMPILED grade: no runnable chain blocks regardless of stage counts", () => {
    const r = computePlanReadiness({
      declaredInputCount: 3,
      chainStageCount: 1, // authored but doesn't project (e.g. no base)
      projection: { hasRunnableChain: false, errorIssueCount: 1 },
    });
    expect(r.compiles).toBe(false);
    expect(r.compileReady).toBe(false);
    expect(r.blockingHint).toBe("Build the algorithm first.");
  });

  it("STRUCTURAL grade (no projection): ≥1 chain stage approximates readiness", () => {
    const r = computePlanReadiness({
      declaredInputCount: 0,
      chainStageCount: 2,
    });
    expect(r.grade).toBe("structural");
    expect(r.compileReady).toBe(true);
    // hasInputs is display-only — a constants-only plan still rates.
    expect(r.hasInputs).toBe(false);
  });

  it("STRUCTURAL grade: no chain stages ⇒ blocked with the algorithm hint", () => {
    const r = computePlanReadiness({
      declaredInputCount: 5,
      chainStageCount: 0,
    });
    expect(r.compileReady).toBe(false);
    expect(r.blockingHint).toBe("Build the algorithm first.");
  });

  // ── Brief 89 R7 — the RATE rail (pill honesty) ─────────────────────
  it("R7: compiles clean but the structure reads undeclared inputs ⇒ rateReady false, hint names the declares (the F5 scaffold lie)", () => {
    const r = computePlanReadiness({
      declaredInputCount: 0,
      chainStageCount: 1,
      projection: { hasRunnableChain: true, errorIssueCount: 0 },
      undeclaredRequiredInputCount: 2,
    });
    expect(r.compileReady).toBe(true); // engine truth unchanged (Ship keeps it)
    expect(r.rateReady).toBe(false);
    expect(r.nextStepHint).toBe("Declare 2 inputs the algorithm needs.");
    expect(r.blockingHint).toBeNull(); // compile-grade hint untouched
  });

  it("R7: singular hint grammar", () => {
    const r = computePlanReadiness({
      declaredInputCount: 3,
      chainStageCount: 1,
      projection: { hasRunnableChain: true, errorIssueCount: 0 },
      undeclaredRequiredInputCount: 1,
    });
    expect(r.nextStepHint).toBe("Declare 1 input the algorithm needs.");
  });

  it("R7: everything declared ⇒ rateReady, no hint", () => {
    const r = computePlanReadiness({
      declaredInputCount: 4,
      chainStageCount: 1,
      projection: { hasRunnableChain: true, errorIssueCount: 0 },
      undeclaredRequiredInputCount: 0,
    });
    expect(r.rateReady).toBe(true);
    expect(r.nextStepHint).toBeNull();
  });

  it("R7/R6: a FULLY-empty plan speaks the fork phrase, not the algorithm hint", () => {
    const r = computePlanReadiness({
      declaredInputCount: 0,
      chainStageCount: 0,
      undeclaredRequiredInputCount: 0,
    });
    expect(r.rateReady).toBe(false);
    expect(r.nextStepHint).toBe("Bring the plan's variables.");
    // Ship's compile-grade hint keeps its own language.
    expect(r.blockingHint).toBe("Build the algorithm first.");
  });

  it("R7: not compiling (but inputs exist) mirrors blockingHint", () => {
    const r = computePlanReadiness({
      declaredInputCount: 4,
      chainStageCount: 0,
      undeclaredRequiredInputCount: 0,
    });
    expect(r.rateReady).toBe(false);
    expect(r.nextStepHint).toBe("Build the algorithm first.");
  });

  it("R7: omitted count defaults 0 ⇒ rateReady degrades to compileReady (list pages unchanged)", () => {
    const r = computePlanReadiness({
      declaredInputCount: 0,
      chainStageCount: 2,
    });
    expect(r.undeclaredRequiredInputCount).toBe(0);
    expect(r.unsetValueStepCount).toBe(0);
    expect(r.rateReady).toBe(r.compileReady);
  });

  // ── Brief 89 R8 — unset constants phrase as Rating repairs ────────
  it("R8: an unset constant slot blocks rateReady with the step phrase (the scaffold LCM)", () => {
    const r = computePlanReadiness({
      declaredInputCount: 2,
      chainStageCount: 1,
      projection: { hasRunnableChain: true, errorIssueCount: 0 },
      undeclaredRequiredInputCount: 0,
      unsetValueStepCount: 1,
    });
    expect(r.compileReady).toBe(true);
    expect(r.rateReady).toBe(false);
    expect(r.nextStepHint).toBe("1 step needs a value.");
  });

  it("R8: plural step grammar + steps phrase before declares when both gaps exist", () => {
    const r = computePlanReadiness({
      declaredInputCount: 1,
      chainStageCount: 1,
      projection: { hasRunnableChain: true, errorIssueCount: 0 },
      undeclaredRequiredInputCount: 2,
      unsetValueStepCount: 2,
    });
    expect(r.nextStepHint).toBe("2 steps need values.");
    expect(r.rateReady).toBe(false);
  });
});
