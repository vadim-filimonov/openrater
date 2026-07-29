/**
 * ProductCode vocabulary tests (ADR-0033 §1).
 *
 * Verifies:
 *   - 11 codes exist (10 products + "other"), de-conflated from LineCode
 *   - professional split into do + eo; coverages (liability/property) gone
 *   - labels + descriptions populated for every code
 *   - isProductCode accepts canonical codes + rejects garbage
 *   - PRODUCT_CODES is frozen + canonical-ordered (UI depends on order)
 */

import { describe, it, expect } from "vitest";
import {
  PRODUCT_CODES,
  PRODUCT_LABELS,
  PRODUCT_DESCRIPTIONS,
  isProductCode,
} from "./product-types";
import type { ProductCode } from "./product-types";

describe("ProductCode vocabulary", () => {
  it("includes the 12 standard products + 'other'", () => {
    const expected: ProductCode[] = [
      "bop",
      "cgl",
      "do",
      "eo",
      "wc",
      "auto",
      "umbrella",
      "excess",
      "marine",
      "inland_marine",
      // Brief 94.6 (owner-gated) — personal lines join the axis.
      "homeowners",
      "dwelling",
      "other",
    ];
    expect([...PRODUCT_CODES].sort()).toEqual([...expected].sort());
  });

  it("de-conflates LineCode: splits professional into do + eo", () => {
    // The whole point of ADR-0033: D&O and E&O are distinct products,
    // not one "professional" code.
    expect(PRODUCT_CODES).toContain("do");
    expect(PRODUCT_CODES).toContain("eo");
    expect(PRODUCT_CODES as readonly string[]).not.toContain("professional");
  });

  it("de-conflates LineCode: coverages (liability/property) are NOT products", () => {
    // `liability` becomes `cgl` (a product); `property` is a COVERAGE
    // and leaves the product axis entirely.
    expect(PRODUCT_CODES).toContain("cgl");
    expect(PRODUCT_CODES as readonly string[]).not.toContain("liability");
    expect(PRODUCT_CODES as readonly string[]).not.toContain("property");
  });

  it("has a non-empty label for every code", () => {
    for (const code of PRODUCT_CODES) {
      expect(PRODUCT_LABELS[code]).toBeTruthy();
      expect(PRODUCT_LABELS[code].length).toBeGreaterThan(0);
    }
  });

  it("has a non-empty description for every code", () => {
    for (const code of PRODUCT_CODES) {
      expect(PRODUCT_DESCRIPTIONS[code]).toBeTruthy();
      expect(PRODUCT_DESCRIPTIONS[code].length).toBeGreaterThan(0);
    }
  });

  it("PRODUCT_CODES is canonical-ordered (matches export literal order)", () => {
    expect(PRODUCT_CODES).toEqual([
      "bop",
      "cgl",
      "do",
      "eo",
      "wc",
      "auto",
      "umbrella",
      "excess",
      "marine",
      "inland_marine",
      "homeowners",
      "dwelling",
      "other",
    ]);
  });
});

describe("immutability (Object.freeze guarantees)", () => {
  it("PRODUCT_CODES is frozen", () => {
    expect(Object.isFrozen(PRODUCT_CODES)).toBe(true);
  });
  it("PRODUCT_LABELS is frozen", () => {
    expect(Object.isFrozen(PRODUCT_LABELS)).toBe(true);
  });
  it("PRODUCT_DESCRIPTIONS is frozen", () => {
    expect(Object.isFrozen(PRODUCT_DESCRIPTIONS)).toBe(true);
  });
});

describe("isProductCode type guard", () => {
  it("accepts every ProductCode", () => {
    for (const code of PRODUCT_CODES) {
      expect(isProductCode(code)).toBe(true);
    }
  });

  it("rejects legacy LineCode values that are not products", () => {
    // These were valid LineCodes but are NOT ProductCodes — the guard
    // is the boundary that catches an un-migrated value.
    expect(isProductCode("professional")).toBe(false);
    expect(isProductCode("liability")).toBe(false);
    expect(isProductCode("property")).toBe(false);
  });

  it("rejects unknown strings + wrong case", () => {
    expect(isProductCode("cyber")).toBe(false);
    expect(isProductCode("BOP")).toBe(false);
    expect(isProductCode("do ")).toBe(false);
    expect(isProductCode("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isProductCode(null)).toBe(false);
    expect(isProductCode(undefined)).toBe(false);
    expect(isProductCode(123)).toBe(false);
    expect(isProductCode({})).toBe(false);
    expect(isProductCode(["do"])).toBe(false);
  });
});
