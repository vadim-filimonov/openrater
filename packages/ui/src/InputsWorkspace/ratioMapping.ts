/**
 * ratioMapping — Brief 45 K8 derived-ratio sentinel.
 *
 * Some banded rating dimensions are driven by a RATIO of two raw CSV
 * columns rather than a single column. Example (IRS-990 D&O+GL spec):
 *
 *   stress              band = total_expenses / revenue   (binned)
 *   occupancy_intensity band = occupancy_expense / revenue (binned)
 *
 * The real datasets carry the COMPONENTS (total_expenses, revenue,
 * occupancy_expense), not the ratios. To let an end-user feed a ratio
 * of two columns into a banded input WITHOUT changing the
 * `column_map: Record<string, string>` shape (and therefore no Zod /
 * schema churn), we encode the ratio as a sentinel string:
 *
 *   "@ratio:<numeratorColumn>/<denominatorColumn>"
 *
 * e.g. "@ratio:total_expenses/revenue".
 *
 * The sentinel is a USER ASSERTION — it is not a literal CSV column.
 * Three consumers in this directory recognise it:
 *
 *   1. projectRowsForBatch — computes Number(num) / Number(den) and
 *      projects the result (a number) to the engine, which bins it.
 *   2. detectMismatches — skips inputs whose mapping is a ratio (there
 *      is no `row["@ratio:…"]` to inspect).
 *   3. ColumnMappingTable — renders an editable num ÷ den control
 *      instead of a plain source-column picker.
 *
 * Pure helpers only: no React, no DOM, no I/O.
 */

/** The prefix that marks a column-map value as a derived ratio. */
export const RATIO_PREFIX = "@ratio:";

/** Parsed shape of a `@ratio:num/den` sentinel. */
export interface ParsedRatio {
  /** Numerator source-column name. */
  readonly numerator: string;
  /** Denominator source-column name. */
  readonly denominator: string;
}

/**
 * `true` when a column-map value encodes a derived ratio. Cheap prefix
 * check; does NOT validate the `num/den` payload (use `parseRatio`).
 */
export function isRatioMapping(value: string | undefined | null): boolean {
  return typeof value === "string" && value.startsWith(RATIO_PREFIX);
}

/**
 * Parse a `@ratio:num/den` sentinel into its two column names. Returns
 * `null` when the value is not a ratio sentinel OR is malformed
 * (missing numerator, missing denominator, or extra slashes).
 *
 * The payload is split on the FIRST slash only would be ambiguous if a
 * column name itself contained "/", so we require EXACTLY one slash —
 * a column whose name contains "/" cannot be used in a ratio. This is
 * an acceptable limitation: rating-input source columns are
 * identifiers, not paths.
 */
export function parseRatio(value: string | undefined | null): ParsedRatio | null {
  if (!isRatioMapping(value)) return null;
  const payload = (value as string).slice(RATIO_PREFIX.length);
  const slash = payload.indexOf("/");
  if (slash <= 0) return null; // no numerator, or no slash
  const numerator = payload.slice(0, slash).trim();
  const denominator = payload.slice(slash + 1).trim();
  if (!numerator || !denominator) return null;
  // Reject extra slashes — ambiguous column boundaries.
  if (denominator.includes("/")) return null;
  return { numerator, denominator };
}

/** Build a `@ratio:num/den` sentinel from two column names. */
export function formatRatio(numerator: string, denominator: string): string {
  return `${RATIO_PREFIX}${numerator}/${denominator}`;
}

/**
 * Compute the ratio for one row. Returns a finite number on success,
 * or `null` when either component is missing / non-numeric, or the
 * denominator is 0 (division would be ±Infinity or NaN). Callers treat
 * `null` like an empty cell (skip the input).
 *
 * Numeric parsing strips thousands commas to match the dtype-coercion
 * path in projectRowsForBatch (so "1,360,000" parses).
 */
export function computeRatioForRow(
  row: Readonly<Record<string, string>>,
  ratio: ParsedRatio,
): number | null {
  const rawNum = row[ratio.numerator];
  const rawDen = row[ratio.denominator];
  if (rawNum == null || rawDen == null) return null;
  const num = toNumber(rawNum);
  const den = toNumber(rawDen);
  if (num === null || den === null) return null;
  if (den === 0) return null;
  const result = num / den;
  return Number.isFinite(result) ? result : null;
}

/**
 * Parse a raw cell to a number, stripping thousands commas. Returns
 * `null` for empty / non-numeric values. Mirrors `coerceNumber` in
 * projectRowsForBatch so ratio components parse identically to plain
 * numeric inputs.
 */
function toNumber(raw: string): number | null {
  if (raw === "") return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
