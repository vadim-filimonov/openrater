/**
 * Unit tests for `derive.class_attribute` (ADR-0035 — Brief 51).
 *
 * Locks the runtime contract:
 *   - a class code resolves to its derived structural attribute value
 *   - leading zeros are significant ("00101" ≠ "101") — no lowercasing
 *   - trimmed + coerced value matching (" 45101 ", numeric 45101)
 *   - a class not in the table falls back to defaultValue (or "" when
 *     unset, which then propagates to a downstream lookup's default)
 *   - explainStep renders the auditor-friendly derivation line
 *   - validate warns on an empty table (mid-author / empty registry)
 */

import { describe, it, expect } from "vitest";
import { DeriveClassAttributeKind } from "./derive-class-attribute";

// Intentionally invented Meridian reference rows. These identifiers and
// values are synthetic and are not copied from any carrier or bureau filing.
const CLASS_TO_RATE_NUMBER: Readonly<Record<string, string>> = {
  "00101": "11", // Meridian general merchandise
  "00102": "12", // Meridian apparel shop
  "00103": "13", // Meridian professional office
  "45101": "07", // Meridian neighborhood bakery (leading zero is intentional)
  "56101": "22", // Meridian hardware shop
};

describe("derive.class_attribute — execute", () => {
  it("derives a structural attribute from a class code", () => {
    const out = DeriveClassAttributeKind.execute(
      { class_code: "45101" },
      { attributeKey: "prop_rate_number", table: CLASS_TO_RATE_NUMBER },
    );
    expect(out.value).toBe("07");
  });

  it("derives a different class correctly", () => {
    const out = DeriveClassAttributeKind.execute(
      { class_code: "00101" },
      { attributeKey: "prop_rate_number", table: CLASS_TO_RATE_NUMBER },
    );
    expect(out.value).toBe("11");
  });

  it("trims + coerces a numeric class code (defends unknown externalInputs)", () => {
    // A CSV cell or webhook field may arrive as a number or padded.
    const numeric = DeriveClassAttributeKind.execute(
      { class_code: 45101 as unknown as string },
      { attributeKey: "prop_rate_number", table: CLASS_TO_RATE_NUMBER },
    );
    expect(numeric.value).toBe("07");
    const padded = DeriveClassAttributeKind.execute(
      { class_code: "  45101  " },
      { attributeKey: "prop_rate_number", table: CLASS_TO_RATE_NUMBER },
    );
    expect(padded.value).toBe("07");
  });

  it("preserves leading zeros — '101' does NOT match '00101'", () => {
    // Class codes are case-sensitive digit-strings; a number that dropped
    // its leading zero must NOT silently resolve to the wrong class.
    const out = DeriveClassAttributeKind.execute(
      { class_code: 101 as unknown as string },
      {
        attributeKey: "prop_rate_number",
        table: CLASS_TO_RATE_NUMBER,
        defaultValue: "__unknown__",
      },
    );
    expect(out.value).toBe("__unknown__");
  });

  it("falls back to defaultValue for a class not in the table", () => {
    const out = DeriveClassAttributeKind.execute(
      { class_code: "00000" },
      {
        attributeKey: "prop_rate_number",
        table: CLASS_TO_RATE_NUMBER,
        defaultValue: "fallback-rate",
      },
    );
    expect(out.value).toBe("fallback-rate");
  });

  it("returns empty string on a miss when no default is set (propagates to lookup default)", () => {
    const out = DeriveClassAttributeKind.execute(
      { class_code: "00000" },
      { attributeKey: "prop_rate_number", table: CLASS_TO_RATE_NUMBER },
    );
    expect(out.value).toBe("");
  });

  it("returns the default for an empty / missing class code", () => {
    const out = DeriveClassAttributeKind.execute(
      { class_code: "" },
      {
        attributeKey: "prop_rate_number",
        table: CLASS_TO_RATE_NUMBER,
        defaultValue: "fallback-rate",
      },
    );
    expect(out.value).toBe("fallback-rate");
  });
});

describe("derive.class_attribute — override (Brief 83 / TV-19)", () => {
  const BASE_TABLE: Readonly<Record<string, string>> = {
    "45101": "loi", // fictional Meridian occupant class
  };

  it("a non-empty override supersedes the class-derived value", () => {
    // A fictional Meridian occupant class elects the lessors basis.
    const out = DeriveClassAttributeKind.execute(
      { class_code: "45101", override: "lessors_loi" },
      { attributeKey: "liab_exposure_base", table: BASE_TABLE },
    );
    expect(out.value).toBe("lessors_loi");
  });

  it("an absent/empty/whitespace override falls through to the derivation", () => {
    for (const override of [undefined, "", "   "]) {
      const out = DeriveClassAttributeKind.execute(
        { class_code: "45101", ...(override !== undefined ? { override } : {}) },
        { attributeKey: "liab_exposure_base", table: BASE_TABLE },
      );
      expect(out.value).toBe("loi");
    }
  });

  it("override wins even when the class is NOT in the table (no default leak)", () => {
    const out = DeriveClassAttributeKind.execute(
      { class_code: "99999", override: "payroll" },
      { attributeKey: "liab_exposure_base", table: BASE_TABLE, defaultValue: "loi" },
    );
    expect(out.value).toBe("payroll");
  });

  it("explainStep names the override as declared, not derived", () => {
    const line = DeriveClassAttributeKind.explainStep!(
      { class_code: "45101", override: "lessors_loi" },
      { attributeKey: "liab_exposure_base", table: BASE_TABLE },
      { value: "lessors_loi" },
    );
    expect(line).toContain("Declared liab_exposure_base override");
    expect(line).toContain("lessors_loi");
    expect(line).toContain("supersedes");
  });

  it("collectRowIssues stays silent when an override answers for an unknown class", () => {
    const issues = DeriveClassAttributeKind.collectRowIssues!(
      { class_code: "99999", override: "payroll" },
      { attributeKey: "liab_exposure_base", table: BASE_TABLE },
      { value: "payroll" },
    );
    expect(issues).toBeUndefined();
    // …and still warns without one (the pre-existing contract).
    const noOverride = DeriveClassAttributeKind.collectRowIssues!(
      { class_code: "99999" },
      { attributeKey: "liab_exposure_base", table: BASE_TABLE },
      { value: "" },
    );
    expect(noOverride?.[0]?.code).toBe("class_attribute_missing");
  });
});

describe("derive.class_attribute — explainStep", () => {
  it("renders the derivation line for a hit (with table name)", () => {
    const params = {
      attributeKey: "prop_rate_number",
      table: CLASS_TO_RATE_NUMBER,
      tableName: "Meridian fictional class table",
    };
    const out = DeriveClassAttributeKind.execute({ class_code: "45101" }, params);
    const explain = DeriveClassAttributeKind.explainStep!(
      { class_code: "45101" },
      params,
      out,
    );
    expect(explain).toBe(
      "Derived prop_rate_number of class 45101 → 07 (Meridian fictional class table)",
    );
  });

  it("renders the default line for a miss", () => {
    const params = {
      attributeKey: "liab_class_group",
      table: CLASS_TO_RATE_NUMBER,
      defaultValue: "mg_default",
    };
    const out = DeriveClassAttributeKind.execute({ class_code: "00000" }, params);
    const explain = DeriveClassAttributeKind.explainStep!(
      { class_code: "00000" },
      params,
      out,
    );
    expect(explain).toBe(
      "Class 00000 not in liab_class_group table → mg_default (default)",
    );
  });

  it("falls back to 'attribute' when attributeKey is empty", () => {
    const params = { attributeKey: "", table: CLASS_TO_RATE_NUMBER };
    const out = DeriveClassAttributeKind.execute({ class_code: "56101" }, params);
    const explain = DeriveClassAttributeKind.explainStep!(
      { class_code: "56101" },
      params,
      out,
    );
    expect(explain).toBe("Derived attribute of class 56101 → 22");
  });
});

describe("derive.class_attribute — validate", () => {
  it("accepts a non-empty table", () => {
    const result = DeriveClassAttributeKind.validate!({
      attributeKey: "prop_rate_number",
      table: CLASS_TO_RATE_NUMBER,
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("warns on an empty table (empty registry / mid-author)", () => {
    const result = DeriveClassAttributeKind.validate!({
      attributeKey: "prop_rate_number",
      table: {},
    });
    expect(result.valid).toBe(true);
    expect(result.issues[0]?.severity).toBe("warning");
    expect(result.issues[0]?.field).toBe("table");
  });
});
