/**
 * Issues module barrel — Brief 13 (Unified error surface).
 *
 * Pure types + pure aggregator. The @openrater/ui unified panel
 * (lands in M2) consumes these verbatim.
 */

export type {
  IssueSeverity,
  IssueSource,
  IssueLocation,
  IssueFixHint,
  Issue,
  IssueSeverityCounts,
  FilingReadiness,
} from "./types";

export { ISSUE_SEVERITIES, ISSUE_SOURCES } from "./types";

export {
  deriveIssueId,
  rankIssues,
  countSeverities,
  filingReadiness,
  defaultFilingBlocking,
} from "./helpers";

export { collectIssues } from "./collect";
export type {
  CollectIssuesInput,
  ConformanceVectorResult,
} from "./collect";
