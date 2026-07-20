/**
 * CSV encoder — ADR-0017.
 *
 * RFC-4180 strict + deterministic byte-stable output.
 * - UTF-8 without BOM
 * - LF line endings (never CRLF)
 * - Trailing newline at EOF
 * - Minimal-quote policy (only when required)
 * - Doubled-quote escape for embedded quotes
 * - Canonical column order (per `schema.columns`)
 * - Trailing-newline + sort-by-key for byte-stability
 *
 * See ADR-0017 §1, §2, §7 (reproducibility guarantee).
 */

import type { CsvSchema } from "./types";

/**
 * Encode a collection of rows to a deterministic CSV string.
 *
 * Rows are sorted by `schema.keyOf(row)` ascending (string
 * comparison) so that the same input produces byte-identical output.
 *
 * @param rows The collection to serialize.
 * @param schema The CSV schema (column order + key extractor + per-column encode).
 * @returns A UTF-8 string with LF line endings and a trailing newline.
 */
export function encodeCsv<TRow>(
  rows: readonly TRow[],
  schema: CsvSchema<TRow>,
): string {
  // Build header.
  const headerLine = schema.columns
    .map((col) => quoteIfNeeded(col.name))
    .join(",");

  // Sort rows by key ascending (stable + lexicographic).
  const sorted = [...rows].sort((a, b) => {
    const ka = schema.keyOf(a);
    const kb = schema.keyOf(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });

  // Encode each row in canonical column order.
  const rowLines = sorted.map((row) =>
    schema.columns
      .map((col) => quoteIfNeeded(col.encode(row)))
      .join(","),
  );

  // Trailing newline at EOF per POSIX convention.
  return [headerLine, ...rowLines, ""].join("\n");
}

/**
 * Quote a field if it contains a comma, a quote, or a newline.
 * Otherwise return as-is. Doubled-quote escape for embedded quotes.
 *
 * Exported for tests + per-cell consumers (citation rendering, etc.).
 */
export function quoteIfNeeded(raw: string): string {
  if (raw === "") {
    // Empty fields are emitted as empty (no quotes).
    return "";
  }
  const needsQuote =
    raw.includes(",") ||
    raw.includes('"') ||
    raw.includes("\n") ||
    raw.includes("\r");

  if (!needsQuote) return raw;

  // Doubled-quote escape: " → "".
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Canonical number formatting for CSV output.
 *
 * - Integers as `"123"`.
 * - Decimals as decimal form with trailing zeros trimmed
 *   (`"1.25"`, not `"1.250000"`).
 * - Special values (NaN, ±Infinity) produce the empty string.
 *
 * Per-brief schemas can override (e.g., factor tables want 4 fixed
 * digits for filing artifacts); this is the default for the common
 * case.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  // Trim trailing zeros after decimal point.
  const str = String(value);
  // Avoid scientific notation for small/large numbers.
  if (str.includes("e") || str.includes("E")) {
    return value.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
  }
  return str;
}
