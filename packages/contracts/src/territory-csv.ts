/**
 * Territory CSV schema — Brief 20 §6 + P-TM6 + ADR-0017.
 *
 * ZIP-to-territory CSV imports are the dominant authoring path —
 * ISO + consultants ship territory schemas as flat CSVs:
 *
 *   zip,territory_code,citation_rule,citation_page
 *   53201,1,ISO BOP §11.A,p.107
 *   53202,1,ISO BOP §11.A,p.107
 *   ...
 *
 * The shape is one row per ZIP (NOT one row per territory) so a
 * single territory may span hundreds of rows. The import flow uses
 * `groupByTerritoryCode` to fold the flat list back into the
 * Territory[] schema shape.
 *
 * Per ADR-0017: required columns = zip, territory_code; optional
 * columns = citation_rule, citation_page, factor. Canonical column
 * order = `zip, territory_code, factor, citation_rule, citation_page`.
 */

import type { CsvSchema } from "./csv";
import {
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
} from "./csv";
import { isValidZipFormat } from "./territory-types";

/**
 * One flat row in a ZIP-to-territory CSV. The import drawer collects
 * many of these + folds into Territory[] via groupByTerritoryCode.
 */
export interface TerritoryCsvRow {
  readonly zip: string;
  readonly territory_code: string;
  readonly factor?: number;
  readonly citation_rule?: string;
  readonly citation_page?: string;
}

/**
 * CSV schema for ZIP-to-territory imports. Per ADR-0017:
 *   - required: zip, territory_code
 *   - optional: factor, citation_rule, citation_page
 *
 * Key = zip (one row per ZIP; the import treats duplicate zips as
 * conflict-preview overrides).
 */
export const TERRITORY_CSV_SCHEMA: CsvSchema<TerritoryCsvRow> = {
  columns: [
    {
      name: "zip",
      required: true,
      description: "5-digit USPS ZIP code.",
      parse: (raw: string, line: number) => {
        const parsed = parseRequiredString(raw, line);
        if (!parsed.ok) return parsed;
        const trimmed = String(parsed.value).trim();
        // Reject obvious malformed inputs (non-digit characters, or
        // too few digits even after Excel coercion). The smallest
        // valid US ZIP is around 00501 (Massachusetts/Puerto Rico),
        // so we require ≥4 digits pre-padding.
        if (!/^\d+$/.test(trimmed) || trimmed.length < 4 || trimmed.length > 5) {
          return {
            ok: false,
            error: `Invalid ZIP code "${trimmed}" (must be 5 digits).`,
          };
        }
        // Pad single-digit prefixes (e.g., Maine's 04001 sometimes
        // comes through Excel as the integer 4001).
        const padded = trimmed.padStart(5, "0");
        if (!isValidZipFormat(padded)) {
          return {
            ok: false,
            error: `Invalid ZIP code "${trimmed}" (must be 5 digits).`,
          };
        }
        return { ok: true, value: padded };
      },
      encode: (r) => r.zip,
    },
    {
      name: "territory_code",
      required: true,
      description: "Territory id (e.g., 1, Milwaukee, Urban-A).",
      parse: parseRequiredString,
      encode: (r) => r.territory_code,
    },
    {
      name: "factor",
      required: false,
      description: "Territory factor (constant across all rows for the same territory_code).",
      parse: parseOptionalNumber,
      encode: (r) => (r.factor !== undefined ? String(r.factor) : ""),
    },
    {
      name: "citation_rule",
      required: false,
      description: "Optional territory citation rule.",
      parse: parseOptionalString,
      encode: (r) => r.citation_rule ?? "",
    },
    {
      name: "citation_page",
      required: false,
      description: "Optional territory citation page.",
      parse: parseOptionalString,
      encode: (r) => r.citation_page ?? "",
    },
  ],
  keyOf: (row) => row.zip,
  assemble: (parsed) => {
    const row: Mutable<TerritoryCsvRow> = {
      zip: parsed.zip as string,
      territory_code: String(parsed.territory_code).trim(),
    };
    if (parsed.factor !== undefined && parsed.factor !== null) {
      row.factor = parsed.factor as number;
    }
    if (
      typeof parsed.citation_rule === "string" &&
      parsed.citation_rule.length > 0
    ) {
      row.citation_rule = parsed.citation_rule;
    }
    if (
      typeof parsed.citation_page === "string" &&
      parsed.citation_page.length > 0
    ) {
      row.citation_page = parsed.citation_page;
    }
    return row;
  },
};

/**
 * Group the flat CSV rows by territory_code → list of ZIPs + an
 * (optional) shared factor + (optional) shared citation. Used by
 * the import drawer to fold the flat CSV into Territory[] shape.
 *
 * Per Brief 20 §6: each territory_code MUST have a single factor.
 * If two rows for the same territory_code disagree on factor, the
 * helper returns `factor_conflicts` with the conflicting list — the
 * import drawer surfaces these to the user before commit.
 *
 * Pure + deterministic. Stable output ordering (territory_code asc).
 */
export interface GroupedTerritory {
  readonly territory_code: string;
  readonly zips: readonly string[];
  /** Single factor across all rows; undefined if no row supplied one. */
  readonly factor?: number;
  readonly citation_rule?: string;
  readonly citation_page?: string;
}

export interface FactorConflict {
  readonly territory_code: string;
  /** All distinct factors seen for this code. */
  readonly factors: readonly number[];
}

export interface GroupedResult {
  readonly territories: readonly GroupedTerritory[];
  readonly factor_conflicts: readonly FactorConflict[];
}

export function groupByTerritoryCode(
  rows: readonly TerritoryCsvRow[],
): GroupedResult {
  const byCode = new Map<
    string,
    {
      zips: string[];
      factors: Set<number>;
      citation_rule?: string;
      citation_page?: string;
    }
  >();

  for (const row of rows) {
    const existing = byCode.get(row.territory_code);
    if (existing) {
      existing.zips.push(row.zip);
      if (row.factor !== undefined) existing.factors.add(row.factor);
      if (row.citation_rule && !existing.citation_rule) {
        existing.citation_rule = row.citation_rule;
      }
      if (row.citation_page && !existing.citation_page) {
        existing.citation_page = row.citation_page;
      }
    } else {
      const factors = new Set<number>();
      if (row.factor !== undefined) factors.add(row.factor);
      const seed: {
        zips: string[];
        factors: Set<number>;
        citation_rule?: string;
        citation_page?: string;
      } = {
        zips: [row.zip],
        factors,
      };
      if (row.citation_rule) seed.citation_rule = row.citation_rule;
      if (row.citation_page) seed.citation_page = row.citation_page;
      byCode.set(row.territory_code, seed);
    }
  }

  const territories: GroupedTerritory[] = [];
  const factor_conflicts: FactorConflict[] = [];

  // Sorted output for stable byte-equivalent grouping.
  const codes = Array.from(byCode.keys()).sort();
  for (const code of codes) {
    const entry = byCode.get(code)!;
    const factors = Array.from(entry.factors);
    if (factors.length > 1) {
      factor_conflicts.push({
        territory_code: code,
        factors: factors.sort((a, b) => a - b),
      });
    }
    const grouped: Mutable<GroupedTerritory> = {
      territory_code: code,
      zips: Array.from(new Set(entry.zips)).sort(),
    };
    if (factors.length === 1) {
      const f = factors[0];
      if (f !== undefined) grouped.factor = f;
    }
    if (entry.citation_rule) grouped.citation_rule = entry.citation_rule;
    if (entry.citation_page) grouped.citation_page = entry.citation_page;
    territories.push(grouped);
  }

  return { territories, factor_conflicts };
}

// ── Internal type helper ────────────────────────────────────────

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
