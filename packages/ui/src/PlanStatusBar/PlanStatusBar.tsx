/**
 * <PlanStatusBar> — persistent bottom bar.
 *
 * Brief 13 §3 Surface 1 — the always-visible status indicator at the
 * bottom of the Plan Surface. Shows:
 *
 *   ⊖ 3 errors    ◬ 2 warnings    ⓘ 1 info       Last saved 2 min ago
 *
 * or, when all clear:
 *
 *   ✓ All clear                                  Last saved 2 min ago
 *
 * Each severity chip is clickable; clicking opens the
 * UnifiedErrorPanel pre-filtered to that severity (the caller wires
 * this via `onOpenIssues(initialSeverity?)`).
 *
 * Visual: low-key, hairline border above, single-row at the very
 * bottom of the plan surface. ARIA: role=status, aria-live=polite
 * so count changes are announced without interrupting.
 *
 * BEM:
 *   .rater-plan-status-bar
 *   .rater-plan-status-bar__counts
 *   .rater-plan-status-bar__meta
 *   .rater-plan-status-bar__last-saved
 */

import { useMemo } from "react";
import type { Issue, IssueSeverity } from "@openrater/contracts";
import { countSeverities } from "@openrater/contracts";
import {
  AllClearChip,
  IssueSeverityChip,
} from "../IssueSeverityChip/IssueSeverityChip";
import "./PlanStatusBar.css";

export interface PlanStatusBarProps {
  /** The full issue list. The bar derives counts via countSeverities. */
  readonly issues: readonly Issue[];
  /** Last-saved timestamp (ms since epoch). When provided, renders
   *  a relative "X min ago" string in the meta slot. */
  readonly lastSavedAt?: number;
  /** Fires when the user clicks a severity chip OR the all-clear
   *  affordance. When called with no argument, the panel opens with
   *  no pre-filter. */
  readonly onOpenIssues?: (initialSeverity?: IssueSeverity) => void;
  /** Optional right-edge content (e.g., a custom plan-status indicator).
   *  Renders to the right of the lastSavedAt slot. */
  readonly metaSlot?: React.ReactNode;
}

export function PlanStatusBar({
  issues,
  lastSavedAt,
  onOpenIssues,
  metaSlot,
}: PlanStatusBarProps) {
  const counts = useMemo(() => countSeverities(issues), [issues]);
  const total = counts.error + counts.warning + counts.info;
  const lastSavedText = useMemo(
    () => (lastSavedAt !== undefined ? formatRelativeTime(lastSavedAt) : null),
    [lastSavedAt],
  );

  return (
    <div
      className="rater-plan-status-bar"
      role="status"
      aria-live="polite"
      aria-label="Plan status"
    >
      <div className="rater-plan-status-bar__counts">
        {total === 0 ? (
          // Wrap the all-clear chip in a button so the actuary can
          // still open the (empty) panel via keyboard if they need to.
          onOpenIssues ? (
            <button
              type="button"
              className="rater-plan-status-bar__all-clear-btn"
              onClick={() => onOpenIssues()}
              aria-label="Open issues panel"
            >
              <AllClearChip />
            </button>
          ) : (
            <AllClearChip />
          )
        ) : (
          <>
            <IssueSeverityChip
              severity="error"
              count={counts.error}
              hideWhenZero
              {...(onOpenIssues
                ? { onClick: () => onOpenIssues("error") }
                : {})}
            />
            <IssueSeverityChip
              severity="warning"
              count={counts.warning}
              hideWhenZero
              {...(onOpenIssues
                ? { onClick: () => onOpenIssues("warning") }
                : {})}
            />
            <IssueSeverityChip
              severity="info"
              count={counts.info}
              hideWhenZero
              {...(onOpenIssues
                ? { onClick: () => onOpenIssues("info") }
                : {})}
            />
          </>
        )}
      </div>
      <div className="rater-plan-status-bar__meta">
        {lastSavedText ? (
          <span className="rater-plan-status-bar__last-saved">
            Last saved {lastSavedText}
          </span>
        ) : null}
        {metaSlot}
      </div>
    </div>
  );
}

/**
 * Pure relative-time formatter. Used by the lastSavedAt slot.
 *
 *   <30s    → "just now"
 *   <60min  → "X min ago"
 *   <24h    → "Xh ago"
 *   else    → ISO date "YYYY-MM-DD"
 *
 * Exported so tests + the Plan Control Tower can reuse the same
 * relative-time conventions.
 */
export function formatRelativeTime(
  timestampMs: number,
  now: number = Date.now(),
): string {
  const deltaMs = now - timestampMs;
  if (deltaMs < 30_000) return "just now";
  const deltaMin = Math.floor(deltaMs / 60_000);
  if (deltaMin < 60) return `${deltaMin} min ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  // Stable ISO date for longer intervals.
  const d = new Date(timestampMs);
  return d.toISOString().slice(0, 10);
}
