/**
 * Preflight tests pin that the header meets the dictionary before any
 * row rates, and that the sentence
 * names the culprit — missing column, misspelled column, foreign
 * delimiter — never a per-row lookup error.
 */

import { describe, it, expect } from "vitest";
import {
  preflightBook,
  preflightHeader,
  sniffDelimiter,
  type PreflightInput,
} from "./preflight";

const MERIDIAN: PreflightInput[] = [
  { name: "class_code", display_name: "Class code", required: true },
  { name: "building_limit", display_name: "Building limit", required: true },
  { name: "bpp_limit", display_name: "BPP limit", required: true },
  { name: "annual_gross_sales", display_name: "Annual gross sales", required: true },
  { name: "construction_class", display_name: "Construction", required: true },
  { name: "protection_class", display_name: "Protection class", required: true },
  { name: "zip", display_name: "Location ZIP", required: true },
  { name: "sprinklered", display_name: "Sprinklered", required: false },
  { name: "years_in_business", display_name: "Years in business", required: false },
];

describe("preflightHeader", () => {
  it("the demo book maps clean: every column matched, nothing to say", () => {
    const p = preflightHeader(
      [
        "class_code",
        "building_limit",
        "bpp_limit",
        "annual_gross_sales",
        "construction_class",
        "protection_class",
        "zip",
        "sprinklered",
        "years_in_business",
      ],
      MERIDIAN,
    );
    expect(p.matched).toHaveLength(9);
    expect(p.ok).toBe(true);
    expect(p.missing).toEqual([]);
    expect(p.sentence).toBeNull();
  });

  it("display names match as synonyms (normalized)", () => {
    const p = preflightHeader(["Class Code", "Building Limit"], MERIDIAN);
    expect(p.matched).toEqual([
      { column: "Class Code", input: "class_code" },
      { column: "Building Limit", input: "building_limit" },
    ]);
  });

  it("a missing required column is NAMED, and blocks", () => {
    const p = preflightHeader(
      ["building_limit", "bpp_limit", "annual_gross_sales",
       "construction_class", "protection_class", "zip"],
      MERIDIAN,
    );
    expect(p.ok).toBe(false);
    expect(p.missing).toEqual(["class_code"]);
    expect(p.sentence).toContain("Missing: class_code");
  });

  it("a misspelled column becomes a suggestion, not an unknown", () => {
    const p = preflightHeader(["building_lmit"], [
      { name: "building_limit", display_name: "Building limit", required: true },
    ]);
    expect(p.suggested).toEqual([
      {
        column: "building_lmit",
        input: "building_limit",
        reason: "looks like building_limit",
      },
    ]);
    // The suggestion does NOT satisfy the requirement (ok stays false —
    // a person confirms), but it isn't double-listed as "Missing":
    // the suggestion clause already names it.
    expect(p.ok).toBe(false);
    expect(p.missing).toEqual([]);
    expect(p.sentence).toContain("building_lmit looks like building_limit");
  });

  it("an extra column is named as ignored; rating still proceeds", () => {
    const p = preflightHeader(
      [
        "class_code", "building_limit", "bpp_limit", "annual_gross_sales",
        "construction_class", "protection_class", "zip", "sq_footage",
      ],
      MERIDIAN,
    );
    expect(p.ok).toBe(true);
    expect(p.unknown).toEqual(["sq_footage"]);
    expect(p.sentence).toContain(
      "1 of your column isn't a plan input (sq_footage) — ignored unless mapped.",
    );
  });
});

describe("sniffDelimiter / preflightBook", () => {
  it("a semicolon file is refused BY NAME", () => {
    const csv = "class_code;building_limit;zip\nc101;250000;68102\n";
    const p = preflightBook(csv, MERIDIAN);
    expect(p.delimiter).toBe(";");
    expect(p.ok).toBe(false);
    expect(p.note).toContain("semicolons");
  });

  it("CRLF + BOM headers parse silently", () => {
    const csv =
      "﻿class_code,building_limit,bpp_limit,annual_gross_sales," +
      "construction_class,protection_class,zip\r\nc101,1,2,3,jm,p1_4,68102\r\n";
    const p = preflightBook(csv, MERIDIAN);
    expect(p.ok).toBe(true);
    expect(p.matched.map((m) => m.input)).toContain("class_code");
  });

  it("comma stays the default on a one-column file", () => {
    expect(sniffDelimiter("class_code")).toEqual({
      delimiter: ",",
      note: null,
    });
  });
});
