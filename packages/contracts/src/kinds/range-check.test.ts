import { describe, it, expect } from "vitest";
import { RangeCheckKind } from "./range-check";

describe("RangeCheckKind", () => {
  it("declares one value input, one result (bool) output", () => {
    expect(RangeCheckKind.inputs[0]?.name).toBe("value");
    expect(RangeCheckKind.outputs[0]?.name).toBe("result");
    expect(RangeCheckKind.outputs[0]?.type).toBe("bool");
  });

  it("declares category=branch", () => {
    expect(RangeCheckKind.category).toBe("branch");
  });

  it("inclusive=true (default) treats both bounds as inclusive", () => {
    const params = { lo: 0, hi: 1 };
    expect(RangeCheckKind.execute({ value: 0 }, params).result).toBe(true);
    expect(RangeCheckKind.execute({ value: 0.5 }, params).result).toBe(true);
    expect(RangeCheckKind.execute({ value: 1 }, params).result).toBe(true);
    expect(RangeCheckKind.execute({ value: -0.1 }, params).result).toBe(false);
    expect(RangeCheckKind.execute({ value: 1.1 }, params).result).toBe(false);
  });

  it("inclusive=false treats upper bound as half-open", () => {
    const params = { lo: 0, hi: 1, inclusive: false };
    expect(RangeCheckKind.execute({ value: 0 }, params).result).toBe(true);
    expect(RangeCheckKind.execute({ value: 1 }, params).result).toBe(false);
    expect(
      RangeCheckKind.execute({ value: 0.9999 }, params).result,
    ).toBe(true);
  });

  it("validate flags NaN lo or hi", () => {
    expect(
      RangeCheckKind.validate!({ lo: NaN, hi: 1 }).valid,
    ).toBe(false);
    expect(
      RangeCheckKind.validate!({ lo: 0, hi: NaN }).valid,
    ).toBe(false);
  });

  it("validate flags lo > hi", () => {
    const r = RangeCheckKind.validate!({ lo: 5, hi: 1 });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.message).toMatch(/lo must be/);
  });

  it("validate accepts well-formed bounds", () => {
    expect(RangeCheckKind.validate!({ lo: 0, hi: 1 }).valid).toBe(true);
    expect(RangeCheckKind.validate!({ lo: -100, hi: 100 }).valid).toBe(true);
  });
});
