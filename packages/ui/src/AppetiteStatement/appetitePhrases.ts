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

/**
 * Op → phrase for boolean fields — equality only (FCA S2). Membership
 * over a two-value domain is never what a filed rule means.
 */
export const BOOL_OPS: ReadonlyArray<[string, string]> = [
  ["eq", "is"],
  ["ne", "is not"],
];

export function opPhrase(op: string, numeric: boolean, bool = false): string {
  // A boolean clause reads "is Yes" / "is not Yes" — never the numeric
  // register's "is exactly" (FCA S2's yes/no grammar).
  if (bool) {
    const hit = BOOL_OPS.find(([o]) => o === op);
    if (hit) return hit[1];
  }
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

/**
 * FCA S2 — boolean fields: the yes/no value picker + equality ops.
 * Both spellings reach here ("bool" from the input dictionary's
 * PrimitiveType, "boolean" from workbook-vocabulary callers).
 */
export function isBoolDtype(dtype: string | undefined): boolean {
  return dtype === "bool" || dtype === "boolean";
}

/**
 * The picker label ("Yes"/"No") for a stored boolean literal — the
 * spec §2.1 spellings, trimmed/case-folded like the runtime
 * comparator reads them. Anything else (a legacy free-text value)
 * returns null so callers can surface it verbatim.
 */
export function boolValueLabel(value: string): string | null {
  const s = value.trim().toLowerCase();
  return s === "true" ? "Yes" : s === "false" ? "No" : null;
}

/** Format a numeric display value with separators ("1000000" → "1,000,000"). */
export function fmtAppetiteValue(value: string, dtype?: string): string {
  if (isBoolDtype(dtype)) {
    return boolValueLabel(value) ?? value;
  }
  if (isNumericDtype(dtype) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value).toLocaleString("en-US");
  }
  return value;
}
