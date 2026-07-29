/**
 * composePolicy — run N product Plans against one risk, sum them, then
 * apply the ordered post-aggregation tail (ADR-0034 §2 + ADR-0042).
 *
 * A `Plan` is one product's algorithm; a `Policy` is the customer's
 * order. This is the composer that turns the order into a number: it runs
 * each referenced Plan, reads each line's declared premium output, sums
 * them to a `subtotal`, then walks the policy's ordered
 * `adjustments[]` — schedule rating (IRPM) → package mods → endorsements
 * → minimum premium — recording every step in the trace.
 *
 * ── GENERICITY / SOURCE-BLIND (ADR-0033 §0 / ADR-0042 D2) ──
 *
 * This function contains NO product literal and NO product branch. It
 * also never branches on an adjustment's `source.from` beyond "is it a
 * `literal`?": a literal IRPM is read inline; every other source
 * (column/model/connector) is resolved by the injected
 * `resolveAdjustment` callback, exactly as each line's inputs arrive via
 * the injected `resolve`. A model-sourced and a connector-sourced IRPM
 * flow through the identical code path. The typed `switch (adj.kind)` is
 * dispatch over a closed union, not a business branch.
 *
 * ── BACK-COMPAT (ADR-0034) ──
 *
 * A policy that authors no `adjustments[]` synthesizes the legacy
 * two-step tail (`package_credit` → `minimum_premium`), so there is
 * exactly ONE evaluation path and every existing policy + conformance
 * vector composes byte-identically. The legacy scalar `PolicyResult`
 * fields are derived from the pipeline.
 *
 * Purity: the composer does NO I/O and NO compilation. The CALLER
 * fetches + compiles each Plan (pinned by `plan_ref.content_hash`),
 * supplies the per-line `externalInputs` slice via `resolve`, and
 * resolves any non-literal adjustment value via `resolveAdjustment`. This
 * keeps the composer pure + deterministic (engine-contract §6) and usable
 * from the browser, the batch runner, and a portable conformance vector
 * alike.
 *
 * Pure. No React, no DOM. See
 * `docs/adr/0034-policy-account-composition.md` +
 * `docs/adr/0042-policy-adjustments-and-irpm-resolver.md`.
 */

import type { CompiledPlan, RunOptions } from "./plan-types";
import type {
  Policy,
  PolicyLine,
  PolicyLineResult,
  PolicyResult,
} from "./policy-types";
import type {
  AdjustmentKind,
  AdjustmentProvenance,
  AdjustmentStep,
  GuardExpr,
  IrpmSourceSpec,
  PolicyAdjustment,
} from "./policy-adjustments";
import { evaluateEligibilityComparator } from "./tier-types";
import { runPlan } from "./runtime";

/**
 * What `resolve` must return for one policy line: the compiled Plan
 * (pinned by the line's `content_hash`) and the externalInputs row to
 * run it against. The caller owns fetch + compile + per-line risk
 * projection; the composer only runs + sums.
 */
export interface ResolvedPolicyLine {
  readonly compiled: CompiledPlan;
  readonly externalInputs: Record<string, unknown>;
}

/**
 * The value a non-literal adjustment source resolves to (ADR-0042 D2).
 * The injected `resolveAdjustment` turns a `column`/`model`/`connector`
 * source into one of these; the composer applies it without ever
 * learning which source produced it.
 *   - `factor` — an IRPM-style net percentage (e.g. `net: -7` for −7%),
 *     optionally with the sub-section breakdown (D2). Used by
 *     `schedule_rating`.
 *   - `flat`   — a resolved dollar amount (e.g. a terrorism charge
 *     derived from coverage limits). Used by a sourced flat endorsement.
 */
export type ResolvedAdjustmentValue =
  | {
      readonly kind: "factor";
      readonly net: number;
      readonly sections?: Readonly<Record<string, number>>;
      readonly provenance: AdjustmentProvenance;
    }
  | {
      readonly kind: "flat";
      readonly amount: number;
      readonly provenance: AdjustmentProvenance;
    };

/**
 * Injected by the CALLER (62.2+) to resolve a non-literal adjustment
 * source. 62.1 ships the built-in `literal` resolution inline; any other
 * `source.from` requires this callback or the composer throws (Validate
 * early — a misconfigured source fails loudly, never silently defaults).
 */
export type AdjustmentResolver = (
  adj: PolicyAdjustment,
  ctx: {
    readonly externalInputs: Record<string, unknown>;
    readonly lines: readonly PolicyLineResult[];
  },
) => ResolvedAdjustmentValue;

/** Options for `composePolicy`: the line `RunOptions` plus the adjustment
 *  resolver + the policy-level inputs guards/resolvers read. */
export type ComposePolicyOptions = RunOptions & {
  readonly resolveAdjustment?: AdjustmentResolver;
  /** Policy-level inputs read by `when` guards + non-literal resolvers
   *  (e.g. `is_first_term`, `years_in_business`). */
  readonly adjustmentInputs?: Record<string, unknown>;
};

/**
 * Compose a policy total from its product Plans + its ordered tail.
 *
 * @param policy   The policy: lines (Plan refs + declared premium
 *                 outputs) and either `adjustments[]` (Brief 62.1) or the
 *                 legacy `package_credit` / `minimum_premium`.
 * @param resolve  Caller-supplied: maps each line to its compiled Plan +
 *                 externalInputs slice. Called once per line.
 * @param options  Optional `RunOptions` forwarded to every line's
 *                 `runPlan` (notably `as_of`), plus `resolveAdjustment`
 *                 (for non-literal sources) and `adjustmentInputs` (the
 *                 policy-level inputs guards read).
 *
 * @returns PolicyResult with the full build-up: `subtotal` (Σ line
 *   premiums), the ordered `adjustments[]` trace, the derived legacy
 *   scalar fields, and `total` (the running total after the last step).
 *
 * @throws if a line's `premium_output` does not resolve to a finite
 *   number, or a non-literal adjustment source has no `resolveAdjustment`.
 */
export function composePolicy(
  policy: Policy,
  resolve: (line: PolicyLine) => ResolvedPolicyLine,
  options?: ComposePolicyOptions,
): PolicyResult {
  const { resolveAdjustment, adjustmentInputs = {}, ...runOptions } =
    options ?? {};

  const lines: PolicyLineResult[] = policy.lines.map((line) => {
    const { compiled, externalInputs } = resolve(line);
    const result = runPlan(compiled, externalInputs, runOptions);
    const premium = coercePremium(
      result.outputs[line.premium_output],
      policy.policy_id,
      line,
    );
    return {
      product: line.plan_ref.product,
      plan_id: line.plan_ref.plan_id,
      outputs: result.outputs,
      premium,
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.premium, 0);

  // ONE evaluation path: an authored tail, or the synthesized legacy tail.
  const adjustments = normalizeAdjustments(policy);
  const tail = evaluatePolicyTail(
    subtotal,
    adjustments,
    { externalInputs: adjustmentInputs, lines },
    resolveAdjustment,
  );

  // Legacy fields (ADR-0034). `after_credit` keeps its historical meaning
  // (subtotal × the package credit); it equals `total` only when there are
  // no schedule_rating / endorsement steps — documented on the type.
  const after_credit = subtotal * tail.package_credit;

  return {
    policy_id: policy.policy_id,
    lines,
    subtotal,
    package_credit: tail.package_credit,
    after_credit,
    minimum_premium: tail.minimum_premium,
    minimum_applied: tail.minimum_applied,
    total: tail.total,
    adjustments: tail.adjustments,
  };
}

/** The post-aggregation tail result: the running total after the ordered
 *  adjustments, the per-step trace, and the derived legacy scalars. */
export interface PolicyTailResult {
  readonly total: number;
  readonly adjustments: readonly AdjustmentStep[];
  readonly package_credit: number;
  readonly minimum_premium: number;
  readonly minimum_applied: boolean;
}

/**
 * Evaluate the ordered post-aggregation tail against an already-computed
 * `subtotal` (Brief 62.3) — the pure core extracted from `composePolicy`
 * so the cohort-scoring path can apply a plan's tail to a row's aggregated
 * premium WITHOUT re-running the plan. `composePolicy` calls it after
 * summing its lines; behavior is byte-identical to the prior inline loop.
 *
 * Per adjustment, in order, threading `running` from `subtotal`: evaluate
 * the `when` guard (a miss is a visible no-op), resolve the value (a
 * `literal` inline; any other source via the injected `resolveAdjustment`
 * or throw — Validate-early), apply per kind (schedule_rating caps on the
 * section sum; package_factor ×; endorsement +/×; minimum_premium max),
 * and record the `AdjustmentStep`. Pure + source-blind + product-blind.
 */
export function evaluatePolicyTail(
  subtotal: number,
  adjustments: readonly PolicyAdjustment[],
  ctx: {
    readonly externalInputs: Record<string, unknown>;
    readonly lines: readonly PolicyLineResult[];
  },
  resolveAdjustment?: AdjustmentResolver,
): PolicyTailResult {
  let running = subtotal;
  const steps: AdjustmentStep[] = [];
  // Derived legacy fields, accumulated as the pipeline runs.
  let packageCredit = 1;
  let minimumPremium = 0;
  let minimumApplied = false;

  for (const adj of adjustments) {
    const before = running;

    // 1. Guard (package_factor / endorsement). A miss is a VISIBLE no-op.
    const guard = "when" in adj ? adj.when : undefined;
    if (guard && !guardMatches(guard, ctx.externalInputs)) {
      const neutral =
        adj.kind === "endorsement" && adj.effect.kind === "flat" ? 0 : 1;
      steps.push(
        makeStep(
          {
            id: adj.id,
            kind: adj.kind,
            applied: false,
            before,
            factor_or_delta: neutral,
            after: before,
            detail: `not applied — guard ${describeGuard(guard)} not met`,
          },
          { citation: adj.citation },
        ),
      );
      continue;
    }

    // 2 + 3. Resolve + apply, per kind (typed dispatch, never a product
    //        or source business branch).
    switch (adj.kind) {
      case "schedule_rating": {
        const resolved = resolveSourceValue(
          adj,
          adj.source,
          ctx,
          resolveAdjustment,
        );
        if (resolved.kind !== "factor") {
          throw new Error(
            `composePolicy: schedule_rating "${adj.id}" resolved to a ` +
              `${resolved.kind} value (expected a factor/net percentage).`,
          );
        }
        // Cap is applied to the SUM of sub-sections (D2/D5).
        const cappedNet = clamp(resolved.net, -adj.cap_pct, adj.cap_pct);
        const factor = 1 + cappedNet / 100;
        running = before * factor;
        steps.push(
          makeStep(
            {
              id: adj.id,
              kind: adj.kind,
              applied: true,
              before,
              factor_or_delta: factor,
              after: running,
              detail: scheduleDetail(cappedNet, resolved.sections, adj.cap_pct),
            },
            {
              sections: resolved.sections,
              provenance: resolved.provenance,
              citation: adj.citation,
            },
          ),
        );
        break;
      }
      case "package_factor": {
        running = before * adj.factor;
        packageCredit *= adj.factor;
        steps.push(
          makeStep(
            {
              id: adj.id,
              kind: adj.kind,
              applied: true,
              before,
              factor_or_delta: adj.factor,
              after: running,
              detail: `× ${adj.factor}`,
            },
            { citation: adj.citation },
          ),
        );
        break;
      }
      case "endorsement": {
        if (adj.effect.kind === "flat") {
          let amount = adj.effect.amount;
          let provenance: AdjustmentProvenance | undefined;
          if (adj.source) {
            const resolved = resolveSourceValue(
              adj,
              adj.source,
              ctx,
              resolveAdjustment,
            );
            if (resolved.kind !== "flat") {
              throw new Error(
                `composePolicy: flat endorsement "${adj.id}" resolved to a ` +
                  `${resolved.kind} value (expected a flat amount).`,
              );
            }
            amount = resolved.amount;
            provenance = resolved.provenance;
          }
          running = before + amount;
          steps.push(
            makeStep(
              {
                id: adj.id,
                kind: adj.kind,
                applied: true,
                before,
                factor_or_delta: amount,
                after: running,
                detail: `+ ${formatDollars(amount)}`,
              },
              { provenance, citation: adj.citation },
            ),
          );
        } else {
          const factor = adj.effect.factor;
          running = before * factor;
          steps.push(
            makeStep(
              {
                id: adj.id,
                kind: adj.kind,
                applied: true,
                before,
                factor_or_delta: factor,
                after: running,
                detail: `× ${factor}`,
              },
              { citation: adj.citation },
            ),
          );
        }
        break;
      }
      case "minimum_premium": {
        const bound = before < adj.floor;
        running = bound ? adj.floor : before;
        minimumPremium = adj.floor;
        minimumApplied = bound;
        steps.push(
          makeStep(
            {
              id: adj.id,
              kind: adj.kind,
              applied: bound,
              before,
              factor_or_delta: running - before,
              after: running,
              detail: bound
                ? `floored at ${formatDollars(adj.floor)}`
                : `floor ${formatDollars(adj.floor)} not binding`,
            },
            { citation: adj.citation },
          ),
        );
        break;
      }
    }
  }

  return {
    total: running,
    adjustments: steps,
    package_credit: packageCredit,
    minimum_premium: minimumPremium,
    minimum_applied: minimumApplied,
  };
}

/**
 * One evaluation path: use the authored `adjustments[]`, or synthesize
 * the legacy two-step tail (ADR-0034) so a no-`adjustments` policy runs
 * the SAME two steps in the SAME order as before.
 */
function normalizeAdjustments(policy: Policy): readonly PolicyAdjustment[] {
  if (policy.adjustments) return policy.adjustments;
  return [
    {
      kind: "package_factor",
      id: "__legacy_package_credit",
      display_name: "Package credit",
      factor: policy.package_credit ?? 1,
    },
    {
      kind: "minimum_premium",
      id: "__legacy_minimum_premium",
      floor: policy.minimum_premium ?? 0,
    },
  ];
}

/**
 * Resolve an adjustment's sourced value. The `literal` source is built in
 * (62.1): its net is `total`, or the sum of `sections` (D2). Any other
 * source delegates to the injected `resolveAdjustment` — the composer
 * never branches on which non-literal source it is.
 */
function resolveSourceValue(
  adj: PolicyAdjustment,
  source: IrpmSourceSpec,
  ctx: {
    readonly externalInputs: Record<string, unknown>;
    readonly lines: readonly PolicyLineResult[];
  },
  resolveAdjustment: AdjustmentResolver | undefined,
): ResolvedAdjustmentValue {
  if (source.from === "literal") {
    const sections = source.sections;
    const net = source.total ?? (sections ? sumValues(sections) : 0);
    return {
      kind: "factor",
      net,
      ...(sections !== undefined ? { sections } : {}),
      provenance: { source: "literal" },
    };
  }
  if (!resolveAdjustment) {
    throw new Error(
      `composePolicy: adjustment "${adj.id}" uses a "${source.from}" source ` +
        `but no resolveAdjustment was provided. 62.1 builds in only ` +
        `"literal" (column → 62.2, model → 62.5, connector → 62.6).`,
    );
  }
  return resolveAdjustment(adj, ctx);
}

/**
 * Build an `AdjustmentStep`, OMITTING any undefined optional field (the
 * repo runs `exactOptionalPropertyTypes`, so `{ citation: undefined }` is
 * NOT assignable to `citation?: string`). Keeps every push site readable.
 */
function makeStep(
  base: {
    readonly id: string;
    readonly kind: AdjustmentKind;
    readonly applied: boolean;
    readonly before: number;
    readonly factor_or_delta: number;
    readonly after: number;
    readonly detail: string;
  },
  optional: {
    // Accept explicit `undefined` IN (callers forward `adj.citation` etc.);
    // the body strips them so the result honors exactOptionalPropertyTypes.
    readonly sections?: Readonly<Record<string, number>> | undefined;
    readonly provenance?: AdjustmentProvenance | undefined;
    readonly citation?: string | undefined;
  } = {},
): AdjustmentStep {
  return {
    ...base,
    ...(optional.sections !== undefined ? { sections: optional.sections } : {}),
    ...(optional.provenance !== undefined
      ? { provenance: optional.provenance }
      : {}),
    ...(optional.citation !== undefined ? { citation: optional.citation } : {}),
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function sumValues(record: Readonly<Record<string, number>>): number {
  return Object.values(record).reduce((sum, v) => sum + v, 0);
}

/** Evaluate a guard against the policy-level inputs (gate vocabulary). A
 *  missing field degrades gracefully to "doesn't match" (never throws). */
function guardMatches(
  when: GuardExpr,
  inputs: Record<string, unknown>,
): boolean {
  return evaluateEligibilityComparator(when.op, inputs[when.field], when.value);
}

function describeGuard(when: GuardExpr): string {
  return `${when.field} ${when.op} ${JSON.stringify(when.value)}`;
}

/** "−7.0% (Σ 6 sections, cap ±25%)" — the schedule-rating trace detail. */
function scheduleDetail(
  net: number,
  sections: Readonly<Record<string, number>> | undefined,
  cap_pct: number,
): string {
  const pct = `${net > 0 ? "+" : ""}${net.toFixed(1)}%`;
  const sectionNote = sections
    ? `Σ ${Object.keys(sections).length} sections, cap ±${cap_pct}%`
    : `cap ±${cap_pct}%`;
  return `${pct} (${sectionNote})`;
}

/** Whole-dollar labelling for the trace ("$500", "+$18"). */
function formatDollars(amount: number): string {
  return `$${amount}`;
}

/**
 * Coerce a Plan output to a line premium. Strict: the declared
 * `premium_output` MUST resolve to a finite number. Anything else
 * (missing field, string, NaN, Infinity) is a contract violation and
 * throws with the offending policy / plan / field named.
 */
function coercePremium(
  value: unknown,
  policyId: string,
  line: PolicyLine,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(
    `composePolicy: policy "${policyId}" line plan "${line.plan_ref.plan_id}" ` +
      `(product "${line.plan_ref.product}"): premium_output "${line.premium_output}" ` +
      `did not resolve to a finite number (got ${describe(value)}).`,
  );
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number") return `number ${value}`;
  if (typeof value === "string") return `string ${JSON.stringify(value)}`;
  return typeof value;
}
