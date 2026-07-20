/**
 * Brief 44 PR 44.9 — pure migration helper from Brief 20's
 * `TerritorySchema` shape to Brief 44's `geographic` dimension shape.
 *
 * Brief 20 modelled territories as a *separate* entity living at
 * `/rate-lab/:id/territories` with its own MapLibre editor +
 * import/export drawers. Brief 44 §1.B lock collapses the same
 * concept down to a single property on a `geographic` dimension:
 *
 *   {
 *     geo_granularity: "state" | "county" | "zip",
 *     geo_scope:       { kind: "national" | "subset", states?: [...] },
 *     geo_territories: GeoTerritory[],   // optional groupings
 *   }
 *
 * This module is the bridge for plans authored under Brief 20 that
 * want to convert to the Brief 44 surface. The function is PURE +
 * DETERMINISTIC — feeds a `TerritorySchema`, returns the equivalent
 * geographic dim + a `warnings[]` array for things that didn't
 * translate cleanly (polygon boundaries can't be expressed as a
 * categorical level set in v1).
 *
 * What this DOESN'T do:
 *   · It doesn't hit any HTTP endpoint. Migrating an actual plan in
 *     storage is a separate consumer-site step (rate-lab calls
 *     api-client to author the new dim, then deletes the old schema
 *     via the territory route's API surface).
 *   · It doesn't merge with existing geographic dimensions — callers
 *     are expected to call this fresh.
 *   · It doesn't run the API Lab side at all. /territories is still
 *     served by Brief 20's storage in v1; this helper just shows
 *     what the migrated dim would look like.
 */

import type { TerritorySchema, Territory } from "@openrater/contracts";
import type { GeoGranularity, GeoScope } from "../GeoDimWizard/geoLevelSeeds";
import type { GeoTerritory } from "./territoryOps";

export interface MigratedGeoDim {
  /** Suggested display name — pulled from the schema's. */
  readonly display_name: string;
  /** Inferred from the dominant boundary kind. */
  readonly geo_granularity: GeoGranularity;
  /** Always `subset` — Brief 20 schemas are state-scoped. */
  readonly geo_scope: GeoScope;
  /** Levels — union of all boundary members across territories. */
  readonly levels: readonly { kind: "categorical"; id: string; label: string }[];
  /** Brief 44 territory groupings — one per source Territory. */
  readonly geo_territories: readonly GeoTerritory[];
  /** Caller-facing warnings (e.g., polygon boundaries skipped). */
  readonly warnings: readonly string[];
}

export interface MigrationOptions {
  /**
   * Override the granularity inference. Useful when the schema is
   * mixed (some `zip_set`, some `fips_set`) — the helper picks the
   * majority, but the caller may know better.
   */
  readonly granularityOverride?: GeoGranularity;
}

/**
 * Normalize a Brief 20 state code (always ISO-3166-2 like `US-WI`)
 * down to the Brief 44 USPS code (`WI`). Returns `undefined` for
 * anything that doesn't look like a state ref.
 */
function uspsFromIso(iso: string): string | undefined {
  if (/^US-[A-Z]{2}$/.test(iso)) return iso.slice(3);
  if (/^[A-Z]{2}$/.test(iso)) return iso;
  return undefined;
}

/**
 * Infer the granularity from a schema's boundary distribution.
 * Picks the majority. Ties break in this order: zip > county > state
 * (because finest granularity loses the least information).
 *
 * Returns `"state"` for an empty schema as a safe fallback — caller
 * gets warned via the `warnings[]` array.
 */
function inferGranularity(
  schema: TerritorySchema,
): { granularity: GeoGranularity; polygonCount: number } {
  let zipCount = 0;
  let fipsCount = 0;
  let polygonCount = 0;
  for (const t of schema.territories) {
    switch (t.boundary.kind) {
      case "zip_set":
        zipCount += 1;
        break;
      case "fips_set":
        fipsCount += 1;
        break;
      case "polygon":
        polygonCount += 1;
        break;
    }
  }
  if (zipCount === 0 && fipsCount === 0) {
    return { granularity: "state", polygonCount };
  }
  if (zipCount >= fipsCount) {
    return { granularity: "zip", polygonCount };
  }
  return { granularity: "county", polygonCount };
}

/**
 * Pull the level ids out of one territory's boundary. Polygon-kind
 * boundaries return an empty list; the caller surfaces this as a
 * migration warning.
 */
function levelIdsFromBoundary(t: Territory): readonly string[] {
  switch (t.boundary.kind) {
    case "zip_set":
      return t.boundary.zips;
    case "fips_set":
      return t.boundary.counties;
    case "polygon":
      return [];
  }
}

/**
 * Convert a Brief 20 territory schema to the Brief 44 geographic
 * dimension shape. Pure + deterministic.
 */
export function migrateTerritorySchemaToGeoDim(
  schema: TerritorySchema,
  options: MigrationOptions = {},
): MigratedGeoDim {
  const warnings: string[] = [];

  // ── Scope: state-scoped → subset of one USPS code ───────────────
  const usps = uspsFromIso(schema.state);
  let geo_scope: GeoScope;
  if (usps) {
    geo_scope = { kind: "subset", states: [usps] };
  } else {
    geo_scope = { kind: "subset", states: [] };
    warnings.push(
      `Schema state "${schema.state}" couldn't be parsed as a USPS code; geo_scope.states left empty.`,
    );
  }

  // ── Granularity: majority boundary kind (or override) ──────────
  const { granularity, polygonCount } = inferGranularity(schema);
  const geo_granularity = options.granularityOverride ?? granularity;
  if (polygonCount > 0) {
    warnings.push(
      `${polygonCount} territory boundary/boundaries use the "polygon" kind, which can't be expressed as categorical levels in v1. Members of those territories were skipped.`,
    );
  }
  if (schema.territories.length === 0) {
    warnings.push(
      "Schema has no territories — migrated dim has no levels. The caller should re-seed via getLevelsForScope() if desired.",
    );
  }

  // ── Levels: union of all members across territories ────────────
  const seen = new Set<string>();
  const levels: { kind: "categorical"; id: string; label: string }[] = [];
  for (const t of schema.territories) {
    for (const id of levelIdsFromBoundary(t)) {
      if (seen.has(id)) continue;
      seen.add(id);
      levels.push({ kind: "categorical", id, label: id });
    }
  }

  // ── Territories: one GeoTerritory per source Territory ─────────
  const geo_territories: GeoTerritory[] = schema.territories.map(
    (t): GeoTerritory => ({
      id: t.id,
      label: t.display_name || t.territory_code,
      members: levelIdsFromBoundary(t).slice(),
    }),
  );

  return {
    display_name: schema.display_name,
    geo_granularity,
    geo_scope,
    levels,
    geo_territories,
    warnings,
  };
}
