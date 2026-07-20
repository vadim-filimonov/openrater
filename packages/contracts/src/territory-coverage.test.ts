/**
 * Tests for territory-coverage.ts — Brief 20 P-TM3.
 */

import { describe, it, expect } from "vitest";
import {
  computeCoverage,
  emptyGeoCatalog,
  type GeoCatalog,
} from "./territory-coverage";
import type { Territory, TerritorySchema } from "./territory-types";

// ── Fixtures ─────────────────────────────────────────────────────

function mkTerritory(over: Partial<Territory>): Territory {
  return {
    id: "t-id",
    territory_code: "1",
    display_name: "Territory 1",
    factor: 1.0,
    state: "US-WI",
    boundary: { kind: "zip_set", zips: [] },
    citation_rule: "Meridian Rule MS-R11",
    citation_page: "p.100",
    ...over,
  };
}

function mkSchema(over: Partial<TerritorySchema>): TerritorySchema {
  return {
    id: "wi-bop-2026",
    state: "US-WI",
    display_name: "WI BOP",
    territories: [],
    ...over,
  };
}

function mkCatalog(over: Partial<GeoCatalog>): GeoCatalog {
  return { ...emptyGeoCatalog(), ...over };
}

// ── computeCoverage — gaps ───────────────────────────────────────

describe("computeCoverage — gaps", () => {
  it("reports ZIPs in the state but in no territory as gaps", () => {
    const schema = mkSchema({
      territories: [
        mkTerritory({
          id: "t1",
          boundary: { kind: "zip_set", zips: ["53201"] },
        }),
      ],
    });
    const catalog = mkCatalog({
      expectedZips: new Set(["53201", "53202", "53203"]),
    });
    const out = computeCoverage(schema, catalog);
    expect(out.gaps).toEqual(["53202", "53203"]);
  });

  it("returns empty gaps when every expected ZIP is covered", () => {
    const schema = mkSchema({
      territories: [
        mkTerritory({
          id: "t1",
          boundary: { kind: "zip_set", zips: ["53201", "53202"] },
        }),
      ],
    });
    const catalog = mkCatalog({
      expectedZips: new Set(["53201", "53202"]),
    });
    const out = computeCoverage(schema, catalog);
    expect(out.gaps).toEqual([]);
  });
});

// ── computeCoverage — overlaps ───────────────────────────────────

describe("computeCoverage — overlaps", () => {
  it("reports ZIPs in 2+ territories as overlaps", () => {
    const schema = mkSchema({
      territories: [
        mkTerritory({
          id: "t1",
          boundary: { kind: "zip_set", zips: ["53201", "53202"] },
        }),
        mkTerritory({
          id: "t2",
          territory_code: "2",
          boundary: { kind: "zip_set", zips: ["53202", "53203"] },
        }),
      ],
    });
    const catalog = mkCatalog({
      expectedZips: new Set(["53201", "53202", "53203"]),
    });
    const out = computeCoverage(schema, catalog);
    expect(out.overlaps).toHaveLength(1);
    expect(out.overlaps[0]!.zip).toBe("53202");
    expect(out.overlaps[0]!.territoryIds).toEqual(["t1", "t2"]);
  });

  it("returns empty overlaps for disjoint territories", () => {
    const schema = mkSchema({
      territories: [
        mkTerritory({
          id: "t1",
          boundary: { kind: "zip_set", zips: ["53201"] },
        }),
        mkTerritory({
          id: "t2",
          territory_code: "2",
          boundary: { kind: "zip_set", zips: ["53202"] },
        }),
      ],
    });
    const catalog = mkCatalog({
      expectedZips: new Set(["53201", "53202"]),
    });
    expect(computeCoverage(schema, catalog).overlaps).toEqual([]);
  });
});

// ── computeCoverage — stats ──────────────────────────────────────

describe("computeCoverage — per-territory stats", () => {
  it("computes zip_count + population + area for each territory", () => {
    const schema = mkSchema({
      territories: [
        mkTerritory({
          id: "t1",
          boundary: { kind: "zip_set", zips: ["53201", "53202"] },
        }),
      ],
    });
    const catalog = mkCatalog({
      expectedZips: new Set(["53201", "53202"]),
      populationOf: (zip) => (zip === "53201" ? 100 : 200),
      areaOf: () => 10,
    });
    const stats = computeCoverage(schema, catalog).statsByTerritory.get(
      "t1",
    )!;
    expect(stats.zip_count).toBe(2);
    expect(stats.population).toBe(300);
    expect(stats.area_sq_mi).toBe(20);
  });
});

// ── computeCoverage — polygon mode ────────────────────────────────

describe("computeCoverage — polygon claim resolution", () => {
  it("uses zipIntersectsPolygon callback for polygon boundaries", () => {
    const schema = mkSchema({
      territories: [
        mkTerritory({
          id: "t-poly",
          boundary: {
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
          },
        }),
      ],
    });
    const catalog = mkCatalog({
      expectedZips: new Set(["A", "B", "C"]),
      zipIntersectsPolygon: (zip) => zip !== "C", // A + B inside, C outside
    });
    const out = computeCoverage(schema, catalog);
    expect(out.gaps).toEqual(["C"]);
    expect(out.statsByTerritory.get("t-poly")!.zip_count).toBe(2);
  });
});

// ── computeCoverage — totals ─────────────────────────────────────

describe("computeCoverage — totals", () => {
  it("reports expected + covered counts for both ZIPs + FIPS", () => {
    const schema = mkSchema({
      territories: [
        mkTerritory({
          id: "t1",
          boundary: { kind: "zip_set", zips: ["53201"] },
        }),
        mkTerritory({
          id: "t2",
          territory_code: "2",
          boundary: { kind: "fips_set", counties: ["55079"] },
        }),
      ],
    });
    const catalog = mkCatalog({
      expectedZips: new Set(["53201", "53202", "53203"]),
      expectedFips: new Set(["55079", "55101"]),
    });
    const totals = computeCoverage(schema, catalog).totals;
    expect(totals.expectedZips).toBe(3);
    expect(totals.coveredZips).toBe(1);
    expect(totals.expectedFips).toBe(2);
    expect(totals.coveredFips).toBe(1);
  });
});
