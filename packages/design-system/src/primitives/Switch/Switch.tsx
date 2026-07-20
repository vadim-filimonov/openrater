/**
 * <Switch> — the boolean toggle (Shell v3 polish; Wave 1).
 *
 * Before this primitive existed, booleans fell back to raw
 * `<input type="checkbox">` — OS-default chrome on the zinc-950 canvas,
 * the single most visible "not next-gen" tell the design audit found.
 *
 * Semantics: a `<button role="switch">` (WAI-ARIA switch pattern) —
 * native button gives focus + Space/Enter activation for free;
 * aria-checked carries the state. NOT a form control; for
 * submit-with-a-form selection semantics use `<Checkbox>` instead.
 *
 * When to use which:
 *   - Switch   — an on/off MODE with immediate effect (enable webhook,
 *                include archived, live preview).
 *   - Checkbox — inclusion/selection inside a form or list (select rows,
 *                "replace existing levels" before an Apply button).
 *
 * Motion: the thumb travels via transform over --rater-d-140
 * --rater-ease-snap (collapses under prefers-reduced-motion via the
 * token); the track cross-fades its fill.
 *
 * BEM:
 *   .rater-switch
 *   .rater-switch--sm | --md
 *   .rater-switch__track  (the button itself)
 *   .rater-switch__thumb
 *   .rater-switch__label  (optional visible label; clicking it toggles)
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./Switch.css";

export type SwitchSize = "sm" | "md";

export interface SwitchProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "onChange" | "children" | "role" | "type"
  > {
  /** Current state. Controlled-only — the primitive holds no state. */
  readonly checked: boolean;
  /** Fires with the next state on click / Space / Enter. */
  readonly onChange: (next: boolean) => void;
  /**
   * - `md`: 36×20 track, 16px thumb (default — settings rows)
   * - `sm`: 28×16 track, 12px thumb (dense headers, table rows)
   */
  readonly size?: SwitchSize;
  /**
   * Optional visible label rendered after the track; clicking it
   * toggles. When omitted, pass `aria-label` so the switch has an
   * accessible name.
   */
  readonly label?: ReactNode;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    { checked, onChange, size = "md", label, disabled, className, ...rest },
    ref,
  ) {
    const track = (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className="rater-switch__track"
        onClick={() => onChange(!checked)}
        {...rest}
      >
        <span className="rater-switch__thumb" aria-hidden />
      </button>
    );

    const classes = [
      "rater-switch",
      `rater-switch--${size}`,
      checked ? "is-checked" : null,
      disabled ? "is-disabled" : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    if (label === undefined) {
      return <span className={classes}>{track}</span>;
    }
    return (
      <label className={classes}>
        {track}
        <span className="rater-switch__label">{label}</span>
      </label>
    );
  },
);
