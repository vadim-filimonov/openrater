/**
 * ONE Δ grammar for the filing's verified examples (Brief 94 U8).
 *
 * The same 658 → 657.92 check used to read "—" in the build-report
 * drawer, "0" on the plan report, and "+0.08" nowhere — three grammars
 * for one number, and "0" quietly overstated "exactly." Both surfaces
 * (BuildReportView and the plan report's worked examples) now import
 * THIS — the browser-twin lesson of PR #484: shared rendering rules
 * live in one module or they drift.
 *
 * The grammar:
 *   - status words pass through ("not run", "error");
 *   - non-numeric checks (the tier verdict) have no numeric Δ → "—";
 *   - a missing delta falls back to the check's detail (or "—");
 *   - an exact match → "0.00";
 *   - anything else → signed cents ("+0.08", "-214.00").
 */

/** The Δ column's tooltip — the honesty note both tables carry. */
export const VECTOR_DELTA_NOTE =
  "Signed, to the cent. Green within the workbook's authored tolerance.";

export function formatVectorDelta(check: {
  readonly status: string;
  readonly expected: number | string | null;
  readonly delta: number | null;
  readonly detail?: string | null;
}): string {
  if (check.status === "not_run") return "not run";
  if (check.status === "error") return "error";
  if (typeof check.expected !== "number") return "—";
  if (check.delta === null) return check.detail ?? "—";
  if (check.delta === 0) return "0.00";
  return `${check.delta > 0 ? "+" : ""}${check.delta.toFixed(2)}`;
}
