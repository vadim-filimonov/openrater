/**
 * <Checkbox> — custom-drawn selection control (Shell v3 polish; Wave 1).
 *
 * Replaces raw `<input type="checkbox">` (OS-default chrome on the
 * zinc-950 canvas). A REAL native checkbox stays underneath —
 * visually hidden but full-size over the drawn box — so form
 * semantics, label association, focus, and assistive tech all work
 * natively; only the pixels are ours.
 *
 * When to use which:
 *   - Checkbox — inclusion/selection (select rows, "replace existing"
 *                options that take effect on a later Apply/submit).
 *   - Switch   — an on/off mode with immediate effect.
 *
 * BEM:
 *   .rater-checkbox
 *   .rater-checkbox__input   (the hidden native input)
 *   .rater-checkbox__box     (the drawn 16px box)
 *   .rater-checkbox__label   (optional visible label)
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Check } from "lucide-react";
import "./Checkbox.css";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  /** Current state. Controlled-only. */
  readonly checked: boolean;
  /** Fires with the next state. */
  readonly onChange: (next: boolean) => void;
  /**
   * Optional visible label rendered after the box; clicking it toggles
   * (native label association). When omitted, pass `aria-label`.
   */
  readonly label?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ checked, onChange, label, disabled, className, ...rest }, ref) {
    const classes = [
      "rater-checkbox",
      checked ? "is-checked" : null,
      disabled ? "is-disabled" : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <label className={classes}>
        <input
          ref={ref}
          type="checkbox"
          className="rater-checkbox__input"
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            if (disabled) return;
            onChange(e.target.checked);
          }}
          {...rest}
        />
        <span className="rater-checkbox__box" aria-hidden>
          {checked ? <Check strokeWidth={3} /> : null}
        </span>
        {label !== undefined ? (
          <span className="rater-checkbox__label">{label}</span>
        ) : null}
      </label>
    );
  },
);
