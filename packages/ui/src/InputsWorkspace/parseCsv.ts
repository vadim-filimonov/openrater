/**
 * parseCsv — Brief 38 PR 38.5 minimal CSV reader.
 *
 * Loose CSV → header columns + row records. v1 doesn't typecheck the
 * row values — the Inputs workspace cares about COLUMN NAMES + raw
 * sample values for auto-recognition; the engine handles dtype
 * coercion later. RFC-4180 strict tokenization with:
 *
 *   - Comma delimiter
 *   - Double-quote escapes (use "" inside quoted fields)
 *   - LF / CRLF / CR line endings (normalized to LF on read)
 *   - UTF-8 BOM stripped on read
 *   - Unterminated quoted fields → error
 *   - Quote inside non-quoted field → error
 *
 * v1 SCOPE:
 *   - Headers required (first row)
 *   - Unknown columns are NOT filtered — every header becomes a field
 *   - String values returned as-is (no inferred number/date coercion)
 *   - Inferred dtype per column is best-effort (number / boolean /
 *     date / string) based on the first non-empty sample value
 *
 * Pure data in / pure data out. No I/O. The caller hands a string;
 * we return columns + rows + per-column inferred dtypes.
 *
 * NOT a port of @openrater/contracts/csv decodeCsv — that one is schema-
 * driven (typed factor tables, curves). This reader is intentionally
 * untyped so users can load arbitrary submission CSVs.
 */

import type { MatchDtype } from "./autoMatch";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** Successful parse result. */
export interface CsvParseSuccess {
  readonly ok: true;
  /** Columns in source order. */
  readonly columns: readonly string[];
  /** Rows as plain records keyed by column name. */
  readonly rows: readonly Readonly<Record<string, string>>[];
  /**
   * Best-effort inferred dtype per column. Drives the autoMatch
   * dtype-mismatch penalty (PR 38.2). When inference is ambiguous,
   * defaults to "string".
   */
  readonly dtypes: Readonly<Record<string, MatchDtype>>;
  /** Optional non-blocking warnings. */
  readonly warnings: readonly CsvParseWarning[];
}

/** Failed parse result. */
export interface CsvParseFailure {
  readonly ok: false;
  readonly error: CsvParseError;
}

export interface CsvParseError {
  readonly kind:
    | "encoding"
    | "empty"
    | "header"
    | "row"
    | "unterminated_quote";
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface CsvParseWarning {
  readonly kind: "duplicate_column" | "empty_column_name";
  readonly message: string;
  readonly columnIndex: number;
  readonly columnName?: string;
}

export type CsvParseResult = CsvParseSuccess | CsvParseFailure;

export interface ParseCsvOptions {
  /**
   * Skip these many header columns when inferring dtypes (useful
   * for ignoring a leading auto-generated row-number column).
   * Default 0 — inspect everything.
   */
  readonly dtypeInferenceStartColumn?: number;
  /**
   * Inspect the first N rows when inferring dtypes per column.
   * Default 20 — a fair sample without expensive full scans.
   */
  readonly dtypeInferenceRows?: number;
}

// ─────────────────────────────────────────────────────────────────
// Tokenizer (RFC-4180)
// ─────────────────────────────────────────────────────────────────

function tokenize(
  text: string,
):
  | { ok: true; records: readonly (readonly string[])[] }
  | { ok: false; error: CsvParseError } {
  const records: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let column = 1;
  let fieldStartLine = 1;
  let fieldStartColumn = 1;

  const finishField = () => {
    current.push(field);
    field = "";
  };

  const finishRecord = () => {
    finishField();
    // Suppress a single trailing empty record (CSV files often end
    // with newline + nothing).
    if (!(current.length === 1 && current[0] === "")) {
      records.push(current);
    }
    current = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
          column += 2;
          continue;
        }
        inQuotes = false;
        column++;
        continue;
      }
      field += ch;
      if (ch === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
      continue;
    }

    if (ch === '"') {
      if (field.length === 0) {
        inQuotes = true;
        fieldStartLine = line;
        fieldStartColumn = column;
        column++;
        continue;
      }
      return {
        ok: false,
        error: {
          kind: "row",
          message:
            "Unexpected quote character inside an unquoted field. If the field contains a quote, the whole field must be wrapped in double-quotes.",
          line,
          column,
        },
      };
    }

    if (ch === ",") {
      finishField();
      column++;
      continue;
    }

    if (ch === "\n") {
      finishRecord();
      line++;
      column = 1;
      continue;
    }

    field += ch;
    column++;
  }

  if (inQuotes) {
    return {
      ok: false,
      error: {
        kind: "unterminated_quote",
        message: "Unterminated quoted field at end of file.",
        line: fieldStartLine,
        column: fieldStartColumn,
      },
    };
  }

  // Flush any pending field as the last record (handles files
  // without trailing newline).
  if (field.length > 0 || current.length > 0) {
    finishRecord();
  }

  return { ok: true, records };
}

// ─────────────────────────────────────────────────────────────────
// Dtype inference
// ─────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[0-9:.+\-Z]+)?$/;
// Match US m/d/yyyy + UK d/m/yyyy + dashed alternatives.
const SLASH_DATE_RE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/;
const NUMBER_RE = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;
const BOOL_TRUE = new Set(["true", "yes", "y", "1", "t"]);
const BOOL_FALSE = new Set(["false", "no", "n", "0", "f"]);

/**
 * Infer dtype from a single value. Priority order:
 *
 *   1. Date  — ISO 8601 / m-d-yyyy / d/m/yyyy match patterns
 *   2. Number — numeric (digits + optional comma thousands + decimal)
 *   3. Boolean — text booleans (yes/no/true/false/Y/N)
 *   4. String — fallback
 *
 * NUMBER WINS OVER BOOLEAN for ambiguous values like "1" / "0" —
 * those are far more often counts than booleans. Genuine boolean
 * columns use text values ("Y" / "yes" / "true") which still match.
 */
function inferDtypeForValue(raw: string): MatchDtype {
  const v = raw.trim();
  if (v === "") return "string";
  // Dates win over numbers — "2026-01-15" otherwise looks like a
  // number with dashes. Order matters here.
  if (ISO_DATE_RE.test(v) || SLASH_DATE_RE.test(v)) return "date";
  if (NUMBER_RE.test(v)) return "number";
  const lc = v.toLowerCase();
  if (BOOL_TRUE.has(lc) || BOOL_FALSE.has(lc)) return "boolean";
  return "string";
}

/**
 * Infer a column's dtype by sampling values. Returns the dominant
 * dtype across non-empty rows; ties favor stricter types (date >
 * boolean > number > string). Empty columns infer "string".
 */
function inferColumnDtype(
  values: readonly string[],
  maxSamples: number,
): MatchDtype {
  const counts: Record<MatchDtype, number> = {
    date: 0,
    boolean: 0,
    number: 0,
    string: 0,
  };
  let nonEmpty = 0;
  const limit = Math.min(values.length, maxSamples);
  for (let i = 0; i < limit; i++) {
    const v = values[i]!.trim();
    if (v === "") continue;
    nonEmpty++;
    counts[inferDtypeForValue(v)]++;
  }
  if (nonEmpty === 0) return "string";
  // If any value is "string" (i.e., it doesn't parse as anything
  // else), we widen the column to string — mixed columns are safer
  // as strings.
  if (counts.string > 0) return "string";
  // Otherwise pick the strictest non-zero type.
  if (counts.date === nonEmpty) return "date";
  if (counts.boolean === nonEmpty) return "boolean";
  if (counts.number === nonEmpty) return "number";
  return "string";
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Parse a raw CSV string into header columns + row records + inferred
 * dtypes per column.
 *
 * @param text The CSV file contents (UTF-8 string; BOM stripped).
 * @param options Optional knobs for dtype inference.
 */
export function parseCsv(
  text: string,
  options: ParseCsvOptions = {},
): CsvParseResult {
  if (text == null) {
    return {
      ok: false,
      error: { kind: "empty", message: "CSV input is null or undefined." },
    };
  }

  // Strip UTF-8 BOM if present.
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) {
    body = body.slice(1);
  }
  // Normalize line endings to LF.
  body = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (body.length === 0) {
    return {
      ok: false,
      error: {
        kind: "empty",
        message: "CSV is empty.",
        line: 1,
      },
    };
  }

  const tokenized = tokenize(body);
  if (!tokenized.ok) return { ok: false, error: tokenized.error };

  const records = tokenized.records;
  if (records.length === 0) {
    return {
      ok: false,
      error: {
        kind: "empty",
        message: "CSV has no rows (not even a header).",
        line: 1,
      },
    };
  }

  // ── Header parsing ───────────────────────────────────────────
  const headerRow = records[0]!;
  const columns: string[] = [];
  const warnings: CsvParseWarning[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < headerRow.length; i++) {
    const raw = headerRow[i]!.trim();
    if (raw === "") {
      // Generate a placeholder name so the column still exists.
      const placeholder = `column_${i + 1}`;
      columns.push(placeholder);
      warnings.push({
        kind: "empty_column_name",
        message: `Header column ${i + 1} is empty; renamed to "${placeholder}".`,
        columnIndex: i,
      });
      continue;
    }
    if (seen.has(raw)) {
      // Suffix duplicate names so downstream mapping can address
      // both columns. ("class_code", "class_code_2", "class_code_3"…)
      let suffix = 2;
      let candidate = `${raw}_${suffix}`;
      while (seen.has(candidate)) {
        suffix++;
        candidate = `${raw}_${suffix}`;
      }
      columns.push(candidate);
      seen.set(candidate, i);
      warnings.push({
        kind: "duplicate_column",
        message: `Duplicate header "${raw}" — renamed to "${candidate}".`,
        columnIndex: i,
        columnName: raw,
      });
    } else {
      columns.push(raw);
      seen.set(raw, i);
    }
  }

  // ── Row assembly ─────────────────────────────────────────────
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r]!;
    const row: Record<string, string> = {};
    for (let c = 0; c < columns.length; c++) {
      // Short records: pad missing fields with empty strings (a
      // common CSV pattern when trailing columns are empty).
      row[columns[c]!] = (rec[c] ?? "").trim();
    }
    rows.push(row);
  }

  // ── Dtype inference ──────────────────────────────────────────
  const startCol = options.dtypeInferenceStartColumn ?? 0;
  const maxSamples = options.dtypeInferenceRows ?? 20;
  const dtypes: Record<string, MatchDtype> = {};
  for (let c = 0; c < columns.length; c++) {
    const name = columns[c]!;
    if (c < startCol) {
      dtypes[name] = "string";
      continue;
    }
    const values: string[] = [];
    for (let i = 0; i < rows.length && values.length < maxSamples; i++) {
      const v = rows[i]?.[name];
      if (v !== undefined && v !== "") values.push(v);
    }
    dtypes[name] = inferColumnDtype(values, maxSamples);
  }

  return { ok: true, columns, rows, dtypes, warnings };
}

// ─────────────────────────────────────────────────────────────────
// SourceSpec adapter (Brief 38 PR 38.1 substrate)
// ─────────────────────────────────────────────────────────────────

/**
 * A trimmed view of `Plan.input_mapping.source` (CSV variant) plus
 * dtypes + warnings. Mirrors the substrate shape from PR 38.1 with
 * additions that don't persist (dtypes + warnings live in UI state).
 *
 * The orchestrator (PR 38.8) writes the `columns` + `sample_rows`
 * subset into `Plan.input_mapping.source` and keeps `dtypes` +
 * `warnings` in component state.
 */
export interface CsvSourceSnapshot {
  readonly kind: "csv";
  readonly columns: readonly string[];
  readonly sample_rows: readonly Readonly<Record<string, string>>[];
  readonly dtypes: Readonly<Record<string, MatchDtype>>;
  readonly warnings: readonly CsvParseWarning[];
  /**
   * Total row count in the parsed CSV. Sample rows are only the
   * first N (capped by options); this is the full input length.
   */
  readonly totalRowCount: number;
}

export interface ParseCsvForInputsOptions extends ParseCsvOptions {
  /**
   * Max rows to include in the `sample_rows`. Default 50 — enough
   * to drive auto-recognition + mismatch detection; cheap to embed
   * in a Plan substrate.
   */
  readonly maxSampleRows?: number;
}

/**
 * Convenience wrapper that produces the CsvSourceSnapshot shape the
 * Inputs workspace consumes. Parses + caps sample rows + bundles
 * the dtypes + warnings into one object.
 *
 * @returns CsvSourceSnapshot on success; `null` + error info on
 *          failure (the caller decides how to surface).
 */
export function parseCsvForInputs(
  text: string,
  options: ParseCsvForInputsOptions = {},
):
  | { readonly ok: true; readonly snapshot: CsvSourceSnapshot }
  | { readonly ok: false; readonly error: CsvParseError } {
  const parsed = parseCsv(text, options);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const max = options.maxSampleRows ?? 50;
  const sample = parsed.rows.slice(0, max);
  return {
    ok: true,
    snapshot: {
      kind: "csv",
      columns: parsed.columns,
      sample_rows: sample,
      dtypes: parsed.dtypes,
      warnings: parsed.warnings,
      totalRowCount: parsed.rows.length,
    },
  };
}
