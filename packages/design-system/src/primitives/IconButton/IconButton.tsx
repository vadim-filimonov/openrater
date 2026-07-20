/**
 * <IconButton> — icon-only button. Required aria-label (TS-enforced).
 *
 * Same variant + size matrix as <Button>. Square aspect.
 *
 * BEM class names:
 *   .rater-icon-button                         (root)
 *   .rater-icon-button--primary | --ghost | --danger
 *   .rater-icon-button--xs | --sm | --md
 *
 * Tokens consumed: same as <Button>.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./IconButton.css";
import type { ButtonVariant, ButtonSize } from "../Button/Button";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** Same variant set as <Button>. Default: `ghost`. */
  variant?: ButtonVariant;
  /** Same sizes as <Button>. Default: `md`. */
  size?: ButtonSize;
  /**
   * Required — icon-only buttons MUST have an accessible name.
   * Per W4 §4.4 + WCAG 4.1.2: a button with no visible text needs
   * `aria-label` so screen-reader users can identify it.
   */
  "aria-label": string;
  /** The icon to render. Sized automatically per `size`. */
  icon: ReactNode;
  /** Same loading semantics as <Button>. */
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      variant = "ghost",
      size = "md",
      icon,
      loading = false,
      disabled,
      type = "button",
      className,
      ...rest
    },
    ref,
  ) {
    const classes = [
      "rater-icon-button",
      `rater-icon-button--${variant}`,
      `rater-icon-button--${size}`,
      loading ? "rater-icon-button--loading" : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        type={type}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? (
          <span className="rater-icon-button__spinner" aria-hidden />
        ) : (
          <span className="rater-icon-button__icon" aria-hidden>
            {icon}
          </span>
        )}
      </button>
    );
  },
);
