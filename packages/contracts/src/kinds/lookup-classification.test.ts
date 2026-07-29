import { describe, it, expect } from "vitest";
import { ClassificationLookupKind } from "./lookup-classification";

describe("ClassificationLookupKind", () => {
  it("declares one class_code input, one value output", () => {
    expect(ClassificationLookupKind.inputs).toHaveLength(1);
    expect(ClassificationLookupKind.inputs[0]?.name).toBe("class_code");
    expect(ClassificationLookupKind.inputs[0]?.type).toBe("class_code");
    expect(ClassificationLookupKind.outputs[0]?.name).toBe("value");
  });

  it("returns the table factor when the class code is present", () => {
    const r = ClassificationLookupKind.execute(
      { class_code: "00811" },
      {
        table: { "00811": 1.85, "00812": 0.65 },
        defaultValue: 1.0,
      },
    );
    expect(r.value).toBe(1.85);
  });

  it("returns defaultValue when the class code is absent", () => {
    const r = ClassificationLookupKind.execute(
      { class_code: "99999" },
      {
        table: { "00811": 1.85 },
        defaultValue: 1.0,
      },
    );
    expect(r.value).toBe(1.0);
  });

  it("validate flags NaN defaultValue", () => {
    const r = ClassificationLookupKind.validate!({
      table: { "00811": 1 },
      defaultValue: NaN,
    });
    expect(r.valid).toBe(false);
  });

  it("validate warns on empty table (but stays valid)", () => {
    const r = ClassificationLookupKind.validate!({
      table: {},
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(true);
    expect(r.issues[0]?.severity).toBe("warning");
  });

  it("declares provenance/certainty/determinism/sideEffects metadata", () => {
    expect(ClassificationLookupKind.provenance).toBe("core");
    expect(ClassificationLookupKind.certainty).toBe("draft");
    expect(ClassificationLookupKind.determinism).toBe("strict");
    expect(ClassificationLookupKind.sideEffects).toBe("none");
  });

  it("explainStep distinguishes classified vs default", () => {
    const params = {
      table: { "00811": 1.85, "00812": 0.65 },
      defaultValue: 1.0,
    };
    expect(
      ClassificationLookupKind.explainStep!(
        { class_code: "00811" },
        params,
        { value: 1.85 },
      ),
    ).toBe("Classified `00811` → 1.85");
    expect(
      ClassificationLookupKind.explainStep!(
        { class_code: "99999" },
        params,
        { value: 1.0 },
      ),
    ).toBe("Class `99999` not in table → 1 (default)");
  });
});
