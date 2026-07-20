/**
 * Cohort batch-wiring for the plan's Final-adjustments tail (Brief 62.3 R1).
 *
 * The mission path — score one plan over a cohort (CSV or live API) — runs
 * each row through `runPlan` and reads its aggregated premium from the
 * plan's premium output. THIS module applies the plan's authored tail
 * (`Plan.policy_tail`: schedule rating / IRPM → package mods →
 * endorsements → minimum premium) to each row's aggregated premium,
 * producing the per-row FILED premium + the explainable build-up trace —
 * reusing the engine (`evaluatePolicyTail`, Brief 62.1/62.3) so there is
 * zero parallel tail math, and the source-blind IRPM resolver
 * (`makeIrpmAdjustmentResolver`, Brief 62.2) so a `column` source resolves
 * from each row's own declared inputs.
 *
 * No re-running of the plan: the cohort already ran `runPlan`, so we apply
 * the tail to the already-computed aggregated premium (the reason 62.3
 * extracted `evaluatePolicyTail` from `composePolicy`).
 *
 * When the plan authors no tail (the default until the 62.4 editor lands),
 * this is a NO-OP: `filed === aggregated`, empty trace — so wiring it into
 * the scoring view (62.4) changes nothing until a tail is authored.
 *
 * Pure. The live mount into the cohort-scoring view + the trace rendering
 * are 62.4 (where the editor + `PremiumBuildUp` live).
 */

import {
  effectivePolicyTail,
  evaluatePolicyTail,
  makeIrpmAdjustmentResolver,
  type AdjustmentStep,
  type ConnectorEvaluator,
  type Plan,
} from "@openrater/contracts";
import {
  isTotalLessMultiCoverage,
  sumMoneyFields,
  totalLessTailRefusalMessage,
  type PlanPremiumContext,
} from "../AnalyticsWorkspace/premium-resolution";

/** One cohort row's tail outcome. */
export interface CohortRowTail {
  /** The aggregated (pre-tail) premium — the plan's premium output, or
   *  the dec-page SUM of its coverage towers when the plan declares no
   *  total (`planPremium` supplied + total-less). NaN when unresolved. */
  readonly aggregated: number;
  /** The filed premium — aggregated through the ordered tail. Equals
   *  `aggregated` when the plan authors no tail (or a row doesn't score).
   *  NaN when `refusal` is set — a refused composition files no number. */
  readonly filed: number;
  /** The per-step build-up trace (empty when no tail / no premium). */
  readonly adjustments: readonly AdjustmentStep[];
  /** Law 2 — the named reason this row files NO premium. Set only when
   *  a tail meets a total-less multi-coverage plan; the caller must
   *  surface it and must NOT fall back to a pre-tail number. */
  readonly refusal?: string;
}

export interface ApplyCohortPolicyTailArgs {
  /** The plan whose filed default tail applies (only `policy_tail` read). */
  readonly plan: Pick<Plan, "policy_tail">;
  /** Per-row declared inputs (the externalInputs envelope) — the IRPM
   *  `column` source + `when` guards resolve against these, per row. */
  readonly rows: readonly Record<string, unknown>[];
  /** Per-row run outputs (1-to-1 with `rows`); the aggregated premium is
   *  `results[i].outputs[premiumColumn]`. `row_status` (ADR-0056) is
   *  read when present so an error row derives no money (Law 2 / G8). */
  readonly results: readonly {
    readonly outputs: Record<string, unknown>;
    readonly row_status?: "ok" | "error";
  }[];
  /** Which output field carries the aggregated premium (e.g.
   *  `final_premium`) — the same column the cohort charts read.
   *  IGNORED when `planPremium` says the plan is total-less (there is
   *  no such single field: the premium is the sum of the towers). */
  readonly premiumColumn: string;
  /** What the PLAN declares about premiums (`resolvePlanPremiumContext`
   *  over plan + authored STAGES). Supply it and a total-less
   *  multi-coverage filing aggregates as the dec-page sum of its
   *  towers, and a tail over one becomes the named Law-2 refusal the
   *  scoring service raises. Omit and the last-tower behavior stands —
   *  every live caller passes it. */
  readonly planPremium?: PlanPremiumContext | null;
  /** Brief 62.5 PR4c — resolves a `source.from === "model"` IRPM step
   *  (built by the caller from the Model Lab registry). Omit and a model
   *  source throws; literal + column resolve without it. */
  /** Brief 62.6 PR3 — resolves a `source.from === "connector"` IRPM step
   *  per row (built by the caller from the pre-fetched book; see
   *  `useCohortConnectorEvaluator`). Each row's connector net is looked up by
   *  its features, so a 2,000-policy book gets 2,000 per-row IRPMs. Omit and a
   *  connector source throws; literal + column + model resolve without it. */
  readonly connectorEvaluator?: ConnectorEvaluator;
}

/**
 * Apply the plan's tail to each cohort row → per-row filed premium + trace.
 * A row whose premium output is not a finite number (e.g. a declined /
 * knockout row) is passed through untailed (nothing to floor or modify).
 *
 * Law 2 (93.4) — a tail over a TOTAL-LESS multi-coverage plan is a named
 * refusal, not a tax on the last tower. A tail does money math over ONE
 * rolled-up premium field; such a plan declares none, so applying it to
 * `premiumColumn` (which `resolvePremiumColumn` resolves to the LAST
 * money output) would surcharge one coverage and file it as the policy's
 * price. This mirrors `scoreOne`'s `composition_failed` refusal exactly,
 * so the preview shows what Score-all will actually do.
 */
export function applyCohortPolicyTail(
  args: ApplyCohortPolicyTailArgs,
): CohortRowTail[] {
  const {
    plan,
    rows,
    results,
    premiumColumn,
    planPremium,
    connectorEvaluator,
  } = args;
  const tail = effectivePolicyTail(plan);
  const totalLess =
    planPremium != null && isTotalLessMultiCoverage(planPremium);
  // Plan-level, so it resolves once: every row files the same refusal.
  const refusal =
    tail && totalLess
      ? totalLessTailRefusalMessage(planPremium.moneyFields.length)
      : null;
  // One resolver instance, reused across rows (it's stateless; the row's
  // inputs arrive via ctx.externalInputs). The model evaluator (when the tail
  // has a model source) resolves it in-process; the connector evaluator
  // (62.6) looks up each row's pre-fetched live IRPM by its features. The
  // engine stays source-blind.
  const resolveAdjustment = makeIrpmAdjustmentResolver(connectorEvaluator);

  return results.map((result, i) => {
    // Law 2 / G8 — an error row derives NO money. Its partially-executed
    // towers survive in `outputs` for diagnosis, so summing them would
    // rebuild the exact wrong number the engine's refusal withheld.
    const errored = result.row_status === "error";
    let aggregated: number;
    if (errored) {
      aggregated = Number.NaN;
    } else if (totalLess) {
      // No declared total: the risk's premium is the dec-page sum of
      // its coverage premiums (the same semantic /score derives).
      aggregated = sumMoneyFields(result.outputs, planPremium.moneyFields) ?? Number.NaN;
    } else {
      const raw = result.outputs[premiumColumn];
      aggregated = typeof raw === "number" ? raw : Number.NaN;
    }

    if (refusal !== null) {
      return { aggregated, filed: Number.NaN, adjustments: [], refusal };
    }

    // No tail authored, or this row didn't produce a numeric premium →
    // pass through (the filed premium is the aggregated premium).
    if (!tail || !Number.isFinite(aggregated)) {
      return { aggregated, filed: aggregated, adjustments: [] };
    }

    const evaluated = evaluatePolicyTail(
      aggregated,
      tail,
      { externalInputs: rows[i] ?? {}, lines: [] },
      resolveAdjustment,
    );
    return {
      aggregated,
      filed: evaluated.total,
      adjustments: evaluated.adjustments,
    };
  });
}
