import { describe, it, expect } from "vitest";
import { MathOpKind, executeMath } from "./math-op";
import type { MathOpParams, MathOp } from "./math-op";

describe("executeMath — dispatch", () => {
  it("clamp returns x when within bounds", () => {
    expect(executeMath("clamp", 1.0, undefined, 0.5, 1.5)).toBe(1.0);
  });

  it("clamp returns lo when below", () => {
    expect(executeMath("clamp", 0.2, undefined, 0.5, 1.5)).toBe(0.5);
  });

  it("clamp returns hi when above", () => {
    expect(executeMath("clamp", 2.0, undefined, 0.5, 1.5)).toBe(1.5);
  });

  it("clamp throws without lo or hi", () => {
    expect(() => executeMath("clamp", 1.0, undefined, undefined, 1.5)).toThrow(
      /lo and hi/,
    );
    expect(() => executeMath("clamp", 1.0, undefined, 0.5, undefined)).toThrow(
      /lo and hi/,
    );
  });

  it("log returns natural log", () => {
    expect(executeMath("log", Math.E, undefined, undefined, undefined)).toBeCloseTo(1);
  });

  it("exp returns e^x", () => {
    expect(executeMath("exp", 1, undefined, undefined, undefined)).toBeCloseTo(Math.E);
  });

  it("sigmoid at 0 returns 0.5", () => {
    expect(executeMath("sigmoid", 0, undefined, undefined, undefined)).toBeCloseTo(0.5);
  });

  it.each<[MathOp, number, number, number]>([
    ["add", 2, 3, 5],
    ["sub", 5, 3, 2],
    ["mul", 4, 5, 20],
    ["div", 10, 2, 5],
    ["min", 3, 7, 3],
    ["max", 3, 7, 7],
  ])("%s(%s, %s) = %s", (op, x, y, expected) => {
    expect(executeMath(op, x, y, undefined, undefined)).toBe(expected);
  });

  it("binary ops throw without y", () => {
    const binary: MathOp[] = ["add", "sub", "mul", "div", "min", "max"];
    for (const op of binary) {
      expect(() => executeMath(op, 1, undefined, undefined, undefined)).toThrow(
        new RegExp(`${op} requires y`),
      );
    }
  });

  // ── P1-01 (audit A-2026-07-12): a present-but-non-finite operand
  // REFUSES (NaN), never improvises. JS coerces null/[]/""→0 and true→1;
  // the building exposure `expdiv` is a math.op `div`, so `null / 100`
  // was silently 0 → a wrong premium served as ok. NaN routes to the
  // output backstop, which withholds the premium.
  it("non-finite x → NaN (null/[]/true/''/NaN/Infinity)", () => {
    for (const bad of [null, [], {}, true, false, "", "abc", NaN, Infinity, -Infinity]) {
      const r = executeMath("mul", bad as unknown as number, 1.1, undefined, undefined);
      expect(Number.isNaN(r)).toBe(true);
    }
  });

  it("div: null numerator → NaN (the building_limit=null path)", () => {
    expect(Number.isNaN(executeMath("div", null as unknown as number, 100, undefined, undefined))).toBe(true);
  });

  it("present-but-non-finite y → NaN (but absent y still throws)", () => {
    expect(Number.isNaN(executeMath("mul", 1000, null as unknown as number, undefined, undefined))).toBe(true);
    expect(() => executeMath("mul", 1000, undefined, undefined, undefined)).toThrow(/mul requires y/);
  });

  it("finite operands are byte-identical to before", () => {
    expect(executeMath("div", 200000, 100, undefined, undefined)).toBe(2000);
    expect(executeMath("mul", 1510, 1.0, undefined, undefined)).toBe(1510);
  });

  it("clean numeric STRING operands still coerce (stringly wire)", () => {
    // the building exposure receives "200000" (string) from a CSV/form
    expect(executeMath("div", "200000" as unknown as number, 100, undefined, undefined)).toBe(2000);
    expect(executeMath("mul", "1510" as unknown as number, "1.0" as unknown as number, undefined, undefined)).toBe(1510);
  });

  it("div by zero throws", () => {
    expect(() => executeMath("div", 1, 0, undefined, undefined)).toThrow(
      /Division by zero/,
    );
  });
});

describe("MathOpKind", () => {
  it("declares x + optional y inputs, result output", () => {
    expect(MathOpKind.inputs).toHaveLength(2);
    expect(MathOpKind.inputs[0]?.name).toBe("x");
    expect(MathOpKind.inputs[1]?.name).toBe("y");
    expect(MathOpKind.inputs[1]?.optional).toBe(true);
    expect(MathOpKind.outputs[0]?.name).toBe("result");
  });

  it("execute dispatches through params.op", () => {
    const params: MathOpParams = { op: "mul" };
    expect(MathOpKind.execute({ x: 3, y: 4 }, params).result).toBe(12);
  });

  it("execute clamp uses params.lo/hi", () => {
    const params: MathOpParams = { op: "clamp", lo: 0.5, hi: 1.5 };
    expect(MathOpKind.execute({ x: 2.0 }, params).result).toBe(1.5);
    expect(MathOpKind.execute({ x: 0.1 }, params).result).toBe(0.5);
    expect(MathOpKind.execute({ x: 1.0 }, params).result).toBe(1.0);
  });

  it("jacobian for clamp: 1 inside bounds, 0 outside", () => {
    const params: MathOpParams = { op: "clamp", lo: 0.5, hi: 1.5 };
    const inside = MathOpKind.jacobian!({ x: 1.0 }, params, { result: 1.0 });
    expect(inside["result/x"]?.x).toBe(1);
    const outside = MathOpKind.jacobian!({ x: 2.0 }, params, { result: 1.5 });
    expect(outside["result/x"]?.x).toBe(0);
  });

  it("jacobian for log: 1/x", () => {
    const j = MathOpKind.jacobian!(
      { x: 2 },
      { op: "log" },
      { result: Math.log(2) },
    );
    expect(j["result/x"]?.x).toBeCloseTo(0.5);
  });

  it("validate flags clamp without bounds", () => {
    expect(MathOpKind.validate!({ op: "clamp" }).valid).toBe(false);
    expect(MathOpKind.validate!({ op: "clamp", lo: 0.5 }).valid).toBe(false);
  });

  it("validate flags clamp with lo > hi", () => {
    const r = MathOpKind.validate!({ op: "clamp", lo: 2.0, hi: 1.0 });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.message).toMatch(/Lo bound must be/);
  });

  it("validate accepts clamp with valid bounds", () => {
    expect(MathOpKind.validate!({ op: "clamp", lo: 0.5, hi: 1.5 }).valid).toBe(
      true,
    );
  });

  it("validate accepts unary ops without bounds", () => {
    expect(MathOpKind.validate!({ op: "log" }).valid).toBe(true);
    expect(MathOpKind.validate!({ op: "exp" }).valid).toBe(true);
  });

  it("explainStep covers every dispatch branch", () => {
    expect(
      MathOpKind.explainStep!(
        { x: 2.0 },
        { op: "clamp", lo: 0.5, hi: 1.5 },
        { result: 1.5 },
      ),
    ).toBe("Clamp 2 to [0.5, 1.5] → 1.5");
    expect(
      MathOpKind.explainStep!({ x: Math.E }, { op: "log" }, { result: 1 }),
    ).toMatch(/^log\(/);
    expect(
      MathOpKind.explainStep!({ x: 3, y: 4 }, { op: "mul" }, { result: 12 }),
    ).toBe("3 × 4 = 12");
    expect(
      MathOpKind.explainStep!({ x: 10, y: 2 }, { op: "div" }, { result: 5 }),
    ).toBe("10 ÷ 2 = 5");
    expect(
      MathOpKind.explainStep!({ x: 5, y: 3 }, { op: "sub" }, { result: 2 }),
    ).toBe("5 − 3 = 2");
    expect(
      MathOpKind.explainStep!({ x: 3, y: 7 }, { op: "min" }, { result: 3 }),
    ).toBe("min(3, 7) = 3");
    expect(
      MathOpKind.explainStep!({ x: 0 }, { op: "sigmoid" }, { result: 0.5 }),
    ).toBe("sigmoid(0) = 0.5");
  });
});
