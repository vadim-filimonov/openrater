/**
 * <Button> — the bread-and-butter affordance.
 *
 * Three variants × three sizes × loading + disabled states. Optional
 * leading or trailing icon (lucide ReactNode). Forwards to a native
 * <button> so all standard handlers + form semantics work.
 *
 * Per VISION Part 0 §2: hand-rolled primitive (no Radix). The
 * accessibility surface is small (native <button> handles role,
 * focus, keyboard) — Radix overhead would be net negative.
 *
 * BEM class names:
 *   .rater-button                         (root)
 *   .rater-button--primary | --ghost | --danger | --danger-text
 *   .rater-button--xs | --sm | --md
 *   .rater-button--full-width
 *   .rater-button--loading
 *   .rater-button__icon                   (leading icon slot)
 *   .rater-button__icon--trailing         (trailing icon slot)
 *   .rater-button__label                  (text content)
 *   .rater-button__spinner                (loading state)
 *
 * Tokens consumed:
 *   - --rater-color-* (variant-specific bg/border/text via fill)
 *   - --rater-r-6 (border radius)
 *   - --rater-fw-medium (label weight)
 *   - --rater-t-12 / -13 (size-keyed font size)
 *   - --rater-s-6 / -10 / -12 / -14 (padding + icon-label gap)
 *   - --rater-d-80, --rater-ease-soft (state transitions)
 *   - --rater-focus-ring (focus-visible outline)
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./Button.css";

export type ButtonVariant =
  | "primary"
  | "ghost"
  | "plain"
  | "danger"
  | "danger-text";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual + semantic variant.
   * - `primary`: accent-color fill, used for the primary action on a surface.
   *   At most ONE primary button per surface, per the W4 §4.0 progressive-
   *   disclosure rule.
   * - `ghost`: transparent until hover, used for secondary actions.
   * - `plain`: no border, no fill — a quiet text action (muted → default on
   *   hover with a soft wash). For tertiary affordances that must not read
   *   as buttons at rest: back-crumbs, "+ Add another row" table footers,
   *   inline reveal/collapse toggles. (Shell v3 polish — before this
   *   variant existed, those affordances escaped the design system as raw
   *   <button>s on the v2-buttons allowlist.)
   * - `danger`: red fill, used for destructive actions (Delete plan, Discard
   *   draft, Revoke sign-off). Requires confirmation flow at the call site.
   * - `danger-text`: red text only, used in dense lists where the button is
   *   one of many rows and a red fill would dominate.
   *
   * Default: `ghost` (safest default — never accidentally screams).
   */
  variant?: ButtonVariant;
  /**
   * Height + padding + font-size.
   * - `xs`: 24px tall, --rater-t-12 (used in chip-dense rows, table actions)
   * - `sm`: 28px tall, --rater-t-12 (used in inspector panels)
   * - `md`: 32px tall, --rater-t-13 (default — page actions)
   */
  size?: ButtonSize;
  /**
   * Renders before the label.
   * Use lucide-react icons sized at --rater-icon-14 (sm) or --rater-icon-16
   * (md). The component wraps it in a flexbox slot; no manual sizing needed.
   */
  icon?: ReactNode;
  /**
   * Renders after the label.
   * Same sizing convention as `icon`.
   */
  iconAfter?: ReactNode;
  /**
   * Stretches to fill the parent's inline-axis. Useful for sticky
   * footers, drawer-bottom actions, and modal CTAs.
   */
  fullWidth?: boolean;
  /**
   * Replaces the label with a spinner; sets aria-busy=true and
   * blocks pointer events. Standard pattern for async actions.
   *
   * The button stays the same width to prevent layout shift — set
   * a min-width if your label is short.
   */
  loading?: boolean;
  /**
   * Visible label. Required even with an icon; if you want icon-only,
   * use `<IconButton>` instead (which requires aria-label).
   */
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "ghost",
    size = "md",
    icon,
    iconAfter,
    fullWidth = false,
    loading = false,
    disabled,
    type = "button",
    className,
    children,
    ...rest
  },
  ref,
) {
  const classes = [
    "rater-button",
    `rater-button--${variant}`,
    `rater-button--${size}`,
    fullWidth ? "rater-button--full-width" : null,
    loading ? "rater-button--loading" : null,
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
        <span className="rater-button__spinner" aria-hidden />
      ) : icon ? (
        <span className="rater-button__icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="rater-button__label">{children}</span>
      {!loading && iconAfter ? (
        <span className="rater-button__icon rater-button__icon--trailing" aria-hidden>
          {iconAfter}
        </span>
      ) : null}
    </button>
  );
});
