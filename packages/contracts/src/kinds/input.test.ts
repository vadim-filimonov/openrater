import { describe, it, expect } from "vitest";
import { InputKind } from "./input";
import type { InputParams } from "./input";

describe("InputKind", () => {
  it("declares no inputs, one `value` output", () => {
    expect(InputKind.inputs).toHaveLength(0);
    expect(InputKind.outputs).toHaveLength(1);
    expect(InputKind.outputs[0]?.name).toBe("value");
  });

  it("declares category=input, defaultSize=regular", () => {
    expect(InputKind.category).toBe("input");
    expect(InputKind.defaultSize).toBe("regular");
  });

  it("defaultParams sets a placeholder fieldName + money type", () => {
    expect(InputKind.defaultParams.fieldName).toBe("untitled_input");
    expect(InputKind.defaultParams.fieldType).toBe("money");
  });

  it("execute returns a stub — the runtime substitutes external values", () => {
    const params: InputParams = { fieldName: "tiv", fieldType: "money" };
    expect(InputKind.execute({}, params)).toEqual({ value: null });
  });

  it("validate flags missing fieldName", () => {
    const r = InputKind.validate!({
      fieldName: "",
      fieldType: "money",
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.message).toMatch(/required/i);
    expect(r.issues[0]?.field).toBe("fieldName");
  });

  it("validate flags whitespace-only fieldName", () => {
    const r = InputKind.validate!({
      fieldName: "   ",
      fieldType: "money",
    });
    expect(r.valid).toBe(false);
  });

  it("validate accepts a valid fieldName", () => {
    const r = InputKind.validate!({
      fieldName: "tiv_building",
      fieldType: "money",
    });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("explainStep shows the substituted value", () => {
    expect(
      InputKind.explainStep!(
        {},
        { fieldName: "tiv", fieldType: "money" },
        { value: 1_000_000 },
      ),
    ).toBe("External input `tiv` → 1000000");
  });

  it("explainStep flags the missing-no-default case", () => {
    expect(
      InputKind.explainStep!(
        {},
        { fieldName: "tiv", fieldType: "money" },
        { value: undefined },
      ),
    ).toBe("External input `tiv` not supplied (no default)");
  });
});
