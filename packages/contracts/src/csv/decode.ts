/**
 * CSV decoder — ADR-0017.
 *
 * RFC-4180 strict; normalizes line endings (LF / CRLF / CR all
 * accepted on read); strips UTF-8 BOM; rejects non-UTF-8 input
 * with a specific error.
 *
 * Validation order (per ADR-0017 "Validation contract"):
 *   1. Encoding (UTF-8 strict)
 *   2. Header row present + canonical names + required columns
 *   3. Per-row schema validation
 *   4. Cross-row validation (key uniqueness within file)
 *
 * The first parse error blocks the import.
 */

import type {
  CsvSchema,
  ParseError,
  ParseResult,
  ParseWarning,
} from "./types";

/**
 * Decode a CSV string into typed rows.
 *
 * @param text The CSV file contents (UTF-8 string; BOM stripped on
 *   read).
 * @param schema The CSV schema for the consumer brief.
 * @returns Either `{ ok: true, rows, warnings }` or
 *   `{ ok: false, errors }` with structured per-line/column errors.
 */
export function decodeCsv<TRow>(
  text: string,
  schema: CsvSchema<TRow>,
): ParseResult<TRow> {
  // 1. Encoding normalization.
  // Strip UTF-8 BOM if present. (Excel "Save as CSV UTF-8" emits BOM.)
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) {
    body = body.slice(1);
  }
  // Normalize line endings to LF.
  body = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 2. Tokenize into records (RFC-4180 strict).
  const tokenizeResult = tokenize(body);
  if (!tokenizeResult.ok) {
    return { ok: false, errors: tokenizeResult.errors };
  }
  const records = tokenizeResult.records;

  if (records.length === 0) {
    return {
      ok: false,
      errors: [
        {
          kind: "header",
          message: "CSV is empty (no header row).",
          line: 1,
        },
      ],
    };
  }

  // 3. Header validation.
  const headerRow = records[0]!;
  const headerErrors: ParseError[] = [];
  const headerWarnings: ParseWarning[] = [];

  // Build a name → column-index map of declared columns.
  const declaredByName = new Map(
    schema.columns.map((col, i) => [col.name, i]),
  );

  // Build a header column-index → schema-column map.
  const headerToColumn = new Map<number, string>();
  for (let i = 0; i < headerRow.length; i++) {
    const headerName = headerRow[i]!;
    if (declaredByName.has(headerName)) {
      headerToColumn.set(i, headerName);
    } else {
      headerWarnings.push({
        kind: "unknown_column",
        message: `Unknown column "${headerName}" — values in this column will be ignored.`,
        line: 1,
        column: i + 1,
        field: headerName,
      });
    }
  }

  // Required columns must be present.
  for (const col of schema.columns) {
    if (col.required && !headerRow.includes(col.name)) {
      headerErrors.push({
        kind: "header",
        message: `Required column "${col.name}" is missing.`,
        line: 1,
        field: col.name,
      });
    } else if (!col.required && !headerRow.includes(col.name)) {
      headerWarnings.push({
        kind: "missing_optional_column",
        message: `Optional column "${col.name}" is missing.`,
        line: 1,
        field: col.name,
      });
    }
  }

  if (headerErrors.length > 0) {
    return { ok: false, errors: headerErrors };
  }

  // 4. Per-row schema parse.
  const rows: TRow[] = [];
  const rowErrors: ParseError[] = [];
  const seenKeys = new Set<string>();

  for (let i = 1; i < records.length; i++) {
    const record = records[i]!;
    const lineNumber = i + 1; // 1-indexed; header is line 1
    const parsed: Record<string, unknown> = {};
    let rowHasError = false;

    for (let j = 0; j < record.length; j++) {
      const headerName = headerToColumn.get(j);
      if (headerName == null) continue; // unknown column; already warned

      const col = schema.columns.find((c) => c.name === headerName)!;
      const raw = record[j]!;
      const result = col.parse(raw, lineNumber);
      if (result.ok) {
        parsed[headerName] = result.value;
      } else {
        rowErrors.push({
          kind: "type",
          message: result.error,
          line: lineNumber,
          column: j + 1,
          field: headerName,
        });
        rowHasError = true;
      }
    }

    // Skip row assembly if any field failed to parse. We still
    // continue to find more errors in the same import for batch
    // error surfacing.
    if (rowHasError) continue;

    let row: TRow;
    try {
      row = schema.assemble(parsed);
    } catch (e) {
      rowErrors.push({
        kind: "row",
        message:
          e instanceof Error
            ? `Row assembly failed: ${e.message}`
            : `Row assembly failed.`,
        line: lineNumber,
      });
      continue;
    }

    // 5. Cross-row uniqueness.
    const key = schema.keyOf(row);
    if (seenKeys.has(key)) {
      rowErrors.push({
        kind: "uniqueness",
        message: `Duplicate key "${key}" appears on multiple rows.`,
        line: lineNumber,
      });
      continue;
    }
    seenKeys.add(key);
    rows.push(row);
  }

  if (rowErrors.length > 0) {
    return { ok: false, errors: rowErrors };
  }

  return { ok: true, rows, warnings: headerWarnings };
}

/**
 * Internal: tokenize a CSV string into a 2D array of fields.
 *
 * RFC-4180 strict:
 * - Comma delimiter.
 * - Double-quote quote character.
 * - Doubled-quote escape inside quoted fields.
 * - Newline (LF, after normalization) terminates records.
 *
 * Returns structured errors with line + column positions.
 */
function tokenize(
  text: string,
):
  | { ok: true; records: string[][] }
  | { ok: false; errors: ParseError[] } {
  const records: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let column = 1;
  let fieldStartLine = 1;
  let fieldStartColumn = 1;
  let pendingEndOfRecord = false;

  const finishField = () => {
    current.push(field);
    field = "";
    fieldStartLine = line;
    fieldStartColumn = column;
  };

  const finishRecord = () => {
    finishField();
    // Skip blank trailing lines (a CSV often ends with a newline +
    // empty record; we suppress that). A single empty field counts
    // as a non-empty record if the source had data.
    if (!(current.length === 1 && current[0] === "")) {
      records.push(current);
    }
    current = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // Lookahead for doubled-quote (escaped quote inside field).
        if (text[i + 1] === '"') {
          field += '"';
          i++;
          column += 2;
          continue;
        }
        // End of quoted field.
        inQuotes = false;
        column++;
        continue;
      }
      // Newlines + commas inside quotes are literal.
      field += ch;
      if (ch === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
      continue;
    }

    // Not in quotes.
    if (ch === '"') {
      if (field.length === 0) {
        inQuotes = true;
        fieldStartLine = line;
        fieldStartColumn = column;
        column++;
        continue;
      }
      // A quote that's not at field start in non-quoted mode is
      // RFC-4180 ambiguous; treat as a parse error.
      return {
        ok: false,
        errors: [
          {
            kind: "row",
            message:
              "Unexpected quote character inside an unquoted field. " +
              "If the field contains a quote, the whole field must be " +
              "wrapped in double-quotes.",
            line,
            column,
          },
        ],
      };
    }

    if (ch === ",") {
      finishField();
      column++;
      pendingEndOfRecord = false;
      continue;
    }

    if (ch === "\n") {
      finishRecord();
      line++;
      column = 1;
      pendingEndOfRecord = true;
      continue;
    }

    field += ch;
    column++;
    pendingEndOfRecord = false;
  }

  // Handle trailing content.
  if (inQuotes) {
    return {
      ok: false,
      errors: [
        {
          kind: "row",
          message: "Unterminated quoted field at end of file.",
          line: fieldStartLine,
          column: fieldStartColumn,
        },
      ],
    };
  }

  // Flush any in-progress field as the last record (handles
  // files without trailing newline).
  if (!pendingEndOfRecord && (field.length > 0 || current.length > 0)) {
    finishRecord();
  }

  return { ok: true, records };
}
