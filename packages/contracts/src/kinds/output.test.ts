import { describe, it, expect } from "vitest";
import { OutputKind } from "./output";
import type { OutputParams } from "./output";

describe("OutputKind", () => {
  it("declares one `value` input, no outputs", () => {
    expect(OutputKind.inputs).toHaveLength(1);
    expect(OutputKind.inputs[0]?.name).toBe("value");
    expect(OutputKind.outputs).toHaveLength(0);
  });

  it("declares category=output, defaultSize=regular", () => {
    expect(OutputKind.category).toBe("output");
    expect(OutputKind.defaultSize).toBe("regular");
  });

  it("defaultParams sets a placeholder fieldName + money type", () => {
    expect(OutputKind.defaultParams.fieldName).toBe("untitled_output");
    expect(OutputKind.defaultParams.fieldType).toBe("money");
  });

  it("execute returns an empty object — the runtime collects the value input", () => {
    const params: OutputParams = {
      fieldName: "indicated_premium",
      fieldType: "money",
    };
    expect(OutputKind.execute({ value: 1234.5 }, params)).toEqual({});
  });

  it("validate flags missing fieldName", () => {
    const r = OutputKind.validate!({
      fieldName: "",
      fieldType: "money",
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.message).toMatch(/required/i);
    expect(r.issues[0]?.field).toBe("fieldName");
  });

  it("validate flags whitespace-only fieldName", () => {
    const r = OutputKind.validate!({
      fieldName: "  \t  ",
      fieldType: "money",
    });
    expect(r.valid).toBe(false);
  });

  it("validate accepts a valid fieldName", () => {
    const r = OutputKind.validate!({
      fieldName: "indicated_premium",
      fieldType: "money",
    });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("explainStep names the output field + value", () => {
    expect(
      OutputKind.explainStep!(
        { value: 1379.4 },
        { fieldName: "premium", fieldType: "money" },
        {},
      ),
    ).toBe("Output `premium` = 1379.4");
  });
});
