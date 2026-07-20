/**
 * Tests for territory-types.ts — Brief 20 §6.
 */

import { describe, it, expect } from "vitest";
import {
  enumerateFipsFromBoundary,
  enumerateZipsFromBoundary,
  isBoundaryNonEmpty,
  isValidFipsFormat,
  isValidZipFormat,
  normalizeStateCode,
  type TerritoryBoundary,
} from "./territory-types";

describe("isValidZipFormat", () => {
  it("accepts 5-digit ZIPs", () => {
    expect(isValidZipFormat("53201")).toBe(true);
    expect(isValidZipFormat("90210")).toBe(true);
    expect(isValidZipFormat("04001")).toBe(true);
  });

  it("rejects non-5-digit strings", () => {
    expect(isValidZipFormat("532")).toBe(false);
    expect(isValidZipFormat("532012")).toBe(false);
    expect(isValidZipFormat("5320a")).toBe(false);
    expect(isValidZipFormat("")).toBe(false);
  });
});

describe("isValidFipsFormat", () => {
  it("accepts 5-digit FIPS", () => {
    expect(isValidFipsFormat("55079")).toBe(true); // Milwaukee, WI
  });

  it("rejects malformed FIPS", () => {
    expect(isValidFipsFormat("550")).toBe(false);
    expect(isValidFipsFormat("5507a")).toBe(false);
  });
});

describe("normalizeStateCode", () => {
  it("passes through ISO-3166-2", () => {
    expect(normalizeStateCode("US-WI")).toBe("US-WI");
  });

  it("normalizes 2-letter abbrev", () => {
    expect(normalizeStateCode("wi")).toBe("US-WI");
    expect(normalizeStateCode("CA")).toBe("US-CA");
  });

  it("returns undefined for unknown forms", () => {
    expect(normalizeStateCode("Wisconsin")).toBeUndefined();
    expect(normalizeStateCode("US")).toBeUndefined();
    expect(normalizeStateCode("")).toBeUndefined();
  });
});

describe("isBoundaryNonEmpty", () => {
  it("is true for non-empty zip_set", () => {
    expect(
      isBoundaryNonEmpty({ kind: "zip_set", zips: ["53201"] }),
    ).toBe(true);
  });

  it("is false for empty zip_set", () => {
    expect(isBoundaryNonEmpty({ kind: "zip_set", zips: [] })).toBe(false);
  });

  it("is true for non-empty fips_set", () => {
    expect(
      isBoundaryNonEmpty({ kind: "fips_set", counties: ["55079"] }),
    ).toBe(true);
  });

  it("is true for polygon with rings", () => {
    const boundary: TerritoryBoundary = {
      kind: "polygon",
      geojson: {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
    };
    expect(isBoundaryNonEmpty(boundary)).toBe(true);
  });

  it("is false for polygon with empty coords", () => {
    const boundary: TerritoryBoundary = {
      kind: "polygon",
      geojson: {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [] },
      },
    };
    expect(isBoundaryNonEmpty(boundary)).toBe(false);
  });
});

describe("enumerateZipsFromBoundary / enumerateFipsFromBoundary", () => {
  it("returns the zip list for zip_set", () => {
    expect(
      enumerateZipsFromBoundary({
        kind: "zip_set",
        zips: ["53201", "53202"],
      }),
    ).toEqual(["53201", "53202"]);
  });

  it("returns empty for fips_set / polygon zip enumeration", () => {
    expect(
      enumerateZipsFromBoundary({ kind: "fips_set", counties: ["55079"] }),
    ).toEqual([]);
  });

  it("returns the fips list for fips_set", () => {
    expect(
      enumerateFipsFromBoundary({
        kind: "fips_set",
        counties: ["55079", "55101"],
      }),
    ).toEqual(["55079", "55101"]);
  });

  it("returns empty for zip_set fips enumeration", () => {
    expect(
      enumerateFipsFromBoundary({ kind: "zip_set", zips: ["53201"] }),
    ).toEqual([]);
  });
});
