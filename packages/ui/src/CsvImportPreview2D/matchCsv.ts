/**
 * matchCsv — Brief 33 PR 33.5.
 *
 * The label-match library that powers <CsvImportPreview2D>. Pure
 * function. Given a parsed CSV and the dim axes, returns a preview
 * the drawer can render: matched rows, warning rows (close-but-not-
 * exact), bad rows (no suggestion), and missing dim levels.
 *
 * Match rules (per Brief 33 §−1 Q-load + mockup Frame 8):
 *
 *   1. Normalize both sides: trim + lowercase
 *   2. Exact match against level.id → "ok" match
 *   3. Exact match against level.label → "ok" match
 *   4. Exact match against any level.aliases entry → "ok" match
 *   5. Honor user override (overrides[csvKey] = rowId) → "ok" match
 *   6. Substring-or-similar match (within edit distance 2) → "warn"
 *      with suggestions
 *   7. No match → "bad"
 *
 * Why label-match and not positional: a dim adds/removes a level
 * between exports → positional matching silently writes to the
 * wrong row. With label matching, the user sees exactly what mapped
 * and what didn't.
 */

import type { DimensionRow } from "../DimensionsTable";
import { cellKey } from "../FactorTableGrid2D";
import { levelsForKeying } from "../keying";

/**
 * Inline level shape — DimensionRow's `levels` array element. The
 * canonical type isn't exported from DimensionsTable so we
 * reconstruct it here. Keep in sync with DimensionRow.levels.
 */
type DimensionLevel = NonNullable<DimensionRow["levels"]>[number];

// ──────────────────────────────────────────────────────────────────
// Input + output types
// ──────────────────────────────────────────────────────────────────

/**
 * The parsed CSV shape. Header row is the column label list; each
 * row's `keyLabel` is what appears in the first column (the row
 * key); `cells` is colLabel → numeric value (string parsed).
 */
export interface CsvImport2D {
  readonly fileName: string;
  /** Header row's column labels (excluding the row-key column). */
  readonly colLabels: readonly string[];
  /** Body rows. */
  readonly rows: readonly {
    readonly keyLabel: string;
    /** colLabel → cell value (null for empty cells). */
    readonly cells: Readonly<Record<string, number | null>>;
  }[];
}

export type MatchQuality = "ok" | "warn" | "bad";

export interface MatchedRow {
  /** The original CSV row key text (as it appears in the file). */
  readonly csvKey: string;
  /** The matched row dim level id. */
  readonly rowId: string;
  /** The matched level's display label. */
  readonly rowLabel: string;
  /** Per-col cell diffs (`null` old → empty; `null` new → skip). */
  readonly cellDiffs: readonly CellDiff[];
}

export interface CellDiff {
  /** Column dim level id (or `null` for 1-D). */
  readonly colId: string | null;
  /** Column display label (or "Factor" for 1-D). */
  readonly colLabel: string;
  /** Existing cell value, undefined if absent from current map. */
  readonly oldValue: number | undefined;
  /** New value, null if the CSV cell was blank. */
  readonly newValue: number | null;
  /** True if the CSV value differs from the current value. */
  readonly willChange: boolean;
}

export interface UnmatchedRow {
  readonly csvKey: string;
  /**
   * Quality of the match attempt:
   *   • "warn" — close-but-not-exact; suggestions list is populated
   *   • "bad"  — no suggestion
   */
  readonly quality: "warn" | "bad";
  /**
   * Suggested row dim level ids (best-first). Empty for "bad" rows.
   * Used by the drawer's re-key picker.
   */
  readonly suggestions: readonly string[];
}

export interface MissingDimLevel {
  readonly rowId: string;
  readonly rowLabel: string;
}

export interface ImportPreview2D {
  readonly fileName: string;
  readonly csvRowCount: number;
  readonly csvColCount: number;
  /** Matched rows (with per-cell diffs). */
  readonly matchedRows: readonly MatchedRow[];
  /** CSV rows we couldn't match (warn + bad). */
  readonly unmatchedRows: readonly UnmatchedRow[];
  /** Dim levels not present in the CSV — they keep their current cells. */
  readonly missingDimLevels: readonly MissingDimLevel[];
  /** Total cells the apply will change. */
  readonly cellsWillChange: number;
  /** Total cells already in agreement with the CSV (no-op). */
  readonly cellsUnchanged: number;
  /**
   * Resolved cell map ready to merge into the parent's current
   * cells map. Only contains cells that DIFFER from current.
   * Apply this with `currentCells.set(...)` for each entry.
   */
  readonly resolvedChanges: ReadonlyMap<string, number>;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/** Normalize for label-match: trim + lowercase. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Build a lookup map from every recognized label form of a level
 * (id, display label, all aliases) → level. Normalized.
 */
function buildLevelLookup(
  levels: readonly DimensionLevel[],
): Map<string, DimensionLevel> {
  const map = new Map<string, DimensionLevel>();
  for (const level of levels) {
    if (level.id) map.set(norm(level.id), level);
    if ("label" in level && level.label) {
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

/**
 * Levenshtein distance — used for "close-but-not-exact" suggestions.
 * Bound at 3 for short rating-table labels (e.g., "frame" vs
 * "framed"). Lifted from a textbook DP implementation.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/**
 * Pick the best suggestions for an unmatched CSV key: top-3 levels
 * by Levenshtein distance ≤ 3. Returns level ids (parent renders
 * the dropdown with labels).
 */
function pickSuggestions(
  csvKey: string,
  levels: readonly DimensionLevel[],
  alreadyMatched: ReadonlySet<string>,
): string[] {
  const normKey = norm(csvKey);
  type Scored = { readonly levelId: string; readonly dist: number };
  const scored: Scored[] = [];
  for (const level of levels) {
    if (!level.id || alreadyMatched.has(level.id)) continue;
    const candidates: string[] = [];
    if (level.id) candidates.push(norm(level.id));
    if ("label" in level && level.label) candidates.push(norm(level.label));
    if ("aliases" in level && Array.isArray(level.aliases)) {
      for (const alias of level.aliases) {
        if (typeof alias === "string") candidates.push(norm(alias));
      }
    }
    let best = Infinity;
    for (const cand of candidates) {
      const d = editDistance(normKey, cand);
      if (d < best) best = d;
    }
    if (best <= 3) scored.push({ levelId: level.id, dist: best });
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, 3).map((s) => s.levelId);
}

// ──────────────────────────────────────────────────────────────────
// Main function
// ──────────────────────────────────────────────────────────────────

export interface MatchCsvOptions {
  /**
   * User-supplied re-key overrides. Maps original CSV key text →
   * the row dim level id the user explicitly mapped it to. Applied
   * before the auto-match runs (and short-circuits it).
   */
  readonly overrides?: ReadonlyMap<string, string>;
}

export function matchCsv2D(
  csv: CsvImport2D,
  rowAxis: DimensionRow,
  colAxis: DimensionRow | undefined,
  currentCells: ReadonlyMap<string, number>,
  options: MatchCsvOptions = {},
): ImportPreview2D {
  const overrides = options.overrides ?? new Map<string, string>();
  // Platform-test finding E10a — match against the KEYING domain, not
  // the raw levels. For a geographic dim with active territories the
  // grid (and the persisted cells) key on TERRITORY ids (ADR-0038's
  // levelsForKeying); matching raw ZIP levels here meant a
  // territory-rowed CSV never matched and a ZIP-rowed one targeted
  // rows the grid doesn't have. Non-geo dims are unchanged
  // (levelsForKeying returns their own levels).
  const rowLevels = levelsForKeying(rowAxis);
  const colLevels = colAxis ? levelsForKeying(colAxis) : [];
  const is2D = colAxis !== undefined;

  const rowLookup = buildLevelLookup(rowLevels);
  const colLookup = is2D ? buildLevelLookup(colLevels) : new Map();

  // Pre-resolve every col label in the CSV header to a col dim
  // level (or null if 1-D, where the single "factor" column is
  // implicit).
  const colResolution: Array<{
    readonly csvColLabel: string;
    readonly colId: string | null;
    readonly colLabel: string;
  }> = [];
  if (is2D) {
    for (const csvCol of csv.colLabels) {
      const match = colLookup.get(norm(csvCol));
      if (match && match.id) {
        const label = ("label" in match && match.label) || match.id;
        colResolution.push({
          csvColLabel: csvCol,
          colId: match.id,
          colLabel: label,
        });
      } else {
        // Unmatched col — render label as-is, no resolution. We
        // tag colId as null so the diff path can skip cells.
        colResolution.push({
          csvColLabel: csvCol,
          colId: null,
          colLabel: csvCol,
        });
      }
    }
  } else {
    // 1-D: pretend the CSV has a single "factor" column. If the
    // CSV has more than one body column we use the first.
    const csvColLabel = csv.colLabels[0] ?? "factor";
    colResolution.push({
      csvColLabel,
      colId: null,
      colLabel: csvColLabel,
    });
  }

  const matchedRows: MatchedRow[] = [];
  const unmatchedRows: UnmatchedRow[] = [];
  const resolvedChanges = new Map<string, number>();
  const matchedRowIds = new Set<string>();
  let cellsWillChange = 0;
  let cellsUnchanged = 0;

  for (const row of csv.rows) {
    const normKey = norm(row.keyLabel);
    // 1. User override
    let level: DimensionLevel | undefined;
    const overrideId = overrides.get(row.keyLabel);
    if (overrideId) {
      level = rowLevels.find((l) => l.id === overrideId);
    }
    // 2. Auto-match by id / label / alias
    if (!level) {
      level = rowLookup.get(normKey);
    }

    if (level && level.id) {
      matchedRowIds.add(level.id);
      const rowLabel = ("label" in level && level.label) || level.id;
      const cellDiffs: CellDiff[] = [];
      for (const col of colResolution) {
        const csvVal = row.cells[col.csvColLabel];
        const colKeyForMap = is2D ? col.colId : null;
        // 2-D row × unmatched col → skip this cell (can't write
        // without a target col id).
        if (is2D && col.colId === null) continue;
        const key = cellKey(level.id, colKeyForMap);
        const oldValue = currentCells.get(key);
        const newValue: number | null = csvVal ?? null;
        const willChange =
          newValue !== null && newValue !== oldValue;
        if (willChange) {
          resolvedChanges.set(key, newValue);
          cellsWillChange += 1;
        } else if (newValue !== null) {
          cellsUnchanged += 1;
        }
        cellDiffs.push({
          colId: colKeyForMap,
          colLabel: col.colLabel,
          oldValue,
          newValue,
          willChange,
        });
      }
      matchedRows.push({
        csvKey: row.keyLabel,
        rowId: level.id,
        rowLabel,
        cellDiffs,
      });
    } else {
      const suggestions = pickSuggestions(
        row.keyLabel,
        rowLevels,
        matchedRowIds,
      );
      unmatchedRows.push({
        csvKey: row.keyLabel,
        quality: suggestions.length > 0 ? "warn" : "bad",
        suggestions,
      });
    }
  }

  // Compute missing dim levels (levels NOT matched by any CSV row).
  const missingDimLevels: MissingDimLevel[] = [];
  for (const level of rowLevels) {
    if (!level.id) continue;
    if (matchedRowIds.has(level.id)) continue;
    const label = ("label" in level && level.label) || level.id;
    missingDimLevels.push({ rowId: level.id, rowLabel: label });
  }

  return {
    fileName: csv.fileName,
    csvRowCount: csv.rows.length,
    csvColCount: csv.colLabels.length,
    matchedRows,
    unmatchedRows,
    missingDimLevels,
    cellsWillChange,
    cellsUnchanged,
    resolvedChanges,
  };
}
