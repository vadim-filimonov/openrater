/**
 * scorePolicy — synchronous multi-location policy composition (Brief 76
 * P4.1b). The single-risk twin (`scoreOne`) composes ONE location; this
 * composes N locations into ONE policy and returns the rolled-up FILED
 * premium — the number a real BOP policy quote needs.
 *
 * It runs the EXACT `evaluatePolicyBook` the book path (Brief 75) runs —
 * rate each location, roll up the declared fields, apply the frozen tail
 * + G9 floor once per policy, resolve the appetite — so a policy quote
 * and a grouped book run of the same policy return the identical premium
 * (Law 1). The only difference from the book path is that it's
 * synchronous (no job queue) and takes already-declared inputs (not raw
 * CSV rows).
 */

import {
  compilePlan,
  evaluatePolicyBook,
  PlanCompileError,
  runPlanBatch,
  type ProjectionIssue,
  type RowIssue,
} from "@openrater/contracts";
import {
  appendPlanFloor,
  planMinimumPremium,
  policyBookConfigFromPlan,
} from "@openrater/ui/InputsWorkspace/policyBookConfig";

import { ensureEngineReady } from "./engine";
import { resolvePlanBundle, type PlanBundleDeps } from "./planSource";
import {
  declaredPremiumRollup,
  deriveViews,
  extraPolicyRollupFields,
  isCoverageSumBook,
  resolvePlanPremiumContext,
  sumMoneyFields,
  totalLessTailRefusalMessage,
} from "./derive";
import {
  resolveComposePremiumField,
  toRunOptions,
} from "./score";
import { buildTailResolver } from "./tailResolver";
import { badRequest } from "./errors";
import type { ScorePolicyRequest } from "./schema";

export interface PolicyLocationResult {
  readonly location_id: string;
  readonly premium: number | null;
  readonly tier: string | null;
  readonly row_status: "ok" | "error";
  readonly rowIssues?: readonly RowIssue[];
}

export interface ScorePolicyResponse {
  /** The FILED policy premium — `composed.final` (tail + G9 floor applied
   *  once), or the rolled subtotal when the plan has no tail. `null` when
   *  any location REFUSES (the policy is unrateable — Law 2, never a
   *  partial roll-up). */
  readonly premium: number | null;
  readonly tier: string | null;
  readonly row_status: "ok" | "error";
  /** G4 build-up (rolled subtotal → tail steps → final). */
  readonly composed?: {
    readonly subtotal: number;
    readonly final: number;
    readonly adjustments: readonly unknown[];
  };
  readonly locations: readonly PolicyLocationResult[];
  readonly location_count: number;
  readonly planIssues?: readonly ProjectionIssue[];
  /** Policy-level refusals (Law 2 — e.g. `composition_failed` when a
   *  tail meets a total-less multi-coverage plan). */
  readonly rowIssues?: readonly RowIssue[];
  readonly as_of: string;
}

export async function scorePolicy(
  req: ScorePolicyRequest,
  deps: PlanBundleDeps = {},
): Promise<ScorePolicyResponse> {
  const registry = ensureEngineReady();
  const bundle = await resolvePlanBundle(req, deps);
  const runOptions = toRunOptions(req.options);

  let compiled;
  try {
    compiled = compilePlan(bundle.plan, registry);
  } catch (err) {
    if (err instanceof PlanCompileError) {
      throw badRequest(`Plan failed to compile: ${err.message}`, err.errors);
    }
    throw err;
  }

  // Rate each location once — for the per-location breakdown + the premium
  // field (the composition re-rates internally; the engine is pure, so the
  // two passes agree byte-for-byte).
  const perLoc = runPlanBatch(compiled, req.locations, runOptions);
  const planPremium = resolvePlanPremiumContext(bundle.plan, bundle.stages);
  // A declared premium roll-up is an explicit basis; only without one do
  // the plan's own declarations drive — and a total-less multi-coverage
  // plan (legal transcription) has NO single premium field: its policy
  // premium is the dec-page sum over every coverage money output. The
  // predicate is SHARED (the book runner + the browser ask it too);
  // the field fallback stays scorePolicy's own OUTPUTS-aware resolver.
  const declaredNames = (req.rollupFields ?? []).map((f) => f.fieldName);
  const declaredBasis = declaredPremiumRollup(declaredNames);
  const totalLess = isCoverageSumBook(declaredNames, planPremium);
  const premiumField =
    declaredBasis ?? resolveComposePremiumField(bundle, perLoc[0]?.outputs ?? {});

  // Compose the ONE policy — the SAME extraction + evaluatePolicyBook the
  // grouped book runs (Law 1). Roll-up fields come from the plan's mapping
  // (so tail-GLM aggregates sum), else just the premium field.
  const rollupFields =
    (req.rollupFields?.length ?? 0) > 0
      ? req.rollupFields!.map((f) => ({
          fieldName: f.fieldName,
          reducer: f.reducer as never,
        }))
      : [];
  const base = bundle.stages
    ? policyBookConfigFromPlan(
        bundle.stages as unknown as Parameters<
          typeof policyBookConfigFromPlan
        >[0],
        rollupFields,
      )
    : { rollupFields: [] };
  const composedTail = appendPlanFloor(
    bundle.policyTail ?? [],
    bundle.stages
      ? planMinimumPremium(
          bundle.stages as unknown as Parameters<typeof planMinimumPremium>[0],
        )
      : null,
  );
  const locationsFor = (
    premiumOf: (r: (typeof perLoc)[number]) => number | null,
  ): PolicyLocationResult[] =>
    perLoc.map((r, i) => ({
      location_id: `L${i + 1}`,
      premium: r.row_status === "error" ? null : premiumOf(r),
      tier: r.eligibility_tier ?? null,
      row_status: r.row_status,
      ...(r.issues && r.issues.length > 0 ? { rowIssues: r.issues } : {}),
    }));
  const asOf = perLoc[0]?.as_of ?? req.options?.as_of ?? "";

  // Law 2 — a tail/floor composes over ONE rolled-up premium field. A
  // total-less multi-coverage plan declares none, and silently taxing
  // the last tower is the exact wrong number this refusal exists to
  // kill (scoreOne's guard, mirrored policy-side). Location premiums
  // are withheld too — the parts would reconstruct the refused number.
  if (totalLess && composedTail.length > 0) {
    return {
      premium: null,
      tier: null,
      row_status: "error",
      locations: locationsFor(() => null),
      location_count: req.locations.length,
      ...(bundle.planIssues.length > 0
        ? { planIssues: bundle.planIssues }
        : {}),
      rowIssues: [
        {
          severity: "error",
          code: "composition_failed",
          nodeId: "policy_tail",
          message:
            `The filed premium could not be composed: ` +
            `${totalLessTailRefusalMessage(planPremium.moneyFields.length)}`,
        },
      ],
      as_of: asOf,
    };
  }

  const resolveAdjustment = buildTailResolver(composedTail);
  const keyed = req.locations.map((inputs, i) => ({
    policy_id: "quote",
    location_id: `L${i + 1}`,
    inputs,
  }));
  // Roll-up fields: the mapping's declarations, PLUS whatever Law 1
  // needs on top (total-less ⇒ every coverage money output; declared
  // nothing ⇒ the basis field). The SHARED synthesis — the book runner
  // and the browser's local composition call the same function.
  const extraRollups = extraPolicyRollupFields(
    declaredNames,
    planPremium,
    premiumField,
  ).map((field) => ({ field, reducer: "sum" as const }));
  const config = {
    ...base,
    rollupFields: [...base.rollupFields, ...extraRollups],
    ...(composedTail.length > 0
      ? {
          policyTail: composedTail,
          premiumRollupField: premiumField,
          ...(req.policyInputKeys
            ? { policyInputKeys: req.policyInputKeys }
            : {}),
        }
      : {}),
  };
  const [policy] = evaluatePolicyBook(compiled, keyed, config, {
    ...runOptions,
    ...(resolveAdjustment ? { resolveAdjustment } : {}),
  });

  const rowErrors = policy?.row_errors ?? 0;
  // The rolled policy premium: the dec-page sum over every rolled
  // coverage for a total-less plan, else the single premium field.
  const rolledMap = policy?.rollup.rolled ?? {};
  const rolledValue = rolledMap[premiumField];
  const rolledPremium = totalLess
    ? sumMoneyFields(rolledMap, planPremium.moneyFields)
    : typeof rolledValue === "number"
      ? rolledValue
      : null;
  // Law 2 — a policy with ANY unrateable location is itself unrateable:
  // the roll-up is missing premiums, so the number is WITHHELD, never partial.
  const premium =
    rowErrors > 0 ? null : (policy?.composed?.final ?? rolledPremium);

  const locations = locationsFor(
    totalLess
      ? (r) => deriveViews(r, undefined, planPremium).premium
      : (r) => {
          const p = r.outputs[premiumField];
          return typeof p === "number" && Number.isFinite(p) ? p : null;
        },
  );

  return {
    premium,
    tier: policy?.appetite.tier ?? null,
    row_status: rowErrors > 0 ? "error" : "ok",
    ...(policy?.composed ? { composed: policy.composed } : {}),
    locations,
    location_count: req.locations.length,
    ...(bundle.planIssues.length > 0 ? { planIssues: bundle.planIssues } : {}),
    as_of: asOf,
  };
}
