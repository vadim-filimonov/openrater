/**
 * <IssueSeverityChip> — severity icon + count chip.
 *
 * Brief 13's count-by-severity glyph. Two use cases:
 *   1. PlanStatusBar — read-only counts at the bottom of the plan
 *      surface ("⊖ 3 errors    ◬ 2 warnings    ⓘ 1 info")
 *   2. ErrorFilter — clickable filter chip that toggles severity
 *      filtering in the drawer
 *
 *   <IssueSeverityChip severity="error" count={3} />
 *   <IssueSeverityChip severity="error" count={3} active onClick={...} />
 *   <IssueSeverityChip severity="info" count={0} hideWhenZero />
 *
 * BEM class names:
 *   .rater-issue-severity-chip
 *   .rater-issue-severity-chip--{error|warning|info|ok}
 *   .rater-issue-severity-chip--clickable
 *   .rater-issue-severity-chip--active
 *   .rater-issue-severity-chip__icon
 *   .rater-issue-severity-chip__count
 *   .rater-issue-severity-chip__label
 */

import type { IssueSeverity } from "@openrater/contracts";
import {
  AlertTriangle,
  CheckCircle,
  Info,
  XCircle,
} from "lucide-react";
import "./IssueSeverityChip.css";

export interface IssueSeverityChipProps {
  /** Severity rendered. */
  readonly severity: IssueSeverity;
  /** Count to display next to the icon. */
  readonly count: number;
  /** When true and count === 0, the chip renders nothing. Useful for
   *  the status bar (don't show "0 errors"). For filter chips, leave
   *  unset so 0-count chips still render (the actuary can still click
   *  to filter to "no errors"). */
  readonly hideWhenZero?: boolean;
  /** When true, renders as a button (vs read-only span). Pair with
   *  onClick. */
  readonly onClick?: () => void;
  /** Visual "filter active" state when used as a filter chip. */
  readonly active?: boolean;
  /** Optional explicit label override. Defaults to the plural of
   *  severity ("errors", "warnings", "info"). */
  readonly label?: string;
}

const SEVERITY_LABELS: Readonly<Record<IssueSeverity, string>> = Object.freeze({
  error: "errors",
  warning: "warnings",
  info: "info",
});

function SeverityIcon({ severity }: { severity: IssueSeverity }) {
  switch (severity) {
    case "error":
      return <XCircle size={14} aria-hidden />;
    case "warning":
      return <AlertTriangle size={14} aria-hidden />;
    case "info":
      return <Info size={14} aria-hidden />;
  }
}

export function IssueSeverityChip({
  severity,
  count,
  hideWhenZero = false,
  onClick,
  active = false,
  label,
}: IssueSeverityChipProps) {
  if (hideWhenZero && count === 0) return null;

  const effectiveLabel = label ?? SEVERITY_LABELS[severity];
  const clickable = onClick !== undefined;
  const classes = [
    "rater-issue-severity-chip",
    `rater-issue-severity-chip--${severity}`,
    clickable ? "rater-issue-severity-chip--clickable" : null,
    active ? "rater-issue-severity-chip--active" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className="rater-issue-severity-chip__icon">
        <SeverityIcon severity={severity} />
      </span>
      <span className="rater-issue-severity-chip__count">{count}</span>
      <span className="rater-issue-severity-chip__label">{effectiveLabel}</span>
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        aria-pressed={active}
        aria-label={`Filter to ${count} ${effectiveLabel}`}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={classes} aria-label={`${count} ${effectiveLabel}`}>
      {content}
    </span>
  );
}

/**
 * "All clear" companion chip — replaces the severity counts when the
 * issue list is empty. Renders a green check + "All clear" label.
 */
export function AllClearChip() {
  return (
    <span
      className="rater-issue-severity-chip rater-issue-severity-chip--ok"
      aria-label="No issues"
    >
      <span className="rater-issue-severity-chip__icon">
        <CheckCircle size={14} aria-hidden />
      </span>
      <span className="rater-issue-severity-chip__label">All clear</span>
    </span>
  );
}
