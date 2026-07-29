/**
 * premium-resolution — THE answer to "what does this plan call its
 * premium?", shared by every consumer (the #482/#483 follow-through).
 *
 * A filing with multiple coverage towers and NO total row is a legal
 * transcription (workbook spec — the ingest never invents a total), so
 * the projected plan has ≥2 money outputs and no aggregate. Its risk
 * premium is the dec-page SUM of the coverage premiums — a value the
 * scoring service derives (`views.premium`, basis `"coverage_sum"`),
 * NOT a column any engine output carries. Column-shaped consumers
 * (Analytics exhibits, the metric picker, CSV exports, the run
 * summary's `premium_field`) need a name for it:
 *
 *   `COVERAGE_SUM_COLUMN` — advertised by the run summary as
 *   `premium_field` when the plan declares no total, and MATERIALIZED
 *   per clean row by the batch-result builders (the value is always
 *   the service-derived `views.premium`, never re-summed client-side).
 *
 * This is deliberately NOT `plan_total_premium` (the projector's
 * plan-DECLARED total output) — a synthesized sum and a filed total
 * are different facts, and surfaces label them differently.
 *
 * ── Why the resolver lives HERE (labs-ui), not in the scoring service ──
 * It began in `services/scoring/src/core/derive.ts` (#482) while the
 * browser kept `resolvePremiumColumn`'s last-money leg — two answers to
 * one question. They drifted, and the drift shipped a wrong number: a
 * two-tower reference risk costing $267 headlined "$72" (the last
 * tower's tip) on the plan report. So the resolver is hoisted to the
 * LOWER layer that both sides already share — the scoring service
 * deep-imports this module (same seam as `snapshot-plan`), and the
 * browser surfaces import it directly. `derive.ts` re-exports it, so
 * its consumers are unchanged. One question, one authority.
 *
 * Pure module: no window, no React, no `@openrater/contracts` — safe for
 * both the browser bundle and the Node service.
 */

/** The synthesized premium column for total-less multi-coverage plans:
 *  the dec-page sum of the coverage money outputs. */
export const COVERAGE_SUM_COLUMN = "coverage_sum_premium" as const;

/** Human label for the synthesized column (metric picker + exhibits). */
export const COVERAGE_SUM_COLUMN_LABEL = "All coverages (sum)" as const;

/** What the plan itself declares about premiums — feeds the
 *  plan-declared legs of the premium view. */
export interface PlanPremiumContext {
  /** The plan's total output field, or null when the plan declares
   *  none (the legal total-less transcription). */
  readonly aggregateField: string | null;
  /** Every money-typed output field, in node order. */
  readonly moneyFields: readonly string[];
}

/** The projected runtime plan, narrowed to the output nodes this
 *  module reads. */
export interface PremiumPlanLike {
  readonly nodes?: readonly {
    readonly id: string;
    readonly kind: string;
    readonly params?: unknown;
  }[];
}

/** The authored-stage shape carried alongside the projected plan
 *  (null for raw `source:"plan"` requests). Structurally satisfied by
 *  every labs-ui stage shape (`StageLike`, `InputStageLike`, the
 *  api-client's `StageSummary`) — they all carry these two fields. */
export interface PremiumStageLike {
  readonly stage_kind: string;
  readonly config_json?: unknown;
}

function stageConfig(stage: PremiumStageLike): Record<string, unknown> {
  const cfg = stage.config_json;
  if (cfg !== null && typeof cfg === "object") {
    return cfg as Record<string, unknown>;
  }
  if (typeof cfg === "string") {
    try {
      const parsed: unknown = JSON.parse(cfg);
      if (parsed !== null && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* opaque config — treated as empty */
    }
  }
  return {};
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Read the plan's own premium declarations. The aggregate is found by
 * the v4 G1 name convention (`total_premium` / `final_premium`), else
 * from the authored STAGES: a `round` stage is the ADR-0044 D8
 * plan-tail total-rounder, and its `output_field` names the plan total
 * whatever the workbook called it. No round stage and no conventional
 * name ⇒ the plan declares no total.
 *
 * ⭐ STAGES — not the projected graph — are the authority. Exposure-rated
 * towers (ADR-0044 D3, `apply_exposure` + divisor) carry per-tip ISO
 * `round` NODES (rate→3 dp, premium→nearest $), so "a money output fed
 * by a round node" does NOT mean aggregate; a graph-side detector
 * crowns the LAST TOWER. Per-coverage rounding is a refused construct
 * (registry r2), so a `round` STAGE is unambiguously the plan total.
 * Callers WITHOUT stages (raw `source:"plan"`) get the name-convention
 * leg only — a custom-named round total is then indistinguishable from
 * a tower, and summing would double-count.
 */
export function resolvePlanPremiumContext(
  plan: PremiumPlanLike,
  stages?: readonly PremiumStageLike[] | null,
): PlanPremiumContext {
  const nodes = plan.nodes ?? [];
  const moneyFields: string[] = [];
  let namedAggregate: string | null = null;
  for (const n of nodes) {
    if (n.kind !== "output") continue;
    const params = n.params as
      | { fieldName?: string; fieldType?: string }
      | undefined;
    const fieldName = params?.fieldName;
    if (typeof fieldName !== "string" || fieldName === "") continue;
    if (
      namedAggregate === null &&
      (fieldName === "total_premium" || fieldName === "final_premium")
    ) {
      namedAggregate = fieldName;
    }
    if (params?.fieldType === "money") {
      moneyFields.push(fieldName);
    }
  }
  if (namedAggregate !== null) {
    return { aggregateField: namedAggregate, moneyFields };
  }
  for (const stage of stages ?? []) {
    if (stage.stage_kind !== "round") continue;
    const raw = stageConfig(stage)["output_field"];
    const field =
      typeof raw === "string" && raw.trim() !== ""
        ? raw.trim()
        : "total_premium";
    return { aggregateField: field, moneyFields };
  }
  return { aggregateField: null, moneyFields };
}

/** True when the plan is the legal total-less multi-coverage
 *  transcription: ≥2 money outputs and no declared total. */
export function isTotalLessMultiCoverage(ctx: PlanPremiumContext): boolean {
  return ctx.aggregateField === null && ctx.moneyFields.length > 1;
}

/** The dec-page sum over the given money fields — finite parts only,
 *  `null` when none resolve. The ONE summing rule every seam shares
 *  (deriveViews' coverage_sum leg, /score-policy's rolled sum, the
 *  book summary's policy premiums, the report walk, the rate card). */
export function sumMoneyFields(
  values: Readonly<Record<string, unknown>>,
  moneyFields: readonly string[],
): number | null {
  const parts = moneyFields
    .map((f) => asFiniteNumber(values[f]))
    .filter((v): v is number => v !== null);
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0);
}

// ── The book's premium basis ────────────────────────────────────────
// Everything above answers "what does this PLAN call its premium?".
// A grouped BOOK adds one more fact: the mapping's own `rollup_fields`.
// The four below are that seam, and they are shared for the same
// reason the resolver above is — the browser composes policies LOCALLY
// (`policyRollupResults`) while the service composes them again in
// `bookRun`/`scorePolicy`. Three answers to one question is how a
// total-less book came to roll one tower on the server and headline a
// TIV column in the browser. One question, one authority.

/** The legacy pre-G1 convention, still the floor when a caller has no
 *  plan context at all. */
const LEGACY_TOTAL_PREMIUM_FIELD = "total_premium";

/** A roll-up field NAMED like a premium is the author's explicit basis
 *  — the one declaration that overrides the plan's own answer. */
export function declaredPremiumRollup(
  declaredFieldNames: readonly string[],
): string | null {
  return declaredFieldNames.find((f) => /premium/i.test(f)) ?? null;
}

/**
 * True when a policy's premium is the dec-page SUM over the coverage
 * money outputs: the plan is the legal total-less multi-coverage
 * transcription AND the mapping declares no premium-named roll-up.
 *
 * ⭐ The declared leg is why the AUTHORING side must never volunteer a
 * premium-named roll-up for a total-less plan. `resolvePremiumColumn`'s
 * last-money leg names the LAST tower (`contents_premium`), and a
 * config carrying it reads here as "the author chose contents" — the
 * sum is skipped and every policy files one coverage of its dec page.
 */
export function isCoverageSumBook(
  declaredFieldNames: readonly string[],
  planPremium: PlanPremiumContext,
): boolean {
  return (
    declaredPremiumRollup(declaredFieldNames) === null &&
    isTotalLessMultiCoverage(planPremium)
  );
}

/**
 * The field the composition rolls up and the summary advertises as
 * `premium_field`: the declared basis, else the plan's own answer (the
 * aggregate whatever the workbook called it · the lone money output ·
 * the synthesized `COVERAGE_SUM_COLUMN` for the total-less
 * transcription), else the legacy convention.
 */
export function premiumBasisField(
  declaredFieldNames: readonly string[],
  planPremium?: PlanPremiumContext | null,
): string {
  const declared = declaredPremiumRollup(declaredFieldNames);
  if (declared !== null) return declared;
  if (planPremium) {
    if (planPremium.aggregateField !== null) return planPremium.aggregateField;
    if (planPremium.moneyFields.length === 1) return planPremium.moneyFields[0]!;
    if (planPremium.moneyFields.length > 1) return COVERAGE_SUM_COLUMN;
  }
  return LEGACY_TOTAL_PREMIUM_FIELD;
}

/**
 * Law 1 — the roll-up fields a policy composition needs ON TOP of the
 * mapping's declarations: every coverage money output when the premium
 * is the dec-page sum (nothing else would roll them), else — when the
 * mapping declared nothing at all — the basis field, so the subtotal
 * resolves. Returns field names; each rolls with `sum`.
 */
export function extraPolicyRollupFields(
  declaredFieldNames: readonly string[],
  planPremium: PlanPremiumContext,
  premiumField: string,
): readonly string[] {
  if (isCoverageSumBook(declaredFieldNames, planPremium)) {
    return planPremium.moneyFields.filter(
      (f) => !declaredFieldNames.includes(f),
    );
  }
  if (declaredFieldNames.length === 0) return [premiumField];
  return [];
}

/**
 * A policy's premium read off its ROLLED aggregates: the dec-page sum
 * over every coverage when the book is coverage-sum, else the single
 * rolled basis field. Callers own the precedence ABOVE this read (an
 * error policy carries none; a composed tail wins — ADR-0056).
 */
export function rolledPolicyPremium(
  rolled: Readonly<Record<string, unknown>>,
  planPremium: PlanPremiumContext,
  declaredFieldNames: readonly string[],
): number | null {
  if (isCoverageSumBook(declaredFieldNames, planPremium)) {
    return sumMoneyFields(rolled, planPremium.moneyFields);
  }
  return asFiniteNumber(rolled[premiumBasisField(declaredFieldNames, planPremium)]);
}

/** The Law-2 refusal every composing seam names when a policy tail /
 *  minimum meets a total-less multi-coverage plan: a tail does money
 *  math over ONE rolled-up field, the plan declares none, and silently
 *  taxing the last tower is the exact wrong number the refusal kills. */
export function totalLessTailRefusalMessage(coverageCount: number): string {
  return (
    `this plan prices ${coverageCount} coverages but ` +
    `declares no total output for the tail/minimum to apply to — add ` +
    `the plan's total (a final-adjustments round) or remove the tail.`
  );
}
