/**
 * Unified error surface types — Brief 13.
 *
 * The Issue shape consolidates ALL diagnostic signals across the
 * plan into one common record. The Brief 13 status bar + drawer
 * primitives (which land in M2) consume these verbatim.
 *
 *   collectIssues(plan, run?, registry?) → readonly Issue[]
 *
 * Pulls from 5 sources:
 *   - compile      — `compilePlan()` errors (schema, refs, types)
 *   - runtime      — trace entries with non-null `error`
 *   - authoring    — per-section validators (kind.validate, plan
 *                    reference integrity)
 *   - reference    — broken refs (validatePlanReferences output)
 *   - conformance  — failing conformance vectors (M1.7+)
 *
 * Deterministic ranking (Brief 13 P-UE3):
 *   1. severity:  error  >  warning  >  info
 *   2. source:    compile > runtime > authoring > reference > conformance
 *   3. section:   spine declaration order (Risk Inputs first, Outputs last)
 *   4. entity:    alphabetical
 *   5. field:     alphabetical
 *
 * Stable ids per Brief 13 P-UE8: deterministic from (source +
 * canonical-location + message_template). Same plan → same Issue
 * ids across sessions. Enables: audit linkage, CI regression
 * detection, persistent snooze state (V2).
 *
 * Pure types. No React, no DOM. See `docs/design-briefs/unified-
 * error-surface.md` §6 for the design rationale.
 */

/** Three-level severity. Error > warning > info. */
export type IssueSeverity = "error" | "warning" | "info";

/** Where the issue came from. Drives source-filter chips + ranking. */
export type IssueSource =
  | "compile"
  | "runtime"
  | "authoring"
  | "reference"
  | "conformance";

/** Iterable list of every severity, ranked highest-first. */
export const ISSUE_SEVERITIES: readonly IssueSeverity[] = Object.freeze([
  "error",
  "warning",
  "info",
] as const);

/** Iterable list of every source, in deterministic-ranking order. */
export const ISSUE_SOURCES: readonly IssueSource[] = Object.freeze([
  "compile",
  "runtime",
  "authoring",
  "reference",
  "conformance",
] as const);

/**
 * Where the issue lives in the plan — drives the deep-link affordance
 * and the per-section dot routing.
 */
export interface IssueLocation {
  /** Spine section id (e.g., "risk-inputs", "dimensions",
   *  "classification"). Matches `Section.id` from spine.ts. */
  readonly section: string;
  /** Optional entity id within the section (e.g., a dimension id,
   *  a chain node id, a class code). */
  readonly entity?: string;
  /** Optional field within the entity (e.g., "value", "ref",
   *  "exposure_bases"). */
  readonly field?: string;
}

/**
 * Optional fix hint — a one-click CTA pointing at the source.
 * Brief 13 P-UE6.
 */
export interface IssueFixHint {
  /** Actuary-language CTA label (e.g., "Open Classification → Class 91342"). */
  readonly label: string;
  /** Where the CTA navigates to. May be the same as `issue.location`
   *  OR a different surface (e.g., a missing-input error in the
   *  Trace section deep-links to Risk Inputs). */
  readonly target: IssueLocation;
}

/**
 * One diagnostic. The unified panel consumes a list of these,
 * ranks them, and renders one row per Issue.
 */
export interface Issue {
  /** Stable deterministic id (see `deriveIssueId`). */
  readonly id: string;
  /** Severity drives the chip color + sort. */
  readonly severity: IssueSeverity;
  /** Source category drives the filter chip + sort. */
  readonly source: IssueSource;
  /** Actuary-language message — a complete sentence ending in a period. */
  readonly message: string;
  /** Optional fix hint CTA (deep-link only in V1). */
  readonly fix_hint?: IssueFixHint;
  /** Where the issue lives. */
  readonly location: IssueLocation;
  /** Whether the issue blocks filing. Driven by severity + source
   *  per Brief 13 §6.
   *
   *  Rule (V1):
   *    - error + (compile | reference | runtime) → true
   *    - error + (authoring | conformance) → true ONLY when
   *      explicitly tagged (authoring) OR when in the regulator-
   *      required vector set (conformance)
   *    - warning / info → false (regardless of source)
   */
  readonly filing_blocking: boolean;
  /** Optional citation to the source rule / contract / vector. */
  readonly citation?: string;
}

/**
 * Counts by severity. Status bar uses these for the persistent
 * chip ("3 errors · 2 warnings · 1 info").
 */
export interface IssueSeverityCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
}

/**
 * Aggregate filing-readiness verdict. Drives the drawer header
 * chip per Brief 13 §3 Surface 5.
 */
export type FilingReadiness =
  | "filing_ready" // zero issues OR only non-blocking warnings + info
  | "filing_ready_with_warnings" // zero errors; some warnings
  | "blocked"; // at least one filing_blocking issue
