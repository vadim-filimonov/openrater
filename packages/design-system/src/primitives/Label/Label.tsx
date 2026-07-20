/**
 * <Label> — semantic form label.
 *
 * Wraps a native <label>, optionally with a required asterisk, an
 * "optional" tag, and a description line below. Use htmlFor to bind
 * to a form control by id.
 *
 * BEM:
 *   .rater-label
 *   .rater-label__text
 *   .rater-label__required        (red asterisk)
 *   .rater-label__optional        (muted "optional" text)
 *   .rater-label__description     (small muted line below)
 */

import type { LabelHTMLAttributes, ReactNode } from "react";
import "./Label.css";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  /** Renders an "optional" tag in muted text after the label. */
  optional?: boolean;
  /** Renders a small muted description line below the label text. */
  description?: ReactNode;
  children: ReactNode;
}

export function Label({
  required = false,
  optional = false,
  description,
  className,
  children,
  ...rest
}: LabelProps) {
  return (
    <label
      className={["rater-label", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className="rater-label__text">
        {children}
        {required ? (
          <span className="rater-label__required" aria-hidden>
            *
          </span>
        ) : null}
        {optional ? (
          <span className="rater-label__optional">(optional)</span>
        ) : null}
      </span>
      {description ? (
        <span className="rater-label__description">{description}</span>
      ) : null}
    </label>
  );
}
