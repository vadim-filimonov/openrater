/**
 * Tests for the CSV → ClassDraft mapping (Brief 51 bulk import).
 *
 * The load-bearing rule: a real ISO BOP `class_table` loads with its
 * derived rating attributes (prop_rate_number / liab_class_group /
 * liab_exposure_base / …) routed into `attributes` automatically.
 */

import { describe, it, expect } from "vitest";
import { parseClassTableCsv, mapRowToDraft } from "./classCsv";

// The real KS filing class_table header + two rows.
const CLASS_TABLE_CSV = [
  "class_code,description,sic_code,naics_code,prop_rate_number,liab_class_group,liab_exposure_base,liability_kind,eq_grade,eqsl_grade,citation_rule,citation_page",
  "09015,Bagelry,5812,722515,18,cg_40,sales,occupant,2,M,ISO BOP Classification Table #1(CT),BP-CT-1..47",
  "53983,Army/Navy Retail,5311,452990,09,cg_07,sales,occupant,3,L,ISO BOP Classification Table #1(CT),BP-CT-1..47",
].join("\n");

describe("parseClassTableCsv — real ISO BOP class_table", () => {
  it("maps every row + routes unknown columns into attributes", () => {
    const result = parseClassTableCsv(CLASS_TABLE_CSV);
    expect(result.ok).toBe(true);
    expect(result.validCount).toBe(2);
    expect(result.rows).toHaveLength(2);

    const bagelry = result.rows[0]!.draft!;
    expect(bagelry.class_code).toBe("09015");
    // `description` column holds the NAME in the class_table convention.
    expect(bagelry.display_name).toBe("Bagelry");
    expect(bagelry.description).toBeUndefined(); // not duplicated into description
    expect(bagelry.naics_code).toBe("722515");
    expect(bagelry.sic_code).toBe("5812");
    expect(bagelry.citation_rule).toBe("ISO BOP Classification Table #1(CT)");
    expect(bagelry.citation_page).toBe("BP-CT-1..47");
    // The derived rating attributes — the whole point.
    expect(bagelry.attributes).toEqual({
      prop_rate_number: "18",
      liab_class_group: "cg_40",
      liab_exposure_base: "sales",
      liability_kind: "occupant",
      eq_grade: "2",
      eqsl_grade: "M",
    });

    const armyNavy = result.rows[1]!.draft!;
    expect(armyNavy.class_code).toBe("53983");
    expect(armyNavy.attributes.prop_rate_number).toBe("09"); // leading zero kept
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

  // F3 — a filing's trailing documentation row (long prose in class_code)
  // must be SKIPPED + reported, not 422 the whole batch (geo-importer parity).
  it("skips an over-length class_code instead of producing a draft", () => {
    const longCode = "THE CLASSIFICATION ENTRY POINT — 456 codes extracted from the KS manual".padEnd(80, ".");
    const csv = ["class_code,name", "09015,Bagelry", `${longCode},Footer prose`].join("\n");
    const result = parseClassTableCsv(csv);
    expect(result.ok).toBe(true);
    expect(result.validCount).toBe(1);
    expect(result.rows[0]!.draft!.class_code).toBe("09015");
    expect(result.rows[1]!.draft).toBeUndefined();
    expect(result.rows[1]!.error).toMatch(/class_code too long/);
  });

  it("skips an over-length display_name instead of producing a draft", () => {
    const longName = "X".repeat(250);
    const { draft, error } = mapRowToDraft({ class_code: "53983", name: longName });
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
