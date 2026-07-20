/**
 * <ProgressBar> — slim accent-colored bar with optional segment dots.
 *
 * Used in the Plan Control Tower's completeness widget: "2 of 14
 * sections complete" maps to a filled bar (2/14 of width) optionally
 * with 14 segment ticks so the actuary can see "how many more."
 *
 * Behavior:
 *   - `value` / `max` — required. value clamped to [0, max].
 *   - `segments` — optional. When provided, renders N evenly-spaced
 *     tick marks along the track. Useful when the count is meaningful
 *     (14 sections) vs continuous (percentage).
 *   - `tone` — "accent" (default, brand blue) | "warning" (orange) |
 *     "success" (green). Surfaces semantics: warning = required
 *     sections still missing; success = plan compiles.
 *   - `label` — optional sr-only label for screen readers.
 *
 * The rendered element is a native <progress> for accessibility, with
 * a styled overlay because <progress> styling is browser-quirky.
 *
 * BEM:
 *   .rater-progress
 *   .rater-progress--accent | --warning | --success
 *   .rater-progress__track
 *   .rater-progress__fill
 *   .rater-progress__ticks
 *   .rater-progress__tick
 *
 * Tokens:
 *   - --rater-color-blue-500 (accent fill)
 *   - --rater-color-orange-500 (warning fill)
 *   - --rater-color-green-500 (success fill)
 *   - --rater-surface-2 (track bg)
 *   - --rater-border-default (track border)
 *   - --rater-r-full (pill end caps)
 *   - --rater-d-380 (fill transition on value change)
 *   - --rater-ease-soft
 */

import type { HTMLAttributes } from "react";
import "./ProgressBar.css";

export type ProgressBarTone = "accent" | "warning" | "success";

export interface ProgressBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  /** Filled count. Clamped to [0, max]. */
  value: number;
  /** Total count. */
  max: number;
  /**
   * Optional. When provided, renders this many evenly-spaced ticks
   * along the track. Usually equals `max` for discrete counts.
   */
  segments?: number;
  /** Visual tone. Default: "accent". */
  tone?: ProgressBarTone;
  /**
   * Screen-reader label describing what the bar represents. Required
   * for accessibility if no surrounding text explains the meaning.
   */
  label?: string;
}

export function ProgressBar({
  value,
  max,
  segments,
  tone = "accent",
  label,
  className,
  ...rest
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(value, max));
  const pct = max === 0 ? 0 : (clamped / max) * 100;

  const classes = [
    "rater-progress",
    `rater-progress--${tone}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      {...rest}
    >
      <div className="rater-progress__track">
        <div
          className="rater-progress__fill"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
        {segments && segments > 1 ? (
          <div className="rater-progress__ticks" aria-hidden>
            {Array.from({ length: segments - 1 }).map((_, i) => (
              <span
                key={i}
                className="rater-progress__tick"
                style={{ left: `${((i + 1) / segments) * 100}%` }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
