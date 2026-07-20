/**
 * <Input> — text input primitive.
 *
 * Wraps a native <input>, accepts all standard HTMLInputElement props
 * (type defaults to "text"). Adds:
 *   - sizes (sm / md)
 *   - error state (red border + accessible aria-invalid)
 *   - optional leading + trailing slot (icon, button, suffix label)
 *
 * Pair with <Label> for form-field semantics. For Select-style inputs
 * use the upcoming <Select> primitive (Radix-backed).
 *
 * BEM:
 *   .rater-input              (root wrapper — holds slots + the input)
 *   .rater-input--sm | --md
 *   .rater-input--error
 *   .rater-input__field       (the actual <input>)
 *   .rater-input__leading
 *   .rater-input__trailing
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import "./Input.css";

export type InputSize = "sm" | "md";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  inputSize?: InputSize;
  /** Marks the input invalid; sets aria-invalid="true". */
  hasError?: boolean;
  /** Optional content rendered before the input (icon, prefix). */
  leading?: ReactNode;
  /** Optional content rendered after the input (icon, suffix, badge). */
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    inputSize = "md",
    hasError = false,
    leading,
    trailing,
    type = "text",
    className,
    ...rest
  },
  ref,
) {
  const wrapperClasses = [
    "rater-input",
    `rater-input--${inputSize}`,
    hasError ? "rater-input--error" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClasses}>
      {leading ? (
        <span className="rater-input__leading" aria-hidden>
          {leading}
        </span>
      ) : null}
      <input
        ref={ref}
        type={type}
        className="rater-input__field"
        aria-invalid={hasError || undefined}
        {...rest}
      />
      {trailing ? (
        <span className="rater-input__trailing" aria-hidden>
          {trailing}
        </span>
      ) : null}
    </div>
  );
});
