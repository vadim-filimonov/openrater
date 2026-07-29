/**
 * Policy-level adjustments — the ordered, post-aggregation premium tail
 * (Brief 62 / ADR-0042).
 *
 * After a policy's per-coverage rating chains aggregate to a `subtotal`
 * (ADR-0034 `composePolicy`), a real filing layers on an ORDERED list of
 * policy-level adjustments before the premium is final:
 *
 *   subtotal → × IRPM (schedule rating) → × package mods → + endorsements
 *            → max(_, minimum premium) = filed premium
 *
 * ADR-0034 modelled only the last-two-step special case (one
 * `package_credit`, then a `minimum_premium`). This module generalises
 * that fixed tail into an authored, reorderable `PolicyAdjustment[]` that
 * the composer evaluates in order, recording each step in the trace
 * (ADR-0042 D1/D4). The legacy two-field tail maps onto two adjustments,
 * so every existing policy composes identically (see `policy-compose.ts`
 * §back-compat).
 *
 * ── SOURCE-BLIND (ADR-0042 D2 / Genericity invariant ADR-0033 §0) ──
 *
 * An IRPM value can come from four places — a literal the underwriter
 * typed, a CSV column, a Model Lab model, or an API Lab connector — but
 * the composer NEVER branches on which. It either reads a `literal`
 * inline or asks an injected resolver; the four sources converge on the
 * single `{ total?, sections?, provenance }` shape. `IrpmSourceSpec`
 * declares all four `from` tags here; only `literal` is implemented in
 * 62.1 (`column` → 62.2, `model` → 62.5, `connector` → 62.6).
 *
 * Pure data + type guards. No React, no DOM, no I/O. The evaluation
 * algorithm lives in `policy-compose.ts` (it depends on the runtime;
 * these shapes deliberately do not, so they stay portable). See
 * `docs/adr/0042-policy-adjustments-and-irpm-resolver.md`.
 */

import type { EligibilityOp } from "./tier-types";
import { ELIGIBILITY_OPS } from "./tier-types";
import type { IrpmSourceSpec } from "./irpm-source";
import { isIrpmSourceSpec } from "./irpm-source";

// `IrpmSourceSpec` + its guard moved to the shared `irpm-source.ts` (62.2,
// where the per-row resolver also lives). Re-exported here so existing
// imports from `policy-adjustments` stay unbroken.
export type { IrpmSourceSpec } from "./irpm-source";
export { isIrpmSourceSpec } from "./irpm-source";

/**
 * A guard evaluated against the policy's externalInputs (e.g.
 * `is_first_term === true`, `years_in_business < 3`). When an adjustment
 * carries no `when`, it always applies; when the guard does not match the
 * adjustment is recorded as a visible no-op step (never silently skipped).
 *
 * Reuses the gate guard vocabulary (`EligibilityOp`) so a guard here
 * means exactly what it means on an eligibility rule — one comparator
 * vocabulary across the platform, evaluated by the same
 * `evaluateEligibilityComparator`.
 */
export interface GuardExpr {
  /** The externalInputs key to read at evaluation time. */
  readonly field: string;
  /** Comparator operator (shared gate vocabulary). */
  readonly op: EligibilityOp;
  /** Right-hand side: a primitive for eq/ne/lt/le/gt/ge, an array for in/nin. */
  readonly value: unknown;
}

/**
 * Where a sourced value (IRPM, or a derived endorsement amount) comes
 * from. The composer is blind to this beyond "is it a `literal`?": every
 * non-literal source is resolved by the injected `AdjustmentResolver`.
 *
 * 62.1 implements `literal` only. `column` is 62.2, `model` is 62.5,
 * `connector` is 62.6. The union itself now lives in `irpm-source.ts`
 * (re-exported above); see that module for the per-`from` shapes.
 */

/** The closed set of policy-adjustment kinds (the typed dispatch axis). */
export type AdjustmentKind =
  | "schedule_rating"
  | "package_factor"
  | "endorsement"
  | "minimum_premium";

/**
 * How an endorsement modifies the running premium: a flat dollar charge
 * (additive) or a multiplicative factor (D6 — KS endorsements include
 * both; terrorism is a per-$100 charge, others are flat or factor).
 */
export type EndorsementEffect =
  | { readonly kind: "flat"; readonly amount: number }
  | { readonly kind: "factor"; readonly factor: number };

/**
 * One post-aggregation adjustment, applied to the policy total (D3 — all
 * adjustments apply at the policy total; there is no per-adjustment
 * application level). A discriminated union over `kind`.
 */
export type PolicyAdjustment =
  | {
      /** IRPM / schedule rating — × (1 + clamp(Σ sections, ∓cap_pct)). */
      readonly kind: "schedule_rating";
      readonly id: string;
      readonly display_name: string;
      /** The filed cap, applied to the SUM of sub-sections (D2/D5). e.g. 25. */
      readonly cap_pct: number;
      readonly source: IrpmSourceSpec;
      readonly citation?: string;
    }
  | {
      /** A package modifier — × factor (Pioneer −10%, new-business +10%). */
      readonly kind: "package_factor";
      readonly id: string;
      readonly display_name: string;
      readonly factor: number;
      /** Applies only when the guard matches (e.g. is_first_term). */
      readonly when?: GuardExpr;
      readonly citation?: string;
    }
  | {
      /** An endorsement — flat charge or factor; the value may be sourced. */
      readonly kind: "endorsement";
      readonly id: string;
      readonly display_name: string;
      readonly effect: EndorsementEffect;
      /** Optional: a flat amount may be resolved (e.g. terrorism from limits). */
      readonly source?: IrpmSourceSpec;
      readonly when?: GuardExpr;
      readonly citation?: string;
    }
  | {
      /** The minimum-premium floor — max(running, floor). */
      readonly kind: "minimum_premium";
      readonly id: string;
      readonly floor: number;
      readonly citation?: string;
    };

/**
 * Provenance for a resolved adjustment value (Citation/provenance,
 * P-N4). `literal` carries just `{ source: "literal" }`; a model carries
 * `model + version`; a connector (62.6) carries `connector + version` + the
 * replay `snapshot_id` (the filing record) + the call `cost_usd`, and a
 * `fallback_reason` when a failed/late live call degraded to a fallback net.
 */
export interface AdjustmentProvenance {
  readonly source: IrpmSourceSpec["from"];
  readonly model?: string;
  /** The connector id (62.6 — `source: "connector"`). */
  readonly connector?: string;
  readonly version?: string;
  readonly snapshot_id?: string;
  /** The live-call cost in USD (62.6 §5 — the book cost rollup). */
  readonly cost_usd?: number;
  /** Set when a connector call failed/timed out + a fallback net was used. */
  readonly fallback_reason?: string;
}

/**
 * One step in the policy build-up trace (Trace contract, P-N5). The plan
 * trace's policy tail is the ordered union of these — the
 * regulator-answerable build-up: running total in, the factor or delta
 * applied, running total out, in actuary-readable language.
 */
export interface AdjustmentStep {
  readonly id: string;
  readonly kind: AdjustmentKind;
  /** false when a `when` guard did not match (a visible no-op). */
  readonly applied: boolean;
  /** Running total coming in. */
  readonly before: number;
  /** The × factor (multiplicative) or + delta (additive) applied. */
  readonly factor_or_delta: number;
  /** Running total going out. */
  readonly after: number;
  /** Human-readable explanation, e.g. "−7.0% (Σ 6 sections, cap ±25%)". */
  readonly detail: string;
  /** IRPM sub-sections, retained when the source provides them (D2). */
  readonly sections?: Readonly<Record<string, number>>;
  /** Provenance for a sourced value. */
  readonly provenance?: AdjustmentProvenance;
  readonly citation?: string;
}

// ── Type guards (schema-validation boundary) ─────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Is this a structurally valid GuardExpr (field + known op + value)? */
export function isGuardExpr(value: unknown): value is GuardExpr {
  if (!isObject(value)) return false;
  if (!isNonEmptyString(value.field)) return false;
  if (!ELIGIBILITY_OPS.includes(value.op as EligibilityOp)) return false;
  // `value` is `unknown` by contract — its presence is enough; any JSON
  // value is acceptable (a primitive for comparators, an array for in/nin).
  return "value" in value;
}

function isEndorsementEffect(value: unknown): value is EndorsementEffect {
  if (!isObject(value)) return false;
  if (value.kind === "flat") return typeof value.amount === "number";
  if (value.kind === "factor") return typeof value.factor === "number";
  return false;
}

/**
 * Is this a structurally valid PolicyAdjustment? Validates the
 * discriminated union by `kind` — required fields present + correctly
 * typed; optional `when`/`source`/`citation` validated when present.
 *
 * Use at the schema-validation boundary (persisted policy load, external
 * JSON). Membership-only on `kind` — never a product/source branch.
 */
export function isPolicyAdjustment(value: unknown): value is PolicyAdjustment {
  if (!isObject(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (value.citation !== undefined && typeof value.citation !== "string") {
    return false;
  }
  switch (value.kind) {
    case "schedule_rating":
      return (
        isNonEmptyString(value.display_name) &&
        typeof value.cap_pct === "number" &&
        isIrpmSourceSpec(value.source)
      );
    case "package_factor":
      return (
        isNonEmptyString(value.display_name) &&
        typeof value.factor === "number" &&
        (value.when === undefined || isGuardExpr(value.when))
      );
    case "endorsement":
      return (
        isNonEmptyString(value.display_name) &&
        isEndorsementEffect(value.effect) &&
        (value.source === undefined || isIrpmSourceSpec(value.source)) &&
        (value.when === undefined || isGuardExpr(value.when))
      );
    case "minimum_premium":
      return typeof value.floor === "number";
    default:
      return false;
  }
}
