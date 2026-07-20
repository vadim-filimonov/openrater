/**
 * Exhibits — geographic derivations for the territory map (P6, P8).
 *
 * Pure functions only: grain resolution, member→state grouping via
 * the platform's SCF ranges, the packed-boundary decoder for the
 * per-state ZCTA chunks scripts/geo/build-zcta-shapes.py emits (US
 * Census cartographic boundaries — provenance in scripts/geo/
 * README.md), and the diverging paint math. Asset loading and the
 * SVG live in MapStage.tsx.
 */

import type { PlanDimension } from "@openrater/api-client";
import { zip5_to_state } from "@openrater/ui";

/** One territory of a geographic dim (the api-client schema's shape). */
export type GeoTerritoryLike = NonNullable<
  PlanDimension["geo_territories"]
>[number];

/** One packed polygon: rings (outer first) as flat [lng, lat, …]. */
export type PackedPolygon = readonly (readonly number[])[];

/** One per-state boundary chunk (public/geo/zcta-shapes/{STATE}.json). */
export interface ZctaShapes {
  readonly state: string;
  readonly shapes: Readonly<Record<string, readonly PackedPolygon[]>>;
}

/**
 * Unpack one zip's packed polygons into GeoJSON MultiPolygon
 * coordinates ([polygon][ring][point][lng, lat]). Malformed rings
 * (odd length, fewer than four points) are dropped — a boundary we
 * can't trust is a boundary we don't draw.
 */
export function shapeCoordinates(
  packed: readonly PackedPolygon[],
): number[][][][] {
  const out: number[][][][] = [];
  for (const polygon of packed) {
    const rings: number[][][] = [];
    for (const flat of polygon) {
      if (flat.length < 8 || flat.length % 2 !== 0) continue;
      const ring: number[][] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const lng = flat[i];
        const lat = flat[i + 1];
        if (lng === undefined || lat === undefined) continue;
        ring.push([lng, lat]);
      }
      rings.push(ring);
    }
    if (rings.length > 0) out.push(rings);
  }
  return out;
}

export type GeoGrain = "zip" | "county" | "state";

/**
 * The territories of a dim that can take the map — geographic, with
 * at least one territory defined. Null otherwise (the stage keeps
 * its bars).
 */
export function mapTerritoriesOf(
  dim: PlanDimension | null,
): readonly GeoTerritoryLike[] | null {
  if (dim === null) return null;
  const geographic =
    dim.dimension_type === "geographic" || dim.shape === "geographic";
  if (!geographic) return null;
  const territories = dim.geo_territories;
  return territories !== null &&
    territories !== undefined &&
    territories.length > 0
    ? territories
    : null;
}

/**
 * The dim's grain. The declared `geo_granularity` wins (locked at
 * creation since Brief 44); without one, infer from the members'
 * shape — 2-letter codes read as states, 5-digit codes as ZIPs (the
 * dominant authoring case; an undeclared county-FIPS plan will fail
 * boundary lookup and fall back to the bars rather than guess).
 */
export function geoGrainOf(dim: PlanDimension): GeoGrain | null {
  const declared = dim.geo_granularity;
  if (declared === "zip" || declared === "county" || declared === "state")
    return declared;
  const member = (dim.geo_territories ?? [])
    .flatMap((t) => t.members)
    .find((m) => m.trim() !== "");
  if (member === undefined) return null;
  if (/^[A-Za-z]{2}$/.test(member.trim())) return "state";
  if (/^\d{5}$/.test(member.trim())) return "zip";
  return null;
}

export interface MemberStates {
  /** USPS states the members span, sorted. */
  readonly states: readonly string[];
  /** member zip → its USPS state (unresolvable members omitted). */
  readonly stateOf: ReadonlyMap<string, string>;
}

/** Group ZIP members by state via the SCF ranges (zip5_to_state). */
export function memberStates(
  territories: readonly GeoTerritoryLike[],
): MemberStates {
  const stateOf = new Map<string, string>();
  const states = new Set<string>();
  for (const territory of territories) {
    for (const raw of territory.members) {
      const zip = raw.trim();
      if (zip === "" || stateOf.has(zip)) continue;
      const state = zip5_to_state(zip);
      if (state !== null) {
        stateOf.set(zip, state);
        states.add(state);
      }
    }
  }
  return { states: [...states].sort(), stateOf };
}

/**
 * The stage's diverging paint, shared by fills and legend swatches:
 * warm above ×1.00, azure below, intensity = distance from par
 * within the table's own worst deviation (0.35 floor so the palest
 * member stays legible).
 */
export function divergingPaint(
  value: number,
  maxDev: number,
): { readonly up: boolean; readonly alpha: number } {
  const t = maxDev < 1e-9 ? 0 : Math.min(1, Math.abs(value - 1) / maxDev);
  return { up: value >= 1, alpha: 0.35 + 0.65 * t };
}
