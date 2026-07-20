/**
 * Brief 51 / ADR-0038 — ZIP→territory CSV import for a geographic dimension.
 *
 * Closes F2: a ZIP-granularity geo dim seeds 0 levels (the "PR 44.4" path was
 * never built). Instead of bundling a 33k-ZIP blob (the maturity-plan
 * anti-goal), the actuary imports an authoritative ZIP→territory map (e.g. the
 * 747-row KS `geo.territory` sheet). ONE import seeds the granular ZIP
 * `levels[]` AND the `geo_territories[]` grouping — which the canonical
 * `geoLookupKeys` then collapses to the territory key space (t1/t2).
 *
 * Pure: CSV text in → `{ levels, territories, report }` out. No DOM, no I/O.
 * Reuses the workspace `parseCsv` tokenizer (quoting / BOM / line endings).
 *
 * Column detection is header-based + alias-tolerant (a ZIP column + a
 * territory column are required; a name/label column is optional). We parse
 * the map LITERALLY — no geocoding, no fuzzy matching (Brief 51 §3.1 Q6).
 */

import type { SeedLevel } from "../GeoDimWizard/geoLevelSeeds";
import { parseCsv } from "../InputsWorkspace/parseCsv";

export interface ImportedTerritory {
  readonly id: string;
  readonly label: string;
  readonly members: string[];
}

export interface ZipTerritoryImportReport {
  /** Non-blank data rows inspected. */
  readonly rowsRead: number;
  /** Distinct ZIP levels created. */
  readonly levelsCreated: number;
  /** One entry per territory, with its member ZIP count. */
  readonly territories: ReadonlyArray<{ readonly id: string; readonly count: number }>;
  /** Rows dropped, with a human reason (missing ZIP, missing territory, …). */
  readonly skipped: ReadonlyArray<{ readonly line: number; readonly reason: string }>;
  /** ZIPs that appeared on more than one row (last row wins membership). */
  readonly duplicateZips: readonly string[];
}

export interface ZipTerritoryImportResult {
  readonly levels: SeedLevel[];
  readonly territories: ImportedTerritory[];
  readonly report: ZipTerritoryImportReport;
  /** Set only on a fatal parse / missing-column failure (levels empty). */
  readonly error?: string;
}

const ZIP_HEADERS = ["zip", "zip5", "zipcode", "zip_code", "postal_code"];
const TERRITORY_HEADERS = [
  "territory",
  "territory_code",
  "territory_id",
  "terr",
  "tier",
];
const NAME_HEADERS = ["zip_name", "name", "label", "city"];

function normHeader(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, "_");
}

function findColumn(
  columns: readonly string[],
  aliases: readonly string[],
): string | null {
  for (const c of columns) {
    if (aliases.includes(normHeader(c))) return c;
  }
  return null;
}

function emptyResult(error?: string): ZipTerritoryImportResult {
  return {
    levels: [],
    territories: [],
    report: {
      rowsRead: 0,
      levelsCreated: 0,
      territories: [],
      skipped: [],
      duplicateZips: [],
    },
    ...(error ? { error } : {}),
  };
}

/**
 * Parse a ZIP→territory CSV into geographic-dim levels + a territory grouping.
 *
 * - One categorical `level` per distinct ZIP (`id = zip`, `label = name || zip`).
 * - One `territory` per distinct territory code; its `members` are the ZIPs
 *   mapped to it. A ZIP is in at most one territory — the LAST row wins (and
 *   the ZIP is reported as a duplicate).
 * - Blank lines are ignored; a row missing a ZIP or a territory is skipped
 *   with a reason (surfaced in the import report, never silently dropped).
 */
export function parseZipTerritoryCsv(text: string): ZipTerritoryImportResult {
  const parsed = parseCsv(text);
  if (!parsed.ok) return emptyResult(parsed.error.message);

  const zipCol = findColumn(parsed.columns, ZIP_HEADERS);
  const terrCol = findColumn(parsed.columns, TERRITORY_HEADERS);
  const nameCol = findColumn(parsed.columns, NAME_HEADERS);
  if (!zipCol || !terrCol) {
    return emptyResult(
      `Need a ZIP column (one of: ${ZIP_HEADERS.join(", ")}) and a territory column (one of: ${TERRITORY_HEADERS.join(", ")}). Found: ${parsed.columns.join(", ") || "(no header)"}.`,
    );
  }

  const levelsById = new Map<string, SeedLevel>();
  const territoriesById = new Map<string, ImportedTerritory>();
  const zipToTerritory = new Map<string, string>(); // last-wins membership
  const skipped: { line: number; reason: string }[] = [];
  const duplicateZips = new Set<string>();
  let rowsRead = 0;

  parsed.rows.forEach((row, i) => {
    const line = i + 2; // 1-based + header row
    const zip = (row[zipCol] ?? "").trim();
    const terr = (row[terrCol] ?? "").trim();
    const name = nameCol ? (row[nameCol] ?? "").trim() : "";

    if (zip === "" && terr === "") return; // fully blank line — ignore
    rowsRead += 1;
    if (zip === "") {
      skipped.push({ line, reason: "missing ZIP" });
      return;
    }
    if (terr === "") {
      skipped.push({ line, reason: `ZIP ${zip} has no territory` });
      return;
    }

    // Duplicate ZIP — last row wins. Detach from a prior territory if it moved.
    const prevTerr = zipToTerritory.get(zip);
    if (prevTerr !== undefined) {
      duplicateZips.add(zip);
      if (prevTerr !== terr) {
        const pt = territoriesById.get(prevTerr);
        if (pt) {
          const idx = pt.members.indexOf(zip);
          if (idx >= 0) pt.members.splice(idx, 1);
        }
      }
    }
    zipToTerritory.set(zip, terr);
    levelsById.set(zip, { kind: "categorical", id: zip, label: name || zip });

    let t = territoriesById.get(terr);
    if (!t) {
      t = { id: terr, label: terr, members: [] };
      territoriesById.set(terr, t);
    }
    if (!t.members.includes(zip)) t.members.push(zip);
  });

  const levels = [...levelsById.values()];
  // Drop territories that ended up empty after a membership move.
  const territories = [...territoriesById.values()].filter(
    (t) => t.members.length > 0,
  );

  return {
    levels,
    territories,
    report: {
      rowsRead,
      levelsCreated: levels.length,
      territories: territories.map((t) => ({ id: t.id, count: t.members.length })),
      skipped,
      duplicateZips: [...duplicateZips],
    },
  };
}
