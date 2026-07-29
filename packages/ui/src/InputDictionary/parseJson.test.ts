import { describe, it, expect } from "vitest";
import { parseInputDictJson } from "./parseJson";

describe("parseInputDictJson", () => {
  it("parses { inputs: [...] }", () => {
    const { entries, errors } = parseInputDictJson(
      JSON.stringify({
        inputs: [
          { fieldName: "total_floor_area_sqft", dataType: "int", required: true },
          { fieldName: "annual_gross_sales", dataType: "money" },
        ],
      }),
    );
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.fieldName).toBe("total_floor_area_sqft");
    expect(entries[0]?.required).toBe(true);
    expect(entries[0]?.id).toBe("input_total_floor_area_sqft");
  });

  it("parses a bare array", () => {
    const { entries } = parseInputDictJson('[{ "fieldName": "x", "type": "money" }]');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.dataType).toBe("money");
  });

  it("F19 — aliases common type words (number→int, boolean→bool) like the CSV path", () => {
    const { entries } = parseInputDictJson(
      JSON.stringify([
        { fieldName: "years_in_business", dataType: "number" },
        { fieldName: "sprinklered", dataType: "boolean" },
        { fieldName: "premium", dataType: "currency" },
      ]),
    );
    expect(entries.map((e) => e.dataType)).toEqual(["int", "bool", "money"]);
  });

  it("tolerates snake_case + alternate keys (name, data_type, allowed_values)", () => {
    const { entries } = parseInputDictJson(
      JSON.stringify([
        { name: "territory", data_type: "string", allowed_values: ["701", "702"], derived_from: "zip", source: "derived" },
      ]),
    );
    expect(entries[0]?.fieldName).toBe("territory");
    expect(entries[0]?.allowedValues).toEqual(["701", "702"]);
    expect(entries[0]?.derivedFrom).toBe("zip");
    expect(entries[0]?.source).toBe("derived");
  });

  it("E01 — maps data_type=enum to the string base type, keeping allowed_values", () => {
    const { entries } = parseInputDictJson(
      JSON.stringify([
        { fieldName: "sprinkler", data_type: "enum", allowed_values: ["sprinklered", "non_sprinklered"] },
      ]),
    );
    expect(entries[0]?.dataType).toBe("string");
    expect(entries[0]?.allowedValues).toEqual(["sprinklered", "non_sprinklered"]);
  });

  it("E01 — accepts a delimited STRING allowed_values on an enum", () => {
    const { entries } = parseInputDictJson(
      JSON.stringify([{ fieldName: "territory", data_type: "enum", allowed_values: "701, 702, 703" }]),
    );
    expect(entries[0]?.allowedValues).toEqual(["701", "702", "703"]);
  });

  it("E01 — does NOT turn a non-enum prose string into bogus options", () => {
    const { entries } = parseInputDictJson(
      JSON.stringify([{ fieldName: "notes", data_type: "string", allowed_values: "see schedule, table 4" }]),
    );
    expect(entries[0]?.allowedValues).toBeUndefined();
  });

  it("falls back to safe defaults for unknown type / source", () => {
    const { entries } = parseInputDictJson(
      JSON.stringify([{ fieldName: "x", dataType: "bogus", source: "bogus" }]),
    );
    expect(entries[0]?.dataType).toBe("string");
    expect(entries[0]?.source).toBe("form");
  });

  it("reports invalid JSON without throwing", () => {
    const { entries, errors } = parseInputDictJson("{ not json");
    expect(entries).toEqual([]);
    expect(errors[0]).toMatch(/not valid json/i);
  });

  it("reports items missing a fieldName", () => {
    const { entries, errors } = parseInputDictJson(JSON.stringify([{ dataType: "int" }]));
    expect(entries).toHaveLength(0);
    expect(errors.some((e) => /missing "fieldName"/.test(e))).toBe(true);
  });
});
