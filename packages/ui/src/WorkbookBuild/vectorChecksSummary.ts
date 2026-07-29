/**
 * vectorChecksSummary — FCA fca-2026-07-25 #19: ONE verdict
 * vocabulary for the verification checks.
 *
 * The same 30 checks used to be summarized three ways on three
 * surfaces: the Exhibits lede counted exact matches only ("10/30
 * filed checks reproduce" — the most alarming framing on the most
 * prominent surface, for a plan whose totals all reproduce), the
 * Analytics chip mixed units ("5 of 5 reproduce the filing (20
 * within rounding)" — cases beside checks), and the build report
 * recorded matched/near/mismatched. A first-contact actuary read
 * "two thirds fail" on a passing plan.
 *
 * One derivation, one unit (CHECKS), three consumers. "Reproduce" =
 * matched + near (within the authored tolerance band); the near
 * share is always disclosed; a mismatch always leads.
 */

export interface VectorChecksLike {
  readonly matched: number;
  readonly near: number;
  readonly mismatched: number;
  readonly checks: readonly unknown[];
}

export interface VectorChecksSummary {
  /** Checks that reproduce the filing (exact + within tolerance). */
  readonly reproduced: number;
  readonly total: number;
  readonly mismatched: number;
  readonly near: number;
  /** The one sentence every surface prints. */
  readonly label: string;
  /** "10/30" is dead — the compact fraction counts REPRODUCED. */
  readonly fraction: string;
  readonly tone: "success" | "warn" | "error";
}

export function vectorChecksSummary(
  v: VectorChecksLike,
): VectorChecksSummary {
  const total = v.checks.length;
  const reproduced = v.matched + v.near;
  const fraction = `${reproduced}/${total}`;
  if (v.mismatched > 0) {
    return {
      reproduced,
      total,
      mismatched: v.mismatched,
      near: v.near,
      fraction,
      label:
        `${reproduced} of ${total} checks reproduce the filing — ` +
        `${v.mismatched} MISMATCHED`,
      tone: "error",
    };
  }
  if (v.near > 0) {
    return {
      reproduced,
      total,
      mismatched: 0,
      near: v.near,
      fraction,
      label:
        `${total} of ${total} checks reproduce the filing ` +
        `(${v.near} within tolerance)`,
      tone: "warn",
    };
  }
  return {
    reproduced,
    total,
    mismatched: 0,
    near: 0,
    fraction,
    label: `${total} of ${total} checks reproduce the filing exactly`,
    tone: "success",
  };
}
