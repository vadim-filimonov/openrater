/**
 * ClassLibrary helper tests.
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

const CAFE: ClassLibraryEntry = {
  class_code: "c101",
  display_name: "Meridian Cafe",
  exposure_bases: [
    { code: "sales", is_primary: true, unit: "USD" },
  ],
};

const WORKSHOP: ClassLibraryEntry = {
  class_code: "c201",
  display_name: "Meridian Workshop",
  exposure_bases: [
    { code: "payroll", is_primary: true, unit: "USD" },
  ],
};

describe("makeClassLibrary", () => {
  it("returns a frozen library", () => {
    const lib = makeClassLibrary([CAFE]);
    expect(Object.isFrozen(lib)).toBe(true);
  });

  it("looks up entries by class_code", () => {
    const lib = makeClassLibrary([CAFE, WORKSHOP]);
    expect(lib.lookup("c101")).toEqual(CAFE);
    expect(lib.lookup("c201")).toEqual(WORKSHOP);
  });

  it("returns undefined for unknown codes", () => {
    const lib = makeClassLibrary([CAFE]);
    expect(lib.lookup("c999")).toBeUndefined();
    expect(lib.lookup("")).toBeUndefined();
  });

  it("is deterministic — lookup() returns identical references on repeat", () => {
    const lib = makeClassLibrary([CAFE]);
    const a = lib.lookup("c101");
    const b = lib.lookup("c101");
    expect(a).toBe(b);
  });

  it("handles duplicate class_codes by last-write-wins (no error)", () => {
    const dupOriginal: ClassLibraryEntry = {
      class_code: "c101",
      display_name: "Old name",
      exposure_bases: [],
    };
    const dupNewer: ClassLibraryEntry = {
      class_code: "c101",
      display_name: "Meridian Cafe (updated)",
      exposure_bases: [{ code: "sales", is_primary: true, unit: "USD" }],
    };
    const lib = makeClassLibrary([dupOriginal, dupNewer]);
    expect(lib.lookup("c101")?.display_name).toBe("Meridian Cafe (updated)");
  });

  it("handles empty input", () => {
    const lib = makeClassLibrary([]);
    expect(lib.lookup("any")).toBeUndefined();
  });
});
