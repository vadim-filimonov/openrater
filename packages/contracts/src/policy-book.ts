/**
 * evaluatePolicyBook — the multi-location policy pipeline (E08 + E03).
 *
 * The single pure batch function that ties the shipped primitives together in
 * the order the brief `location-rollup-and-policy-appetite.md` §3 locks:
 *
 *   1. DERIVE — compute each row's derived fields (`tiv = building + bpp`)
 *      and merge them into the row's inputs, so the per-row run + the roll-up
 *      both see them (the `derive.computed` kind's value, surfaced to
 *      externalInputs).
 *   2. RATE — run the plan once per location row (`runPlanBatch`, one `as_of`
 *      for the whole book).
 *   3. ROLL UP — group by `policy_id`, reduce declared fields (E08
 *      `rollUpBook`; `sum` default for premium + TIV).
 *   4. POLICY GATES — evaluate the policy-scope appetite rules against the
 *      policy TOTALS (E03 `evaluateAppetiteRules`). This is the post-roll-up
 *      batch phase (ADR-016) that the per-row engine deliberately does NOT run.
 *   5. PRECEDENCE — combine the per-location (row) verdicts + the policy
 *      verdict by most-restrictive-wins (E03 `decidePolicyAppetite`).
 *
 * Pure + deterministic (P-N1): no clock (the `as_of` is resolved once by
 * `runPlanBatch`), no randomness; first-seen policy order preserved. No React,
 * no DOM, no I/O. The per-row engine contract is unchanged — roll-up + policy
 * gates are a batch layer on top.
 */

import type { CompiledPlan, RunOptions } from "./plan-types";
import { coercePlanExternalInputs, runPlanBatch } from "./runtime";
import {
  rollUpBook,
  type BookRow,
  type PolicyRollup,
  type RollupField,
  type KeyedRiskRow,
} from "./policy-rollup";
import {
  evaluateComputedFields,
  evaluateAppetiteRules,
  decidePolicyAppetite,
  type ComputedField,
  type PolicyAppetiteDecision,
  type ScopedVerdict,
} from "./policy-appetite";
import { type EligibilityTier, isEligibilityTier } from "./tier-types";
import type { EligibilityRule } from "./kinds/eligibility-gate";
import { evaluatePolicyTail, type AdjustmentResolver } from "./policy-compose";
import type { PolicyAdjustment, AdjustmentStep } from "./policy-adjustments";

/** A policy-scope gate (the rules + the no-match fallback). Mirrors an
 *  `eligibility.gate` with `scope: "policy"`. */
export interface PolicyGateSpec {
  readonly rules: readonly EligibilityRule[];
  readonly default_tier: EligibilityTier;
  readonly default_reasoning: string;
}

/** How to run a book through the policy pipeline. */
export interface PolicyBookConfig {
  /** Derived fields evaluated per row + merged into its inputs before the run
   *  (so the gate + the roll-up see them). E.g. `tiv = building + bpp`. */
  readonly computedFields?: readonly ComputedField[];
  /** What rolls up to the policy + by which reducer (`sum` default seeded for
   *  premium + TIV by the caller). */
  readonly rollupFields: readonly RollupField[];
  /** Policy-scope appetite gates, evaluated against the rolled-up totals. */
  readonly policyGates?: readonly PolicyGateSpec[];
  /** The plan output that carries each row's row-scope gate tier verdict (if
   *  the plan has a row gate). Read per location for the precedence combine. */
  readonly rowVerdictOutput?: string;
  /** Optional ordered policy tail of post-aggregation adjustments
   *  (schedule rating → package modifiers →
   *  endorsements → minimum premium) applied to each policy's rolled premium
   *  subtotal, EXACTLY like `composePolicy` does for a multi-line policy. Omit
   *  ⇒ no tail composed; `PolicyBookResult.composed` stays absent and the
   *  result is byte-identical to the pre-tail behavior. */
  readonly policyTail?: readonly PolicyAdjustment[];
  /** Which rolled field is the premium subtotal the tail composes on. Resolved
   *  against `rollup.rolled` by key; defaults to `total_premium`, then
   *  `premium`. Only read when `policyTail` is non-empty. */
  readonly premiumRollupField?: string;
  /** Per-policy CONSTANT input keys lifted from the policy's FIRST location row
   *  into the tail's `externalInputs` (the `when` guards + the GLM features read
   *  these — e.g. `years_in_business`, `is_first_term`). The rolled aggregates
   *  (incl. GLM Σ features like `total_floor_area_sqft`) are always present.
   *  Only read when `policyTail` is non-empty. */
  readonly policyInputKeys?: readonly string[];
}

/** One policy's pipeline result: the rolled totals + the appetite decision. */
export interface PolicyBookResult {
  readonly policy_id: string;
  readonly rollup: PolicyRollup;
  readonly appetite: PolicyAppetiteDecision;
  /** The IRPM-composed final premium + per-step build-up — present ONLY when
   *  `config.policyTail` is non-empty AND the premium subtotal resolved to a
   *  finite number. Omitted otherwise (a no-tail book is byte-identical). */
  readonly composed?: {
    readonly final: number;
    readonly subtotal: number;
    readonly adjustments: readonly AdjustmentStep[];
  };
  /**
   * ADR-0056 — how many of this policy's location rows could NOT be
   * rated (`RunResult.row_status === "error"`). Present only when > 0
   * (pre-ADR results parse byte-identically). A policy with error rows
   * is itself unrateable: `composed` is WITHHELD (its rolled subtotal
   * is missing those locations' premiums), and consumers render the
   * error facet — never the partial rollup — as the premium. Display
   * precedence: error > decline > ok.
   */
  readonly row_errors?: number;
}

/** How to run a book through the policy pipeline: the per-line `RunOptions`
 *  plus the injected resolver the opt-in `policyTail` uses for non-literal IRPM
 *  sources (model/column/connector). Built by the caller via
 *  `makeIrpmAdjustmentResolver(modelEvaluator)`; a literal source needs none. */
export type PolicyBookOptions = RunOptions & {
  readonly resolveAdjustment?: AdjustmentResolver;
};

export function evaluatePolicyBook(
  compiled: CompiledPlan,
  rows: readonly KeyedRiskRow[],
  config: PolicyBookConfig,
  options?: PolicyBookOptions,
): readonly PolicyBookResult[] {
  const computedFields = config.computedFields ?? [];
  // Split the tail resolver off the run options so `runPlanBatch` sees only the
  // per-line `RunOptions` (the resolver is a tail concern, not a run concern).
  const { resolveAdjustment, ...runOptions } = options ?? {};

  // 0. COERCE — wire-string inputs onto their declared input ports,
  // once, before ANYTHING reads them (Phase F 2026-07-17). The batch
  // layer re-reads raw row inputs outside the engine run — the book-row
  // `values` the roll-up reduces, the per-policy constants the tail
  // lifts, the computed-field evaluation — so coercing only inside
  // `runPlan` would leave the policy-scope reads typed differently from
  // the row-scope ones, and a `"true"` sprinkler flag would carry two
  // meanings in one pipeline (the Law 2 seam the Phase F sweep found).
  const typedRows = rows.map((r) => ({
    ...r,
    inputs: coercePlanExternalInputs(compiled, r.inputs),
  }));

  // 1. DERIVE + 2. RATE — merge each row's derived fields into its inputs,
  // then run the whole book once (one resolved `as_of`).
  const merged = typedRows.map((r) => ({
    ...r,
    inputs: { ...r.inputs, ...evaluateComputedFields(computedFields, r.inputs) },
  }));
  const results = runPlanBatch(
    compiled,
    merged.map((m) => m.inputs),
    runOptions,
  );

  // 3. ROLL UP — book row values = merged inputs + run outputs (outputs win).
  const book: BookRow[] = merged.map((m, i) => ({
    policy_id: m.policy_id,
    location_id: m.location_id,
    values: { ...m.inputs, ...results[i]!.outputs },
  }));
  const rollups = rollUpBook(book, config.rollupFields);

  // Index per-location run outputs by policy for the row-verdict combine.
  const outputsByPolicy = new Map<
    string,
    {
      location_id: string;
      outputs: Readonly<Record<string, unknown>>;
      inputs: Readonly<Record<string, unknown>>;
      eligibility_tier: EligibilityTier | null;
      row_status: "ok" | "error";
    }[]
  >();
  merged.forEach((m, i) => {
    const bucket = outputsByPolicy.get(m.policy_id) ?? [];
    bucket.push({
      location_id: m.location_id,
      outputs: results[i]!.outputs,
      inputs: m.inputs,
      eligibility_tier: results[i]!.eligibility_tier ?? null,
      row_status: results[i]!.row_status,
    });
    outputsByPolicy.set(m.policy_id, bucket);
  });

  return rollups.map((rollup) => {
    const group = outputsByPolicy.get(rollup.policy_id) ?? [];

    // 4. + 5a. Per-location (row) verdicts. A plan-declared verdict output
    // (`config.rowVerdictOutput`) wins when it resolves; otherwise the row's
    // run-resolved `eligibility_tier` (Brief 55's trace resolution — multi-
    // gate most-restrictive, fired-beats-default) supplies the verdict. G11:
    // before the fallback, a book scored without bespoke `row_tier` output
    // wiring produced ZERO row verdicts, so a row-gate decline never reached
    // the policy appetite.
    const rowVerdicts: ScopedVerdict[] = group.flatMap((g) => {
      const declared = config.rowVerdictOutput
        ? g.outputs[config.rowVerdictOutput]
        : undefined;
      const t = isEligibilityTier(declared) ? declared : g.eligibility_tier;
      return isEligibilityTier(t)
        ? [
            {
              scope: "row" as const,
              location_id: g.location_id,
              tier: t,
              matched_rule_id: null,
              reasoning: "Location gate verdict.",
            },
          ]
        : [];
    });

    // 4. Policy-scope verdicts — gates evaluated against the rolled totals
    // PLUS the synthetic `location_count` aggregate. `rollUpBook` keeps
    // `location_count` as a SIBLING of `rolled` (not a rolled field), but the
    // policy field-picker offers it as an aggregate (brief §4.4) and a gate
    // like "location_count > 50 → submit" is legitimate — so it MUST be a
    // readable variable here. Otherwise `evaluateAppetiteRules` skips the
    // absent variable and the gate silently no-matches (the exact footgun
    // ADR-0046 closes). A declared roll-up field literally named
    // `location_count` still wins (the `rolled` spread comes last).
    const policyTotals: Readonly<Record<string, number>> = {
      location_count: rollup.location_count,
      ...rollup.rolled,
    };
    const policyVerdicts: ScopedVerdict[] = (config.policyGates ?? []).map(
      (gate) => ({
        scope: "policy" as const,
        ...evaluateAppetiteRules(
          gate.rules,
          gate.default_tier,
          gate.default_reasoning,
          policyTotals,
        ),
      }),
    );

    // 5b. Precedence — most-restrictive of {row, policy} verdicts.
    const appetite = decidePolicyAppetite([...rowVerdicts, ...policyVerdicts]);

    // ADR-0056 — a policy with unrateable locations is itself
    // unrateable: withhold `composed` (the rolled subtotal is missing
    // those locations' premiums — composing a tail on it would mint a
    // plausible wrong final) and surface the error count instead.
    const rowErrors = group.filter((g) => g.row_status === "error").length;

    // 6. TAIL (opt-in) — compose the authored policy tail (IRPM → loadings →
    // minimum premium) on the rolled premium subtotal, EXACTLY like
    // `composePolicy` does for a multi-line policy. `composed` is OMITTED (not
    // undefined) when no tail is configured, so a no-tail book is byte-identical.
    const composed =
      rowErrors > 0
        ? undefined
        : composePolicyTail(rollup, group, config, resolveAdjustment);

    return {
      policy_id: rollup.policy_id,
      rollup,
      appetite,
      ...(composed !== undefined ? { composed } : {}),
      ...(rowErrors > 0 ? { row_errors: rowErrors } : {}),
    };
  });
}

/**
 * Compose the optional policy tail on a policy's rolled premium subtotal.
 * Returns the composed final + per-step
 * build-up, or `undefined` when no tail is configured / the subtotal isn't a
 * finite number — so the caller omits `composed` and stays byte-stable.
 *
 * The tail's `externalInputs` is the policy's roll-up context: every rolled
 * aggregate (so a GLM IRPM's policy-Σ feature like `total_floor_area_sqft` is
 * present), the synthetic `location_count`, and the declared per-policy
 * constants (`years_in_business`, `is_first_term`) lifted from the policy's
 * first location row. The model-sourced IRPM resolves via the injected
 * `resolveAdjustment`; the math is the shared `evaluatePolicyTail` (no parallel
 * tail implementation — identical to the per-row + multi-line composer paths).
 */
function composePolicyTail(
  rollup: PolicyRollup,
  group: readonly { readonly inputs: Readonly<Record<string, unknown>> }[],
  config: PolicyBookConfig,
  resolveAdjustment: AdjustmentResolver | undefined,
): PolicyBookResult["composed"] {
  const tail = config.policyTail ?? [];
  if (tail.length === 0) return undefined;

  const premiumKey =
    config.premiumRollupField ??
    (["total_premium", "subtotal_after_chain_usd", "premium"].find(
      (k) => k in rollup.rolled,
    ) ??
      "premium");
  const subtotal = rollup.rolled[premiumKey];
  if (typeof subtotal !== "number" || !Number.isFinite(subtotal)) return undefined;

  const first = group[0]?.inputs ?? {};
  const constants: Record<string, unknown> = {};
  for (const key of config.policyInputKeys ?? []) constants[key] = first[key];

  const externalInputs: Record<string, unknown> = {
    ...rollup.rolled,
    location_count: rollup.location_count,
    ...constants,
  };
  const result = evaluatePolicyTail(
    subtotal,
    tail,
    { externalInputs, lines: [] },
    resolveAdjustment,
  );
  return { final: result.total, subtotal, adjustments: result.adjustments };
}
