/**
 * Verification honesty on the landing surface — FCA fca-2026-07-25
 * #11 (S2). After a build whose verification MISMATCHED the filing,
 * the plan Overview showed only green: a "Ready to rate" pill and a
 * "5 of 5 complete" checklist, with the mismatch state one deliberate
 * click deep in the build-report drawer. A user who trusted the
 * landing page concluded everything reproduced.
 *
 * Two pure derivations, consumed by the plan route:
 *   · `verificationChecklistItem` — a sixth checklist row for
 *     workbook-built plans whose vectors RAN: green "N of N checks
 *     match" when clean, an UNDONE row naming the mismatch counts
 *     (with the build report as its action) when not.
 *   · `verificationHealthOverride` — the pill phrase when the plan
 *     rates but its latest build disputes the filing: "Ready to
 *     rate" must not stand unqualified over red checks.
 *
 * The denominator is `checks.length` — the same counting
 * BuildReportView renders ("9 of 12"), so the row and the drawer can
 * never disagree.
 */

import type { OverviewChecklistItem } from "./OverviewSection";

export interface VerificationVectorsLike {
  readonly status: string; // "ran" | "unavailable" | "none"
  readonly matched: number;
  readonly near: number;
  readonly mismatched: number;
  readonly checks: readonly unknown[];
}

/** The Overview checklist row. Null when there is nothing to verify
 *  (hand-authored plan, or a build whose vectors never ran) — the
 *  checklist keeps its five structural rows exactly as before. */
export function verificationChecklistItem(
  vectors: VerificationVectorsLike | null | undefined,
  onOpen: () => void,
): OverviewChecklistItem | null {
  if (!vectors || vectors.status !== "ran") return null;
  const total = vectors.checks.length;
  if (total === 0) return null;
  if (vectors.mismatched > 0) {
    return {
      id: "verification",
      label: "Verify against the filing",
      done: false,
      detail:
        `${vectors.matched} of ${total} match · ` +
        `${vectors.mismatched} mismatched`,
      onOpen,
      actionLabel: "View build report →",
    };
  }
  const nearNote = vectors.near > 0 ? ` · ${vectors.near} near` : "";
  return {
    id: "verification",
    label: "Verify against the filing",
    done: true,
    detail: `${vectors.matched} of ${total} checks match${nearNote}`,
    onOpen,
  };
}

/** The health-pill override: non-null iff the latest build's checks
 *  MISMATCHED — the plan still rates, so the phrase says both truths
 *  instead of an unqualified "Ready to rate". Tone is the caller's
 *  ("warn"). */
export function verificationHealthOverride(
  vectors: VerificationVectorsLike | null | undefined,
): string | null {
  if (!vectors || vectors.status !== "ran") return null;
  if (vectors.mismatched <= 0) return null;
  const s = vectors.mismatched === 1 ? "" : "s";
  return `Rates — ${vectors.mismatched} check${s} mismatched`;
}
