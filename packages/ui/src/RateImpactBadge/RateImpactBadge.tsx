/**
 * <RateImpactBadge> — signed $/% delta chip.
 *
 * Brief 12 (Comparison primitive) — every diff row that touches a
 * factor in run-vs-run mode shows a small chip with the rate impact:
 *
 *     +$235 (+4.5%)        red-tinted (premium INCREASED under B)
 *     −$45 (−0.8%)          green-tinted (premium DECREASED under B)
 *     $0 (0.0%)             muted (no change)
 *
 * Sign convention: signed values, with explicit ± + color (red for
 * surcharge / increase, green for credit / decrease) per Brief 15
 * P-M8 sign convention applied to comparison surfaces. (Yes, same
 * intuition: positive delta = "this got more expensive under B".)
 *
 * BEM:
 *   .rater-rate-impact-badge
 *   .rater-rate-impact-badge--increase   (red — premium went up)
 *   .rater-rate-impact-badge--decrease   (green — premium went down)
 *   .rater-rate-impact-badge--zero       (muted)
 *   .rater-rate-impact-badge__dollars
 *   .rater-rate-impact-badge__pct
 */

import type { RateImpact } from "@openrater/contracts";
import "./RateImpactBadge.css";

export interface RateImpactBadgeProps {
  readonly impact: RateImpact;
  /** When true, renders only the dollar delta (no percentage suffix).
   *  Use in compact contexts. */
  readonly compact?: boolean;
  /** Optional aria-label override. Defaults to a screen-reader-
   *  friendly version of the formatted text. */
  readonly ariaLabel?: string;
}

/** Format a signed dollar value with sign + thousands separator. */
function formatSignedDollars(d: number): string {
  if (d === 0) return "$0";
  const sign = d > 0 ? "+" : "−"; // U+2212 minus, not hyphen
  const abs = Math.abs(d);
  // Whole dollars for >= 1; 2 decimals otherwise.
  const formatted = abs >= 1
    ? Math.round(abs).toLocaleString()
    : abs.toFixed(2);
  return `${sign}$${formatted}`;
}

/** Format a signed percentage with sign + 1 decimal. */
function formatSignedPct(p: number): string {
  if (p === 0) return "0.0%";
  const sign = p > 0 ? "+" : "−";
  return `${sign}${Math.abs(p).toFixed(1)}%`;
}

export function RateImpactBadge({
  impact,
  compact = false,
  ariaLabel,
}: RateImpactBadgeProps) {
  const tone =
    impact.dollars > 0 ? "increase" : impact.dollars < 0 ? "decrease" : "zero";
  const dollars = formatSignedDollars(impact.dollars);
  const pct = formatSignedPct(impact.pct);
  const label =
    ariaLabel ??
    `Rate impact: ${dollars}${impact.pct !== 0 ? ` (${pct})` : ""}`;
  return (
    <span
      className={`rater-rate-impact-badge rater-rate-impact-badge--${tone}`}
      aria-label={label}
    >
      <span className="rater-rate-impact-badge__dollars">{dollars}</span>
      {!compact && impact.pct !== 0 ? (
        <span className="rater-rate-impact-badge__pct">{pct}</span>
      ) : null}
    </span>
  );
}

// Export the pure formatters so callers can reuse the same conventions
// outside this component (e.g., in filing-export PDFs or trace).
export { formatSignedDollars, formatSignedPct };
