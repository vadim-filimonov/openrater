/**
 * Coverage entity tests (ADR-0033 §2).
 *
 * Verifies:
 *   - isCoverage accepts a well-formed coverage + rejects malformed
 *   - validateCoverages enforces coverage_id uniqueness + required fields
 *   - coveragesForProduct slices by the opaque product tag (generic)
 *   - the same shape serves multiple products identically (genericity)
 */

import { describe, it, expect } from "vitest";
import {
  isCoverage,
  validateCoverages,
  coveragesForProduct,
} from "./coverage-types";
import type { Coverage } from "./coverage-types";

const propertyCov: Coverage = {
  coverage_id: "property",
  display_name: "Property",
  product: "bop",
  output_field: "property_premium",
};

const sideACov: Coverage = {
  coverage_id: "side_a",
  display_name: "Side A",
  product: "do",
  output_field: "side_a_premium",
  limit: 5_000_000,
  retention: 0,
  exposure_ref: "revenue",
};

describe("isCoverage type guard", () => {
  it("accepts a minimal valid coverage", () => {
    expect(isCoverage(propertyCov)).toBe(true);
  });

  it("accepts a coverage with all optional fields", () => {
    expect(isCoverage(sideACov)).toBe(true);
  });

  it("rejects an unknown product (membership boundary)", () => {
    expect(
      isCoverage({ ...propertyCov, product: "professional" }),
    ).toBe(false);
  });

  it("rejects missing / empty required fields", () => {
    expect(isCoverage({ ...propertyCov, coverage_id: "" })).toBe(false);
    expect(isCoverage({ ...propertyCov, output_field: "" })).toBe(false);
    const { display_name: _omit, ...noName } = propertyCov;
    expect(isCoverage(noName)).toBe(false);
  });

  it("rejects wrong types on optional fields", () => {
    expect(isCoverage({ ...propertyCov, limit: "5m" })).toBe(false);
    expect(isCoverage({ ...propertyCov, retention: "none" })).toBe(false);
    expect(isCoverage({ ...propertyCov, exposure_ref: 42 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isCoverage(null)).toBe(false);
    expect(isCoverage(undefined)).toBe(false);
    expect(isCoverage("property")).toBe(false);
    expect(isCoverage(["property"])).toBe(false);
  });
});

describe("validateCoverages", () => {
  it("returns null for a unique, well-formed list", () => {
    expect(validateCoverages([propertyCov, sideACov])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(validateCoverages([])).toBeNull();
  });

  it("flags a duplicate coverage_id", () => {
    const dup = validateCoverages([propertyCov, { ...sideACov, coverage_id: "property" }]);
    expect(dup).toMatch(/duplicate coverage_id "property"/i);
  });

  it("flags an empty coverage_id", () => {
    expect(validateCoverages([{ ...propertyCov, coverage_id: "" }])).toMatch(
      /non-empty coverage_id/i,
    );
  });

  it("flags a missing output_field", () => {
    expect(validateCoverages([{ ...propertyCov, output_field: "" }])).toMatch(
      /must declare an output_field/i,
    );
  });
});

describe("coveragesForProduct (generic slice-by-opaque-tag)", () => {
  const all: Coverage[] = [
    propertyCov, // bop
    { coverage_id: "premises_liability", display_name: "Premises Liability", product: "bop", output_field: "liability_premium" },
    sideACov, // do
  ];

  it("filters to one product by its opaque tag", () => {
    const bop = coveragesForProduct(all, "bop");
    expect(bop.map((c) => c.coverage_id)).toEqual([
      "property",
      "premises_liability",
    ]);

    const dno = coveragesForProduct(all, "do");
    expect(dno.map((c) => c.coverage_id)).toEqual(["side_a"]);
  });

  it("returns empty for a product with no coverages", () => {
    expect(coveragesForProduct(all, "auto")).toEqual([]);
  });

  it("the SAME shape serves different products identically (genericity)", () => {
    // No code path differs between a bop coverage and a do coverage —
    // proving the entity is product-agnostic (ADR-0033 §0).
    for (const c of all) {
      expect(isCoverage(c)).toBe(true);
    }
  });
});
