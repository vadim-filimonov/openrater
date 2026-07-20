/**
 * <Num> — numeric display.
 *
 * Formats numbers via Intl.NumberFormat, in tabular mono. Optionally
 * renders a delta arrow (▲ ▼ ―) before the value. Use for premiums,
 * factors, percents, integer counts — anywhere a number is shown
 * inline.
 *
 * BEM:
 *   .rater-num
 *   .rater-num--<format>
 *   .rater-num--delta-up | --delta-down | --delta-flat
 *   .rater-num__delta
 *   .rater-num__value
 */

import type { HTMLAttributes } from "react";
import "./Num.css";

export type NumFormat = "default" | "currency" | "percent" | "integer";
export type NumDelta = "up" | "down" | "flat";

export interface NumProps extends HTMLAttributes<HTMLSpanElement> {
  value: number;
  /**
   * - `default`: 1,234.567 (no decimal limit, but trims trailing zeros)
   * - `currency`: $1,234.57 (always 2 decimals, USD by default)
   * - `percent`: 12.3% (value is 0.123)
   * - `integer`: 1,234 (no decimals)
   */
  format?: NumFormat;
  /** ISO 4217 code. Only meaningful when `format="currency"`. Default: `"USD"`. */
  currency?: string;
  /** Locale tag (e.g. "en-US"). Defaults to runtime default. */
  locale?: string;
  /** Renders a delta arrow before the value. */
  delta?: NumDelta;
  /** Override decimal handling. Useful for precise factor display (e.g. 0.0123). */
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
}

const DELTA_GLYPH: Record<NumDelta, string> = {
  up: "▲",
  down: "▼",
  flat: "—",
};

export function Num({
  value,
  format = "default",
  currency = "USD",
  locale,
  delta,
  maximumFractionDigits,
  minimumFractionDigits,
  className,
  ...rest
}: NumProps) {
  const formatted = formatNumber(value, {
    format,
    currency,
    locale,
    maximumFractionDigits,
    minimumFractionDigits,
  });

  const classes = [
    "rater-num",
    `rater-num--${format}`,
    delta ? `rater-num--delta-${delta}` : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...rest}>
      {delta ? (
        <span className="rater-num__delta" aria-hidden>
          {DELTA_GLYPH[delta]}
        </span>
      ) : null}
      <span className="rater-num__value">{formatted}</span>
    </span>
  );
}

function formatNumber(
  value: number,
  opts: {
    format: NumFormat;
    currency: string;
    locale: string | undefined;
    maximumFractionDigits: number | undefined;
    minimumFractionDigits: number | undefined;
  },
): string {
  const { format, currency, locale, maximumFractionDigits, minimumFractionDigits } = opts;
  const base: Intl.NumberFormatOptions = {};
  if (maximumFractionDigits !== undefined) base.maximumFractionDigits = maximumFractionDigits;
  if (minimumFractionDigits !== undefined) base.minimumFractionDigits = minimumFractionDigits;

  switch (format) {
    case "currency":
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: minimumFractionDigits ?? 2,
        maximumFractionDigits: maximumFractionDigits ?? 2,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: minimumFractionDigits ?? 0,
        maximumFractionDigits: maximumFractionDigits ?? 2,
      }).format(value);
    case "integer":
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0,
        ...base,
      }).format(value);
    default:
      return new Intl.NumberFormat(locale, base).format(value);
  }
}
