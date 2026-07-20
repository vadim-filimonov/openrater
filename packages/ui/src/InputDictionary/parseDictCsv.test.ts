/**
 * I3 — dictionary-CSV import tests. Shape mirrors the Sample BOP filing's
 * `*_input_variables.csv`.
 */
import { describe, it, expect } from "vitest";
import { parseInputDictCsv, parseInputDictText } from "./parseDictCsv";

const DICT_CSV = [
  "category,input_key,display_name,data_type,required,source,allowed_values,description",
  'A. Classification,class_code,Meridian BOP class code,class_code,true,form_input,in class_table,5-digit Meridian BOP code',
  'B. Location,territory,KS rating territory,enum,true,derived_from_zip,t1 / t2,Kansas BOP territory',
  'C. Property,construction_class,Construction type,enum,true,form_input,frame / joisted_masonry / fire_resistive,6 ISO classes',
  'D. Coverage,building_limit,Building limit ($),currency,false,form_input,>= 0,Building coverage limit',
].join("\n");

describe("parseInputDictCsv", () => {
  it("maps a filing dictionary CSV into typed input entries", () => {
    const { entries, errors } = parseInputDictCsv(DICT_CSV);
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(4);

    const byField = Object.fromEntries(entries.map((e) => [e.fieldName, e]));
    expect(byField.class_code!.dataType).toBe("class_code");
    expect(byField.class_code!.required).toBe(true);
    expect(byField.class_code!.category).toBe("A. Classification");

    // enum → string; derived_from_zip → derived; "t1 / t2" → allowedValues.
    expect(byField.territory!.dataType).toBe("string");
    expect(byField.territory!.source).toBe("derived");
    expect(byField.territory!.allowedValues).toEqual(["t1", "t2"]);

    // currency → money; ">= 0" is prose (no slash) → no allowedValues.
    expect(byField.building_limit!.dataType).toBe("money");
    expect(byField.building_limit!.required).toBe(false);
    expect(byField.building_limit!.allowedValues).toBeUndefined();

    expect(byField.construction_class!.allowedValues).toEqual([
      "frame",
      "joisted_masonry",
      "fire_resistive",
    ]);
  });

  it("E01 — preserves a COMMA-delimited enum when data_type is enum/select", () => {
    // A filing quotes a comma-separated `allowed_values` cell; the
    // RFC-4180 tokenizer un-quotes it to "sprinklered, non_sprinklered,
    // partial" — which the pre-fix parser dropped (no / | ; delimiter).
    const csv = [
      "input_key,data_type,allowed_values",
      'sprinkler_status,enum,"sprinklered, non_sprinklered, partial"',
      'occupancy,select,"owner, tenant"',
      "program,enum,monoline", // single-option enum is a valid closed set
    ].join("\n");
    const { entries, errors } = parseInputDictCsv(csv);
    expect(errors).toEqual([]);
    const byField = Object.fromEntries(entries.map((e) => [e.fieldName, e]));
    expect(byField.sprinkler_status!.allowedValues).toEqual([
      "sprinklered",
      "non_sprinklered",
      "partial",
    ]);
    expect(byField.occupancy!.allowedValues).toEqual(["owner", "tenant"]);
    expect(byField.program!.allowedValues).toEqual(["monoline"]);
    // enum data_type still resolves to the `string` base PrimitiveType.
    expect(byField.sprinkler_status!.dataType).toBe("string");
  });

  it("E01 — does NOT split commas in a non-enum cell (prose guard preserved)", () => {
    const csv = [
      "input_key,data_type,allowed_values",
      'notes,string,"see schedule, table 4"',
      "building_limit,currency,>= 0",
    ].join("\n");
    const { entries } = parseInputDictCsv(csv);
    const byField = Object.fromEntries(entries.map((e) => [e.fieldName, e]));
    expect(byField.notes!.allowedValues).toBeUndefined();
    expect(byField.building_limit!.allowedValues).toBeUndefined();
  });

  it("errors when there is no field-name column", () => {
    const { entries, errors } = parseInputDictCsv("foo,bar\n1,2");
    expect(entries).toEqual([]);
    expect(errors[0]).toMatch(/field-name column/);
  });
});

describe("parseInputDictText — format detection", () => {
  it("routes JSON to the JSON parser", () => {
    const { entries } = parseInputDictText(
      '{ "inputs": [ { "fieldName": "revenue", "dataType": "money" } ] }',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.fieldName).toBe("revenue");
  });

  it("routes a header row to the CSV parser", () => {
    const { entries } = parseInputDictText(DICT_CSV);
    expect(entries).toHaveLength(4);
  });

  it("empty text → no entries, no errors", () => {
    expect(parseInputDictText("   ")).toEqual({ entries: [], errors: [] });
  });
});
