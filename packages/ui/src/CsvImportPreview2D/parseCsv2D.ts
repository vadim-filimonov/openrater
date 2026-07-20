/**
 * parseCsv2D — Brief 33 PR 33.5.
 *
 * Minimal CSV parser tuned for 2-D rating tables. Reads a string,
 * returns a `CsvImport2D` shape ready for `matchCsv2D`.
 *
 * Scope:
 *   • Comma-separated (one delimiter)
 *   • CRLF or LF line endings
 *   • Optional surrounding double-quotes (and escaped `""` inside)
 *   • Blank lines stripped
 *   • Numeric cells parsed via `Number()`; non-numeric body cells
 *     become `null`
 *
 * What this does NOT do (deliberately):
 *   • Semicolon / tab delimiters
 *   • UTF-8 BOM stripping (most rate-table CSVs are plain ASCII)
 *   • Multi-line cells inside quotes (rare for rate tables; keeps
 *     the parser tiny)
 *
 * Format expected:
 *
 *   ROW_KEY_HEADER,col_label_1,col_label_2,col_label_3
 *   row_key_a,1.10,1.15,1.20
 *   row_key_b,0.95,1.00,1.05
 *
 * For 1-D tables, the same shape works with a single value column.
 */

import type { CsvImport2D } from "./matchCsv";

/**
 * Tokenize a single CSV line. Respects double-quoted fields (which
 * may contain commas) and the `""` escape.
 */
function tokenizeLine(line: string): string[] {
  const cells: string[] = [];
  let buf = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuote) {
      if (ch === '"') {
        // Lookahead for "" → literal "
        if (line[i + 1] === '"') {
          buf += '"';
          i += 1;
        } else {
          inQuote = false;
        }
      } else {
        buf += ch;
      }
    } else {
      if (ch === ",") {
        cells.push(buf);
        buf = "";
      } else if (ch === '"' && buf === "") {
        inQuote = true;
      } else {
        buf += ch;
      }
    }
  }
  cells.push(buf);
  return cells;
}

/**
 * Parse a numeric CSV cell. Empty or non-numeric → null. Strips
 * surrounding whitespace.
 */
function parseNumericCell(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export interface ParseCsv2DOptions {
  readonly fileName: string;
}

/**
 * Parse a CSV string into the `CsvImport2D` shape that
 * `matchCsv2D` consumes. Throws on a CSV with no header row OR no
 * body rows (callers should catch + surface as a validation error
 * in the drawer).
 */
export function parseCsv2D(
  raw: string,
  options: ParseCsv2DOptions,
): CsvImport2D {
  // Normalize line endings, strip blank lines.
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("Empty CSV — no rows to import.");
  }
  if (lines.length < 2) {
    throw new Error(
      "CSV needs at least one body row after the header.",
    );
  }
  const headerTokens = tokenizeLine(lines[0]!);
  if (headerTokens.length < 2) {
    throw new Error(
      "CSV header must have at least one value column after the row-key column.",
    );
  }
  // First header cell is the row-key column label (typically the
  // dim slug, but we ignore it — the row-key field on each body row
  // is what matters). The rest are the col labels.
  const colLabels = headerTokens.slice(1).map((s) => s.trim());

  const rows = lines.slice(1).map((line) => {
    const tokens = tokenizeLine(line);
    const keyLabel = (tokens[0] ?? "").trim();
    const cells: Record<string, number | null> = {};
    for (let i = 0; i < colLabels.length; i++) {
      const colLabel = colLabels[i]!;
      const value = parseNumericCell(tokens[i + 1] ?? "");
      cells[colLabel] = value;
    }
    return { keyLabel, cells };
  });

  return {
    fileName: options.fileName,
    colLabels,
    rows,
  };
}
