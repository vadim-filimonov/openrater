/**
 * Territory schema validation — Brief 20 §6 + P-TM3.
 *
 * Pure validator that walks a territory schema and returns Brief 13
 * Issue[]. Consumed by:
 *   · The route's section banner (real-time feedback while editing).
 *   · Brief 9's collectIssues() aggregator (filing-export gate).
 *
 * Rules per Brief 20 §6:
 *   1. territory_code values non-empty + unique within schema.
 *   2. factor values finite + positive.
 *   3. state matches the schema state (every territory.state == schema.state).
 *   4. zip_set boundaries: every ZIP matches /^\d{5}$/. Per-state
 *      validity (USPS-allocated for the state) is checked by the
 *      coverage report, not here — that requires the GeoCatalog.
 *   5. fips_set boundaries: every FIPS matches /^\d{5}$/.
 *   6. polygon boundaries: geometry type is Polygon or MultiPolygon,
 *      coordinates non-empty.
 *   7. empty boundary → warning (an empty territory exists but
 *      covers no geography — filing-blocking warning).
 *   8. missing per-territory citation → warning.
 *   9. duplicate ZIPs WITHIN a single territory → warning (likely
 *      a data-entry bug; the dedupe at coverage time would mask it).
 *
 * Coverage-level rules (gaps / overlaps) require the GeoCatalog and
 * live in territory-coverage.ts. The orchestrator surfaces those as
 * additional issues alongside the ones from this module.
 *
 * Pure + deterministic. Same input → same Issue ids.
 */

import {
  isValidFipsFormat,
  isValidZipFormat,
  isBoundaryNonEmpty,
  type TerritorySchema,
} from "./territory-types";
import { deriveIssueId } from "./issues/helpers";
import type { Issue } from "./issues/types";

/**
 * Validate a territory schema. Returns an issue per problem found
 * in stable order (territories walked in array order; per-territory
 * rules walked in declaration order).
 */
export function validateTerritorySchema(
  schema: TerritorySchema,
): readonly Issue[] {
  const issues: Issue[] = [];

  // Schema-level pre-pass: collect codes for uniqueness check.
  const seenCodes = new Map<string, string[]>(); // code → territory ids
  for (const t of schema.territories) {
    const code = t.territory_code.trim();
    if (code === "") continue;
    const arr = seenCodes.get(code);
    if (arr) arr.push(t.id);
    else seenCodes.set(code, [t.id]);
  }

  // Per-territory pass.
  for (let i = 0; i < schema.territories.length; i += 1) {
    const t = schema.territories[i]!;

    // Rule 1: non-empty + unique territory_code.
    const code = t.territory_code.trim();
    if (code === "") {
      issues.push(
        makeIssue({
          schemaId: schema.id,
          territoryId: t.id,
          severity: "error",
          field: "territory_code",
          messageTemplate: "empty_territory_code",
          message: `Territory ${i + 1} has an empty territory_code.`,
        }),
      );
    } else {
      const claimants = seenCodes.get(code);
      if (claimants && claimants.length > 1 && claimants[0] === t.id) {
        issues.push(
          makeIssue({
            schemaId: schema.id,
            territoryId: t.id,
            severity: "error",
            field: "territory_code",
            messageTemplate: "duplicate_territory_code",
            message: `Territory code "${code}" appears ${claimants.length} times in this schema.`,
          }),
        );
      }
    }

    // Rule 2: finite + positive factor.
    if (!Number.isFinite(t.factor)) {
      issues.push(
        makeIssue({
          schemaId: schema.id,
          territoryId: t.id,
          severity: "error",
          field: "factor",
          messageTemplate: "non_finite_factor",
          message: `Territory "${t.territory_code}" has a non-finite factor (${t.factor}).`,
        }),
      );
    } else if (t.factor <= 0) {
      issues.push(
        makeIssue({
          schemaId: schema.id,
          territoryId: t.id,
          severity: "error",
          field: "factor",
          messageTemplate: "non_positive_factor",
          message: `Territory "${t.territory_code}" factor must be positive (got ${t.factor}).`,
        }),
      );
    }

    // Rule 3: state matches the schema state.
    if (t.state !== schema.state) {
      issues.push(
        makeIssue({
          schemaId: schema.id,
          territoryId: t.id,
          severity: "error",
          field: "state",
          messageTemplate: "state_mismatch",
          message: `Territory "${t.territory_code}" has state="${t.state}" but the schema's state is "${schema.state}".`,
        }),
      );
    }

    // Rule 4-6: boundary-mode-specific validation.
    switch (t.boundary.kind) {
      case "zip_set": {
        // Format check.
        const bad: string[] = [];
        for (const z of t.boundary.zips) {
          if (!isValidZipFormat(z)) bad.push(z);
        }
        if (bad.length > 0) {
          issues.push(
            makeIssue({
              schemaId: schema.id,
              territoryId: t.id,
              severity: "error",
              field: "boundary.zips",
              messageTemplate: "invalid_zip_format",
              message: `Territory "${t.territory_code}" has ${bad.length} invalid ZIP code${bad.length === 1 ? "" : "s"}: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? "…" : ""}.`,
            }),
          );
        }
        // Rule 9: duplicate ZIPs.
        const seen = new Set<string>();
        const dupes = new Set<string>();
        for (const z of t.boundary.zips) {
          if (seen.has(z)) dupes.add(z);
          seen.add(z);
        }
        if (dupes.size > 0) {
          issues.push(
            makeIssue({
              schemaId: schema.id,
              territoryId: t.id,
              severity: "warning",
              field: "boundary.zips",
              messageTemplate: "duplicate_zip_in_territory",
              message: `Territory "${t.territory_code}" lists ${dupes.size} duplicate ZIP${dupes.size === 1 ? "" : "s"}.`,
            }),
          );
        }
        break;
      }
      case "fips_set": {
        const bad: string[] = [];
        for (const f of t.boundary.counties) {
          if (!isValidFipsFormat(f)) bad.push(f);
        }
        if (bad.length > 0) {
          issues.push(
            makeIssue({
              schemaId: schema.id,
              territoryId: t.id,
              severity: "error",
              field: "boundary.counties",
              messageTemplate: "invalid_fips_format",
              message: `Territory "${t.territory_code}" has ${bad.length} invalid FIPS code${bad.length === 1 ? "" : "s"}.`,
            }),
          );
        }
        break;
      }
      case "polygon": {
        const geom = t.boundary.geojson.geometry;
        if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") {
          issues.push(
            makeIssue({
              schemaId: schema.id,
              territoryId: t.id,
              severity: "error",
              field: "boundary.geojson",
              messageTemplate: "invalid_polygon_geometry_type",
              message: `Territory "${t.territory_code}" has an unsupported polygon geometry type.`,
            }),
          );
        } else if (geom.coordinates.length === 0) {
          // Polygon with zero rings is empty — fall through to rule 7.
        }
        break;
      }
    }

    // Rule 7: empty boundary → filing-blocking warning.
    if (!isBoundaryNonEmpty(t.boundary)) {
      issues.push(
        makeIssue({
          schemaId: schema.id,
          territoryId: t.id,
          severity: "warning",
          field: "boundary",
          messageTemplate: "empty_boundary",
          message: `Territory "${t.territory_code}" has an empty boundary. Filing export will block until covered.`,
        }),
      );
    }

    // Rule 8: missing per-territory citation → warning.
    if (!t.citation_rule && !t.citation_page) {
      issues.push(
        makeIssue({
          schemaId: schema.id,
          territoryId: t.id,
          severity: "warning",
          field: "citation",
          messageTemplate: "missing_territory_citation",
          message: `Territory "${t.territory_code}" is missing a citation.`,
        }),
      );
    }
  }

  return issues;
}

// ── Internal: Issue factory ──────────────────────────────────────

interface MakeIssueArgs {
  readonly schemaId: string;
  readonly territoryId: string;
  readonly severity: "error" | "warning";
  readonly field: string;
  readonly messageTemplate: string;
  readonly message: string;
}

function makeIssue(args: MakeIssueArgs): Issue {
  const location = {
    section: "territories",
    entity: `${args.schemaId}.${args.territoryId}`,
    field: args.field,
  } as const;
  const filing_blocking = args.severity === "error";
  return {
    id: deriveIssueId({
      source: "authoring",
      location,
      message_template: args.messageTemplate,
    }),
    severity: args.severity,
    source: "authoring",
    message: args.message,
    location,
    filing_blocking,
    fix_hint: {
      label: `Open territory → ${args.territoryId}`,
      target: location,
    },
  };
}
