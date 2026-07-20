import { describe, it, expect } from "vitest";
import {
  fieldNameToStageId,
  humanizeFieldName,
  isDeclarableFieldName,
  validateDictionary,
  type InputDictEntry,
} from "./types";

function entry(p: Partial<InputDictEntry> & { fieldName: string }): InputDictEntry {
  return {
    id: fieldNameToStageId(p.fieldName),
    displayName: p.fieldName,
    dataType: "string",
    source: "form",
    required: false,
    ...p,
  };
}

describe("fieldNameToStageId", () => {
  it("slugs + prefixes deterministically", () => {
    expect(fieldNameToStageId("total_floor_area_sqft")).toBe(
      "input_total_floor_area_sqft",
    );
    expect(fieldNameToStageId("Annual Gross Sales ($)")).toBe(
      "input_annual_gross_sales",
    );
    expect(fieldNameToStageId("  ")).toBe("input_field");
  });
});

describe("humanizeFieldName", () => {
  it("turns snake/camel into a label", () => {
    expect(humanizeFieldName("total_floor_area_sqft")).toBe(
      "Total floor area sqft",
    );
    expect(humanizeFieldName("annualGrossSales")).toBe("Annual Gross Sales");
  });
});

describe("validateDictionary", () => {
  it("returns no issues for a clean dictionary", () => {
    expect(
      validateDictionary([
        entry({ fieldName: "total_floor_area_sqft", dataType: "int", required: true }),
        entry({ fieldName: "annual_gross_sales", dataType: "money" }),
      ]),
    ).toEqual([]);
  });

  it("flags a blank fieldName", () => {
    const issues = validateDictionary([entry({ fieldName: "" })]);
    expect(issues.some((i) => i.field === "fieldName" && i.severity === "error")).toBe(
      true,
    );
  });

  // 2026-07-15 filing-digitization review — one-click Declare minted a
  // junk `literal:1` input from the ingest builder's default exposure
  // binding. A ':' marks a binding namespace, never a field name.
  it("flags a namespace-form fieldName (literal:1)", () => {
    const issues = validateDictionary([entry({ fieldName: "literal:1" })]);
    expect(
      issues.some((i) => i.field === "fieldName" && i.severity === "error"),
    ).toBe(true);
  });

  it("isDeclarableFieldName rejects ':' forms, keeps ordinary names", () => {
    expect(isDeclarableFieldName("literal:1")).toBe(false);
    expect(isDeclarableFieldName("context:lcm")).toBe(false);
    expect(isDeclarableFieldName("")).toBe(false);
    expect(isDeclarableFieldName("   ")).toBe(false);
    expect(isDeclarableFieldName("revenue")).toBe(true);
    // Narrow by design — existing dictionaries carry book-column names
    // that aren't strict slugs (mixed case, spaces); those stay valid.
    expect(isDeclarableFieldName("Annual Gross Sales ($)")).toBe(true);
  });

  it("flags duplicate fieldNames on every colliding entry", () => {
    const issues = validateDictionary([
      entry({ fieldName: "class_code" }),
      entry({ fieldName: "class_code" }),
    ]);
    const dups = issues.filter((i) => /declared 2 times/.test(i.message));
    expect(dups).toHaveLength(2);
  });

  it("flags a default outside the allowed set", () => {
    const issues = validateDictionary([
      entry({
        fieldName: "territory",
        allowedValues: ["t1", "t2"],
        defaultValue: "999",
      }),
    ]);
    expect(issues.some((i) => i.field === "defaultValue")).toBe(true);
  });

  it("accepts a default that is in the allowed set", () => {
    const issues = validateDictionary([
      entry({
        fieldName: "territory",
        allowedValues: ["t1", "t2"],
        defaultValue: "t1",
      }),
    ]);
    expect(issues).toEqual([]);
  });

  it("warns (not errors) on a derived input with no source", () => {
    const issues = validateDictionary([
      entry({ fieldName: "territory", source: "derived" }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.field).toBe("derivedFrom");
  });
});
