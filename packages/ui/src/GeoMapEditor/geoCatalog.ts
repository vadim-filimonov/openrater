/**
 * Brief 44 PR 44.4 — Bundled geographic catalog.
 *
 * Loads the us-atlas TopoJSON (`counties-10m.json` — 822KB raw, ~150KB
 * gzipped) lazily and converts to per-state GeoJSON FeatureCollections.
 * Mike Bostock's `us-atlas` is the OSS-grade, canonical source for US
 * state + county boundaries at 1:10M resolution — perfect for the
 * single-state authoring view at editor zoom levels.
 *
 * Per ADR-0018:
 *   · Renderer is MapLibre (already in @openrater/ui deps).
 *   · Boundary data is bundled (no Mapbox CDN, no API key, no tile
 *     server dependency for v1). The CDN-hosted MVT path is a v2
 *     concern for ZIP-level rendering.
 *
 * Memoization: counties-10m is parsed once. Per-state lookups are
 * cached. Total in-memory after warm-up: ~3MB for all 3,144 county
 * polygons — acceptable for the editor surface.
 *
 * USPS↔FIPS mapping: us-atlas keys polygons by GEOID (2-digit FIPS
 * for states, 5-digit FIPS for counties). The catalog translates
 * via `STATE_FIPS_TO_USPS` so callers stay in USPS-space.
 */

import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";

// ────────────────────────────────────────────────────────────────────
// USPS ↔ FIPS state-code lookup
// ────────────────────────────────────────────────────────────────────

/** 2-digit FIPS state code → USPS 2-letter abbreviation. */
export const STATE_FIPS_TO_USPS: Readonly<Record<string, string>> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

/** Inverse lookup — USPS → 2-digit FIPS. */
export const STATE_USPS_TO_FIPS: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(STATE_FIPS_TO_USPS).map(([fips, usps]) => [usps, fips]),
  );

// ────────────────────────────────────────────────────────────────────
// Loaded catalog (memoized)
// ────────────────────────────────────────────────────────────────────

type StateFeature = Feature<Polygon | MultiPolygon, { GEOID: string; USPS: string; NAME: string }>;
type CountyFeature = Feature<Polygon | MultiPolygon, { GEOID: string; STATE_USPS: string; NAME: string }>;

interface ParsedCatalog {
  readonly statesByUsps: ReadonlyMap<string, StateFeature>;
  readonly countiesByState: ReadonlyMap<string, readonly CountyFeature[]>;
  readonly countiesByGeoid: ReadonlyMap<string, CountyFeature>;
  /**
   * The merged US silhouette (us-atlas ships a pre-built `nation` object) —
   * the national coastline used by <UsChoropleth>'s geographic-context
   * backdrop (graticule clip + coastline + depth halo). Null if the atlas
   * build lacks the `nation` layer.
   */
  readonly nationOutline: Feature<Polygon | MultiPolygon> | null;
}

let catalogPromise: Promise<ParsedCatalog> | null = null;

/**
 * Lazily load + parse `us-atlas/counties-10m.json`. Returns the same
 * Promise on subsequent calls (memoized at the module level so the
 * 822KB TopoJSON parses once per app lifetime).
 *
 * Test seam: callers in jsdom should mock this via `vi.mock` because
 * the underlying dynamic-import resolves to a parsed object — not
 * something testable without bundling.
 */
export async function loadGeoCatalog(): Promise<ParsedCatalog> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = doLoad();
  return catalogPromise;
}

/** Test-only reset hook. Not exported at the package top level. */
export function _resetGeoCatalogForTests(): void {
  catalogPromise = null;
}

async function doLoad(): Promise<ParsedCatalog> {
  // Dynamic-import both modules so the bundler can code-split. The
  // 822KB TopoJSON is only fetched when the user first opens a geo
  // map view.
  const [topojsonClient, atlasModule] = await Promise.all([
    import("topojson-client"),
    import("us-atlas/counties-10m.json"),
  ]);
  // us-atlas ships as { type: "Topology", objects: { states, counties, nation }, ... }
  const topology = (atlasModule.default ?? atlasModule) as unknown as TopoJsonTopology;

  // Convert each layer to a GeoJSON FeatureCollection.
  const statesFc = topojsonClient.feature(
    topology as unknown as Parameters<typeof topojsonClient.feature>[0],
    topology.objects.states as unknown as Parameters<typeof topojsonClient.feature>[1],
  ) as unknown as FeatureCollection<Polygon | MultiPolygon, { id?: string; name?: string }>;
  const countiesFc = topojsonClient.feature(
    topology as unknown as Parameters<typeof topojsonClient.feature>[0],
    topology.objects.counties as unknown as Parameters<typeof topojsonClient.feature>[1],
  ) as unknown as FeatureCollection<Polygon | MultiPolygon, { id?: string; name?: string }>;

  // Build the state lookup: us-atlas stores `id` on each Feature
  // (the 2-digit FIPS), with the display name in properties.name.
  const statesByUsps = new Map<string, StateFeature>();
  for (const feat of statesFc.features) {
    const fips = String(feat.id ?? "").padStart(2, "0");
    const usps = STATE_FIPS_TO_USPS[fips];
    if (!usps) continue; // Skip territories (60, 66, 69, 72, 78) for v1.
    const name = feat.properties?.name ?? usps;
    statesByUsps.set(usps, {
      type: "Feature",
      geometry: feat.geometry,
      properties: { GEOID: fips, USPS: usps, NAME: name },
      id: fips,
    });
  }

  // Build the county lookup: id is the 5-digit FIPS (e.g. "55079" =
  // Milwaukee). The first 2 chars are the state FIPS.
  const countiesByState = new Map<string, CountyFeature[]>();
  const countiesByGeoid = new Map<string, CountyFeature>();
  for (const feat of countiesFc.features) {
    const fips5 = String(feat.id ?? "").padStart(5, "0");
    const stateFips = fips5.slice(0, 2);
    const usps = STATE_FIPS_TO_USPS[stateFips];
    if (!usps) continue;
    const name = feat.properties?.name ?? `County ${fips5}`;
    const county: CountyFeature = {
      type: "Feature",
      geometry: feat.geometry,
      properties: { GEOID: fips5, STATE_USPS: usps, NAME: name },
      id: fips5,
    };
    if (!countiesByState.has(usps)) countiesByState.set(usps, []);
    countiesByState.get(usps)!.push(county);
    countiesByGeoid.set(fips5, county);
  }

  // The national silhouette (coastline) — us-atlas ships a pre-merged
  // `nation` object, so no client-side union is needed.
  let nationOutline: Feature<Polygon | MultiPolygon> | null = null;
  if (topology.objects.nation) {
    const nationGeo = topojsonClient.feature(
      topology as unknown as Parameters<typeof topojsonClient.feature>[0],
      topology.objects.nation as unknown as Parameters<typeof topojsonClient.feature>[1],
    ) as unknown as
      | Feature<Polygon | MultiPolygon>
      | FeatureCollection<Polygon | MultiPolygon>;
    nationOutline =
      nationGeo.type === "FeatureCollection"
        ? nationGeo.features[0] ?? null
        : nationGeo;
  }

  return { statesByUsps, countiesByState, countiesByGeoid, nationOutline };
}

// ────────────────────────────────────────────────────────────────────
// Public lookup API
// ────────────────────────────────────────────────────────────────────

export async function getStateOutline(
  usps: string,
): Promise<StateFeature | null> {
  const cat = await loadGeoCatalog();
  return cat.statesByUsps.get(usps) ?? null;
}

export async function getCountiesInState(
  usps: string,
): Promise<readonly CountyFeature[]> {
  const cat = await loadGeoCatalog();
  return cat.countiesByState.get(usps) ?? [];
}

export async function getCountyByGeoid(
  fips5: string,
): Promise<CountyFeature | null> {
  const cat = await loadGeoCatalog();
  return cat.countiesByGeoid.get(fips5) ?? null;
}

// ────────────────────────────────────────────────────────────────────
// Internal — TopoJSON shape used during loading. Keeps the
// topojson-client signature dependency at one site.
// ────────────────────────────────────────────────────────────────────

interface TopoJsonTopology {
  readonly type: "Topology";
  readonly objects: {
    readonly states: unknown;
    readonly counties: unknown;
    readonly nation?: unknown;
  };
  readonly arcs: ReadonlyArray<unknown>;
  readonly transform?: unknown;
}

// ────────────────────────────────────────────────────────────────────
// Re-export type aliases for consumers
// ────────────────────────────────────────────────────────────────────

export type GeoStateFeature = StateFeature;
export type GeoCountyFeature = CountyFeature;
