/**
 * Derived views over a RunResult — premium / perCoverage / tier.
 *
 * CRITICAL: there is NO canonical "premium" output field. `outputs` is
 * keyed by each `output` node's author-chosen `fieldName` (V1 uses
 * "factor", V11 uses "tier", a BOP plan uses "indicated_premium", …).
 * So these views are CONFIG-DRIVEN, never hardcoded — the caller names
 * the fields via `views`, then the PLAN's own declarations resolve
 * (`resolvePlanPremiumContext`), then value-shape heuristics.
 *
 * `resolvePlanPremiumContext` + the total-less helpers now live in
 * labs-ui's pure `AnalyticsWorkspace/premium-resolution` — the ONE
 * authority this service and the browser surfaces share (re-exported
 * below, so `./derive` importers are unchanged). They were duplicated
 * while the browser answered the same question with `resolvePremiumColumn`'s
 * last-money leg; the drift shipped a $72 headline for a $267 risk.
 *
 * The plan-declared order (v4 G1 precedent, which
 * `resolveComposePremiumField` also follows):
 *   1. the plan's aggregate output — by name (`total_premium` /
 *      `final_premium`) or by structure (the money output a `round`
 *      node feeds: the ADR-0044 D8 plan-total, whatever it's named).
 *      A declared aggregate resolves or the premium is null — the
 *      parts NEVER reconstruct a total the plan computes itself.
 *   2. the lone money output (single-coverage plans — debug/number
 *      outputs like a model's `*_factor_used` no longer defeat it).
 *   3. ≥2 money outputs and NO aggregate — the legal total-less
 *      filing transcription (workbook spec: a filing with no total
 *      row transcribes without inventing one). The risk's premium is
 *      the dec-page sum of its coverage premiums — the SAME semantic
 *      the engine's own `round` total uses ("sum the money outputs").
 *      Marked `premiumBasis: "coverage_sum"` so surfaces can say so.
 *
 * `tier` prefers the engine's own Brief-55 projection
 * (`result.eligibility_tier`, which resolves multiple gates by the
 * decline > submit > standard > preferred precedence) and only falls
 * back to a named/conventional output field when the plan has no gate.
 *
 * Law 2 / ADR-0056 G8 — an error row derives NO money views. A
 * partially-executed plan (some chains resolved, some didn't) leaves
 * real numbers in `outputs`, but the row's premium is unknowable, so
 * `premium` is null and `perCoverage` is empty — a consumer summing
 * per-coverage partials would reconstruct the exact silently-wrong
 * number the refusal withheld. Raw partials stay visible in `outputs`
 * and the trace for diagnosis. `tier` is ALSO withheld (MVP-011): a
 * tier is a verdict, and an unrateable row gets none — the gate may
 * never have evaluated, so a derived tier would be fabricated.
 * The coverage-sum view is safe against this by construction: it only
 * runs on CLEAN rows, and G8 marks any withheld output as an error row.
 */

import type { RunResult } from "@openrater/contracts";
import {
  type PlanPremiumContext,
  sumMoneyFields,
} from "@openrater/ui/AnalyticsWorkspace/premium-resolution";

// The plan-declaration resolver lives in labs-ui's pure
// `premium-resolution` module — the LOWER layer both this service and
// the browser surfaces share (same seam as `snapshot-plan`). It began
// here, while the browser kept its own last-money `resolvePremiumColumn`
// leg; the two drifted and shipped a wrong number (a $267 two-tower risk
// headlined "$72"). One question, one authority. Re-exported so this
// module's consumers (score / scorePolicy / worker / bookRun) are
// unchanged.
export {
  declaredPremiumRollup,
  extraPolicyRollupFields,
  isCoverageSumBook,
  isTotalLessMultiCoverage,
  premiumBasisField,
  resolvePlanPremiumContext,
  rolledPolicyPremium,
  sumMoneyFields,
  totalLessTailRefusalMessage,
} from "@openrater/ui/AnalyticsWorkspace/premium-resolution";
export type {
  PlanPremiumContext,
  PremiumPlanLike as PlanLike,
  PremiumStageLike as StageLike,
} from "@openrater/ui/AnalyticsWorkspace/premium-resolution";

/** How `views.premium` resolved. */
export type PremiumBasis =
  | "premium_field" // the caller named the field (views.premiumField)
  | "aggregate_output" // the plan's own declared total output
  | "coverage_sum" // total-less plan: sum of its coverage money outputs
  | "single_output" // the lone money (or lone numeric) output
  | "composed"; // composed.final overrode (tail / floor / gates)

export interface ScoreViews {
  /** The premium scalar, or null when it can't be resolved. */
  readonly premium: number | null;
  /** How `premium` resolved — absent when premium is null. Surfaces
   *  qualify copy with this (a "coverage_sum" premium is the dec-page
   *  sum over coverages, not a field the filing declares). */
  readonly premiumBasis?: PremiumBasis;
  /** Per-coverage numeric outputs (one per chain tower). */
  readonly perCoverage: Record<string, number>;
  /** Resolved eligibility tier, or null when the plan has no gate. */
  readonly tier: string | null;
}

export interface ViewConfig {
  // `| undefined` on each: the zod-inferred request type carries it
  // (optional props are `T | undefined`), and exactOptionalPropertyTypes
  // makes the bare `?:` form reject an explicit-undefined value.
  readonly premiumField?: string | undefined;
  readonly coverageFields?: readonly string[] | undefined;
  readonly tierField?: string | undefined;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function deriveViews(
  result: RunResult,
  views?: ViewConfig,
  planPremium?: PlanPremiumContext,
): ScoreViews {
  const outputs = result.outputs;

  // ── G8 refusal — no money views on an error row ──
  // MVP-011 — and no VERDICT either: an unrateable row's gate may
  // never have evaluated, so a derived tier would be fabricated from
  // partial state. tier: null end to end.
  if (result.row_status === "error") {
    return { premium: null, perCoverage: {}, tier: null };
  }

  // ── premium ──
  let premium: number | null = null;
  let premiumBasis: PremiumBasis | undefined;
  if (views?.premiumField) {
    // Explicit config is a contract — it resolves or the premium is
    // null; it never falls through to a guess.
    premium = asFiniteNumber(outputs[views.premiumField]);
    if (premium !== null) premiumBasis = "premium_field";
  } else if (planPremium?.aggregateField) {
    // The plan declares its total. Read it or stay honestly null —
    // never rebuild a declared-but-absent total from its parts.
    premium = asFiniteNumber(outputs[planPremium.aggregateField]);
    if (premium !== null) premiumBasis = "aggregate_output";
  } else {
    if (planPremium && planPremium.moneyFields.length === 1) {
      premium = asFiniteNumber(outputs[planPremium.moneyFields[0]!]);
      if (premium !== null) premiumBasis = "single_output";
    } else if (planPremium && planPremium.moneyFields.length > 1) {
      // Total-less transcription: the risk's premium is the sum of its
      // coverage premiums. Clean row ⇒ nothing was withheld (G8 turns
      // any withheld output into an error row, refused above).
      premium = sumMoneyFields(outputs, planPremium.moneyFields);
      if (premium !== null) premiumBasis = "coverage_sum";
    }
    if (premium === null) {
      // Heuristic of last resort: a single numeric output IS the
      // premium (typeless/raw plans). With more than one we don't
      // guess — the caller should name `premiumField`.
      const numeric = Object.values(outputs).filter(
        (v) => asFiniteNumber(v) !== null,
      );
      if (numeric.length === 1) {
        premium = asFiniteNumber(numeric[0]);
        if (premium !== null) premiumBasis = "single_output";
      }
    }
  }

  // ── per-coverage ──
  const perCoverage: Record<string, number> = {};
  const coverageFields = views?.coverageFields;
  if (coverageFields && coverageFields.length > 0) {
    for (const field of coverageFields) {
      const n = asFiniteNumber(outputs[field]);
      if (n !== null) perCoverage[field] = n;
    }
  } else {
    // Default: surface every numeric output keyed by its field name.
    for (const [key, value] of Object.entries(outputs)) {
      const n = asFiniteNumber(value);
      if (n !== null) perCoverage[key] = n;
    }
  }

  return {
    premium,
    ...(premiumBasis !== undefined ? { premiumBasis } : {}),
    perCoverage,
    tier: deriveTier(result, views),
  };
}

function deriveTier(result: RunResult, views?: ViewConfig): string | null {
  let tier: string | null = result.eligibility_tier ?? null;
  if (tier === null) {
    const field = views?.tierField ?? "tier";
    const v = result.outputs[field];
    if (typeof v === "string") tier = v;
  }
  return tier;
}
