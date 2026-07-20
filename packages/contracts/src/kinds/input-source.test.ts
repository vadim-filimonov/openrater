import { describe, it, expect } from "vitest";
import { InputSourceKind } from "./input-source";
import type { InputSourceParams } from "./input-source";

describe("InputSourceKind", () => {
  it("declares id=input.source, category=input", () => {
    expect(InputSourceKind.id).toBe("input.source");
    expect(InputSourceKind.category).toBe("input");
    expect(InputSourceKind.defaultSize).toBe("compact");
  });

  it("declares no inputs, one `value` output", () => {
    expect(InputSourceKind.inputs).toHaveLength(0);
    expect(InputSourceKind.outputs).toHaveLength(1);
    expect(InputSourceKind.outputs[0]?.name).toBe("value");
  });

  it("execute returns a stub — the runtime substitutes external values", () => {
    const params: InputSourceParams = {
      fieldName: "tiv",
      fieldType: "money",
      sourceType: "api",
    };
    expect(InputSourceKind.execute({}, params)).toEqual({ value: null });
  });

  it("derivedPorts narrows the output port type to params.fieldType", () => {
    const ports = InputSourceKind.derivedPorts!({
      fieldName: "tiv",
      fieldType: "money",
      sourceType: "api",
    });
    expect(ports.outputs[0]?.type).toBe("money");

    const ports2 = InputSourceKind.derivedPorts!({
      fieldName: "year_built",
      fieldType: "int",
      sourceType: "form",
    });
    expect(ports2.outputs[0]?.type).toBe("int");
  });

  it("derivedPorts falls back to `string` when fieldType is missing", () => {
    const ports = InputSourceKind.derivedPorts!({
      fieldName: "x",
      // @ts-expect-error — intentionally missing fieldType to test fallback
      fieldType: undefined,
      sourceType: "api",
    });
    expect(ports.outputs[0]?.type).toBe("string");
  });

  it("carries provenance/certainty/determinism/sideEffects metadata", () => {
    expect(InputSourceKind.provenance).toBe("core");
    expect(InputSourceKind.certainty).toBe("draft");
    expect(InputSourceKind.determinism).toBe("strict");
    expect(InputSourceKind.sideEffects).toBe("none");
  });

  it("validate flags missing fieldName", () => {
    const r = InputSourceKind.validate!({
      fieldName: "",
      fieldType: "string",
      sourceType: "api",
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.field).toBe("fieldName");
  });

  it("validate accepts a valid binding", () => {
    const r = InputSourceKind.validate!({
      fieldName: "alcohol_intensity",
      fieldType: "factor",
      sourceType: "lookup",
      sourcePath: "account.classification.alcohol_intensity",
    });
    expect(r.valid).toBe(true);
  });

  // ── Brief 52 — input-dictionary fields ──
  it("validate accepts a declared input carrying dictionary metadata", () => {
    const r = InputSourceKind.validate!({
      fieldName: "total_floor_area_sqft",
      fieldType: "int",
      sourceType: "form",
      required: true,
      unit: "sqft",
      category: "G. Eligibility & policy facts",
    });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("validate errors when defaultValue is not in allowedValues", () => {
    const r = InputSourceKind.validate!({
      fieldName: "territory",
      fieldType: "string",
      sourceType: "derived",
      derivedFrom: "zip",
      allowedValues: ["701", "702"],
      defaultValue: "999",
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "defaultValue")).toBe(true);
  });

  it("validate accepts a defaultValue that IS in allowedValues", () => {
    const r = InputSourceKind.validate!({
      fieldName: "territory",
      fieldType: "string",
      sourceType: "derived",
      derivedFrom: "zip",
      allowedValues: ["701", "702"],
      defaultValue: "701",
    });
    expect(r.valid).toBe(true);
  });

  it("validate warns (not errors) when a derived input has no derivedFrom", () => {
    const r = InputSourceKind.validate!({
      fieldName: "territory",
      fieldType: "string",
      sourceType: "derived",
    });
    expect(r.valid).toBe(true); // warning, not error
    expect(
      r.issues.some(
        (i) => i.severity === "warning" && i.field === "derivedFrom",
      ),
    ).toBe(true);
  });

  it("explainStep renders the derived source type", () => {
    expect(
      InputSourceKind.explainStep!(
        {},
        {
          fieldName: "territory",
          fieldType: "string",
          sourceType: "derived",
          derivedFrom: "zip",
        },
        { value: "701" },
      ),
    ).toBe("Input source `territory` (from derived) → 701");
  });

  it("explainStep includes the sourceType context", () => {
    expect(
      InputSourceKind.explainStep!(
        {},
        { fieldName: "tiv", fieldType: "money", sourceType: "api" },
        { value: 1_000_000 },
      ),
    ).toBe("Input source `tiv` (from api) → 1000000");
    expect(
      InputSourceKind.explainStep!(
        {},
        {
          fieldName: "year_built",
          fieldType: "int",
          sourceType: "form",
        },
        { value: undefined },
      ),
    ).toBe("Input source `year_built` (from form) not supplied");
  });
});
