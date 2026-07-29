/**
 * ClassLibrary helper tests (M1.2, Brief 16).
 *
 * Verifies:
 *   - makeClassLibrary builds a frozen Map-backed lookup
 *   - lookup() returns entries by code; undefined for unknown
 *   - Same library instance is referentially stable (frozen)
 *   - Multiple entries with the same class_code: last write wins (the
 *     consumer is responsible for de-duplication; we don't error)
 */

import { describe, it, expect } from "vitest";
import { makeClassLibrary } from "./class-library-types";
import type { ClassLibraryEntry } from "./class-library-types";

const RESTAURANTS: ClassLibraryEntry = {
  class_code: "71641",
  display_name: "Restaurants",
  exposure_bases: [
    { code: "sales", is_primary: true, unit: "USD" },
  ],
};

const CONCRETE: ClassLibraryEntry = {
  class_code: "91342",
  display_name: "Concrete contractors",
  exposure_bases: [
    { code: "payroll", is_primary: true, unit: "USD" },
  ],
};

describe("makeClassLibrary", () => {
  it("returns a frozen library", () => {
    const lib = makeClassLibrary([RESTAURANTS]);
    expect(Object.isFrozen(lib)).toBe(true);
  });

  it("looks up entries by class_code", () => {
    const lib = makeClassLibrary([RESTAURANTS, CONCRETE]);
    expect(lib.lookup("71641")).toEqual(RESTAURANTS);
    expect(lib.lookup("91342")).toEqual(CONCRETE);
  });

  it("returns undefined for unknown codes", () => {
    const lib = makeClassLibrary([RESTAURANTS]);
    expect(lib.lookup("99999")).toBeUndefined();
    expect(lib.lookup("")).toBeUndefined();
  });

  it("is deterministic — lookup() returns identical references on repeat", () => {
    const lib = makeClassLibrary([RESTAURANTS]);
    const a = lib.lookup("71641");
    const b = lib.lookup("71641");
    expect(a).toBe(b);
  });

  it("handles duplicate class_codes by last-write-wins (no error)", () => {
    const dupOriginal: ClassLibraryEntry = {
      class_code: "71641",
      display_name: "Old name",
      exposure_bases: [],
    };
    const dupNewer: ClassLibraryEntry = {
      class_code: "71641",
      display_name: "Restaurants (updated)",
      exposure_bases: [{ code: "sales", is_primary: true, unit: "USD" }],
    };
    const lib = makeClassLibrary([dupOriginal, dupNewer]);
    expect(lib.lookup("71641")?.display_name).toBe("Restaurants (updated)");
  });

  it("handles empty input", () => {
    const lib = makeClassLibrary([]);
    expect(lib.lookup("any")).toBeUndefined();
  });
});
