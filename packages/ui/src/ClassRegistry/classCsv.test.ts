/**
 * Tests for the CSV → ClassDraft mapping (Brief 51 bulk import).
 *
 * The load-bearing rule: a filing `class_table` loads with its
 * derived rating attributes (prop_rate_number / liab_class_group /
 * liab_exposure_base / …) routed into `attributes` automatically.
 */

import { describe, it, expect } from "vitest";
import { parseClassTableCsv, mapRowToDraft } from "./classCsv";

// Intentionally invented Meridian rows. No identifier or rating value below
// comes from a carrier or bureau filing.
const CLASS_TABLE_CSV = [
  "class_code,description,sic_code,naics_code,prop_rate_number,liab_class_group,liab_exposure_base,liability_kind,eq_grade,eqsl_grade,citation_rule,citation_page",
  "c102,Meridian General Merchandise,DEMO-SIC-01,DEMO-NAICS-101,11,mg_01,sales,occupant,A,alpha,Meridian Filing Rule C.1,p.8",
  "c101,Meridian Neighborhood Bakery,DEMO-SIC-02,DEMO-NAICS-102,07,mg_02,sales,occupant,B,beta,Meridian Filing Rule C.2,p.9",
].join("\n");

describe("parseClassTableCsv — fictional Meridian class_table", () => {
  it("maps every row + routes unknown columns into attributes", () => {
    const result = parseClassTableCsv(CLASS_TABLE_CSV);
    expect(result.ok).toBe(true);
    expect(result.validCount).toBe(2);
    expect(result.rows).toHaveLength(2);

    const generalMerchandise = result.rows[0]!.draft!;
    expect(generalMerchandise.class_code).toBe("c102");
    // `description` column holds the NAME in the class_table convention.
    expect(generalMerchandise.display_name).toBe("Meridian General Merchandise");
    expect(generalMerchandise.description).toBeUndefined(); // not duplicated into description
    expect(generalMerchandise.naics_code).toBe("DEMO-NAICS-101");
    expect(generalMerchandise.sic_code).toBe("DEMO-SIC-01");
    expect(generalMerchandise.citation_rule).toBe("Meridian Filing Rule C.1");
    expect(generalMerchandise.citation_page).toBe("p.8");
    // The derived rating attributes — the whole point.
    expect(generalMerchandise.attributes).toEqual({
      prop_rate_number: "11",
      liab_class_group: "mg_01",
      liab_exposure_base: "sales",
      liability_kind: "occupant",
      eq_grade: "A",
      eqsl_grade: "alpha",
    });

    const neighborhoodBakery = result.rows[1]!.draft!;
    expect(neighborhoodBakery.class_code).toBe("c101");
    expect(neighborhoodBakery.attributes.prop_rate_number).toBe("07"); // leading zero kept
  });
});

describe("mapRowToDraft — column conventions", () => {
  it("prefers an explicit display_name over description", () => {
    const { draft } = mapRowToDraft({
      class_code: "100",
      display_name: "Bowling Centers",
      description: "Indoor bowling alleys incl. pro shops",
      family: "Recreation",
    });
    expect(draft!.display_name).toBe("Bowling Centers");
    expect(draft!.description).toBe("Indoor bowling alleys incl. pro shops");
    expect(draft!.family).toBe("Recreation");
  });

  it("splits eligible_for on comma / semicolon / pipe", () => {
    const { draft } = mapRowToDraft({
      class_code: "200",
      name: "Office",
      eligible_for: "bop; property , liability",
    });
    expect(draft!.eligible_for).toEqual(["bop", "property", "liability"]);
  });

  it("honors an explicit source=iso column", () => {
    const { draft } = mapRowToDraft({ class_code: "300", name: "X", source: "iso" });
    expect(draft!.source).toBe("iso");
  });

  it("defaults source to custom", () => {
    const { draft } = mapRowToDraft({ class_code: "400", name: "Y" });
    expect(draft!.source).toBe("custom");
  });

  it("errors on a row with no class_code", () => {
    const { draft, error } = mapRowToDraft({ name: "Orphan", family: "X" });
    expect(draft).toBeUndefined();
    expect(error).toBe("missing class_code");
  });

  it("falls back to description for the name when no name column", () => {
    const { draft } = mapRowToDraft({ class_code: "500", description: "Catering" });
    expect(draft!.display_name).toBe("Catering");
    expect(draft!.description).toBeUndefined();
  });
});

describe("parseClassTableCsv — failure + skip handling", () => {
  it("reports a top-level parse failure for empty input", () => {
    const result = parseClassTableCsv("");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("keeps valid rows + flags the invalid one (no silent drop)", () => {
    const csv = ["class_code,name", "111,Good", ",Missing code"].join("\n");
    const result = parseClassTableCsv(csv);
    expect(result.ok).toBe(true);
    expect(result.validCount).toBe(1);
    expect(result.rows[0]!.draft!.class_code).toBe("111");
    expect(result.rows[1]!.error).toBe("missing class_code");
  });

  // A filing's trailing documentation row (long prose in class_code)
  // must be SKIPPED + reported, not 422 the whole batch (geo-importer parity).
  it("skips an over-length class_code instead of producing a draft", () => {
    const longCode = "MERIDIAN FICTIONAL CLASSIFICATION APPENDIX — documentation row".padEnd(80, ".");
    const csv = ["class_code,name", "c102,Meridian General Merchandise", `${longCode},Footer prose`].join("\n");
    const result = parseClassTableCsv(csv);
    expect(result.ok).toBe(true);
    expect(result.validCount).toBe(1);
    expect(result.rows[0]!.draft!.class_code).toBe("c102");
    expect(result.rows[1]!.draft).toBeUndefined();
    expect(result.rows[1]!.error).toMatch(/class_code too long/);
  });

  it("skips an over-length display_name instead of producing a draft", () => {
    const longName = "X".repeat(250);
    const { draft, error } = mapRowToDraft({ class_code: "c101", name: longName });
    expect(draft).toBeUndefined();
    expect(error).toMatch(/display_name too long/);
  });

  it("accepts a class_code at exactly the 40-char limit", () => {
    const code = "A".repeat(40);
    const { draft, error } = mapRowToDraft({ class_code: code, name: "Edge" });
    expect(error).toBeUndefined();
    expect(draft!.class_code).toBe(code);
  });
});
