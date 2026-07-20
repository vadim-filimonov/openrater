import { describe, it, expect } from "vitest";
import { PredicateKind, evaluatePredicate } from "./predicate";
import type { PredicateOp } from "./predicate";

describe("evaluatePredicate", () => {
  it.each<[PredicateOp, number, number, boolean]>([
    ["eq", 5, 5, true],
    ["eq", 5, 4, false],
    ["ne", 5, 4, true],
    ["ne", 5, 5, false],
    ["lt", 4, 5, true],
    ["lt", 5, 5, false],
    ["le", 5, 5, true],
    ["le", 6, 5, false],
    ["gt", 6, 5, true],
    ["gt", 5, 5, false],
    ["ge", 5, 5, true],
    ["ge", 4, 5, false],
  ])("%s(%s, %s) → %s", (op, x, t, expected) => {
    expect(evaluatePredicate(op, x, t)).toBe(expected);
  });
});

describe("PredicateKind", () => {
  it("declares one x input, one value (bool) output", () => {
    expect(PredicateKind.inputs).toHaveLength(1);
    expect(PredicateKind.inputs[0]?.name).toBe("x");
    expect(PredicateKind.outputs[0]?.name).toBe("value");
    expect(PredicateKind.outputs[0]?.type).toBe("bool");
  });

  it("declares category=transform", () => {
    expect(PredicateKind.category).toBe("transform");
  });

  it("execute dispatches through params.op + threshold", () => {
    expect(
      PredicateKind.execute({ x: 100_000 }, { op: "gt", threshold: 50_000 })
        .value,
    ).toBe(true);
    expect(
      PredicateKind.execute({ x: 25_000 }, { op: "gt", threshold: 50_000 })
        .value,
    ).toBe(false);
  });

  it("validate flags NaN threshold", () => {
    const r = PredicateKind.validate!({ op: "gt", threshold: NaN });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.field).toBe("threshold");
  });

  it("validate accepts a numeric threshold", () => {
    const r = PredicateKind.validate!({ op: "eq", threshold: 0 });
    expect(r.valid).toBe(true);
  });
});
