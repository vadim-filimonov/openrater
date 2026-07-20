/**
 * Issue helpers — id derivation, ranking, severity counting,
 * filing-readiness verdict.
 *
 * Pure functions. No React, no DOM.
 */

import { PLAN_SECTIONS } from "../spine";
import type {
  FilingReadiness,
  Issue,
  IssueLocation,
  IssueSeverity,
  IssueSeverityCounts,
  IssueSource,
} from "./types";

/**
 * Derive a deterministic stable id for an issue. Same (source,
 * canonical-location, message_template) → same id across sessions.
 *
 * The id is a non-cryptographic hash; collisions are vanishingly
 * unlikely for the diagnostic surface (typically <100 issues per
 * plan). Format: "iss_<8-hex>" — short enough to fit chip-style
 * displays + readable in logs.
 *
 * Why hash and not natural-key concat? Because the message
 * `template` can be long and contain user-content; the hash gives
 * a fixed-width opaque-but-stable token suitable for URL routing,
 * audit log linkage, and snooze persistence (V2).
 *
 * Note: this function takes the message TEMPLATE, not the formatted
 * message. Two issues with the same template but different format
 * args (e.g., "Class X has no exposure" with X=c201 vs X=c101)
 * get DIFFERENT ids. Two re-collections of the SAME plan produce
 * the SAME ids for the SAME issues — that's the invariant.
 */
export function deriveIssueId(input: {
  readonly source: IssueSource;
  readonly location: IssueLocation;
  readonly message_template: string;
  readonly format_args?: readonly string[];
}): string {
  const parts: string[] = [
    input.source,
    input.location.section,
    input.location.entity ?? "",
    input.location.field ?? "",
    input.message_template,
    ...(input.format_args ?? []),
  ];
  const seed = parts.join("|");
  return `iss_${fnv1aHex(seed)}`;
}

/**
 * FNV-1a 32-bit hash. Deterministic + fast + no external deps.
 * Produces an 8-character lowercase hex string.
 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by FNV prime (16777619), keep 32-bit
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ── Severity ranking ────────────────────────────────────────────────

const SEVERITY_RANK: Readonly<Record<IssueSeverity, number>> = Object.freeze({
  error: 0,
  warning: 1,
  info: 2,
});

const SOURCE_RANK: Readonly<Record<IssueSource, number>> = Object.freeze({
  compile: 0,
  runtime: 1,
  authoring: 2,
  reference: 3,
  conformance: 4,
});

/** Lookup map: section.id → declaration order (0-indexed). */
const SECTION_RANK: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(PLAN_SECTIONS.map((s, i) => [s.id, i])),
);

/**
 * Deterministic Issue comparator. Sorts by severity → source →
 * section spine order → entity → field. Stable for ties (any two
 * issues that compare equal stay in their input order).
 */
export function rankIssues(a: Issue, b: Issue): number {
  const sevDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sevDelta !== 0) return sevDelta;
  const srcDelta = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  if (srcDelta !== 0) return srcDelta;
  const aSec = SECTION_RANK[a.location.section] ?? Number.MAX_SAFE_INTEGER;
  const bSec = SECTION_RANK[b.location.section] ?? Number.MAX_SAFE_INTEGER;
  if (aSec !== bSec) return aSec - bSec;
  const aEnt = a.location.entity ?? "";
  const bEnt = b.location.entity ?? "";
  if (aEnt !== bEnt) return aEnt < bEnt ? -1 : 1;
  const aField = a.location.field ?? "";
  const bField = b.location.field ?? "";
  if (aField !== bField) return aField < bField ? -1 : 1;
  return 0;
}

// ── Counts ──────────────────────────────────────────────────────────

/** Compute severity counts from an issue list. O(N) single pass. */
export function countSeverities(issues: readonly Issue[]): IssueSeverityCounts {
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const i of issues) {
    if (i.severity === "error") error++;
    else if (i.severity === "warning") warning++;
    else info++;
  }
  return { error, warning, info };
}

// ── Filing-readiness verdict ────────────────────────────────────────

/**
 * Aggregate filing-readiness from an issue list. Drives the drawer
 * header chip.
 *
 *   any filing_blocking issue → "blocked"
 *   else any warning           → "filing_ready_with_warnings"
 *   else                       → "filing_ready"
 *
 * Info issues never affect readiness — they're purely advisory.
 */
export function filingReadiness(
  issues: readonly Issue[],
): FilingReadiness {
  let hasWarning = false;
  for (const i of issues) {
    if (i.filing_blocking) return "blocked";
    if (i.severity === "warning") hasWarning = true;
  }
  return hasWarning ? "filing_ready_with_warnings" : "filing_ready";
}

// ── filing_blocking decision ────────────────────────────────────────

/**
 * Default `filing_blocking` decision.
 *
 *   - severity = "error" AND source ∈ {compile, reference, runtime}
 *     → true (these block filing by default)
 *   - else → false (authoring + conformance errors block only when
 *     explicitly opted-in by the source surface)
 *
 * Callers building Issue records can use this helper, OR override
 * the default by setting `filing_blocking` directly.
 */
export function defaultFilingBlocking(
  severity: IssueSeverity,
  source: IssueSource,
): boolean {
  if (severity !== "error") return false;
  return source === "compile" || source === "reference" || source === "runtime";
}
