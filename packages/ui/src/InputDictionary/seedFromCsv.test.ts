import { describe, it, expect } from "vitest";
import { seedInputsFromCsv } from "./seedFromCsv";

describe("seedInputsFromCsv", () => {
  it("skips expected_* and identifier columns", () => {
    const out = seedInputsFromCsv([
      "case_id",
      "name",
      "class_code",
      "expected_total_premium",
      "expected_tier",
    ]);
    const names = out.map((e) => e.fieldName);
    expect(names).toEqual(["class_code"]);
  });

  it("infers int / money / bool / string from sample values", () => {
    const out = seedInputsFromCsv(
      ["total_floor_area_sqft", "annual_gross_sales", "sprinklered", "construction_class"],
      {
        sampleRows: [
          {
            total_floor_area_sqft: "42000",
            annual_gross_sales: "900000",
            sprinklered: "true",
            construction_class: "frame",
          },
          {
            total_floor_area_sqft: "9000",
            annual_gross_sales: "250000",
            sprinklered: "false",
            construction_class: "joisted_masonry",
          },
        ],
      },
    );
    const byField = Object.fromEntries(out.map((e) => [e.fieldName, e.dataType]));
    expect(byField["total_floor_area_sqft"]).toBe("int");
    // monetary-named numeric column → money
    expect(byField["annual_gross_sales"]).toBe("money");
    expect(byField["sprinklered"]).toBe("bool");
    expect(byField["construction_class"]).toBe("string");
  });

  it("does not re-propose already-declared fields", () => {
    const out = seedInputsFromCsv(["class_code", "territory"], {
      existingFieldNames: ["class_code"],
    });
    expect(out.map((e) => e.fieldName)).toEqual(["territory"]);
  });

  it("falls back to name-based inference with no sample rows", () => {
    const out = seedInputsFromCsv(["building_limit", "is_first_term", "years_in_business"]);
    const byField = Object.fromEntries(out.map((e) => [e.fieldName, e.dataType]));
    expect(byField["building_limit"]).toBe("money");
    expect(byField["is_first_term"]).toBe("bool");
    expect(byField["years_in_business"]).toBe("int");
  });

  it("seeds form-sourced, optional declarations", () => {
    const [e] = seedInputsFromCsv(["foo"]);
    expect(e?.source).toBe("form");
    expect(e?.required).toBe(false);
  });
});
