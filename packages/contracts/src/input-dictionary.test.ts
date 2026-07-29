import { describe, it, expect } from "vitest";
import {
  validateExternalInputs,
  type InputDictionaryEntry,
} from "./input-dictionary";

// The two Sample BOP fields that drive the Brief 52 acceptance.
const DICT: readonly InputDictionaryEntry[] = [
  { fieldName: "total_floor_area_sqft", fieldType: "int", required: true },
  { fieldName: "annual_gross_sales", fieldType: "money", required: false },
  {
    fieldName: "territory",
    fieldType: "string",
    required: true,
    allowedValues: ["701", "702"],
  },
];

describe("validateExternalInputs", () => {
  it("returns no issues when every required input is present + allowed", () => {
    const issues = validateExternalInputs(DICT, {
      total_floor_area_sqft: 42000,
      annual_gross_sales: 900000,
      territory: "701",
    });
    expect(issues).toEqual([]);
  });

  it("flags a required input that is absent with no default", () => {
    const issues = validateExternalInputs(DICT, { territory: "701" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      fieldName: "total_floor_area_sqft",
      code: "missing-required",
      severity: "error",
    });
  });

  it("treats null / empty-string as absent for required checks", () => {
    const issues = validateExternalInputs(DICT, {
      total_floor_area_sqft: "",
      territory: null,
    });
    const fields = issues.map((i) => i.fieldName).sort();
    expect(fields).toEqual(["territory", "total_floor_area_sqft"]);
    expect(issues.every((i) => i.code === "missing-required")).toBe(true);
  });

  it("does NOT flag a required input that has a defaultValue", () => {
    const dict: readonly InputDictionaryEntry[] = [
      {
        fieldName: "term_in_months",
        fieldType: "int",
        required: true,
        defaultValue: 12,
      },
    ];
    expect(validateExternalInputs(dict, {})).toEqual([]);
  });

  it("does NOT flag an absent OPTIONAL input", () => {
    const issues = validateExternalInputs(DICT, {
      total_floor_area_sqft: 9000,
      territory: "702",
      // annual_gross_sales omitted — required:false
    });
    expect(issues).toEqual([]);
  });

  it("flags a value outside the declared closed set", () => {
    const issues = validateExternalInputs(DICT, {
      total_floor_area_sqft: 9000,
      territory: "999",
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      fieldName: "territory",
      code: "not-in-allowed",
      severity: "error",
    });
  });

  it("tolerates number↔string drift in allowed-values membership", () => {
    // territory declared as ["701","702"] (strings); CSV projects 701 (number)
    const issues = validateExternalInputs(DICT, {
      total_floor_area_sqft: 9000,
      territory: 701,
    });
    expect(issues).toEqual([]);
  });

  it("does not range-check an absent value (no double-report)", () => {
    const issues = validateExternalInputs(DICT, {
      total_floor_area_sqft: 9000,
      // territory absent — should report missing-required, NOT not-in-allowed
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("missing-required");
  });

  it("ignores dictionary entries with an empty fieldName", () => {
    const dict: readonly InputDictionaryEntry[] = [
      { fieldName: "", fieldType: "string", required: true },
    ];
    expect(validateExternalInputs(dict, {})).toEqual([]);
  });

  it("is deterministic — same inputs produce identical issues", () => {
    const a = validateExternalInputs(DICT, { territory: "zzz" });
    const b = validateExternalInputs(DICT, { territory: "zzz" });
    expect(a).toEqual(b);
  });
});
