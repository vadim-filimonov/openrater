/**
 * ExposureBase vocabulary + declaration helpers tests (M1.1, Brief 16).
 *
 * Verifies:
 *   - Vocabulary is correct (6 codes)
 *   - Labels + descriptions + default units populated
 *   - isExposureBaseCode guard works
 *   - slugifyCustomLabel handles edge cases
 *   - exposureInputKey resolves standard + custom codes correctly
 *   - pickExposureDeclaration honors resolution rules from Brief 16 §6
 *   - validateExposureDeclarations catches the exactly-one-primary
 *     invariant + the custom_label-required-for-"other" rule
 */

import { describe, it, expect } from "vitest";
import {
  EXPOSURE_BASE_CODES,
  EXPOSURE_BASE_LABELS,
  EXPOSURE_BASE_DEFAULT_UNIT,
  EXPOSURE_BASE_DESCRIPTIONS,
  EXPOSURE_INPUT_KEYS,
  exposureInputKey,
  isExposureBaseCode,
  pickExposureDeclaration,
  slugifyCustomLabel,
  validateExposureDeclarations,
} from "./exposure-types";
import type { ExposureBaseCode, ExposureBaseDeclaration } from "./exposure-types";

describe("ExposureBase vocabulary", () => {
  it("includes all 6 standard codes", () => {
    const expected: ExposureBaseCode[] = [
      "sales",
      "payroll",
      "area",
      "receipts",
      "units",
      "other",
    ];
    expect([...EXPOSURE_BASE_CODES].sort()).toEqual([...expected].sort());
  });

  it("has label / description / default-unit for every code", () => {
    for (const code of EXPOSURE_BASE_CODES) {
      expect(EXPOSURE_BASE_LABELS[code]).toBeTruthy();
      expect(EXPOSURE_BASE_DESCRIPTIONS[code]).toBeTruthy();
      // "other" intentionally has empty default unit (declarer fills it)
      if (code !== "other") {
        expect(EXPOSURE_BASE_DEFAULT_UNIT[code]).toBeTruthy();
      }
    }
  });
});

describe("immutability (Object.freeze guarantees)", () => {
  it("EXPOSURE_BASE_CODES is frozen", () => {
    expect(Object.isFrozen(EXPOSURE_BASE_CODES)).toBe(true);
  });

  it("EXPOSURE_BASE_LABELS is frozen", () => {
    expect(Object.isFrozen(EXPOSURE_BASE_LABELS)).toBe(true);
  });

  it("EXPOSURE_BASE_DEFAULT_UNIT is frozen", () => {
    expect(Object.isFrozen(EXPOSURE_BASE_DEFAULT_UNIT)).toBe(true);
  });

  it("EXPOSURE_BASE_DESCRIPTIONS is frozen", () => {
    expect(Object.isFrozen(EXPOSURE_BASE_DESCRIPTIONS)).toBe(true);
  });

  it("EXPOSURE_INPUT_KEYS is frozen", () => {
    expect(Object.isFrozen(EXPOSURE_INPUT_KEYS)).toBe(true);
  });
});

describe("isExposureBaseCode", () => {
  it("accepts every code", () => {
    for (const code of EXPOSURE_BASE_CODES) {
      expect(isExposureBaseCode(code)).toBe(true);
    }
  });

  it("rejects unknown strings + non-strings", () => {
    expect(isExposureBaseCode("sale")).toBe(false); // missing s
    expect(isExposureBaseCode("Sales")).toBe(false); // capitalized
    expect(isExposureBaseCode(null)).toBe(false);
    expect(isExposureBaseCode(undefined)).toBe(false);
    expect(isExposureBaseCode(0)).toBe(false);
  });
});

describe("slugifyCustomLabel", () => {
  it("lowercases + replaces non-alphanumerics with underscores", () => {
    expect(slugifyCustomLabel("Miles driven")).toBe("miles_driven");
    expect(slugifyCustomLabel("Cubic Yards (CY)")).toBe("cubic_yards_cy");
    expect(slugifyCustomLabel("Boilers / Tanks")).toBe("boilers_tanks");
  });

  it("trims leading/trailing punctuation", () => {
    expect(slugifyCustomLabel("  Hello!  ")).toBe("hello");
    expect(slugifyCustomLabel("__weird__")).toBe("weird");
  });

  it("collapses consecutive non-alphanumerics", () => {
    expect(slugifyCustomLabel("a---b...c")).toBe("a_b_c");
  });

  it("returns empty string for input with no alphanumerics", () => {
    expect(slugifyCustomLabel("!!!")).toBe("");
    expect(slugifyCustomLabel("")).toBe("");
  });
});

describe("exposureInputKey", () => {
  it("uses the standard mapping for non-other codes", () => {
    expect(exposureInputKey(decl("sales"))).toBe("annual_sales");
    expect(exposureInputKey(decl("payroll"))).toBe("annual_payroll");
    expect(exposureInputKey(decl("area"))).toBe("area_sqft");
    expect(exposureInputKey(decl("receipts"))).toBe("annual_receipts");
    expect(exposureInputKey(decl("units"))).toBe("unit_count");
  });

  it("builds a slugged key for 'other' code", () => {
    expect(
      exposureInputKey({
        code: "other",
        is_primary: true,
        unit: "miles",
        custom_label: "Miles driven",
      }),
    ).toBe("custom_exposure_miles_driven");
  });

  it("falls back to 'custom_exposure' when custom_label is missing/empty", () => {
    expect(
      exposureInputKey({ code: "other", is_primary: true, unit: "" }),
    ).toBe("custom_exposure");
    expect(
      exposureInputKey({
        code: "other",
        is_primary: true,
        unit: "",
        custom_label: "!!!",
      }),
    ).toBe("custom_exposure");
  });
});

describe("pickExposureDeclaration", () => {
  const sales: ExposureBaseDeclaration = {
    code: "sales",
    is_primary: true,
    unit: "USD",
    coverage_tags: ["liability", "property"],
  };
  const payroll: ExposureBaseDeclaration = {
    code: "payroll",
    is_primary: false,
    unit: "USD",
    coverage_tags: ["wc"],
  };
  const area: ExposureBaseDeclaration = {
    code: "area",
    is_primary: false,
    unit: "sq ft",
    // no coverage_tags = applies to all
  };

  it("returns undefined when no declarations", () => {
    expect(pickExposureDeclaration([], "liability")).toBeUndefined();
    expect(pickExposureDeclaration([])).toBeUndefined();
  });

  it("returns the primary when no scope provided", () => {
    expect(pickExposureDeclaration([sales, payroll])).toBe(sales);
    expect(pickExposureDeclaration([sales, payroll], null)).toBe(sales);
  });

  it("matches by coverage_tags when scope provided", () => {
    expect(pickExposureDeclaration([sales, payroll, area], "wc")).toBe(payroll);
    expect(pickExposureDeclaration([sales, payroll, area], "liability")).toBe(
      sales,
    );
  });

  it("falls back to primary when no declaration matches the scope", () => {
    expect(pickExposureDeclaration([sales, payroll], "auto")).toBe(sales);
  });

  it("when multiple match a scope, prefers the primary", () => {
    const altPrimary: ExposureBaseDeclaration = {
      code: "receipts",
      is_primary: true,
      unit: "USD",
      coverage_tags: ["wc"],
    };
    expect(pickExposureDeclaration([altPrimary, payroll], "wc")).toBe(altPrimary);
  });
});

describe("validateExposureDeclarations", () => {
  it("accepts empty list (legacy / not yet declared)", () => {
    expect(validateExposureDeclarations([])).toBeNull();
  });

  it("accepts exactly one primary", () => {
    expect(
      validateExposureDeclarations([
        { code: "sales", is_primary: true, unit: "USD" },
      ]),
    ).toBeNull();
    expect(
      validateExposureDeclarations([
        { code: "sales", is_primary: true, unit: "USD" },
        { code: "payroll", is_primary: false, unit: "USD" },
      ]),
    ).toBeNull();
  });

  it("rejects zero primaries when declarations present", () => {
    expect(
      validateExposureDeclarations([
        { code: "sales", is_primary: false, unit: "USD" },
      ]),
    ).toMatch(/must have exactly one primary/);
  });

  it("rejects multiple primaries", () => {
    expect(
      validateExposureDeclarations([
        { code: "sales", is_primary: true, unit: "USD" },
        { code: "payroll", is_primary: true, unit: "USD" },
      ]),
    ).toMatch(/only one primary/);
  });

  it("rejects 'other' code without custom_label", () => {
    expect(
      validateExposureDeclarations([
        { code: "other", is_primary: true, unit: "miles" },
      ]),
    ).toMatch(/custom_label/);
  });

  it("accepts 'other' code with custom_label", () => {
    expect(
      validateExposureDeclarations([
        {
          code: "other",
          is_primary: true,
          unit: "miles",
          custom_label: "Miles driven",
        },
      ]),
    ).toBeNull();
  });
});

// Helper for tests above
function decl(code: ExposureBaseCode): ExposureBaseDeclaration {
  return {
    code,
    is_primary: true,
    unit: code === "area" ? "sq ft" : code === "units" ? "units" : "USD",
  };
}
