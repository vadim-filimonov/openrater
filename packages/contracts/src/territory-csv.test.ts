/** Tests for territory-csv.ts. */

import { describe, it, expect } from "vitest";
import {
  TERRITORY_CSV_SCHEMA,
  groupByTerritoryCode,
} from "./territory-csv";
import { decodeCsv, encodeCsv } from "./csv";

describe("TERRITORY_CSV_SCHEMA", () => {
  it("has canonical column order: zip, territory_code, factor, citation_rule, citation_page", () => {
    expect(TERRITORY_CSV_SCHEMA.columns.map((c) => c.name)).toEqual([
      "zip",
      "territory_code",
      "factor",
      "citation_rule",
      "citation_page",
    ]);
  });

  it("zip + territory_code are required; the rest optional", () => {
    const required = TERRITORY_CSV_SCHEMA.columns
      .filter((c) => c.required)
      .map((c) => c.name);
    expect(required).toEqual(["zip", "territory_code"]);
  });

  it("pads single-digit-leading ZIPs (Excel integer-coercion fix)", () => {
    const csv = "zip,territory_code\n4001,1\n";
    const out = decodeCsv(csv, TERRITORY_CSV_SCHEMA);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows[0]!.zip).toBe("04001");
  });

  it("rejects malformed ZIPs", () => {
    const csv = "zip,territory_code\n12,1\n";
    const out = decodeCsv(csv, TERRITORY_CSV_SCHEMA);
    expect(out.ok).toBe(false);
  });

  it("encode + decode round-trips", () => {
    const rows = [
      {
        zip: "53201",
        territory_code: "1",
        factor: 1.2,
        citation_rule: "Meridian Rule MS-R11",
        citation_page: "p.100",
      },
      { zip: "53202", territory_code: "1" },
    ];
    const csv = encodeCsv(rows, TERRITORY_CSV_SCHEMA);
    const out = decodeCsv(csv, TERRITORY_CSV_SCHEMA);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows[0]!.zip).toBe("53201");
    expect(out.rows[0]!.factor).toBe(1.2);
    expect(out.rows[1]!.factor).toBeUndefined();
  });
});

describe("groupByTerritoryCode", () => {
  it("folds flat rows into per-territory groups", () => {
    const out = groupByTerritoryCode([
      { zip: "53201", territory_code: "1" },
      { zip: "53202", territory_code: "1" },
      { zip: "53203", territory_code: "2" },
    ]);
    expect(out.territories.length).toBe(2);
    expect(out.territories[0]!.territory_code).toBe("1");
    expect(out.territories[0]!.zips).toEqual(["53201", "53202"]);
    expect(out.territories[1]!.territory_code).toBe("2");
    expect(out.territories[1]!.zips).toEqual(["53203"]);
  });

  it("dedupes equal-ZIP rows within the same territory_code", () => {
    const out = groupByTerritoryCode([
      { zip: "53201", territory_code: "1" },
      { zip: "53201", territory_code: "1" },
    ]);
    expect(out.territories[0]!.zips).toEqual(["53201"]);
  });

  it("captures the shared factor + citation when consistent", () => {
    const out = groupByTerritoryCode([
      {
        zip: "53201",
        territory_code: "1",
        factor: 1.2,
        citation_rule: "Meridian Rule MS-R11",
      },
      {
        zip: "53202",
        territory_code: "1",
        factor: 1.2,
      },
    ]);
    expect(out.territories[0]!.factor).toBe(1.2);
    expect(out.territories[0]!.citation_rule).toBe("Meridian Rule MS-R11");
    expect(out.factor_conflicts).toEqual([]);
  });

  it("reports a factor_conflict when rows disagree on factor", () => {
    const out = groupByTerritoryCode([
      { zip: "53201", territory_code: "1", factor: 1.2 },
      { zip: "53202", territory_code: "1", factor: 1.3 },
    ]);
    expect(out.factor_conflicts).toHaveLength(1);
    expect(out.factor_conflicts[0]!.territory_code).toBe("1");
    expect(out.factor_conflicts[0]!.factors).toEqual([1.2, 1.3]);
  });

  it("returns territories in territory_code ascending order", () => {
    const out = groupByTerritoryCode([
      { zip: "X", territory_code: "B" },
      { zip: "Y", territory_code: "A" },
    ]);
    expect(out.territories.map((t) => t.territory_code)).toEqual(["A", "B"]);
  });

  it("returns empty result for empty input", () => {
    const out = groupByTerritoryCode([]);
    expect(out.territories).toEqual([]);
    expect(out.factor_conflicts).toEqual([]);
  });
});
