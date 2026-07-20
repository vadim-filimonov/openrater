/**
 * <SectionIssueDot> — per-section count badge for the spine nav.
 *
 * Brief 13 P-UE9 (per-section dots count from all sources, not just
 * authoring). Tiny dot rendered next to a section name in the spine
 * navigation; the dot's color matches the HIGHEST-SEVERITY issue
 * present in the section. Hover/focus shows a tooltip with the
 * per-severity counts.
 *
 *   <SectionIssueDot
 *     sectionId="risk-inputs"
 *     issues={issues}
 *     showCounts={false}
 *   />
 *
 * When `showCounts` is true, a count number is rendered next to the
 * dot (typical for the spine nav). When false, just the dot (typical
 * for inline cite next to a section title).
 *
 * Returns null when there are no issues in this section — the
 * caller doesn't need to wrap in an if-check; the dot self-hides.
 *
 * BEM:
 *   .rater-section-issue-dot
 *   .rater-section-issue-dot--{error|warning|info}
 *   .rater-section-issue-dot__dot
 *   .rater-section-issue-dot__count
 */

import { useMemo } from "react";
import type { Issue, IssueSeverity } from "@openrater/contracts";
import { Tooltip } from "@openrater/design-system";
import "./SectionIssueDot.css";

export interface SectionIssueDotProps {
  /** The section id to filter for (matches Issue.location.section). */
  readonly sectionId: string;
  /** Full issue list. The dot filters by sectionId internally. */
  readonly issues: readonly Issue[];
  /** When true, renders a count number next to the dot. */
  readonly showCounts?: boolean;
  /** Optional aria-label override; default explains the counts. */
  readonly ariaLabel?: string;
}

const SEVERITY_RANK: Readonly<Record<IssueSeverity, number>> = Object.freeze({
  error: 0,
  warning: 1,
  info: 2,
});

interface SectionCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
  readonly total: number;
  /** The highest-severity tone present in this section, drives the
   *  dot color. null when there are no issues. */
  readonly tone: IssueSeverity | null;
}

function computeSectionCounts(
  issues: readonly Issue[],
  sectionId: string,
): SectionCounts {
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const i of issues) {
    if (i.location.section !== sectionId) continue;
    if (i.severity === "error") error++;
    else if (i.severity === "warning") warning++;
    else info++;
  }
  const total = error + warning + info;
  let tone: IssueSeverity | null = null;
  if (total > 0) {
    if (error > 0) tone = "error";
    else if (warning > 0) tone = "warning";
    else tone = "info";
  }
  return { error, warning, info, total, tone };
}

/**
 * Build a one-line tooltip from severity counts. Stable + actuary-
 * readable.
 *
 *   "2 errors · 1 warning"
 *   "1 warning"
 *   "3 info"
 */
function formatCountsTooltip(counts: SectionCounts): string {
  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(`${counts.error} error${counts.error === 1 ? "" : "s"}`);
  }
  if (counts.warning > 0) {
    parts.push(`${counts.warning} warning${counts.warning === 1 ? "" : "s"}`);
  }
  if (counts.info > 0) {
    parts.push(`${counts.info} info`);
  }
  return parts.join(" · ");
}

export function SectionIssueDot({
  sectionId,
  issues,
  showCounts = false,
  ariaLabel,
}: SectionIssueDotProps) {
  const counts = useMemo(
    () => computeSectionCounts(issues, sectionId),
    [issues, sectionId],
  );

  if (counts.tone === null) return null;

  const tooltipText = formatCountsTooltip(counts);
  const effectiveLabel = ariaLabel ?? tooltipText;

  const dot = (
    <span
      className={`rater-section-issue-dot rater-section-issue-dot--${counts.tone}`}
      aria-label={effectiveLabel}
      role="img"
    >
      <span
        className="rater-section-issue-dot__dot"
        data-severity={counts.tone}
        aria-hidden
      />
      {showCounts ? (
        <span className="rater-section-issue-dot__count" aria-hidden>
          {counts.total}
        </span>
      ) : null}
    </span>
  );

  return (
    <Tooltip content={tooltipText} placement="right">
      {dot}
    </Tooltip>
  );
}

// Re-export the pure helpers so callers can build custom UIs around
// the same logic without re-implementing the severity-rank.
export { computeSectionCounts, formatCountsTooltip, SEVERITY_RANK };
