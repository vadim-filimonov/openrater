/**
 * Territory shapes — Brief 20 §6 (Territory map).
 *
 * Authoring-time types for territory schemas. A territory schema is
 * state-scoped (V1) and consists of N territories, each with a
 * factor + a boundary definition (one of three modes: zip_set,
 * fips_set, polygon).
 *
 * No MapLibre, no DOM, no I/O. Pure types + helpers shared by:
 *   - The territory editor primitives (@openrater/ui).
 *   - The CSV import/export path (ZIP-to-territory mappings).
 *   - The coverage diagnostics + validator.
 *   - Brief 9's collectIssues() aggregator.
 *
 * Per ADR-0018: V1 boundary modes are zip_set + fips_set + polygon.
 * Polygon stores a GeoJSON Feature (validated against a minimal
 * Feature schema at edit time; MapLibre consumes the geometry).
 */

/**
 * One territory in a state's schema. Carries the rate factor + the
 * geographic boundary + optional citation + metadata.
 */
export interface Territory {
  /** Stable id within the schema (uuid or slug). */
  readonly id: string;
  /** Human-facing code (e.g., "1", "Milwaukee", "Urban-A"). */
  readonly territory_code: string;
  /** Display name shown in the UI. */
  readonly display_name: string;
  /** Multiplicative factor applied to the rate at submission time. */
  readonly factor: number;
  /** ISO-3166-2 (e.g., "US-WI"). MUST match the parent schema's state. */
  readonly state: string;
  /** Boundary definition; one of three modes. */
  readonly boundary: TerritoryBoundary;
  /** Source-of-truth citation. */
  readonly citation_rule: string;
  readonly citation_page: string;
  /** Optional metadata (stats cache, history). */
  readonly metadata?: TerritoryMetadata;
}

/**
 * Closed-vocabulary boundary mode. One per territory.
 *
 * - zip_set: list of 5-digit ZIP codes
 * - fips_set: list of 5-digit county FIPS codes (state FIPS + county FIPS)
 * - polygon: GeoJSON Feature with Polygon or MultiPolygon geometry
 */
export type TerritoryBoundary =
  | { readonly kind: "zip_set"; readonly zips: readonly string[] }
  | { readonly kind: "fips_set"; readonly counties: readonly string[] }
  | { readonly kind: "polygon"; readonly geojson: GeoJsonFeature };

/**
 * Minimal GeoJSON Feature shape. Polygon or MultiPolygon only.
 *
 * V1 stores the user's drawn polygon as-is; validation checks the
 * geometry type + coordinate structure. We don't deep-validate
 * winding order or self-intersection in V1 (Phase C); a malformed
 * polygon falls back to a Brief 9 error from the validator.
 */
export interface GeoJsonFeature {
  readonly type: "Feature";
  readonly geometry:
    | {
        readonly type: "Polygon";
        readonly coordinates: readonly (readonly (readonly number[])[])[];
      }
    | {
        readonly type: "MultiPolygon";
        readonly coordinates: readonly (readonly (readonly (readonly number[])[])[])[];
      };
  readonly properties?: Record<string, unknown>;
}

/**
 * Per-territory cached stats + audit metadata. Recomputed on
 * boundary change; consumed by the legend/diagnostics sidebar.
 */
export interface TerritoryMetadata {
  /** Cached stats; recomputed on boundary change. */
  readonly stats?: TerritoryStats;
  /** Audit trail. Mirrors Brief 18 + Brief 19 history shapes. */
  readonly history?: readonly TerritoryHistoryEvent[];
}

export interface TerritoryStats {
  /** Number of ZIPs covered by this territory's boundary. */
  readonly zip_count: number;
  /** Census ACS 5-year population estimate (sum across ZIPs). */
  readonly population: number;
  /** Land area in square miles. */
  readonly area_sq_mi: number;
}

export interface TerritoryHistoryEvent {
  readonly kind:
    | "import"
    | "reassign"
    | "edit"
    | "create"
    | "delete"
    | "csv_import";
  readonly occurred_at: string; // ISO-8601
  readonly by: string;
  readonly summary: string;
}

/**
 * A territory schema = one state's worth of territories. The plan
 * references this by id; multi-state plans (V2) hold N schemas.
 */
export interface TerritorySchema {
  /** Stable id within the plan. */
  readonly id: string;
  /** Filing state — closed vocabulary in V1. ISO-3166-2 ("US-WI"). */
  readonly state: string;
  /** Human display name (e.g., "WI BOP 2026 territories"). */
  readonly display_name: string;
  /** All territories in this schema. */
  readonly territories: readonly Territory[];
  /** Optional metadata (CSV import source, schema-level history). */
  readonly metadata?: TerritorySchemaMetadata;
}

export interface TerritorySchemaMetadata {
  /** Source filename if the schema was bulk-imported. */
  readonly imported_from?: string;
  /** Schema-level history (vs per-territory history). */
  readonly history?: readonly TerritoryHistoryEvent[];
}

// ── Pure helpers ──────────────────────────────────────────────────

/**
 * USPS ZIP codes are 5 digits. Returns true if the input matches.
 * Pure + deterministic. Used by the validator + CSV parser.
 */
export function isValidZipFormat(raw: string): boolean {
  return /^\d{5}$/.test(raw);
}

/**
 * County FIPS codes are 5 digits (2-digit state FIPS + 3-digit county).
 * Pure + deterministic.
 */
export function isValidFipsFormat(raw: string): boolean {
  return /^\d{5}$/.test(raw);
}

/**
 * Normalize a state code to the ISO-3166-2 form ("US-WI"). Accepts:
 *   · "US-WI" → "US-WI"
 *   · "WI"    → "US-WI"
 *   · "wi"    → "US-WI"
 *   · "Wisconsin" → undefined (caller must use a state-name lookup)
 *
 * Returns undefined for anything that doesn't look like a US state
 * 2-letter abbreviation.
 */
export function normalizeStateCode(raw: string): string | undefined {
  const trimmed = raw.trim().toUpperCase();
  if (/^US-[A-Z]{2}$/.test(trimmed)) {
    // Guard against pathological "US-US" inputs.
    const suffix = trimmed.slice(3);
    return suffix === "US" ? undefined : trimmed;
  }
  if (/^[A-Z]{2}$/.test(trimmed)) {
    // "US" alone isn't a state abbrev.
    return trimmed === "US" ? undefined : `US-${trimmed}`;
  }
  return undefined;
}

/**
 * True if the territory's boundary geometry is non-empty (i.e.,
 * covers at least one feature). Used to surface "empty territory"
 * issues in the validator.
 */
export function isBoundaryNonEmpty(boundary: TerritoryBoundary): boolean {
  switch (boundary.kind) {
    case "zip_set":
      return boundary.zips.length > 0;
    case "fips_set":
      return boundary.counties.length > 0;
    case "polygon":
      // A polygon with zero coords is empty.
      if (boundary.geojson.geometry.type === "Polygon") {
        return boundary.geojson.geometry.coordinates.length > 0;
      }
      return boundary.geojson.geometry.coordinates.length > 0;
  }
}

/**
 * Enumerate the ZIPs (or FIPS, or empty for polygon) a boundary
 * covers. Used by the coverage diagnostics module to compute gaps +
 * overlaps. Pure.
 */
export function enumerateZipsFromBoundary(
  boundary: TerritoryBoundary,
): readonly string[] {
  return boundary.kind === "zip_set" ? boundary.zips : [];
}

export function enumerateFipsFromBoundary(
  boundary: TerritoryBoundary,
): readonly string[] {
  return boundary.kind === "fips_set" ? boundary.counties : [];
}
