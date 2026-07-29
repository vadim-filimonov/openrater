/**
 * timesMapping — FCA fca-2026-07-25 #23 (finding 13) scaled-column
 * sentinel.
 *
 * Real extracts carry figures in the WRONG UNIT for the filed
 * algorithm — the audited GL book stored payroll in THOUSANDS while
 * the plan's exposure divisor expects dollars. The Match columns
 * screen offered no way to say "×1,000", so the persona left the
 * product and hand-built a corrected CSV.
 *
 * Mirrors the `@ratio:` sentinel (Brief 45 K8): a scaled column is
 * encoded INSIDE the existing `column_map: Record<string, string>`
 * shape, so no schema churn anywhere it travels (plan input mapping,
 * book runs, webhooks):
 *
 *   "@times:<column>*<multiplier>"
 *
 * e.g. "@times:payroll*1000".
 *
 * The sentinel is a USER ASSERTION — not a literal CSV column. The
 * consumers that recognise `@ratio:` recognise this too:
 *
 *   1. projectRow — computes Number(row[column]) × multiplier and
 *      projects the number (dtype path skipped; already typed).
 *   2. detectMismatches — skips scaled inputs (no literal column).
 *   3. applyAutoMatch — never seeds a sentinel as a claimed column,
 *      never overwrites one.
 *   4. InputsPanelV2 — renders a column × multiplier editor with a
 *      computed sample.
 *
 * Pure helpers only: no React, no DOM, no I/O.
 */

/** The prefix that marks a column-map value as a scaled column. */
export const TIMES_PREFIX = "@times:";

/** Parsed shape of a `@times:column*multiplier` sentinel. */
export interface ParsedTimes {
  /** Source-column name. */
  readonly column: string;
  /** The scalar the raw value is multiplied by (finite, non-zero). */
  readonly multiplier: number;
}

/**
 * `true` when a column-map value encodes a scaled column. Cheap prefix
 * check; does NOT validate the payload (use `parseTimes`).
 */
export function isTimesMapping(value: string | undefined | null): boolean {
  return typeof value === "string" && value.startsWith(TIMES_PREFIX);
}

/**
 * Parse a `@times:column*multiplier` sentinel. Returns `null` when the
 * value is not a times sentinel OR is malformed (missing column,
 * missing/non-finite/zero multiplier, extra `*`). The multiplier is
 * split on the LAST `*` so a column name containing `*` cannot be
 * scaled — acceptable: rating-input source columns are identifiers.
 */
export function parseTimes(value: string | undefined | null): ParsedTimes | null {
  if (!isTimesMapping(value)) return null;
  const payload = (value as string).slice(TIMES_PREFIX.length);
  const star = payload.lastIndexOf("*");
  if (star <= 0) return null; // no column, or no star
  const column = payload.slice(0, star).trim();
  const rawMult = payload.slice(star + 1).trim();
  if (!column || !rawMult) return null;
  const multiplier = Number(rawMult.replace(/,/g, ""));
  if (!Number.isFinite(multiplier) || multiplier === 0) return null;
  return { column, multiplier };
}

/** Build a `@times:column*multiplier` sentinel. */
export function formatTimes(column: string, multiplier: number): string {
  return `${TIMES_PREFIX}${column}*${multiplier}`;
}

/**
 * Compute the scaled value for one row. Returns a finite number on
 * success, or `null` when the component is missing / non-numeric.
 * Callers treat `null` like an empty cell (skip the input — the
 * engine's missing-input handling owns the outcome).
 *
 * Numeric parsing strips thousands commas to match the dtype-coercion
 * path in projectRowsForBatch (so "1,247" × 1000 parses).
 */
export function computeTimesForRow(
  row: Readonly<Record<string, string>>,
  times: ParsedTimes,
): number | null {
  const raw = row[times.column];
  if (raw == null || raw === "") return null;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const result = n * times.multiplier;
  return Number.isFinite(result) ? result : null;
}
