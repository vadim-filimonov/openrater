/**
 * Territory coverage diagnostics — Brief 20 §1.4 + P-TM3.
 *
 * Pure functions that compute:
 *   · GAPS: ZIPs (or FIPS) in the state's expected set but not covered
 *     by any territory boundary in the schema. → filing-blocking error.
 *   · OVERLAPS: ZIPs covered by ≥2 territories. → save-blocking error.
 *   · PER-TERRITORY STATS: ZIP count + population + area_sq_mi.
 *
 * The "expected set" for a state is the canonical list of ZIPs (or
 * FIPS) USPS / Census publish. We accept it as input rather than
 * baking the data in — the caller (route or labs-ui consumer) loads
 * the data once and passes it in. This keeps @openrater/contracts free of
 * megabyte-scale geo data.
 *
 * For polygon-mode territories we accept an explicit `zip_membership`
 * callback that maps a ZIP to whether it lies inside a polygon. Real
 * implementations use a point-in-polygon test against a centroid
 * lookup; the test suite supplies a stub.
 *
 * No I/O. Pure + deterministic.
 */

import type {
  Territory,
  TerritorySchema,
  TerritoryStats,
} from "./territory-types";

/**
 * Per-ZIP centroid + population + area lookup. Real impls load this
 * from a CDN-served JSON keyed by ZIP. We accept the closure here
 * so the contracts package doesn't ship the data.
 */
export interface GeoCatalog {
  /** All ZIPs the schema is expected to cover (state's canonical list). */
  readonly expectedZips: ReadonlySet<string>;
  /** All county FIPS the schema is expected to cover. */
  readonly expectedFips: ReadonlySet<string>;
  /** ACS 5-year population for a ZIP. Returns 0 for unknown. */
  readonly populationOf: (zip: string) => number;
  /** Land area (sq mi) for a ZIP. Returns 0 for unknown. */
  readonly areaOf: (zip: string) => number;
  /**
   * For polygon boundaries: returns true if the ZIP's centroid is
   * inside the polygon. Real impls run point-in-polygon. The catalog
   * supplies this so the validator doesn't need to embed geo math.
   */
  readonly zipIntersectsPolygon: (
    zip: string,
    territoryId: string,
  ) => boolean;
}

/**
 * Aggregate coverage report. The diagnostics sidebar renders this.
 */
export interface CoverageReport {
  /** ZIPs expected but not in ANY territory boundary. */
  readonly gaps: readonly string[];
  /**
   * ZIPs in more than one territory. Each entry lists the offending
   * territory ids in the order they appeared in the schema.
   */
  readonly overlaps: readonly OverlapEntry[];
  /** Per-territory cached stats, keyed by territory id. */
  readonly statsByTerritory: ReadonlyMap<string, TerritoryStats>;
  /**
   * Total expected coverage from the catalog. Used by the sidebar
   * to compute "coverage %" badges.
   */
  readonly totals: {
    readonly expectedZips: number;
    readonly coveredZips: number;
    readonly expectedFips: number;
    readonly coveredFips: number;
  };
}

export interface OverlapEntry {
  readonly zip: string;
  readonly territoryIds: readonly string[];
}

/**
 * Compute the full coverage report for a schema. Pure + O(N × M)
 * worst case where N = expectedZips and M = territories; for the
 * largest US state (CA ≈ 2700 ZIPs × 50 territories) this is
 * trivially fast (<10ms).
 */
export function computeCoverage(
  schema: TerritorySchema,
  catalog: GeoCatalog,
): CoverageReport {
  // ── 1. Build per-ZIP membership index ───────────────────────────
  // Walks each territory once; appends the territory id to every
  // ZIP it claims. After this pass we know, for every expected ZIP,
  // which territories claim it.
  const membership = new Map<string, string[]>();
  for (const t of schema.territories) {
    const claimedZips = collectClaimedZips(t, catalog);
    for (const zip of claimedZips) {
      const arr = membership.get(zip);
      if (arr) {
        if (!arr.includes(t.id)) arr.push(t.id);
      } else {
        membership.set(zip, [t.id]);
      }
    }
  }

  // ── 2. Walk expectedZips → gaps + overlaps ──────────────────────
  const gaps: string[] = [];
  const overlaps: OverlapEntry[] = [];
  for (const zip of catalog.expectedZips) {
    const claimants = membership.get(zip);
    if (!claimants || claimants.length === 0) {
      gaps.push(zip);
    } else if (claimants.length > 1) {
      overlaps.push({ zip, territoryIds: claimants });
    }
  }

  // ── 3. Compute per-territory stats ──────────────────────────────
  const statsByTerritory = new Map<string, TerritoryStats>();
  for (const t of schema.territories) {
    const claimedZips = collectClaimedZips(t, catalog);
    let population = 0;
    let area = 0;
    for (const zip of claimedZips) {
      population += catalog.populationOf(zip);
      area += catalog.areaOf(zip);
    }
    statsByTerritory.set(t.id, {
      zip_count: claimedZips.length,
      population,
      area_sq_mi: area,
    });
  }

  // ── 4. Totals ───────────────────────────────────────────────────
  const coveredZips = membership.size;
  const fipsMembership = new Set<string>();
  for (const t of schema.territories) {
    if (t.boundary.kind === "fips_set") {
      for (const fips of t.boundary.counties) fipsMembership.add(fips);
    }
  }

  return {
    gaps: gaps.sort(),
    overlaps: overlaps.sort((a, b) => (a.zip < b.zip ? -1 : 1)),
    statsByTerritory,
    totals: {
      expectedZips: catalog.expectedZips.size,
      coveredZips,
      expectedFips: catalog.expectedFips.size,
      coveredFips: fipsMembership.size,
    },
  };
}

// ── Internal: claim resolution ────────────────────────────────────

/**
 * Returns the deduped list of ZIPs a territory claims. For zip_set
 * boundaries this is the explicit list; for fips_set boundaries it
 * is the empty list (callers compute ZIPs from FIPS-mapping out-of-
 * band when needed); for polygon boundaries it's every ZIP whose
 * centroid lies inside the polygon per the catalog callback.
 */
function collectClaimedZips(
  territory: Territory,
  catalog: GeoCatalog,
): string[] {
  switch (territory.boundary.kind) {
    case "zip_set":
      return dedupe(territory.boundary.zips);
    case "fips_set":
      // FIPS-only territories don't claim ZIPs by themselves; the
      // route can compose a ZIP claim if desired by looking up ZIPs
      // per FIPS. Phase B' / Brief 4 work.
      return [];
    case "polygon": {
      const claimed: string[] = [];
      for (const zip of catalog.expectedZips) {
        if (catalog.zipIntersectsPolygon(zip, territory.id)) {
          claimed.push(zip);
        }
      }
      return claimed;
    }
  }
}

function dedupe(arr: readonly string[]): string[] {
  return Array.from(new Set(arr));
}

/**
 * Convenience: build an empty catalog. Useful for tests + as a
 * fallback when the geo data hasn't loaded yet.
 */
export function emptyGeoCatalog(): GeoCatalog {
  return {
    expectedZips: new Set(),
    expectedFips: new Set(),
    populationOf: () => 0,
    areaOf: () => 0,
    zipIntersectsPolygon: () => false,
  };
}
