/**
 * report-examples — Brief 93 §1.1.7 / R5 (93.3): the worked-examples
 * section's workbook variant.
 *
 * Projects the persisted build report's vector results (Brief 92 —
 * the filing's OWN test cases, scored through the production engine
 * at build) into the report's verdict + table. The strongest trust
 * artifact the platform produces, surfaced from the drawer onto the
 * front page. Pure data-in / data-out; the build-report drawer keeps
 * the full cell-addressed detail (R5).
 */

import { formatVectorDelta } from "../WorkbookBuild/vectorDelta";

export type VectorStatus = "match" | "near" | "mismatch" | "not_run" | "error";

/** The slice of the build report this module reads (client schema). */
export interface VectorResultLike {
  readonly case_id: string;
  readonly name: string | null;
  readonly field: string;
  readonly expected: number | string;
  readonly actual: number | string | null;
  readonly delta: number | null;
  readonly status: VectorStatus;
}

export interface VectorsSummaryLike {
  readonly status: "ran" | "unavailable" | "none";
  readonly total_cases: number;
  readonly checks: readonly VectorResultLike[];
  readonly matched: number;
  readonly near: number;
  readonly mismatched: number;
}

export interface VerifiedExampleRow {
  readonly id: string;
  readonly label: string;
  readonly expected: string;
  readonly actual: string;
  /** The Δ cell — ONE grammar with the build report (Brief 94 U8):
   *  "0.00" exact, signed cents when tolerated-but-nonzero, "—" for
   *  non-numeric checks, or the failure word. */
  readonly delta: string;
  readonly status: VectorStatus;
}

export interface VerifiedExamples {
  /** "40 of 40 reproduce the filing exactly" */
  readonly verdict: string;
  readonly tone: "success" | "warn" | "error";
  readonly rows: readonly VerifiedExampleRow[];
  /** Checks beyond the cap — stated, never silent. */
  readonly moreCount: number;
  /** ISO date the verification ran (the build), for the honesty caption. */
  readonly builtAt: string | null;
}

const ROW_CAP = 8;

function fmtNum(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtVal(v: number | string | null): string {
  if (v === null) return "—";
  return typeof v === "number" ? fmtNum(v) : v;
}

function fmtDelta(r: VectorResultLike): string {
  // Brief 94 (U8) — ONE Δ grammar, shared with BuildReportView. A
  // tolerated-but-nonzero match shows its signed cents ("-0.08"), never
  // a "0" that overstates "exactly"; exact matches show "0.00".
  return formatVectorDelta(r);
}

/**
 * Null ⇒ no usable verification (not workbook-built, vectors
 * unavailable, or zero cases) — the section falls back to the probe
 * book variant.
 */
export function buildVerifiedExamples(
  report: {
    readonly vectors: VectorsSummaryLike;
    readonly created_at?: string | null;
  } | null,
  opts?: { readonly cap?: number },
): VerifiedExamples | null {
  if (!report) return null;
  const v = report.vectors;
  if (v.status !== "ran" || v.total_cases === 0 || v.checks.length === 0) {
    return null;
  }
  const cap = opts?.cap ?? ROW_CAP;
  const total = v.total_cases;

  // The verdict sentence — honest tone ladder: any mismatch is an
  // error headline; rounding-tolerance nears get named; else exact.
  let verdict: string;
  let tone: VerifiedExamples["tone"];
  if (v.mismatched > 0) {
    verdict = `${v.matched + v.near} of ${total} match the filing — ${v.mismatched} ${v.mismatched === 1 ? "does" : "do"} not`;
    tone = "error";
  } else if (v.near > 0) {
    verdict = `${total} of ${total} reproduce the filing (${v.near} within rounding)`;
    tone = "warn";
  } else {
    verdict = `${total} of ${total} reproduce the filing exactly`;
    tone = "success";
  }

  // Disambiguate labels only when the checks span multiple fields.
  const fields = new Set(v.checks.map((c) => c.field));
  const rows = v.checks.slice(0, cap).map((c, i) => ({
    id: `${c.case_id}:${c.field}:${i}`,
    label: (c.name ?? c.case_id) + (fields.size > 1 ? ` — ${c.field}` : ""),
    expected: fmtVal(c.expected),
    actual: fmtVal(c.actual),
    delta: fmtDelta(c),
    status: c.status,
  }));

  return {
    verdict,
    tone,
    rows,
    moreCount: Math.max(0, v.checks.length - rows.length),
    builtAt: report.created_at ?? null,
  };
}
