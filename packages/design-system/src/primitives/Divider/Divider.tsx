/**
 * <Divider> — visual separator. Horizontal or vertical.
 *
 * Renders an <hr> for horizontal, a <span role="separator" aria-orientation="vertical">
 * for vertical (since <hr> can't be styled vertical reliably across UAs).
 *
 * BEM:
 *   .rater-divider
 *   .rater-divider--horizontal | --vertical
 *   .rater-divider--inset            (indents both ends; useful inside lists)
 */

import "./Divider.css";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  /** Indents both ends by --rater-s-12. Useful for separators inside list rows. */
  inset?: boolean;
  className?: string;
}

export function Divider({
  orientation = "horizontal",
  inset = false,
  className,
}: DividerProps) {
  const classes = [
    "rater-divider",
    `rater-divider--${orientation}`,
    inset ? "rater-divider--inset" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (orientation === "horizontal") {
    return <hr className={classes} />;
  }

  return <span className={classes} role="separator" aria-orientation="vertical" />;
}
