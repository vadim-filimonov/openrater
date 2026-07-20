/**
 * scoreOne — single-risk scoring over the reused engine.
 *
 * The whole orchestration: resolve a runtime Plan (PlanSource), thread
 * options into the engine's RunOptions exactly as the conformance
 * runner does, run `executePlan` against the EXPLICIT registry, then
 * derive the premium/perCoverage/tier views. Pure over (request) — no
 * I/O, no infra. The HTTP layer and the worker both call this.
 */

import {
  compilePlan,
  evaluatePolicyBook,
  executePlan,
  makeClassLibrary,
  MODEL_SOURCE_RETIRED_MESSAGE,
  PlanCompileError,
  type AdjustmentStep,
  type ClassLibraryEntry,
  type PolicyAppetiteDecision,
  type ProjectionIssue,
  type RowIssue,
  type RunOptions,
  type TraceEntry,
} from "@openrater/contracts";
import {
  appendPlanFloor,
  planMinimumPremium,
  policyBookConfigFromPlan,
} from "@openrater/ui/InputsWorkspace/policyBookConfig";

import { ensureEngineReady } from "./engine";
import {
  resolvePlanBundle,
  type PlanBundleDeps,
  type ResolvedPlanBundle,
} from "./planSource";
import {
  deriveViews,
  isTotalLessMultiCoverage,
  resolvePlanPremiumContext,
  totalLessTailRefusalMessage,
  type ScoreViews,
} from "./derive";
import { preflightInputs, type InputsPreflight } from "./inputsPreflight";
import { buildTailResolver } from "./tailResolver";
import { badRequest } from "./errors";
import type { ScoreRequest, ScoreTraceMode } from "./schema";

/** The retired gate model refs a legacy plan still pins (an
 *  `eligibility.gate` stage whose `variable_sources` carry
 *  `{from:"model"}`). Structural — mirrors the old contracts-side
 *  extraction, kept here only to refuse by name (S1). */
function collectLegacyGateModelRefs(
  stages: readonly { stage_kind?: string; config_json?: unknown }[],
): string[] {
  const refs: string[] = [];
  for (const stage of stages) {
    if (stage.stage_kind !== "eligibility.gate") continue;
    const config = stage.config_json as
      | { variable_sources?: unknown; params?: { variable_sources?: unknown } }
      | null;
    const sources = config?.variable_sources ?? config?.params?.variable_sources;
    if (!sources || typeof sources !== "object") continue;
    for (const spec of Object.values(sources as Record<string, unknown>)) {
      const s = spec as { from?: unknown; model_id?: unknown; version?: unknown } | null;
      if (s?.from === "model") {
        refs.push(`${String(s.model_id ?? "?")}@${String(s.version ?? "?")}`);
      }
    }
  }
  return refs;
}

export interface ScoreResponse {
  readonly outputs: Record<string, unknown>;
  readonly views: ScoreViews;
  readonly as_of: string;
  readonly durationMs: number;
  readonly trace?: Record<string, TraceEntry>;
  /** ADR-0056 — the row's rating verdict (error ≠ decline ≠ $0). */
  readonly row_status: "ok" | "error";
  /** ADR-0056 — structured per-row issues (unknown key, withheld output). */
  readonly rowIssues?: readonly RowIssue[];
  /** ADR-0056 — structured projection issues (stages/plan_id sources). */
  readonly planIssues?: readonly ProjectionIssue[];
  /** G5 — named missing/unknown request fields vs the plan's consumed inputs. */
  readonly inputIssues?: InputsPreflight;
  /** G4 — the FILED premium build-up: rolled subtotal → tail steps →
   *  final. Present when the plan composes (a frozen tail, policy
   *  gates, or an authored floor). `views.premium` equals `final`. */
  readonly composed?: {
    readonly subtotal: number;
    readonly final: number;
    readonly adjustments: readonly AdjustmentStep[];
  };
  /** G4 — the policy-scope appetite verdict (row + policy precedence). */
  readonly appetite?: PolicyAppetiteDecision;
}

/** The option shape both /score and the batch JobSpec carry. (Loose
 *  optionals to accept the zod-inferred `T | undefined` under
 *  exactOptionalPropertyTypes.) */
export interface ScoreOptionsInput {
  readonly as_of?: string | undefined;
  readonly classLibraryEntries?: readonly unknown[] | undefined;
}

/**
 * Map the wire `options` onto the engine's RunOptions. Spread-
 * conditional because `exactOptionalPropertyTypes` forbids setting a
 * key to `undefined`. Mirrors the conformance runner's `optionsFor()`
 * so the server resolves time/class-library identically to the suite.
 */
export function toRunOptions(options: ScoreOptionsInput | undefined): RunOptions {
  return {
    ...(options?.as_of ? { as_of: options.as_of } : {}),
    ...(options?.classLibraryEntries
      ? {
          classLibrary: makeClassLibrary(
            options.classLibraryEntries as unknown as ClassLibraryEntry[],
          ),
        }
      : {}),
  };
}

/** Trim the trace per the caller's mode; "none" omits it entirely. */
export function projectTrace(
  trace: Record<string, TraceEntry>,
  mode: ScoreTraceMode,
): Record<string, TraceEntry> | undefined {
  if (mode === "none") return undefined;
  if (mode === "full") return trace;
  // "summary" — keep the explanation + outputs (what the actuary reads),
  // drop the verbose per-node inputs to keep responses small.
  const summarized: Record<string, TraceEntry> = {};
  for (const [id, entry] of Object.entries(trace)) {
    summarized[id] = {
      kindId: entry.kindId,
      inputs: {},
      outputs: entry.outputs,
      ...(entry.citation ? { citation: entry.citation } : {}),
      ...(entry.explanation ? { explanation: entry.explanation } : {}),
      ...(entry.error ? { error: entry.error } : {}),
    };
  }
  return summarized;
}

export async function scoreOne(
  req: ScoreRequest,
  deps: PlanBundleDeps = {},
): Promise<ScoreResponse> {
  const registry = ensureEngineReady();
  const bundle: ResolvedPlanBundle = await resolvePlanBundle(req, deps);
  const runOptions = toRunOptions(req.options);

  // The gate `{from:"model"}` seam (Brief 87 P5) was retired with the
  // model registry. A plan whose eligibility gate
  // still pins a model refuses BY NAME before anything runs — never a
  // silent pass on a variable the model would have scored (Law 2). The
  // migration is the same as the tail's: land the score as a typed
  // input and let the gate read it like any other variable.
  const inputs: Record<string, unknown> = { ...req.inputs };
  const legacyGateRefs = collectLegacyGateModelRefs(bundle.stages ?? []);
  if (legacyGateRefs.length > 0) {
    throw badRequest(
      `This plan's eligibility gate pins model source(s) ` +
        `[${legacyGateRefs.join(", ")}] — ${MODEL_SOURCE_RETIRED_MESSAGE}`,
    );
  }

  // G5 — name what the caller got wrong BEFORE running. Not a 4xx:
  // the engine refuses honestly per row (G8 — row_status "error",
  // premium withheld), so a missing field can never score a plausible
  // number; this simply tells the caller WHICH fields to fix. The P4
  // quote endpoint layers the strict 4xx contract on top.
  const inputIssues = preflightInputs(bundle.plan, inputs);
  const hasInputIssues =
    inputIssues.missing_inputs.length > 0 ||
    inputIssues.unknown_inputs.length > 0;

  let result;
  try {
    result = executePlan(bundle.plan, inputs, runOptions, registry);
  } catch (err) {
    if (err instanceof PlanCompileError) {
      throw badRequest(`Plan failed to compile: ${err.message}`, err.errors);
    }
    throw err;
  }

  // ── G4 — compose the FILED premium (tail + policy gates + G9 floor)
  // when the plan carries any of them. One code path: the SAME config
  // extraction + evaluatePolicyBook the browser's grouped book uses.
  // The engine is pure, so the composition's internal re-run is
  // byte-identical to `result` above (single-risk cost: ~ms).
  const baseConfig = bundle.stages
    ? policyBookConfigFromPlan(bundle.stages, [])
    : { rollupFields: [] };
  const composedTail = appendPlanFloor(
    bundle.policyTail ?? [],
    bundle.stages ? planMinimumPremium(bundle.stages) : null,
  );
  const shouldCompose =
    result.row_status !== "error" &&
    (composedTail.length > 0 || (baseConfig.policyGates?.length ?? 0) > 0);

  const planPremium = resolvePlanPremiumContext(bundle.plan, bundle.stages);

  let composed: ScoreResponse["composed"];
  let appetite: PolicyAppetiteDecision | undefined;
  let compositionFailure: string | null = null;
  if (
    shouldCompose &&
    composedTail.length > 0 &&
    isTotalLessMultiCoverage(planPremium)
  ) {
    // Law 2 — a tail/floor does money math over ONE rolled-up premium
    // field. A total-less multi-coverage plan declares none, and
    // silently taxing the last tower is the exact wrong number this
    // refusal exists to kill. (Gate-only composition proceeds below —
    // appetite is a verdict, not money.)
    compositionFailure = totalLessTailRefusalMessage(
      planPremium.moneyFields.length,
    );
  } else if (shouldCompose) {
    const premiumField = resolveComposePremiumField(bundle, result.outputs);
    try {
      const resolveAdjustment = buildTailResolver(composedTail);
      const compiled = compilePlan(bundle.plan, registry);
      const [policy] = evaluatePolicyBook(
        compiled,
        [{ policy_id: "quote", location_id: "L1", inputs }],
        {
          ...baseConfig,
          rollupFields: [{ field: premiumField, reducer: "sum" }],
          ...(composedTail.length > 0
            ? {
                policyTail: composedTail,
                premiumRollupField: premiumField,
              }
            : {}),
        },
        {
          ...runOptions,
          ...(resolveAdjustment ? { resolveAdjustment } : {}),
        },
      );
      if (policy?.composed) {
        composed = policy.composed;
      }
      if (policy?.appetite) {
        appetite = policy.appetite;
      }
    } catch (err) {
      // Law 2 — a plan that composes but CAN'T is a named refusal.
      // Serving the pre-tail number as THE premium would be the exact
      // silent-improvise this phase exists to kill.
      compositionFailure = err instanceof Error ? err.message : String(err);
    }
  }

  const compositionIssue: RowIssue | null = compositionFailure
    ? {
        severity: "error",
        code: "composition_failed",
        nodeId: "policy_tail",
        message:
          `The filed premium could not be composed: ${compositionFailure}`,
      }
    : null;

  const trace = projectTrace(result.trace, req.trace);
  const views = deriveViews(result, req.views, planPremium);
  const rowStatus: "ok" | "error" =
    compositionIssue ? "error" : result.row_status;
  return {
    outputs: result.outputs,
    // Law 1 — when the plan composes, THE premium is composed.final
    // (the filed number), and the verdict is the policy-precedence
    // appetite tier. Pre-tail views remain for no-composition plans.
    // Law 2 / G8 — an error row (engine refusal OR failed composition)
    // carries NO money in views: premium withheld, perCoverage emptied
    // (partial chain totals would let a caller reconstruct the exact
    // number the refusal withheld; `outputs` + trace keep the partials
    // for diagnosis). deriveViews already refuses engine-error rows —
    // this re-states the invariant over the FINAL row_status.
    views:
      rowStatus === "error"
        ? //  — an error row carries no verdict either.
          { premium: null, perCoverage: {}, tier: null }
        : {
            ...views,
            ...(composed !== undefined
              ? { premium: composed.final, premiumBasis: "composed" as const }
              : {}),
            ...(appetite !== undefined ? { tier: appetite.tier } : {}),
          },
    as_of: result.as_of,
    durationMs: result.durationMs,
    ...(trace ? { trace } : {}),
    row_status: rowStatus,
    ...((result.issues && result.issues.length > 0) || compositionIssue
      ? {
          rowIssues: [
            ...(result.issues ?? []),
            ...(compositionIssue ? [compositionIssue] : []),
          ],
        }
      : {}),
    ...(bundle.planIssues.length > 0 ? { planIssues: bundle.planIssues } : {}),
    ...(hasInputIssues ? { inputIssues } : {}),
    ...(composed !== undefined ? { composed } : {}),
    ...(appetite !== undefined ? { appetite } : {}),
  };
}

/** The output field the single-risk composition rolls up: the plan's
 *  declared aggregate (name convention or the round-fed total —
 *  `resolvePlanPremiumContext`), else `total_premium` when the row
 *  produced one, else the LAST money output, else `premium`. Mirrors
 *  the browser's premium resolver precedence (v4 G1). */
export function resolveComposePremiumField(
  bundle: ResolvedPlanBundle,
  outputs: Record<string, unknown>,
): string {
  const ctx = resolvePlanPremiumContext(bundle.plan, bundle.stages);
  if (ctx.aggregateField !== null) return ctx.aggregateField;
  if (outputs["total_premium"] !== undefined) return "total_premium";
  return ctx.moneyFields[ctx.moneyFields.length - 1] ?? "premium";
}
