/**
 * <Chip> — small inline tag for status, category, count, or selection.
 *
 * Two variants × ten tones × optional leading dot × optional remove
 * button. Use sans variant for word labels, mono variant for IDs +
 * codes + numeric badges (where letter widths matter).
 *
 * BEM:
 *   .rater-chip
 *   .rater-chip--mono | --sans
 *   .rater-chip--<tone>
 *   .rater-chip--removable
 *   .rater-chip__dot
 *   .rater-chip__label
 *   .rater-chip__remove
 */

import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import "./Chip.css";

export type ChipTone =
  | "default"
  | "input"
  | "transform"
  | "lookup"
  | "math"
  | "loading"
  | "output"
  | "success"
  | "warning"
  | "danger";

export type ChipVariant = "mono" | "sans";

export interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "onRemove"> {
  variant?: ChipVariant;
  tone?: ChipTone;
  /** Leading colored dot — matches the chip's tone. */
  dot?: boolean;
  /**
   * Adds a trailing remove button. The callback fires when the user
   * clicks the X (or activates it with keyboard).
   * Sets cursor + role appropriately.
   */
  onRemove?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** A11y label for the remove button. Required when `onRemove` is set. */
  removeLabel?: string;
  children: ReactNode;
}

export function Chip({
  variant = "sans",
  tone = "default",
  dot = false,
  onRemove,
  removeLabel = "Remove",
  className,
  children,
  ...rest
}: ChipProps) {
  const classes = [
    "rater-chip",
    `rater-chip--${variant}`,
    `rater-chip--${tone}`,
    onRemove ? "rater-chip--removable" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...rest}>
      {dot ? <span className="rater-chip__dot" aria-hidden /> : null}
      <span className="rater-chip__label">{children}</span>
      {onRemove ? (
        <button
          type="button"
          className="rater-chip__remove"
          onClick={onRemove}
          aria-label={removeLabel}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M2 2 L8 8 M8 2 L2 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </span>
  );
}
