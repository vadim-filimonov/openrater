import { describe, it, expect } from "vitest";
import { ConstantKind } from "./constant";

describe("ConstantKind", () => {
  it("declares no inputs, one output", () => {
    expect(ConstantKind.inputs).toHaveLength(0);
    expect(ConstantKind.outputs).toHaveLength(1);
    expect(ConstantKind.outputs[0]?.name).toBe("value");
  });

  it("execute returns the params.value as the output", () => {
    const result = ConstantKind.execute(
      {},
      { value: 1.42, type: "factor" },
    );
    expect(result.value).toBe(1.42);
  });

  it("execute is pure — same params → same output", () => {
    const a = ConstantKind.execute({}, { value: 5, type: "money" });
    const b = ConstantKind.execute({}, { value: 5, type: "money" });
    expect(a.value).toBe(b.value);
  });

  it("execute handles non-numeric values", () => {
    expect(
      ConstantKind.execute({}, { value: "hello", type: "string" }).value,
    ).toBe("hello");
    expect(
      ConstantKind.execute({}, { value: true, type: "bool" }).value,
    ).toBe(true);
  });

  it("jacobian is empty (constants have zero gradient)", () => {
    const j = ConstantKind.jacobian!(
      {},
      { value: 1, type: "factor" },
      { value: 1 },
    );
    expect(j).toEqual({});
  });

  it("validate rejects null value", () => {
    const r = ConstantKind.validate!({
      value: null as unknown as number,
      type: "factor",
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.message).toMatch(/required/i);
  });

  it("validate accepts a value of 0 (falsy but valid)", () => {
    const r = ConstantKind.validate!({ value: 0, type: "factor" });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("declares category=constant + defaultSize=compact", () => {
    expect(ConstantKind.category).toBe("constant");
    expect(ConstantKind.defaultSize).toBe("compact");
  });

  it("explainStep emits actuary-readable prose", () => {
    expect(
      ConstantKind.explainStep!(
        {},
        { value: 1.25, type: "factor" },
        { value: 1.25 },
      ),
    ).toBe("Constant factor: 1.25");
    expect(
      ConstantKind.explainStep!(
        {},
        { value: "frame", type: "string" },
        { value: "frame" },
      ),
    ).toBe("Constant string: frame");
  });
});
