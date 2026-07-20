/**
 * <UnifiedErrorPanel> — drawer-rendered ranked issue list.
 *
 * Brief 13 §3 Surface 2 — the on-demand drawer. Composes
 * ErrorFilter + ErrorRow into a single self-contained drawer with
 * filing-readiness header chip.
 *
 *   <UnifiedErrorPanel
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     issues={issues}
 *     onDeepLink={(loc) => navigate(loc)}
 *     onFixHint={(target) => navigate(target)}
 *   />
 *
 * Behavior:
 *   - Non-modal drawer (the actuary can keep editing while it's open)
 *   - Filing-readiness chip at the top (Brief 13 P-UE7 + §6 ruleset)
 *   - Filter chips below — collapse / expand axes via clicks
 *   - Ranked issue list grouped by severity (errors / warnings / info)
 *     using the deterministic rankIssues comparator from @openrater/contracts
 *   - "No issues match the current filter" empty state when filters
 *     don't match
 *   - "All clear ✓" empty state when issues is empty
 *
 * The Drawer primitive handles the chrome (header, close, ESC, focus
 * trap, body scroll lock, portal). This component fills the body +
 * footer with issue-surface content.
 */

import { useMemo, useState } from "react";
import type {
  FilingReadiness,
  Issue,
  IssueLocation,
  IssueSeverity,
} from "@openrater/contracts";
import {
  countSeverities,
  filingReadiness as computeReadiness,
  rankIssues,
} from "@openrater/contracts";
import { Drawer } from "@openrater/design-system";
import {
  AllClearChip,
  IssueSeverityChip,
} from "../IssueSeverityChip/IssueSeverityChip";
import { ErrorRow } from "../ErrorRow/ErrorRow";
import {
  EMPTY_FILTER_STATE,
  ErrorFilter,
  applyErrorFilter,
  type ErrorFilterState,
} from "../ErrorFilter/ErrorFilter";
import "./UnifiedErrorPanel.css";

export interface UnifiedErrorPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly issues: readonly Issue[];
  /** Fires when the user clicks an issue's deep-link icon. */
  readonly onDeepLink?: (location: IssueLocation) => void;
  /** Fires when the user clicks an issue's fix-hint CTA. */
  readonly onFixHint?: (target: IssueLocation) => void;
  /** Initial filter selection — typically EMPTY_FILTER_STATE. When
   *  the user opens the panel from a specific severity chip in the
   *  status bar, the caller pre-arms this with that severity. */
  readonly initialFilter?: ErrorFilterState;
}

const READINESS_LABELS: Readonly<Record<FilingReadiness, string>> = Object.freeze({
  filing_ready: "Filing-ready",
  filing_ready_with_warnings: "Filing-ready with warnings",
  blocked: "Blocked",
});

const SEVERITY_HEADERS: Readonly<Record<IssueSeverity, string>> = Object.freeze({
  error: "Errors",
  warning: "Warnings",
  info: "Info",
});

export function UnifiedErrorPanel({
  open,
  onClose,
  issues,
  onDeepLink,
  onFixHint,
  initialFilter,
}: UnifiedErrorPanelProps) {
  const [filters, setFilters] = useState<ErrorFilterState>(
    initialFilter ?? EMPTY_FILTER_STATE,
  );

  const ranked = useMemo(() => [...issues].sort(rankIssues), [issues]);
  const filtered = useMemo(
    () => applyErrorFilter(ranked, filters),
    [ranked, filters],
  );
  const counts = useMemo(() => countSeverities(issues), [issues]);
  const readiness = useMemo(() => computeReadiness(issues), [issues]);

  // Group filtered issues by severity for the rendered sections.
  const grouped = useMemo(() => {
    const m: Record<IssueSeverity, Issue[]> = {
      error: [],
      warning: [],
      info: [],
    };
    for (const i of filtered) m[i.severity].push(i);
    return m;
  }, [filtered]);

  const totalCount = counts.error + counts.warning + counts.info;
  const headerTitle = totalCount === 0 ? "Issues" : `Issues (${totalCount})`;

  const subtitle =
    totalCount === 0
      ? null
      : `${filtered.length} shown · ${READINESS_LABELS[readiness]}`;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={headerTitle}
      {...(subtitle !== null ? { subtitle } : {})}
      size="lg"
    >
      <Drawer.Body>
        {totalCount === 0 ? (
          <div className="rater-unified-error-panel__empty">
            <AllClearChip />
            <p className="rater-unified-error-panel__empty-text">
              No issues. The plan compiles cleanly + all references
              resolve.
            </p>
          </div>
        ) : (
          <>
            <ReadinessHeader readiness={readiness} counts={counts} />
            <ErrorFilter
              issues={ranked}
              filters={filters}
              onFiltersChange={setFilters}
            />
            {filtered.length === 0 ? (
              <div className="rater-unified-error-panel__empty-filter">
                No issues match the current filter.
                <button
                  type="button"
                  className="rater-unified-error-panel__clear-filter"
                  onClick={() => setFilters(EMPTY_FILTER_STATE)}
                >
                  Clear filter
                </button>
              </div>
            ) : (
              <div className="rater-unified-error-panel__groups">
                {(["error", "warning", "info"] as const).map((sev) =>
                  grouped[sev].length > 0 ? (
                    <section
                      key={sev}
                      className={`rater-unified-error-panel__group rater-unified-error-panel__group--${sev}`}
                      aria-label={`${SEVERITY_HEADERS[sev]} (${grouped[sev].length})`}
                    >
                      <header className="rater-unified-error-panel__group-header">
                        <h3 className="rater-unified-error-panel__group-title">
                          {SEVERITY_HEADERS[sev]}
                        </h3>
                        <span className="rater-unified-error-panel__group-count">
                          {grouped[sev].length}
                        </span>
                      </header>
                      <div className="rater-unified-error-panel__group-list">
                        {grouped[sev].map((issue) => (
                          <ErrorRow
                            key={issue.id}
                            issue={issue}
                            {...(onDeepLink ? { onDeepLink } : {})}
                            {...(onFixHint ? { onFixHint } : {})}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null,
                )}
              </div>
            )}
          </>
        )}
      </Drawer.Body>
    </Drawer>
  );
}

function ReadinessHeader({
  readiness,
  counts,
}: {
  readonly readiness: FilingReadiness;
  readonly counts: { readonly error: number; readonly warning: number; readonly info: number };
}) {
  return (
    <header
      className={`rater-unified-error-panel__readiness rater-unified-error-panel__readiness--${readiness}`}
    >
      <span className="rater-unified-error-panel__readiness-label">
        {READINESS_LABELS[readiness]}
      </span>
      <span className="rater-unified-error-panel__readiness-counts">
        <IssueSeverityChip severity="error" count={counts.error} hideWhenZero />
        <IssueSeverityChip
          severity="warning"
          count={counts.warning}
          hideWhenZero
        />
        <IssueSeverityChip severity="info" count={counts.info} hideWhenZero />
      </span>
    </header>
  );
}
