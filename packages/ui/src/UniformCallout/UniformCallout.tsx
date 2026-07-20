/**
 * <UniformCallout> — Brief 45 PR 45.5.
 *
 * The "nothing tuned yet" presentation surface. Replaces the
 * chart entirely when `stddev / |mean| < UNIFORM_THRESHOLD`
 * (Brief 45 §−1 Q3 lock). Honest empty-state UX: when every
 * populated cell holds the same factor, drawing a flat bar
 * carpet reads as a bug.
 *
 * Apple-grade composition:
 *   • A soft pulse-dot icon (concentric circles)
 *   • Heading with the constant value highlighted
 *   • One-line nudge body copy
 *   • Primary CTA "Edit first cell" — fires `onEditFirst` so
 *     the parent can focus + scroll the grid
 *
 * Pure presentation. The hero strip (PR 45.1) stays above this
 * callout in the FactorTableViz layout — it tells the actuary
 * "100% coverage but no dispersion."
 */

import { type JSX } from "react";
import { formatFactorValue } from "../FactorTableViz/factorStats";
import "./UniformCallout.css";

export interface UniformCalloutProps {
  /**
   * The constant value every populated cell holds. Renders in
   * the heading. When `null`, displays an em-dash (defensive —
   * the auto-mode router shouldn't pick callout for a 0-cell
   * table).
   */
  readonly value: number | null;
  /**
   * Optional baseline value for contextual phrasing. When the
   * constant equals the baseline, the body line says "no factor
   * has been tuned yet"; when it differs, the body line says
   * "all factors are flat at X — start tuning to differentiate."
   * Defaults to 1.0.
   */
  readonly baseline?: number;
  /**
   * Fires when the user clicks the primary CTA. Parent typically
   * focuses + scrolls the grid to the first editable cell.
   */
  readonly onEditFirst?: () => void;
  /**
   * Optional copy override — replaces the auto-generated body
   * text. Useful when the consumer has more context (e.g.
   * "All 487 class codes default to 1.00 — start with the top
   * exposure classes").
   */
  readonly bodyOverride?: string;
  readonly testId?: string;
}

export function UniformCallout(props: UniformCalloutProps): JSX.Element {
  const {
    value,
    baseline = 1.0,
    onEditFirst,
    bodyOverride,
    testId = "rater-uniform-callout",
  } = props;

  const valueText = formatFactorValue(value);
  const atIdentity =
    value !== null && Math.abs(value - baseline) < baseline * 0.005;

  const heading = atIdentity
    ? "Nothing has been tuned yet"
    : `All factors equal ${valueText}`;

  const body =
    bodyOverride ??
    (atIdentity
      ? `Every cell sits at the identity (${valueText}). Edit a cell in the grid to see the chart come to life.`
      : `Every populated cell holds the same value. Tune one to start differentiating the levels.`);

  return (
    <div
      className="rater-uniform-callout"
      data-testid={testId}
      role="region"
      aria-label="Uniform table — nothing tuned yet"
    >
      <div
        className="rater-uniform-callout__icon"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="4" />
          <circle
            cx="12"
            cy="12"
            r="9"
            strokeDasharray="3 3"
            opacity="0.5"
          />
        </svg>
      </div>

      <h2
        className="rater-uniform-callout__title"
        data-testid={`${testId}-title`}
      >
        {atIdentity ? (
          heading
        ) : (
          <>
            All factors equal{" "}
            <strong
              className="rater-uniform-callout__title-value"
              data-testid={`${testId}-value`}
            >
              {valueText}
            </strong>
          </>
        )}
      </h2>

      <p
        className="rater-uniform-callout__body"
        data-testid={`${testId}-body`}
      >
        {body}
      </p>

      {onEditFirst && (
        <button
          type="button"
          className="rater-uniform-callout__cta"
          onClick={onEditFirst}
          data-testid={`${testId}-cta`}
        >
          Edit first cell
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
