/**
 * detectDtypeMismatch — type-aware sample validation for a mapped column
 * (Brief 65 §3.5).
 *
 * `detectMismatches` validates DIMENSION-bound inputs (level membership,
 * band fit, geo acceptance) and skips everything else — so a plain Number
 * input mapped to a text column sailed through with a confident green dot
 * (the audit's "Kansas" case). This helper covers the other half: does the
 * mapped column's sample VALUES parse as the input's declared type?
 *
 * Deliberately shallow: it inspects up to `maxSampleRows` sample values,
 * skips blanks (missing ≠ mistyped), and only judges dtypes with a real
 * parse rule (number / boolean / date). Strings accept anything.
 */

import type { MatchDtype } from "./autoMatch";

export interface DtypeMismatch {
  /** Sample values that failed to parse as the declared type. */
  readonly bad: number;
  /** Non-blank sample values inspected. */
  readonly total: number;
  /** Human label for the expected type ("numbers", "yes/no values", "dates"). */
  readonly expectedLabel: string;
}

const NUMERIC_CLEAN = /[$,%\s]/g;

function parsesAsNumber(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  const s = String(v).replace(NUMERIC_CLEAN, "");
  if (s === "") return false;
  return Number.isFinite(Number(s));
}

const BOOL_WORDS = new Set([
  "true",
  "false",
  "yes",
  "no",
  "y",
  "n",
  "0",
  "1",
]);

function parsesAsBool(v: unknown): boolean {
  if (typeof v === "boolean") return true;
  return BOOL_WORDS.has(String(v).trim().toLowerCase());
}

function parsesAsDate(v: unknown): boolean {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  const s = String(v).trim();
  if (s === "") return false;
  // Reject bare numbers ("750" parses as a Date in some engines).
  if (parsesAsNumber(s)) return false;
  return !Number.isNaN(Date.parse(s));
}

const EXPECTED_LABEL: Record<string, string> = {
  number: "numbers",
  boolean: "yes/no values",
  date: "dates",
};

/**
 * Returns the mismatch summary when at least one non-blank sample value
 * fails the declared type's parse rule; null when the type is string-ish,
 * nothing is mapped, or every inspected value parses.
 */
export function detectDtypeMismatch(
  dtype: MatchDtype | undefined,
  columnName: string,
  sampleRows: readonly Record<string, unknown>[],
  maxSampleRows = 8,
): DtypeMismatch | null {
  if (!dtype || dtype === "string") return null;
  const check =
    dtype === "number"
      ? parsesAsNumber
      : dtype === "boolean"
        ? parsesAsBool
        : parsesAsDate;

  let bad = 0;
  let total = 0;
  for (const row of sampleRows.slice(0, maxSampleRows)) {
    const v = row[columnName];
    if (v == null || String(v).trim() === "") continue;
    total += 1;
    if (!check(v)) bad += 1;
  }
  if (total === 0 || bad === 0) return null;
  return { bad, total, expectedLabel: EXPECTED_LABEL[dtype] ?? dtype };
}
