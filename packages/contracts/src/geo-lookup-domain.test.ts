/**
 * ADR-0038 — canonical geographic-dimension lookup domain.
 *
 * Pins the single source of truth the factor grid, the input validator, and
 * the engine projector all read through. The cold-test shape is the KS ZIP
 * dim fully grouped into territories 701/702.
 */

import { describe, it, expect } from "vitest";

import {
  isGeographicLookupDim,
  activeGeoTerritories,
  geoLookupKeys,
  resolveGeographicValue,
  geoAcceptanceSet,
  geoValueToKeyMap,
  inferDimensionShape,
  type GeoLookupDimLike,
} from "./dimension-types";

// KS ZIP dim, every ZIP grouped into 701/702 (the cold-test shape).
const ksFull: GeoLookupDimLike = {
  levels: [
    { id: "66101", label: "Kansas City 66101" },
    { id: "66102", label: "Kansas City 66102" },
    { id: "66201", label: "Mission 66201" },
    { id: "67201", label: "Wichita 67201" },
  ],
  geo_territories: [
    { id: "701", label: "Kansas City / Wyandotte metro", members: ["66101", "66102"] },
    { id: "702", label: "Rest of state", members: ["66201", "67201"] },
  ],
};

// Partially grouped: one ZIP left ungrouped.
const partial: GeoLookupDimLike = {
  levels: [
    { id: "66101", label: "metro" },
    { id: "66201", label: "rest" },
    { id: "67555", label: "Lone town" },
  ],
  geo_territories: [
    { id: "701", label: "Metro", members: ["66101"] },
    { id: "702", label: "Rest", members: ["66201"] },
  ],
};

// The live-bug shape: empty-membership buckets + hand-added levels.
const emptyBuckets: GeoLookupDimLike = {
  levels: [
    { id: "701", label: "701" },
    { id: "702", label: "702" },
  ],
  geo_territories: [
    { id: "territory_1", label: "New territory", members: [] },
    { id: "territory_2", label: "New territory", members: [] },
  ],
};

// No territories — rate directly on the granular levels (V21).
const states: GeoLookupDimLike = {
  levels: [
    { id: "KS", label: "Kansas" },
    { id: "MO", label: "Missouri" },
  ],
};

describe("isGeographicLookupDim (the F3 routing predicate)", () => {
  it("is true for dimension_type:'geographic' even when shape is 'categorical'", () => {
    // The live-bug shape — the wizard stamped shape:"categorical". This is
    // exactly why we must NOT route via inferDimensionShape (which returns the
    // explicit "categorical" here and would mis-route to the categorical
    // validator — the F3 failure).
    const liveDim = { dimension_type: "geographic" as const, shape: "categorical" as const };
    expect(isGeographicLookupDim(liveDim)).toBe(true);
    expect(inferDimensionShape(liveDim)).toBe("categorical"); // proves the trap
  });
  it("is true for shape:'geographic' alone (no dimension_type)", () => {
    expect(isGeographicLookupDim({ shape: "geographic" })).toBe(true);
  });
  it("is false for a plain categorical or banded dim", () => {
    expect(isGeographicLookupDim({ dimension_type: "standard", shape: "categorical" })).toBe(false);
    expect(isGeographicLookupDim({ shape: "banded" })).toBe(false);
  });
});

describe("activeGeoTerritories", () => {
  it("keeps only territories with ≥1 member", () => {
    expect(activeGeoTerritories(ksFull).map((t) => t.id)).toEqual(["701", "702"]);
  });
  it("drops empty-membership buckets (the live-bug shape)", () => {
    expect(activeGeoTerritories(emptyBuckets)).toEqual([]);
  });
  it("is empty for a dim with no territories", () => {
    expect(activeGeoTerritories(states)).toEqual([]);
  });
});

describe("geoLookupKeys — the rating key space", () => {
  it("collapses a fully-grouped dim to exactly its territories (701/702)", () => {
    expect(geoLookupKeys(ksFull).map((k) => k.id)).toEqual(["701", "702"]);
  });

  it("is territory ids ∪ ungrouped levels when grouping is partial", () => {
    expect(geoLookupKeys(partial).map((k) => k.id)).toEqual(["701", "702", "67555"]);
  });

  it("falls back to the granular levels when no territory is active", () => {
    // The live bug: empty buckets must NOT key the grid (was territory_1/2).
    expect(geoLookupKeys(emptyBuckets).map((k) => k.id)).toEqual(["701", "702"]);
  });

  it("uses the granular levels for an ungrouped geo dim", () => {
    expect(geoLookupKeys(states).map((k) => k.id)).toEqual(["KS", "MO"]);
  });

  it("carries the territory label, not the granular label", () => {
    expect(geoLookupKeys(ksFull)[0]).toEqual({
      id: "701",
      label: "Kansas City / Wyandotte metro",
    });
  });
});

describe("resolveGeographicValue", () => {
  it("maps a grouped member level to its territory (ZIP → 701)", () => {
    expect(resolveGeographicValue(ksFull, "66101")).toEqual({
      key: "701",
      unmapped: false,
    });
  });

  it("passes a territory id through idempotently (701 → 701)", () => {
    expect(resolveGeographicValue(ksFull, "701")).toEqual({
      key: "701",
      unmapped: false,
    });
  });

  it("is case-insensitive + trims (the engine analogue's contract)", () => {
    expect(resolveGeographicValue(ksFull, "  66201 ").key).toBe("702");
    expect(resolveGeographicValue(states, "ks").key).toBe("KS");
  });

  it("resolves an ungrouped level to itself", () => {
    expect(resolveGeographicValue(partial, "67555")).toEqual({
      key: "67555",
      unmapped: false,
    });
  });

  it("returns unmapped for a value in no territory and no level", () => {
    expect(resolveGeographicValue(ksFull, "99999")).toEqual({
      key: null,
      unmapped: true,
    });
    // An empty bucket's id is not a key (it isn't active).
    expect(resolveGeographicValue(emptyBuckets, "territory_1").key).toBeNull();
  });

  it("resolves a plain level for an ungrouped geo dim; unknown → null", () => {
    expect(resolveGeographicValue(states, "MO").key).toBe("MO");
    expect(resolveGeographicValue(states, "CA")).toEqual({
      key: null,
      unmapped: true,
    });
  });
});

describe("geoValueToKeyMap — the derive.territory map (mixed model)", () => {
  it("maps every grouped member to its territory", () => {
    expect(geoValueToKeyMap(ksFull)).toEqual({
      "66101": "701",
      "66102": "701",
      "66201": "702",
      "67201": "702",
    });
  });

  it("self-maps the ungrouped tail so the territory-keyed lookup still resolves it", () => {
    expect(geoValueToKeyMap(partial)).toEqual({
      "66101": "701",
      "66201": "702",
      "67555": "67555",
    });
  });

  it("is empty when there is no active grouping (projector keeps the direct lookup)", () => {
    expect(geoValueToKeyMap(emptyBuckets)).toEqual({});
    expect(geoValueToKeyMap(states)).toEqual({});
  });
});

describe("geoAcceptanceSet — the validator's accepted-value set", () => {
  it("accepts both the ZIP and the territory id (carries territory OR ZIP)", () => {
    const set = geoAcceptanceSet(ksFull);
    expect(set.has("66101")).toBe(true); // a ZIP
    expect(set.has("701")).toBe(true); // a territory id
    expect(set.has("99999")).toBe(false);
  });

  // The load-bearing invariant: the validator accepts exactly the values the
  // engine can resolve to a key. If these ever diverge, F3 reopens.
  it("equals exactly { v : resolveGeographicValue(v).key !== null } (the F3 guard)", () => {
    const fixtures: ReadonlyArray<[string, GeoLookupDimLike]> = [
      ["ksFull", ksFull],
      ["partial", partial],
      ["emptyBuckets", emptyBuckets],
      ["states", states],
    ];
    const outsiders = ["99999", "ZZ", "territory_1", "", "  ", "Territory"];
    for (const [name, dim] of fixtures) {
      const set = geoAcceptanceSet(dim);
      const candidates = new Set<string>(outsiders);
      for (const l of dim.levels ?? []) candidates.add(l.id);
      for (const t of dim.geo_territories ?? []) {
        candidates.add(t.id);
        for (const m of t.members) candidates.add(m);
      }
      for (const v of candidates) {
        const inSet = set.has(v.trim().toLowerCase());
        const resolves = resolveGeographicValue(dim, v).key !== null;
        expect(inSet, `${name}: acceptance vs resolve disagree for "${v}"`).toBe(
          resolves,
        );
      }
    }
  });
});
