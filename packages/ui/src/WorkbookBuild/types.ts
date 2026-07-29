/**
 * WorkbookBuild wire-shape mirrors — Brief 92.
 *
 * labs-ui stays off the HTTP layer (the GeoDimWizard precedent):
 * these types MIRROR @openrater/api-client's zod-inferred shapes
 * structurally, and the panel's two operations arrive as injected
 * props. The app layer (rate-lab) passes the real api-client
 * functions; the api-client types are supersets, so they assign
 * without casts.
 */

export interface WorkbookCheckIssue {
  readonly rule: string;
  readonly severity: "error" | "warning" | "notice";
  readonly sheet: string | null;
  readonly cell: string | null;
  readonly message: string;
}

export interface WorkbookManifestCounts {
  readonly dimensions: number;
  readonly dimension_levels: number;
  readonly factor_tables: number;
  readonly factor_cells: number;
  /** Brief 94 (U5) — factor cells covered by a citation (row-level, or
   *  the table-level citation covering its whole table). */
  readonly factor_cells_cited: number;
  readonly chains: number;
  readonly chain_stages: number;
  readonly gates: number;
  readonly modifier_categories: number;
  readonly endorsements: number;
  readonly loadings: number;
  readonly final_adjustments: number;
  readonly geo_rows: number;
  readonly inputs: number;
  readonly inputs_with_defaults: number;
  readonly outputs: number;
  readonly test_cases: number;
  readonly declared_gaps: number;
}

export interface WorkbookManifestLike {
  readonly provenance: {
    readonly carrier: string | null;
    readonly product: string | null;
    readonly state: string | null;
    readonly effective_date: string | null;
    readonly serff_tracking_number: string | null;
    readonly display_name: string | null;
    /** Brief 92.R (D2) — the workbook's own identity + version. */
    readonly rating_plan_id?: string | null;
    readonly version?: string | null;
  };
  readonly counts: WorkbookManifestCounts;
  readonly gap_kinds: Readonly<Record<string, number>>;
}

/** Brief 92.R (D2) — the plan a clean check's workbook revises. */
export interface RevisionCandidateLike {
  readonly rating_plan_id: string;
  readonly display_name: string;
  readonly built_at: string;
  readonly version_from: string | null;
  readonly version_to: string | null;
}

export interface WorkbookCheckResultLike {
  readonly ok: boolean;
  readonly spec_version: string;
  readonly workbook_hash: string;
  readonly filename: string | null;
  readonly sheet_count: number;
  readonly errors: readonly WorkbookCheckIssue[];
  readonly warnings: readonly WorkbookCheckIssue[];
  readonly notices: readonly WorkbookCheckIssue[];
  readonly manifest: WorkbookManifestLike | null;
  readonly already_built: {
    readonly rating_plan_id: string;
    readonly report_id: string;
    readonly created_at: string;
  } | null;
  readonly revises?: RevisionCandidateLike | null;
}

/** Brief 92.R (D3) — the diff's wire shape, structurally (the engine
 *  serializes with ADR-0017 aliases; labs-ui only reads). */
export interface DiffFieldChangeLike {
  readonly field: string;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly pct?: number | null;
}

export interface DiffItemLike {
  readonly state: "added" | "changed" | "removed";
  readonly key: string;
  readonly summary: string;
  readonly changes?: readonly DiffFieldChangeLike[];
}

export interface DiffSectionLike {
  readonly section: string;
  readonly label: string;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly items: readonly DiffItemLike[];
}

export interface WorkbookDiffLike {
  readonly totals: {
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
    readonly sections_changed: number;
  };
  readonly sections: readonly DiffSectionLike[];
  readonly ignored?: readonly string[];
}

/** Brief 92.R — the stateless revision check's payload. */
export interface ReingestCheckResultLike {
  readonly check: WorkbookCheckResultLike;
  readonly diff: WorkbookDiffLike | null;
  readonly base: {
    readonly report_id: string;
    readonly workbook_version: string | null;
    readonly built_at: string;
  } | null;
  readonly base_missing_reason: string | null;
  readonly hand_edited_since_build: boolean;
  readonly plan_content_hash: string | null;
}

/** Brief 92.R (D6) — the measured move between builds. */
export interface DriftSummaryLike {
  readonly compared: number;
  readonly median_pct: number | null;
  readonly max_pct: number | null;
  readonly expectations_revised: number;
  readonly cases: readonly {
    readonly case_id: string;
    readonly field: string;
    readonly was: number | string | null;
    readonly now: number | string | null;
    readonly pct: number | null;
  }[];
}

export interface WorkbookVectorResult {
  readonly case_id: string;
  readonly name: string | null;
  readonly field: string;
  readonly expected: number | string;
  readonly actual: number | string | null;
  readonly delta: number | null;
  readonly status: "match" | "near" | "mismatch" | "not_run" | "error";
  readonly detail: string | null;
}

export interface WorkbookVectorsSummary {
  readonly status: "ran" | "unavailable" | "none";
  readonly detail: string | null;
  readonly total_cases: number;
  readonly checks: readonly WorkbookVectorResult[];
  readonly matched: number;
  readonly near: number;
  readonly mismatched: number;
  /** FCA #19 — gate-rule vector coverage from the real engine traces
   *  (optional: reports written before the fields existed parse as
   *  before). */
  readonly gate_rules_total?: number;
  readonly gate_rules_exercised?: number;
  readonly unexercised_gate_rules?: readonly string[];
}

export interface BuildReportLike {
  readonly report_id: string;
  readonly rating_plan_id: string;
  readonly workbook_hash: string;
  readonly filename: string | null;
  readonly spec_version: string;
  readonly workbook_plan_id: string | null;
  /** Brief 92.R — present on re-ingested rows; older reports omit them. */
  readonly workbook_version?: string | null;
  readonly diff?: WorkbookDiffLike | null;
  readonly drift?: DriftSummaryLike | null;
  readonly manifest: WorkbookManifestLike;
  readonly issues: readonly WorkbookCheckIssue[];
  readonly vectors: WorkbookVectorsSummary;
  readonly gaps: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly created_at: string;
}

export interface BuildWorkbookResponseLike {
  readonly rating_plan_id: string;
  readonly display_name: string;
  readonly report: BuildReportLike;
}

/** The two injected operations — the app layer supplies the real
 *  api-client calls; tests supply fakes. */
export type CheckWorkbookFn = (
  bytes: ArrayBuffer,
  filename: string,
) => Promise<WorkbookCheckResultLike>;
export type BuildWorkbookFn = (
  bytes: ArrayBuffer,
  filename: string,
) => Promise<BuildWorkbookResponseLike>;
