/**
 * CSV roundtrip types — ADR-0017.
 *
 * Consumed by Briefs 18 (Factor Table editor), 19 (Curve editor),
 * 20 (Territory map), 21 (Class translator), 22 (Eligibility
 * condition builder), and 6 (CSV batch import for risk inputs).
 *
 * The `ImportDiff<TRow>` shape is the canonical 5-state preview
 * every CSV consumer renders.
 */

/**
 * Five canonical row states in a CSV import preview.
 *
 * - `unchanged` — Row exists in target with identical values
 * - `added`     — Row in CSV; no matching key in target
 * - `changed`   — Row exists in target; one or more values differ
 * - `removed`   — Row exists in target; not in CSV (replace mode only)
 * - `ignored`   — Row in CSV; explicitly skipped (unknown / out-of-scope)
 */
export type ImportDiffState =
  | "unchanged"
  | "added"
  | "changed"
  | "removed"
  | "ignored";

/**
 * Import modes. `merge` is the default (lower risk); `replace` is
 * the opt-in mode for "ship a complete schema as one CSV."
 */
export type ImportMode = "merge" | "replace";

/**
 * A typed import diff. Consumer briefs use this with their
 * brief-specific row type.
 */
export interface ImportDiff<TRow> {
  /** Rows in CSV; not in target. */
  readonly added: readonly TRow[];
  /** Rows in target; values differ in CSV. */
  readonly changed: readonly ImportDiffChange<TRow>[];
  /** Rows in target; not in CSV. Only populated in `replace` mode. */
  readonly removed: readonly TRow[];
  /** Count of rows whose values are byte-identical. Collapsed for UI perf. */
  readonly unchanged_count: number;
  /** Rows the importer chose to skip (unknown columns, out-of-state, etc.). */
  readonly ignored: readonly ImportDiffIgnored<TRow>[];
  /** Non-blocking issues surfaced during parse/diff. */
  readonly warnings: readonly string[];
  /** Mode used to compute this diff. */
  readonly mode: ImportMode;
}

/**
 * A row that changed between target and CSV.
 *
 * The key uniquely identifies the row within the target collection;
 * the per-brief schema defines what counts as a key (e.g., factor
 * table → `key`; curve → `x`; territory → `zip`).
 */
export interface ImportDiffChange<TRow> {
  /** Stable identifier within the target collection. */
  readonly key: string;
  /** Row as currently stored in target. */
  readonly before: TRow;
  /** Row as imported from CSV. */
  readonly after: TRow;
  /** Per-field deltas; populated for cell-level rendering. */
  readonly field_changes: readonly ImportDiffFieldChange[];
}

/** One field that changed between `before` and `after`. */
export interface ImportDiffFieldChange {
  readonly field: string;
  readonly before_value: unknown;
  readonly after_value: unknown;
}

/** A row the importer chose to skip + the reason. */
export interface ImportDiffIgnored<TRow> {
  readonly row: TRow;
  readonly reason: string;
}

/**
 * Result of parsing a CSV file. Distinguishes errors (which block
 * import) from warnings (which surface but allow continue).
 */
export type ParseResult<TRow> =
  | { readonly ok: true; readonly rows: readonly TRow[]; readonly warnings: readonly ParseWarning[] }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

export interface ParseError {
  readonly kind: "encoding" | "header" | "row" | "type" | "uniqueness";
  readonly message: string;
  /** 1-indexed line number in source CSV, when applicable. */
  readonly line?: number;
  /** 1-indexed column number in source CSV, when applicable. */
  readonly column?: number;
  /** Field name when the error is per-field. */
  readonly field?: string;
}

export interface ParseWarning {
  readonly kind: "unknown_column" | "missing_optional_column" | "out_of_scope_row";
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly field?: string;
}

/**
 * Column specification for a CSV consumer. Per-brief schemas
 * declare their canonical column set as a list of these.
 */
export interface ColumnSpec<TRow> {
  /** Canonical column name (snake_case). */
  readonly name: string;
  /** Whether the column is required in the header. */
  readonly required: boolean;
  /** Human-friendly description for error messages. */
  readonly description?: string;
  /**
   * Parse a raw string from the CSV cell into the row's typed value.
   * Returns the parsed value or a per-cell error message.
   */
  readonly parse: (raw: string, line: number) =>
    | { ok: true; value: unknown }
    | { ok: false; error: string };
  /**
   * Read the value off a row for export. Returns the raw string
   * representation (no quoting; the encoder handles quoting).
   */
  readonly encode: (row: TRow) => string;
}

/**
 * A consumer-brief CSV schema. Defines columns + how to extract the
 * key from a row + how to assemble a row from parsed column values.
 */
export interface CsvSchema<TRow> {
  /** Canonical column order in the header. */
  readonly columns: readonly ColumnSpec<TRow>[];
  /** Extract the stable key from a row. */
  readonly keyOf: (row: TRow) => string;
  /**
   * Assemble a row from parsed column values. Receives a map keyed
   * by column name. Optional columns absent from the CSV will not
   * appear in the map.
   */
  readonly assemble: (parsed: Record<string, unknown>) => TRow;
}
