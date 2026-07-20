/**
 * appetitePhrases — the ONE English grammar for eligibility rules.
 *
 * Extracted from <AppetiteStatement> (Brief 70 §3) so every surface
 * that speaks a rule — the Eligibility document, the plan report's
 * "Where the plan says no" section (Brief 93 §1.1.6) — phrases it
 * identically. Pure data-in / data-out.
 */

/** Op → phrase for numeric fields, in composer display order. */
export const NUMERIC_OPS: ReadonlyArray<[string, string]> = [
  ["ge", "is at least"],
  ["gt", "is more than"],
  ["le", "is at most"],
  ["lt", "is less than"],
  ["eq", "is exactly"],
  ["ne", "is not"],
];

/** Op → phrase for string fields, in composer display order. */
export const STRING_OPS: ReadonlyArray<[string, string]> = [
  ["eq", "is"],
  ["ne", "is not"],
  ["in", "is one of"],
  ["nin", "is not one of"],
];

export function opPhrase(op: string, numeric: boolean): string {
  const all = [...NUMERIC_OPS, ...STRING_OPS];
  return all.find(([o]) => o === op)?.[1] ?? (numeric ? "is" : "is");
}

/**
 * Finding E3 — the field-picker carries RAW input-dictionary dtypes
 * (PrimitiveType), not just the aggregates' literal "number". Money /
 * int / factor / pct inputs are numeric too.
 */
export function isNumericDtype(dtype: string | undefined): boolean {
  return (
    dtype === "number" ||
    dtype === "money" ||
    dtype === "int" ||
    dtype === "factor" ||
    dtype === "pct"
  );
}

/** Format a numeric display value with separators ("1000000" → "1,000,000"). */
export function fmtAppetiteValue(value: string, dtype?: string): string {
  if (isNumericDtype(dtype) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value).toLocaleString("en-US");
  }
  return value;
}
