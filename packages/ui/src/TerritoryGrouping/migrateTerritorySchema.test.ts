/**
 * Tests for migrateTerritorySchemaToGeoDim — Brief 44 PR 44.9.
 *
 * Covers the conversion table:
 *
 *   schema.state="US-WI"  → geo_scope.states=["WI"]
 *   schema.state="WI"     → geo_scope.states=["WI"]
 *   schema.state="bogus"  → empty states + warning
 *   boundary.kind=zip_set → geo_granularity=zip, members=zips
 *   boundary.kind=fips_set→ geo_granularity=county, members=counties
 *   boundary.kind=polygon → granularity=state fallback + warning
 *
 *   schema.territories.length===0 → empty levels + warning
 */

import { describe, expect, it } from "vitest";
import type { TerritorySchema, Territory } from "@openrater/contracts";
import { migrateTerritorySchemaToGeoDim } from "./migrateTerritorySchema";

function zipTerritory(
  id: string,
  code: string,
  zips: readonly string[],
): Territory {
  return {
    id,
    territory_code: code,
    display_name: `Territory ${code}`,
    factor: 1.0,
    state: "US-WI",
    boundary: { kind: "zip_set", zips },
    citation_rule: "",
    citation_page: "",
  };
}

function fipsTerritory(
  id: string,
  code: string,
  counties: readonly string[],
): Territory {
  return {
    id,
    territory_code: code,
    display_name: `Territory ${code}`,
    factor: 1.0,
    state: "US-WI",
    boundary: { kind: "fips_set", counties },
    citation_rule: "",
    citation_page: "",
  };
}

function polygonTerritory(id: string, code: string): Territory {
  return {
    id,
    territory_code: code,
    display_name: `Territory ${code}`,
    factor: 1.0,
    state: "US-WI",
    boundary: {
      kind: "polygon",
      geojson: {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-93, 42],
              [-87, 42],
              [-87, 47],
              [-93, 47],
              [-93, 42],
            ],
          ],
        },
      },
    },
    citation_rule: "",
    citation_page: "",
  };
}

function schema(
  state: string,
  territories: readonly Territory[],
): TerritorySchema {
  return {
    id: "ts_1",
    state,
    display_name: "WI BOP 2026 territories",
    territories,
  };
}

describe("migrateTerritorySchemaToGeoDim", () => {
  it("preserves display name", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [zipTerritory("t1", "1", ["53201", "53202"])]),
    );
    expect(out.display_name).toBe("WI BOP 2026 territories");
  });

  it("converts ISO-3166-2 state code (US-WI) to USPS (WI)", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [zipTerritory("t1", "1", ["53201"])]),
    );
    expect(out.geo_scope).toEqual({ kind: "subset", states: ["WI"] });
    expect(out.warnings).toEqual([]);
  });

  it("accepts plain USPS code (WI) without warning", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("WI", [zipTerritory("t1", "1", ["53201"])]),
    );
    expect(out.geo_scope).toEqual({ kind: "subset", states: ["WI"] });
    expect(out.warnings).toEqual([]);
  });

  it("warns when state can't be parsed as a USPS code", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("bogus", [zipTerritory("t1", "1", ["53201"])]),
    );
    expect(out.geo_scope).toEqual({ kind: "subset", states: [] });
    expect(
      out.warnings.some((w) => w.includes("couldn't be parsed")),
    ).toBe(true);
  });

  it("infers zip granularity when boundaries are zip_set", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [
        zipTerritory("t1", "1", ["53201", "53202"]),
        zipTerritory("t2", "2", ["53703"]),
      ]),
    );
    expect(out.geo_granularity).toBe("zip");
  });

  it("infers county granularity when boundaries are fips_set", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [
        fipsTerritory("t1", "1", ["55079"]),
        fipsTerritory("t2", "2", ["55025"]),
      ]),
    );
    expect(out.geo_granularity).toBe("county");
  });

  it("zip wins the tie when boundary kinds are split", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [
        zipTerritory("t1", "1", ["53201"]),
        fipsTerritory("t2", "2", ["55025"]),
      ]),
    );
    expect(out.geo_granularity).toBe("zip");
  });

  it("falls back to state granularity with a warning when only polygons", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [polygonTerritory("t1", "1")]),
    );
    expect(out.geo_granularity).toBe("state");
    expect(
      out.warnings.some((w) => w.includes("polygon")),
    ).toBe(true);
  });

  it("warns for polygon-kind boundaries even when mixed with zip", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [
        zipTerritory("t1", "1", ["53201"]),
        polygonTerritory("t2", "2"),
      ]),
    );
    expect(out.geo_granularity).toBe("zip");
    expect(
      out.warnings.some((w) => w.includes("polygon")),
    ).toBe(true);
  });

  it("granularityOverride wins over inference", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [zipTerritory("t1", "1", ["53201"])]),
      { granularityOverride: "state" },
    );
    expect(out.geo_granularity).toBe("state");
  });

  it("warns on empty schemas + leaves levels empty", () => {
    const out = migrateTerritorySchemaToGeoDim(schema("US-WI", []));
    expect(out.levels).toEqual([]);
    expect(
      out.warnings.some((w) => w.includes("no territories")),
    ).toBe(true);
  });

  it("levels are unioned + deduped across territories", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [
        zipTerritory("t1", "1", ["53201", "53202"]),
        zipTerritory("t2", "2", ["53202", "53703"]), // 53202 dupes
      ]),
    );
    expect(out.levels.map((l) => l.id)).toEqual([
      "53201",
      "53202",
      "53703",
    ]);
  });

  it("preserves territory grouping — one GeoTerritory per source Territory", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [
        zipTerritory("t1", "Urban", ["53201", "53202"]),
        zipTerritory("t2", "Rural", ["53703"]),
      ]),
    );
    expect(out.geo_territories).toHaveLength(2);
    expect(out.geo_territories[0]).toEqual({
      id: "t1",
      label: "Territory Urban",
      members: ["53201", "53202"],
    });
    expect(out.geo_territories[1]).toEqual({
      id: "t2",
      label: "Territory Rural",
      members: ["53703"],
    });
  });

  it("territory label falls back to territory_code if display_name is empty", () => {
    const t: Territory = {
      ...zipTerritory("t1", "Urban-A", ["53201"]),
      display_name: "",
    };
    const out = migrateTerritorySchemaToGeoDim(schema("US-WI", [t]));
    expect(out.geo_territories[0]?.label).toBe("Urban-A");
  });

  it("polygon territories yield empty members but stay in the geo_territories list", () => {
    const out = migrateTerritorySchemaToGeoDim(
      schema("US-WI", [
        zipTerritory("t1", "1", ["53201"]),
        polygonTerritory("t2", "2"),
      ]),
    );
    expect(out.geo_territories).toHaveLength(2);
    expect(out.geo_territories[1]?.members).toEqual([]);
  });

  it("is deterministic — same input → same output", () => {
    const input = schema("US-WI", [
      zipTerritory("t1", "1", ["53201", "53202"]),
      zipTerritory("t2", "2", ["53703"]),
    ]);
    const a = migrateTerritorySchemaToGeoDim(input);
    const b = migrateTerritorySchemaToGeoDim(input);
    expect(a).toEqual(b);
  });
});
