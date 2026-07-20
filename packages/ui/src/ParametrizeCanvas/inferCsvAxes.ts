/**
 * inferCsvAxes — Brief 67 §3.1 (CSV-first creation).
 *
 * Given a parsed CSV and the plan's dimensions, infer which dim the
 * CSV's row keys belong to (and, for 2-D files, which dim the column
 * headers belong to) by LEVEL-LABEL matching — the same id/label
 * matching philosophy as matchCsv2D, applied to the "which dim is
 * this?" question instead of "which level is this row?".
 *
 * Pure function; the catalog's "Import CSV" flow renders the result
 * as a confirm panel (the user validates the inference BEFORE the
 * table exists — same preview-before-apply doctrine as the editor's
 * CSV drawer), then seeds the creation draft from `cells`.
 *
 * Honesty contract: unmatched rows/columns are SKIPPED and counted —
 * the caller must surface the skip counts (the P5 paste-preview
 * precedent: "3 bands · 0 skipped").
 */

import type { DimensionRow } from "../DimensionsTable";
import { cellKey } from "../FactorTableGrid2D";
import { levelsForKeying } from "../keying";
import type { CsvImport2D } from "../CsvImportPreview2D";

/** Minimum fraction of CSV labels that must match a dim's levels. */
const MATCH_THRESHOLD = 0.6;

export interface CsvAxesInferenceOk {
  readonly ok: true;
  readonly axes: {
    readonly rowDimSlug: string;
    readonly colDimSlug: string | null;
  };
  /** Keyed `cellKey(rowLevelId, colLevelId | null)` — grid-ready. */
  readonly cells: ReadonlyMap<string, number>;
  readonly rowDimName: string;
  readonly colDimName: string | null;
  readonly matchedRows: number;
  readonly skippedRows: number;
  readonly matchedCols: number;
  readonly skippedCols: number;
}

export interface CsvAxesInferenceFail {
  readonly ok: false;
  /** Human-readable reason ("no dimension matches the row labels…"). */
  readonly reason: string;
}

export type CsvAxesInference = CsvAxesInferenceOk | CsvAxesInferenceFail;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

type DimensionLevel = NonNullable<DimensionRow["levels"]>[number];

/** id / label / aliases → level, normalized. Mirrors matchCsv's. */
function buildLevelLookup(
  levels: readonly DimensionLevel[],
): Map<string, DimensionLevel> {
  const map = new Map<string, DimensionLevel>();
  for (const level of levels) {
    if (level.id) map.set(norm(level.id), level);
    if ("label" in level && typeof level.label === "string" && level.label) {
      map.set(norm(level.label), level);
    }
    if ("aliases" in level && Array.isArray(level.aliases)) {
      for (const alias of level.aliases) {
        if (typeof alias === "string" && alias.length > 0) {
          map.set(norm(alias), level);
        }
      }
    }
  }
  return map;
}

interface DimScore {
  readonly dim: DimensionRow;
  readonly lookup: Map<string, DimensionLevel>;
  readonly matched: number;
  readonly fraction: number;
}

/** Score every dim against a label list; best-first. */
function scoreDims(
  labels: readonly string[],
  dimensions: readonly DimensionRow[],
): DimScore[] {
  const scores: DimScore[] = [];
  for (const dim of dimensions) {
    // levelsForKeying — a geo dim with territories keys on the
    // territory ids (ADR-0028), in lock-step with the grid.
    const levels = levelsForKeying(dim);
    if (levels.length === 0) continue;
    const lookup = buildLevelLookup(levels);
    let matched = 0;
    for (const label of labels) {
      if (lookup.has(norm(label))) matched += 1;
    }
    if (matched === 0) continue;
    scores.push({
      dim,
      lookup,
      matched,
      fraction: matched / labels.length,
    });
  }
  return scores.sort(
    (a, b) => b.fraction - a.fraction || b.matched - a.matched,
  );
}

export function inferCsvAxes(
  csv: CsvImport2D,
  dimensions: readonly DimensionRow[],
): CsvAxesInference {
  if (csv.rows.length === 0) {
    return { ok: false, reason: "The CSV has no body rows." };
  }

  // ── Row axis — match the first-column keys against every dim ──
  const rowLabels = csv.rows.map((r) => r.keyLabel);
  const rowBest = scoreDims(rowLabels, dimensions)[0];
  if (!rowBest || rowBest.fraction < MATCH_THRESHOLD) {
    return {
      ok: false,
      reason:
        "No dimension's levels match the CSV's row labels. Check the first column holds level ids or labels of a dimension in this plan.",
    };
  }

  // ── Column axis — one value column = 1-D; several = find a dim ──
  let colBest: DimScore | null = null;
  if (csv.colLabels.length > 1) {
    const candidate = scoreDims(
      csv.colLabels,
      dimensions.filter((d) => d.slug !== rowBest.dim.slug),
    )[0];
    if (!candidate || candidate.fraction < MATCH_THRESHOLD) {
      return {
        ok: false,
        reason: `The rows match "${rowBest.dim.display_name || rowBest.dim.slug}", but no second dimension matches the ${csv.colLabels.length} column headers. For a 1-D table, use a single value column.`,
      };
    }
    colBest = candidate;
  }

  // ── Cells — matched rows × matched cols only; skips are counted ──
  const cells = new Map<string, number>();
  let matchedRows = 0;
  let skippedRows = 0;
  for (const row of csv.rows) {
    const rowLevel = rowBest.lookup.get(norm(row.keyLabel));
    if (!rowLevel) {
      skippedRows += 1;
      continue;
    }
    matchedRows += 1;
    for (const colLabel of csv.colLabels) {
      const value = row.cells[colLabel];
      if (value === null || value === undefined) continue;
      if (colBest) {
        const colLevel = colBest.lookup.get(norm(colLabel));
        if (!colLevel) continue;
        cells.set(cellKey(rowLevel.id, colLevel.id), value);
      } else {
        cells.set(cellKey(rowLevel.id, null), value);
      }
    }
  }
  let matchedCols = csv.colLabels.length;
  let skippedCols = 0;
  if (colBest) {
    matchedCols = csv.colLabels.filter((l) =>
      colBest.lookup.has(norm(l)),
    ).length;
    skippedCols = csv.colLabels.length - matchedCols;
  }

  if (cells.size === 0) {
    return {
      ok: false,
      reason: "Every CSV cell was empty or unmatched — nothing to import.",
    };
  }

  return {
    ok: true,
    axes: {
      rowDimSlug: rowBest.dim.slug,
      colDimSlug: colBest ? colBest.dim.slug : null,
    },
    cells,
    rowDimName: rowBest.dim.display_name || rowBest.dim.slug,
    colDimName: colBest
      ? colBest.dim.display_name || colBest.dim.slug
      : null,
    matchedRows,
    skippedRows,
    matchedCols,
    skippedCols,
  };
}
