/**
 * CSV import conflict diff — ADR-0017 §5.
 *
 * Given a target collection and a parsed CSV's rows, compute the
 * 5-state diff (added / changed / removed / unchanged / ignored)
 * that the consumer brief renders as a conflict preview before
 * commit.
 *
 * Pure function; same inputs → same output (byte-identical when
 * serialized).
 */

import type {
  CsvSchema,
  ImportDiff,
  ImportDiffChange,
  ImportDiffFieldChange,
  ImportDiffIgnored,
  ImportMode,
} from "./types";

export interface ComputeDiffOptions<TRow> {
  /** Target collection currently stored. */
  readonly target: readonly TRow[];
  /** Rows parsed from CSV. */
  readonly csv: readonly TRow[];
  /** Schema (used to extract keys + compare fields). */
  readonly schema: CsvSchema<TRow>;
  /** Import mode; defaults to `merge`. */
  readonly mode?: ImportMode;
  /**
   * Optional filter: rows the importer wants to skip (e.g.,
   * out-of-state ZIPs for a state-scoped territory import).
   *
   * Receives a CSV row; returns either `null` (keep) or a string
   * reason (skip + add to `ignored`).
   */
  readonly shouldIgnore?: (row: TRow) => string | null;
  /**
   * Optional warnings accumulated during decode that get carried
   * through to the diff (so the conflict preview can display them).
   */
  readonly warnings?: readonly string[];
}

/**
 * Compute the typed `ImportDiff<TRow>` from a target collection +
 * a CSV row set.
 *
 * Field-level changes are reported with stable field ordering
 * (matches `schema.columns`) so that downstream serialization
 * (e.g., "download diff CSV") is byte-stable.
 */
export function computeDiff<TRow>({
  target,
  csv,
  schema,
  mode = "merge",
  shouldIgnore,
  warnings = [],
}: ComputeDiffOptions<TRow>): ImportDiff<TRow> {
  // Build target-by-key index.
  const targetByKey = new Map<string, TRow>();
  for (const row of target) {
    targetByKey.set(schema.keyOf(row), row);
  }

  // Build CSV-by-key index after applying `shouldIgnore` filter.
  const csvByKey = new Map<string, TRow>();
  const ignored: ImportDiffIgnored<TRow>[] = [];
  for (const row of csv) {
    if (shouldIgnore) {
      const reason = shouldIgnore(row);
      if (reason != null) {
        ignored.push({ row, reason });
        continue;
      }
    }
    csvByKey.set(schema.keyOf(row), row);
  }

  const added: TRow[] = [];
  const changed: ImportDiffChange<TRow>[] = [];
  const removed: TRow[] = [];
  let unchanged_count = 0;

  // Visit every key in CSV: classify as added / changed / unchanged.
  // Sort visit order by key ascending for deterministic output.
  const csvKeysSorted = [...csvByKey.keys()].sort();
  for (const key of csvKeysSorted) {
    const csvRow = csvByKey.get(key)!;
    const targetRow = targetByKey.get(key);

    if (targetRow == null) {
      added.push(csvRow);
      continue;
    }

    // Compare each declared column.
    const fieldChanges = diffFields(targetRow, csvRow, schema);
    if (fieldChanges.length === 0) {
      unchanged_count++;
    } else {
      changed.push({
        key,
        before: targetRow,
        after: csvRow,
        field_changes: fieldChanges,
      });
    }
  }

  // In `replace` mode, target rows not in CSV become `removed`.
  if (mode === "replace") {
    const targetKeysSorted = [...targetByKey.keys()].sort();
    for (const key of targetKeysSorted) {
      if (!csvByKey.has(key)) {
        removed.push(targetByKey.get(key)!);
      }
    }
  }

  return {
    added,
    changed,
    removed,
    unchanged_count,
    ignored,
    warnings,
    mode,
  };
}

/**
 * Compare a target row to a CSV row across every declared column.
 * Returns the list of fields that differ; canonical column order.
 *
 * Equality is deep-by-encoded-value: we compare what the column's
 * `encode()` would emit, so semantically-equivalent values
 * (e.g., `1.0` and `1`) compare equal under the column's encoding.
 */
function diffFields<TRow>(
  before: TRow,
  after: TRow,
  schema: CsvSchema<TRow>,
): ImportDiffFieldChange[] {
  const changes: ImportDiffFieldChange[] = [];
  for (const col of schema.columns) {
    const beforeEncoded = col.encode(before);
    const afterEncoded = col.encode(after);
    if (beforeEncoded !== afterEncoded) {
      // Surface the typed values (not the encoded strings) so the
      // UI can render them in their natural type — but compare by
      // encoded form for "is this actually different?" semantics.
      const beforeValue = (before as unknown as Record<string, unknown>)[col.name];
      const afterValue = (after as unknown as Record<string, unknown>)[col.name];
      changes.push({
        field: col.name,
        before_value: beforeValue ?? beforeEncoded,
        after_value: afterValue ?? afterEncoded,
      });
    }
  }
  return changes;
}

/**
 * Empty / zero-state diff helper. Useful for "no CSV uploaded yet"
 * UI states without manufacturing an `ImportDiff` ad-hoc.
 */
export function emptyDiff<TRow>(mode: ImportMode = "merge"): ImportDiff<TRow> {
  return {
    added: [],
    changed: [],
    removed: [],
    unchanged_count: 0,
    ignored: [],
    warnings: [],
    mode,
  };
}

/**
 * Aggregate counters useful for the conflict-preview banner
 * ("4 added · 2 changed · 1 removed · 422 unchanged").
 */
export function summarizeDiff<TRow>(diff: ImportDiff<TRow>): DiffSummary {
  return {
    added: diff.added.length,
    changed: diff.changed.length,
    removed: diff.removed.length,
    unchanged: diff.unchanged_count,
    ignored: diff.ignored.length,
    warnings: diff.warnings.length,
  };
}

export interface DiffSummary {
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly ignored: number;
  readonly warnings: number;
}
