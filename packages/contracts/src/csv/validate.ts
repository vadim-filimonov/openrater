/**
 * CSV column-parse helpers — ADR-0017.
 *
 * Per-column `parse()` implementations consumer briefs compose into
 * their schema declarations. Each returns `{ ok: true, value }` or
 * `{ ok: false, error }` with an actuary-readable message.
 *
 * No "smart" type coercion (ADR-0017 anti-pattern #5): a string
 * column stays a string; we don't auto-parse "TRUE" → boolean.
 */

/**
 * Parse a required non-empty string. Strips outer whitespace.
 *
 * Empty after trim → error.
 */
export function parseRequiredString(
  raw: string,
  _line: number,
):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: "Required value is empty." };
  }
  return { ok: true, value: trimmed };
}

/**
 * Parse an optional string. Empty → empty string (not undefined).
 */
export function parseOptionalString(
  raw: string,
  _line: number,
): { ok: true; value: string } {
  return { ok: true, value: raw.trim() };
}

/**
 * Parse a finite number. Empty / non-numeric / non-finite → error.
 *
 * Accepts standard decimal notation (`"1.25"`, `"-0.05"`, `"100"`).
 * Does NOT accept thousands separators (per ADR-0017 anti-pattern
 * #7: no locale-sensitive formatting).
 */
export function parseRequiredNumber(
  raw: string,
  _line: number,
):
  | { ok: true; value: number }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: "Required numeric value is empty." };
  }
  // Reject thousands separators explicitly to match ADR-0017 §7.
  if (trimmed.includes(",")) {
    return {
      ok: false,
      error:
        `Value "${trimmed}" contains a comma. Numeric values may not ` +
        `use thousands separators; write "${trimmed.replace(/,/g, "")}".`,
    };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `Value "${trimmed}" is not a finite number.` };
  }
  return { ok: true, value: n };
}

/**
 * Parse an optional finite number. Empty → `null`.
 */
export function parseOptionalNumber(
  raw: string,
  _line: number,
):
  | { ok: true; value: number | null }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  return parseRequiredNumber(trimmed, _line);
}

/**
 * Parse a positive finite number (> 0). Useful for factor values
 * that must be strictly positive.
 */
export function parsePositiveNumber(
  raw: string,
  _line: number,
):
  | { ok: true; value: number }
  | { ok: false; error: string } {
  const result = parseRequiredNumber(raw, _line);
  if (!result.ok) return result;
  if (result.value <= 0) {
    return { ok: false, error: `Value "${raw}" must be greater than zero.` };
  }
  return result;
}

/**
 * Parse a non-negative finite number (≥ 0). Useful for factor
 * values where 0 is meaningful (e.g., zero-factor excludes).
 */
export function parseNonNegativeNumber(
  raw: string,
  _line: number,
):
  | { ok: true; value: number }
  | { ok: false; error: string } {
  const result = parseRequiredNumber(raw, _line);
  if (!result.ok) return result;
  if (result.value < 0) {
    return { ok: false, error: `Value "${raw}" must be non-negative.` };
  }
  return result;
}

/**
 * Parse an integer. Empty / non-integer / non-finite → error.
 */
export function parseInteger(
  raw: string,
  _line: number,
):
  | { ok: true; value: number }
  | { ok: false; error: string } {
  const result = parseRequiredNumber(raw, _line);
  if (!result.ok) return result;
  if (!Number.isInteger(result.value)) {
    return { ok: false, error: `Value "${raw}" must be an integer.` };
  }
  return result;
}

/**
 * Parse a value from a closed enum (case-sensitive). Empty / not
 * in vocabulary → error.
 *
 * The error message lists the accepted values so the actuary can
 * fix in one read.
 */
export function parseEnum<T extends string>(
  vocabulary: readonly T[],
):
  (raw: string, line: number) =>
    | { ok: true; value: T }
    | { ok: false; error: string }
{
  return (raw, _line) => {
    const trimmed = raw.trim();
    if (vocabulary.includes(trimmed as T)) {
      return { ok: true, value: trimmed as T };
    }
    return {
      ok: false,
      error:
        `Value "${trimmed}" is not one of: ${vocabulary.join(", ")}.`,
    };
  };
}
