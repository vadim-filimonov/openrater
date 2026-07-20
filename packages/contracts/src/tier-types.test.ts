/**
 * Eligibility tier + comparator tests (M1.3, Brief 10).
 */

import { describe, it, expect } from "vitest";
import {
  ELIGIBILITY_TIERS,
  ELIGIBILITY_TIER_LABELS,
  ELIGIBILITY_TIER_DESCRIPTIONS,
  ELIGIBILITY_OPS,
  isEligibilityTier,
  evaluateEligibilityComparator,
} from "./tier-types";

describe("EligibilityTier vocabulary", () => {
  it("includes the 4 standard tiers in preferred → decline order", () => {
    expect(ELIGIBILITY_TIERS).toEqual([
      "preferred",
      "standard",
      "submit",
      "decline",
    ]);
  });

  it("has label + description for every tier", () => {
    for (const t of ELIGIBILITY_TIERS) {
      expect(ELIGIBILITY_TIER_LABELS[t]).toBeTruthy();
      expect(ELIGIBILITY_TIER_DESCRIPTIONS[t]).toBeTruthy();
    }
  });

  it("constant maps are frozen (immutability invariant)", () => {
    expect(Object.isFrozen(ELIGIBILITY_TIERS)).toBe(true);
    expect(Object.isFrozen(ELIGIBILITY_TIER_LABELS)).toBe(true);
    expect(Object.isFrozen(ELIGIBILITY_TIER_DESCRIPTIONS)).toBe(true);
    expect(Object.isFrozen(ELIGIBILITY_OPS)).toBe(true);
  });
});

describe("isEligibilityTier", () => {
  it("accepts every tier", () => {
    for (const t of ELIGIBILITY_TIERS) {
      expect(isEligibilityTier(t)).toBe(true);
    }
  });

  it("rejects unknown strings + non-strings", () => {
    expect(isEligibilityTier("Preferred")).toBe(false);
    expect(isEligibilityTier("good")).toBe(false);
    expect(isEligibilityTier("")).toBe(false);
    expect(isEligibilityTier(null)).toBe(false);
    expect(isEligibilityTier(undefined)).toBe(false);
    expect(isEligibilityTier(0)).toBe(false);
  });
});

describe("EligibilityOp vocabulary", () => {
  it("includes 8 comparators", () => {
    expect(ELIGIBILITY_OPS).toHaveLength(8);
  });
});

describe("evaluateEligibilityComparator", () => {
  describe("equality (eq / ne)", () => {
    it("eq on equal primitives → true", () => {
      expect(evaluateEligibilityComparator("eq", 5, 5)).toBe(true);
      expect(evaluateEligibilityComparator("eq", "WI", "WI")).toBe(true);
      expect(evaluateEligibilityComparator("eq", true, true)).toBe(true);
    });

    it("eq on unequal primitives → false", () => {
      expect(evaluateEligibilityComparator("eq", 5, 6)).toBe(false);
      expect(evaluateEligibilityComparator("eq", "WI", "MN")).toBe(false);
    });

    it("ne is the inverse of eq", () => {
      expect(evaluateEligibilityComparator("ne", 5, 6)).toBe(true);
      expect(evaluateEligibilityComparator("ne", 5, 5)).toBe(false);
    });
  });

  describe("numeric ordering (lt / le / gt / ge)", () => {
    it("comparisons work on finite numbers", () => {
      expect(evaluateEligibilityComparator("lt", 5, 6)).toBe(true);
      expect(evaluateEligibilityComparator("lt", 5, 5)).toBe(false);
      expect(evaluateEligibilityComparator("le", 5, 5)).toBe(true);
      expect(evaluateEligibilityComparator("gt", 6, 5)).toBe(true);
      expect(evaluateEligibilityComparator("ge", 5, 5)).toBe(true);
    });

    it("returns false (not throws) for non-numeric values", () => {
      expect(evaluateEligibilityComparator("lt", "WI", 5)).toBe(false);
      expect(evaluateEligibilityComparator("gt", 5, undefined)).toBe(false);
      expect(evaluateEligibilityComparator("le", NaN, 5)).toBe(false);
      expect(evaluateEligibilityComparator("ge", 5, Infinity)).toBe(false);
    });
  });

  describe("membership (in / nin)", () => {
    it("in returns true when value is in the array", () => {
      expect(
        evaluateEligibilityComparator("in", "WI", ["WI", "MN", "IL"]),
      ).toBe(true);
    });

    it("in returns false when value is not in the array", () => {
      expect(
        evaluateEligibilityComparator("in", "TX", ["WI", "MN", "IL"]),
      ).toBe(false);
    });

    it("in returns false when right is not an array", () => {
      expect(
        evaluateEligibilityComparator("in", "WI", "WI" as unknown),
      ).toBe(false);
    });

    it("nin is the inverse of in", () => {
      expect(
        evaluateEligibilityComparator("nin", "TX", ["WI", "MN", "IL"]),
      ).toBe(true);
      expect(
        evaluateEligibilityComparator("nin", "WI", ["WI", "MN", "IL"]),
      ).toBe(false);
    });

    it("nin returns false when right is not an array", () => {
      expect(
        evaluateEligibilityComparator("nin", "WI", "WI" as unknown),
      ).toBe(false);
    });
  });

  // Platform-test finding E3 — rule builders persist numeric-looking
  // codes as ints while book columns deliver strings (and vice versa).
  // The comparator bridges the number/numeric-string seam so those
  // rules match instead of silently leaking declines to the default.
  describe("number/numeric-string seam (finding E3)", () => {
    it("eq matches a number against its numeric string (both directions)", () => {
      expect(evaluateEligibilityComparator("eq", "60989", 60989)).toBe(true);
      expect(evaluateEligibilityComparator("eq", 60989, "60989")).toBe(true);
      // Zero-padded identifiers compare by numeric value too.
      expect(evaluateEligibilityComparator("eq", "09035", 9035)).toBe(true);
    });

    it("ne stays the inverse across the seam", () => {
      expect(evaluateEligibilityComparator("ne", "60989", 60989)).toBe(false);
      expect(evaluateEligibilityComparator("ne", "60989", 60990)).toBe(true);
    });

    it("eq does NOT coerce booleans or non-numeric strings", () => {
      expect(evaluateEligibilityComparator("eq", true, 1)).toBe(false);
      expect(evaluateEligibilityComparator("eq", "1", true)).toBe(false);
      expect(evaluateEligibilityComparator("eq", "", 0)).toBe(false);
      expect(evaluateEligibilityComparator("eq", "12a", 12)).toBe(false);
    });

    it("in matches a string input against an int list (the decline-leak case)", () => {
      // The E3 symptom verbatim: class_code arrives "60989" (string),
      // the saved list holds ints → previously never matched.
      expect(
        evaluateEligibilityComparator("in", "60989", [60989, 9035]),
      ).toBe(true);
      expect(
        evaluateEligibilityComparator("in", 9035, ["09035", "60989"]),
      ).toBe(true);
      expect(
        evaluateEligibilityComparator("in", "12345", [60989, 9035]),
      ).toBe(false);
    });

    it("nin stays the inverse across the seam", () => {
      expect(
        evaluateEligibilityComparator("nin", "60989", [60989, 9035]),
      ).toBe(false);
      expect(
        evaluateEligibilityComparator("nin", "12345", [60989, 9035]),
      ).toBe(true);
    });

    it("ordering comparators accept numeric strings on either side", () => {
      expect(evaluateEligibilityComparator("lt", "0", 1)).toBe(true);
      expect(evaluateEligibilityComparator("ge", 1000000, "1000000")).toBe(
        true,
      );
      expect(evaluateEligibilityComparator("gt", "999999", "1000000")).toBe(
        false,
      );
      // Non-numeric strings still degrade to false, never throw.
      expect(evaluateEligibilityComparator("lt", "WI", 5)).toBe(false);
      expect(evaluateEligibilityComparator("le", "", 5)).toBe(false);
    });
  });
});
