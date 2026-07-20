/**
 * <ErrorRow> — single issue row in the unified error drawer.
 *
 * Brief 13's diagnostic primitive. Layout:
 *
 *   ⊖ compile · Rating Chains
 *   Chain factor 'class_factor' expects a class exposure, but
 *   class c103 has no declared exposure. Declare in Classification
 *   → Class c103.
 *   [ Go to Classification → Class c103 ]  [→]
 *
 * Receives an `Issue` from @openrater/contracts directly. Renders:
 *   - Severity icon + source chip + location breadcrumb (top line)
 *   - Actuary-language message (body)
 *   - Citation (when present, muted italic)
 *   - Fix-hint CTA button (when present)
 *   - Deep-link icon button on the right
 *
 * Brief 13 P-UE5 (deep-link from row to source) + P-UE6 (optional
 * fix hint).
 *
 * BEM:
 *   .rater-error-row
 *   .rater-error-row--{error|warning|info}
 *   .rater-error-row__severity
 *   .rater-error-row__source
 *   .rater-error-row__location
 *   .rater-error-row__message
 *   .rater-error-row__citation
 *   .rater-error-row__actions
 *   .rater-error-row__fix-hint
 *   .rater-error-row__deep-link
 */

import type { Issue, IssueLocation, IssueSource } from "@openrater/contracts";
import { PLAN_SECTIONS_BY_ID } from "@openrater/contracts";
import { Button, IconButton } from "@openrater/design-system";
import { ArrowRight, ChevronRight } from "lucide-react";
import { IssueSeverityChip } from "../IssueSeverityChip/IssueSeverityChip";
import "./ErrorRow.css";

const SOURCE_LABELS: Readonly<Record<IssueSource, string>> = Object.freeze({
  compile: "compile",
  runtime: "runtime",
  authoring: "authoring",
  reference: "reference",
  conformance: "conformance",
});

export interface ErrorRowProps {
  readonly issue: Issue;
  /** Fires when the user clicks the deep-link icon button on the
   *  right. Receives the issue's location for routing. */
  readonly onDeepLink?: (location: IssueLocation) => void;
  /** Fires when the user clicks the fix-hint CTA (when present).
   *  Receives the fix-hint's target location. Common pattern: the
   *  caller routes the same way as onDeepLink but may also pre-arm
   *  the destination editor (open a specific field). */
  readonly onFixHint?: (target: IssueLocation) => void;
}

function formatLocation(location: IssueLocation): string {
  const section = PLAN_SECTIONS_BY_ID[location.section];
  const sectionName = section?.name ?? location.section;
  if (location.entity) {
    return location.field
      ? `${sectionName} · ${location.entity} · ${location.field}`
      : `${sectionName} · ${location.entity}`;
  }
  return sectionName;
}

export function ErrorRow({ issue, onDeepLink, onFixHint }: ErrorRowProps) {
  return (
    <div
      className={`rater-error-row rater-error-row--${issue.severity}`}
      data-issue-id={issue.id}
    >
      <div className="rater-error-row__header">
        <span className="rater-error-row__severity">
          <IssueSeverityChip severity={issue.severity} count={1} label="" />
        </span>
        <span className="rater-error-row__source">{SOURCE_LABELS[issue.source]}</span>
        <ChevronRight
          size={12}
          className="rater-error-row__breadcrumb-sep"
          aria-hidden
        />
        <span className="rater-error-row__location">
          {formatLocation(issue.location)}
        </span>
      </div>
      <p className="rater-error-row__message">{issue.message}</p>
      {issue.citation ? (
        <p className="rater-error-row__citation">{issue.citation}</p>
      ) : null}
      <div className="rater-error-row__actions">
        {issue.fix_hint && onFixHint ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconAfter={<ArrowRight size={14} />}
            onClick={() => onFixHint(issue.fix_hint!.target)}
            className="rater-error-row__fix-hint"
          >
            {issue.fix_hint.label}
          </Button>
        ) : null}
        {onDeepLink ? (
          <IconButton
            icon={<ArrowRight size={14} />}
            aria-label={`Go to source of "${issue.message}"`}
            variant="ghost"
            size="sm"
            onClick={() => onDeepLink(issue.location)}
            className="rater-error-row__deep-link"
          />
        ) : null}
      </div>
    </div>
  );
}
