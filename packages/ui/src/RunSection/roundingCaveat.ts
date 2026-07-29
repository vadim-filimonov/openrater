/**
 * FCA fca-2026-07-25 #14 (the display half) — the Run result panel
 * rounds each coverage premium for display but shows the engine's
 * once-rounded total, so on the filing's own worked example the four
 * rows read $109 + $91 + $97 + $142 = $439 directly under a $440
 * headline, with no explanation anywhere. An actuary reading that
 * screen sees arithmetic that does not close.
 *
 * The engine's rounding ORDER (sum exact values, round once at
 * package level) is documented platform behavior — the fix here is
 * honesty at the surface: when the displayed (rounded) coverage rows
 * would not sum to the displayed total, the panel says why.
 *
 * Composed rows are exempt: their build-up (tail steps, floors) is
 * the explanation, already rendered.
 */

/** The reconciliation sentence, or null when the rows visibly sum. */
export function roundingReconciliationCaveat(args: {
  /** Numeric outputs as displayed (field → exact engine value). */
  readonly outputs: Readonly<Record<string, number>>;
  /** The headline premium (views.premium). */
  readonly premium: number;
  /** True when the row composed (tail/floor build-up shown instead). */
  readonly composed: boolean;
}): string | null {
  if (args.composed) return null;
  const entries = Object.values(args.outputs).filter((v) =>
    Number.isFinite(v),
  );
  // The panel lists the total row too — identify it as the entry
  // equal to the headline; the rest are the coverage parts.
  const parts = entries.filter((v) => v !== args.premium);
  if (parts.length < 2 || parts.length === entries.length) return null;
  const displayedPartsSum = parts.reduce((a, v) => a + Math.round(v), 0);
  if (displayedPartsSum === Math.round(args.premium)) return null;
  return (
    "Coverage rows are rounded for display; the filed total rounds " +
    "ONCE over the exact values, so the rows sum to " +
    `$${displayedPartsSum.toLocaleString("en-US")} here — a display ` +
    "artifact, not a rating difference."
  );
}
