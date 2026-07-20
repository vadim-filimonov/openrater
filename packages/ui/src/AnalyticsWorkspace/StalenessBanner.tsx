/**
 * Brief 64 PR 64.4 — <StalenessBanner> (ADR-0041 Phase 2).
 *
 * A non-blocking amber banner shown when the scored result predates the
 * current plan (the consumer compares `computeScoringFingerprint` of the
 * live plan against the scored result's recorded fingerprint). Renders
 * nothing when fresh, so the consumer can always mount it.
 */

import { type JSX } from "react";
import { AlertTriangle } from "lucide-react";
import { formatRelativeTime } from "./exhibit-math";
import "./StalenessBanner.css";

export interface StalenessBannerProps {
  /** ISO timestamp the scored result was produced at. */
  readonly scoredAt: string;
  /** True when the live plan's fingerprint differs from the scored one. */
  readonly stale: boolean;
  /** Fires when the user clicks "Re-score on Inputs". */
  readonly onReScore?: () => void;
  /** Injectable clock for deterministic tests. */
  readonly now?: Date;
  readonly testId?: string;
}

export function StalenessBanner(
  props: StalenessBannerProps,
): JSX.Element | null {
  const { scoredAt, stale, onReScore, now, testId = "rater-staleness" } = props;
  if (!stale) return null;
  const when = formatRelativeTime(scoredAt, now);
  return (
    <div className="rater-staleness" role="status" data-testid={testId}>
      <AlertTriangle size={14} className="rater-staleness__icon" aria-hidden />
      <span className="rater-staleness__text">
        Scored {when} · the plan changed since — these numbers may be stale.
      </span>
      {onReScore && (
        <button
          type="button"
          className="rater-staleness__action"
          onClick={onReScore}
          data-testid={`${testId}-action`}
        >
          Re-score on Inputs
        </button>
      )}
    </div>
  );
}
