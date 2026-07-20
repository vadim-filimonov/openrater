/**
 * Policy composition shapes — the layer ABOVE a Plan (ADR-0034 §1/§2).
 *
 * A `Plan` is one product's rating algorithm (ADR-0032 D1). A `Policy`
 * is the customer's order: it references N product Plans by `id + hash`,
 * runs each against the (per-line slice of the) risk, and composes their
 * premiums with a policy-level package credit + a policy minimum.
 *
 * The plain-language version: a Plan is the recipe; a Policy is the
 * order. The composer (`composePolicy`, `policy-compose.ts`) is the
 * waiter — it never reads the recipes.
 *
 * ── GENERICITY INVARIANT (ADR-0033 §0 / ADR-0034 §0) ──
 *
 * Nothing here branches on a specific product. `PlanRef.product` is an
 * OPAQUE TAG carried for labeling / analytics only; strip the tags and
 * the composition math is unchanged. A `bop + auto + wc` policy uses the
 * identical shapes + code path as `do + cgl`. Adding a line of business
 * to a policy is referencing another Plan — never a composer change.
 *
 * These are the DATA shapes only. The pure `composePolicy` algorithm
 * lives in `policy-compose.ts` (it depends on the runtime; these shapes
 * deliberately do not, so they stay portable).
 *
 * Pure types. No React and no DOM.
 */

import type { ProductCode } from "./product-types";
import { isProductCode } from "./product-types";
import type { PolicyAdjustment, AdjustmentStep } from "./policy-adjustments";
import { isPolicyAdjustment } from "./policy-adjustments";

/**
 * A reference to a filed product Plan, pinned by `content_hash` so a
 * policy always re-rates against the exact algorithm version it bound.
 */
export interface PlanRef {
  readonly plan_id: string;
  /** Pins the algorithm version (the Plan's content_hash). */
  readonly content_hash: string;
  /** Opaque tag for labeling and analytics, NEVER a branch. */
  readonly product: ProductCode;
}

/**
 * One product's slot on a policy: which Plan rates it, which of that
 * Plan's named outputs IS the line premium, and (optionally) which
 * coverages of the Plan are bound on this policy.
 */
export interface PolicyLine {
  readonly plan_ref: PlanRef;
  /** The Plan output fieldName the composer sums. A field name, not a
   *  product rule — this is what keeps the composer generic. */
  readonly premium_output: string;
  /** Subset of the Plan's Coverage ids bound on this policy (optional;
   *  v1 binds the whole plan when omitted). */
  readonly coverage_ids?: readonly string[];
}

/**
 * A Policy composes N product Plans against one risk.
 */
export interface Policy {
  readonly policy_id: string;
  readonly lines: readonly PolicyLine[];
  /** Policy-level multiplicative credit BETWEEN distinct products
   *  (D3/D6) — distinct from the in-plan `Schedule.scope:"package"`
   *  credit between coverages of one plan. Default 1 (no credit). */
  readonly package_credit?: number;
  /** Floor on the composed total. Default 0 (no floor). */
  readonly minimum_premium?: number;
  /** Dataset grouping key only (D6) — there is NO Account entity, no
   *  nesting, no policy-admin lifecycle. The composer does not read it. */
  readonly account_key?: string;
  /**
   * Brief 62.1 / ADR-0042 D1 — ordered post-aggregation adjustments,
   * applied to the policy total in order (schedule rating → package mods
   * → endorsements → minimum premium). When present this is
   * AUTHORITATIVE and the legacy `package_credit` / `minimum_premium`
   * MUST be absent (`isPolicy` rejects setting both). When absent, the
   * composer synthesizes the legacy 2-step tail so there is exactly ONE
   * evaluation path (see `policy-compose.ts` back-compat normalization).
   */
  readonly adjustments?: readonly PolicyAdjustment[];
}

/**
 * The result of running + reading one policy line.
 */
export interface PolicyLineResult {
  /** Carried through for labeling only (opaque tag). */
  readonly product: ProductCode;
  readonly plan_id: string;
  /** The Plan's full RunResult.outputs (every named output). */
  readonly outputs: Readonly<Record<string, unknown>>;
  /** outputs[line.premium_output], coerced to number. */
  readonly premium: number;
}

/**
 * The composed policy total + its full build-up (for the trace exhibit).
 *
 * `adjustments[]` (Brief 62.1) is the source of truth — the ordered tail
 * applied after `subtotal`, each step traced. The legacy scalar fields
 * are RETAINED for back-compat and DERIVED from the pipeline (see
 * `policy-compose.ts` §back-compat):
 *   - `package_credit` = Π of all `package_factor` step factors (1 if none)
 *   - `after_credit`   = subtotal × package_credit (the ADR-0034 meaning;
 *      equals the running total only when there are no schedule_rating /
 *      endorsement steps)
 *   - `minimum_premium`/`minimum_applied` = the floor + whether it bound
 *   - `total`          = the running total after the LAST step
 *
 * For a legacy (no-`adjustments`) policy this reduces exactly to ADR-0034:
 * `total === max(after_credit, minimum_premium)` and
 * `after_credit === subtotal × package_credit`.
 */
export interface PolicyResult {
  readonly policy_id: string;
  readonly lines: readonly PolicyLineResult[];
  /** Σ line.premium. */
  readonly subtotal: number;
  /** The credit factor applied (1 if none) — Π of package_factor steps. */
  readonly package_credit: number;
  /** subtotal × package_credit. */
  readonly after_credit: number;
  /** The floor applied (0 if none). */
  readonly minimum_premium: number;
  /** Did the floor bind? */
  readonly minimum_applied: boolean;
  /** The policy premium — the running total after the last adjustment. */
  readonly total: number;
  /**
   * Brief 62.1 / ADR-0042 D4 — the per-step build-up trace (the source
   * of truth; the regulator-answerable column). Always present: a legacy
   * policy yields the two synthesized steps; the empty array only occurs
   * before the engine loop lands (62.1 PR2).
   */
  readonly adjustments: readonly AdjustmentStep[];
}

/**
 * Type guard: is this value a structurally valid Policy?
 *
 * Use at the schema-validation boundary (persisted policy load, external
 * JSON). Validates structure + that each line's `plan_ref.product` is a
 * real ProductCode (membership only — not a product branch).
 */
export function isPolicy(value: unknown): value is Policy {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (typeof p.policy_id !== "string" || p.policy_id.length === 0) return false;
  if (!Array.isArray(p.lines)) return false;
  for (const line of p.lines) {
    if (!isPolicyLine(line)) return false;
  }
  if (p.package_credit !== undefined && typeof p.package_credit !== "number") {
    return false;
  }
  if (
    p.minimum_premium !== undefined &&
    typeof p.minimum_premium !== "number"
  ) {
    return false;
  }
  if (p.account_key !== undefined && typeof p.account_key !== "string") {
    return false;
  }
  if (p.adjustments !== undefined) {
    if (!Array.isArray(p.adjustments)) return false;
    if (!p.adjustments.every(isPolicyAdjustment)) return false;
    // Mutual exclusion (Brief 62.1 §3): `adjustments[]` is authoritative —
    // a policy may not ALSO set the legacy scalar tail, or there would be
    // two conflicting definitions of the same steps.
    if (p.package_credit !== undefined || p.minimum_premium !== undefined) {
      return false;
    }
  }
  return true;
}

/**
 * Brief 62.3 §2a — resolve the effective post-aggregation tail for a
 * composition: the Policy's own `adjustments[]` (a hand-tuned, policy-
 * specific override authored in 62.4) WINS; otherwise the composition
 * INHERITS the plan's filed default `policy_tail`; otherwise `undefined`
 * — and `composePolicy` synthesizes the legacy 2-step tail from the
 * Policy's `package_credit` / `minimum_premium` scalars (62.1 §3).
 *
 * Pure + structural (takes only the fields it reads) so it stays free of
 * the Plan↔Policy import direction and is trivially testable. This is the
 * inherit/override rule that the batch wiring (62.3 PR3) applies once per
 * cohort row before handing a single-line `Policy` to `composePolicy`.
 */
export function effectivePolicyTail(
  // Accept explicit `undefined` IN so callers can forward possibly-absent
  // fields directly (the repo runs exactOptionalPropertyTypes).
  plan: { readonly policy_tail?: readonly PolicyAdjustment[] | undefined },
  policy?: { readonly adjustments?: readonly PolicyAdjustment[] | undefined },
): readonly PolicyAdjustment[] | undefined {
  return policy?.adjustments ?? plan.policy_tail;
}

function isPolicyLine(value: unknown): value is PolicyLine {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  if (typeof l.premium_output !== "string" || l.premium_output.length === 0) {
    return false;
  }
  if (
    l.coverage_ids !== undefined &&
    !(
      Array.isArray(l.coverage_ids) &&
      l.coverage_ids.every((id) => typeof id === "string")
    )
  ) {
    return false;
  }
  const ref = l.plan_ref as Record<string, unknown> | undefined;
  return (
    typeof ref === "object" &&
    ref !== null &&
    typeof ref.plan_id === "string" &&
    typeof ref.content_hash === "string" &&
    isProductCode(ref.product)
  );
}
