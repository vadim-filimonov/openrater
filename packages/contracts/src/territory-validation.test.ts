/**
 * Tests for territory-validation.ts — Brief 20 §6.
 */

import { describe, it, expect } from "vitest";
import { validateTerritorySchema } from "./territory-validation";
import type { Territory, TerritorySchema } from "./territory-types";

function mkTerritory(over: Partial<Territory>): Territory {
  return {
    id: "t-id",
    territory_code: "1",
    display_name: "Territory 1",
    factor: 1.0,
    state: "US-WI",
    boundary: { kind: "zip_set", zips: ["53201"] },
    citation_rule: "ISO BOP §11",
    citation_page: "p.100",
    ...over,
  };
}

function mkSchema(over: Partial<TerritorySchema>): TerritorySchema {
  return {
    id: "wi-bop-2026",
    state: "US-WI",
    display_name: "WI BOP territories",
    territories: [mkTerritory({})],
    ...over,
  };
}

describe("validateTerritorySchema — clean", () => {
  it("returns no issues for a clean schema", () => {
    expect(validateTerritorySchema(mkSchema({}))).toEqual([]);
  });
});

describe("validateTerritorySchema — territory_code", () => {
  it("flags empty territory_code as error", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [mkTerritory({ territory_code: "  " })],
      }),
    );
    const v = issues.find((i) => i.message.includes("empty territory_code"));
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
  });

  it("flags duplicate territory_code as error", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [
          mkTerritory({ id: "a" }),
          mkTerritory({ id: "b", boundary: { kind: "zip_set", zips: ["53202"] } }),
        ],
      }),
    );
    const v = issues.find((i) => i.message.includes("appears 2 times"));
    expect(v).toBeDefined();
  });
});

describe("validateTerritorySchema — factor", () => {
  it("flags non-finite factor as error", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [mkTerritory({ factor: NaN })],
      }),
    );
    const v = issues.find((i) => i.message.includes("non-finite"));
    expect(v).toBeDefined();
  });

  it("flags zero / negative factor as error", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [mkTerritory({ factor: 0 })],
      }),
    );
    const v = issues.find((i) => i.message.includes("must be positive"));
    expect(v).toBeDefined();
  });
});

describe("validateTerritorySchema — state mismatch", () => {
  it("flags territory.state ≠ schema.state as error", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [mkTerritory({ state: "US-CA" })],
      }),
    );
    const v = issues.find((i) => i.message.includes("state="));
    expect(v).toBeDefined();
  });
});

describe("validateTerritorySchema — zip_set", () => {
  it("flags invalid ZIP format as error", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [
          mkTerritory({ boundary: { kind: "zip_set", zips: ["123"] } }),
        ],
      }),
    );
    const v = issues.find((i) => i.message.includes("invalid ZIP"));
    expect(v).toBeDefined();
  });

  it("warns on duplicate ZIPs within the same territory", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [
          mkTerritory({
            boundary: { kind: "zip_set", zips: ["53201", "53201", "53202"] },
          }),
        ],
      }),
    );
    const v = issues.find((i) => i.message.includes("duplicate"));
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });
});

describe("validateTerritorySchema — fips_set", () => {
  it("flags invalid FIPS format as error", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [
          mkTerritory({
            boundary: { kind: "fips_set", counties: ["55079", "abc"] },
          }),
        ],
      }),
    );
    const v = issues.find((i) => i.message.includes("invalid FIPS"));
    expect(v).toBeDefined();
  });
});

describe("validateTerritorySchema — empty boundary", () => {
  it("warns on empty zip_set", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [
          mkTerritory({ boundary: { kind: "zip_set", zips: [] } }),
        ],
      }),
    );
    const v = issues.find((i) => i.message.includes("empty boundary"));
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });
});

describe("validateTerritorySchema — citations", () => {
  it("warns on missing citation", () => {
    const issues = validateTerritorySchema(
      mkSchema({
        territories: [
          mkTerritory({ citation_rule: "", citation_page: "" }),
        ],
      }),
    );
    const v = issues.find((i) => i.message.includes("missing a citation"));
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });
});

describe("validateTerritorySchema — determinism", () => {
  it("produces stable Issue ids for the same input", () => {
    const a = validateTerritorySchema(
      mkSchema({
        territories: [mkTerritory({ factor: -1 })],
      }),
    );
    const b = validateTerritorySchema(
      mkSchema({
        territories: [mkTerritory({ factor: -1 })],
      }),
    );
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
  });
});
