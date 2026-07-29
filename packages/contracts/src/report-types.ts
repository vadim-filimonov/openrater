/**
 * UW Report shapes — Brief 7 (UW Report integration).
 *
 * The UW Report is structured AI/API-driven underwriting evidence
 * attached to an account. It's produced upstream (out of scope for
 * the rating engine) — OpenRater Rate Lab consumes it via the `uw.report`
 * kind (which sources it from `ctx.externalInputs`) and downstream
 * kinds (`chain.from_report`, or hand-wired modifier.schedule
 * applications) consume the report.
 *
 *     UwReport
 *       ├─ summary:   "Established restaurant; clean OSHA history; positive Google reviews."
 *       ├─ adjustments:
 *       │   ├─ { category: "Safety devices", value_pct: −5,
 *       │   │    reasoning: "Monitored fire alarm + sprinklers per Google Business Profile",
 *       │   │    citation: "google_business_profile.amenities.fire_safety",
 *       │   │    accepted: true }
 *       │   ├─ { category: "Premises maintenance", value_pct: +3,
 *       │   │    reasoning: "Reviews mention 'tired interior'",
 *       │   │    accepted: true }
 *       │   └─ { category: "Management experience", value_pct: −5,
 *       │        reasoning: "Owner-operator, 18 yrs in trade per LinkedIn",
 *       │        accepted: false }
 *       └─ sources: [google_business_profile, osha_history, linkedin, ...]
 *
 * The no-gimmicks line: the UW Report SUGGESTS values; the
 * underwriter explicitly accepts each. `accepted: false` means the
 * underwriter saw + rejected; downstream kinds must respect this.
 * `chain.from_report` defaults to `require_acceptance: true` so
 * only accepted adjustments contribute.
 *
 * Pure types. No React, no DOM. See `docs/design-briefs/uw-report-
 * integration.md` for the design.
 */

/**
 * A single AI/API-derived underwriting adjustment.
 *
 * The category is free-form (the UW Report author picks it). For the
 * UW Report → modifier.schedule bridge (Brief 15 Q9), name-matching
 * is used: an adjustment with category "Safety devices" auto-suggests
 * into a schedule category whose name fuzzy-matches.
 */
export interface UwAdjustment {
  /** Stable id within the parent report. */
  readonly adjustment_id: string;
  /** Free-form category name. Matched against modifier.schedule
   *  category names for auto-suggest (Brief 15 Q9). */
  readonly category: string;
  /** Suggested signed percentage. Positive = surcharge,
   *  negative = credit. Same convention as ScheduleApplicationEntry. */
  readonly value_pct: number;
  /** AI/API-authored reasoning. Verbatim into the trace + audit. */
  readonly reasoning: string;
  /** Source citation (URL, API endpoint, doc reference). */
  readonly citation?: string;
  /**
   * Underwriter's explicit acceptance state. Default WHEN sourcing
   * an adjustment INTO a UwReport: `false`. The UI surfaces each
   * adjustment with Accept / Edit / Ignore controls; only Accept
   * sets this to true.
   *
   * THE no-gimmicks line: until the underwriter accepts, the
   * adjustment is suggestion-only.
   */
  readonly accepted: boolean;
  /** Free-form metadata from the source API. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * One source/API/document the report was assembled from. Provenance
 * for the audit trail — regulators can answer "where did this
 * evidence come from?".
 */
export interface UwReportSource {
  /** Source identifier (e.g., "google_business_profile",
   *  "osha_history", "manual_inspection"). */
  readonly name: string;
  /** Optional URL of the source document. */
  readonly url?: string;
  /** ISO 8601 timestamp when the source was queried. */
  readonly fetched_at: string;
  /** Free-form metadata (response excerpt, version, etc.). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Top-level UW Report — the AI/API artifact attached to one account.
 */
export interface UwReport {
  /** Stable id for the report. */
  readonly report_id: string;
  /** ISO 8601 timestamp when the report was generated. */
  readonly generated_at: string;
  /** Account identifier this report describes. */
  readonly account_id: string;
  /** Overall human-readable summary. Surfaced in the UW Report
   *  section UI as the actuary-facing executive summary. */
  readonly summary: string;
  /** Per-adjustment list. */
  readonly adjustments: readonly UwAdjustment[];
  /** Provenance — which sources were consulted. */
  readonly sources: readonly UwReportSource[];
}

/**
 * Result of expanding an UW Report through `chain.from_report`. One
 * entry per adjustment that applied (after acceptance + filter rules).
 * Surfaces in the trace for the audit trail.
 */
export interface AppliedReportAdjustment {
  readonly adjustment_id: string;
  readonly category: string;
  readonly value_pct: number;
  readonly reasoning: string;
  readonly citation?: string;
}

/**
 * Type guard: is this an UwReport-shaped object?
 *
 * Defensive check at the runtime boundary (`uw.report` kind reads
 * arbitrary JSON from `ctx.externalInputs`). Returns true when the
 * required fields are present + correctly typed.
 */
export function isUwReport(value: unknown): value is UwReport {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o["report_id"] === "string" &&
    typeof o["generated_at"] === "string" &&
    typeof o["account_id"] === "string" &&
    typeof o["summary"] === "string" &&
    Array.isArray(o["adjustments"]) &&
    Array.isArray(o["sources"])
  );
}
