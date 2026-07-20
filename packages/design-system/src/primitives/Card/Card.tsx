/**
 * <Card> — a surface with border + radius for grouping content.
 *
 * Three variants:
 *   - `default`: no padding — the consumer composes padding via inner
 *     sections or token-driven utility classes.
 *   - `padded`: --rater-card-pad-y / --rater-card-pad-x (inner-card tier).
 *   - `lifted`: padded + a resting shadow for emphasis (used for
 *     primary entity cards on plan-detail surfaces).
 *
 * The `as` prop lets the card render as a different HTML element
 * (`section`, `article`, `aside`, `li`) without losing styling.
 *
 * BEM:
 *   .rater-card
 *   .rater-card--default | --padded | --lifted
 */

import type { ElementType, HTMLAttributes, ReactNode } from "react";
import "./Card.css";

export type CardVariant = "default" | "padded" | "lifted";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  /** Render as a different HTML element. Defaults to <div>. */
  as?: ElementType;
  children: ReactNode;
}

export function Card({
  variant = "default",
  as,
  className,
  children,
  ...rest
}: CardProps) {
  const Tag = (as ?? "div") as ElementType;
  const classes = ["rater-card", `rater-card--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
