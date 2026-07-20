// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * Portfolio R1 "what-if" orchestration (Brief 73 PR 73.2).
 *
 * Re-rate the stored book against a candidate snapshot, IN-BROWSER through
 * the SAME policy pipeline the book was priced with — `evaluatePolicyBook`
 * (locations rate → roll up → policy tail / IRPM / min-premium). The
 * faithful unit is POLICY grain, so a flat row re-score would misstate the
 * dislocation; this runs the full pipeline twice (baseline + candidate)
 * over the same rows + the same `as_of`; each side composes its OWN frozen
 * tail (ADR-0055 — a tail edit is part of the rate change), so the
 * dislocation isolates the rate change. The math then reuses the pure
 * 73.0/73.1 adapters (`portfolioBookToPolicyRows` + `policyBookDislocation`).
 *
 * No I/O — the caller (73.3) fetches the book + the two snapshot bodies.
 */

import type { StageSummary } from "@openrater/api-client";
import {
  compilePlan,
  evaluatePolicyBook,
  isPolicyAdjustment,
  type PolicyBookResult,
  type PolicyAdjustment,
} from "@openrater/contracts";
import {
  snapshotBodyToRuntimePlan,
  snapshotBodyInputMapping,
  snapshotBodyPolicyTail,
  portfolioBookToPolicyRows,
  policyBookDislocation,
  COVERAGE_SUM_COLUMN,
  extraPolicyRollupFields,
  isCoverageSumBook,
  premiumBasisField,
  resolvePlanPremiumContext,
  sumMoneyFields,
  totalLessTailRefusalMessage,
  type PremiumPlanLike,
  type RerateBookSubmission,
  type PolicyDislocation,
} from "@openrater/ui";
import {
  policyBookConfigFromPlan,
  planMinimumPremium,
  appendPlanFloor,
  type AuthoredRollupField,
} from "./policyBookConfig";

/** The snapshot `body` shape this reads — projected via
 *  `snapshotBodyToRuntimePlan`. The roll-up fields ride `input_mapping`
 *  and (ADR-0055) the frozen policy tail rides `policy_tail` — BOTH are
 *  serialized by the API as their ENVELOPES (`{rating_plan_id, mapping|
 *  tail, created_at, …}`), so reads go through the both-shape
 *  normalizers (`snapshotBodyInputMapping` / `snapshotBodyPolicyTail`),
 *  never raw property access. */
export interface RerateSnapshotBody {
  readonly stages?: readonly StageSummary[];
  readonly input_mapping?: unknown;
  /** The version's frozen tail (envelope or bare array; snapshots capture
   *  it since ADR-0055). Absent/null on legacy bodies frozen before. */
  readonly policy_tail?: unknown;
  readonly [k: string]: unknown;
}

export interface RunBookRerateArgs {
  readonly book: readonly RerateBookSubmission[];
  /** The currently-published version (Brief 73 L3 baseline). */
  readonly baselineBody: RerateSnapshotBody;
  /** The frozen candidate (the proposed rate change). */
  readonly candidateBody: RerateSnapshotBody;
  /** LEGACY fallback tail, used only for a side whose body predates
   *  ADR-0055 (no frozen `policy_tail`). A body's own frozen tail always
   *  wins — a changed tail IS part of the rate change, so the two sides
   *  may legitimately compose different tails. */
  readonly policyTail?: readonly PolicyAdjustment[];
  /** Rolled premium field to diff on. Default: each side's OWN resolved
   *  basis (93.4) — the mapping's declared premium roll-up, else the
   *  plan's total, else the lone money output, else the materialized
   *  `coverage_sum_premium` for total-less multi-coverage plans. */
  readonly premiumField?: string;
  /** One shared `as_of` for both sides (Brief 73 L6). */
  readonly asOf?: string;
}

export type RunBookRerateResult =
  | { readonly ok: true; readonly dislocation: PolicyDislocation }
  | { readonly ok: false; readonly reason: string };

// The per-policy CONSTANTS the GLM loadings' guards read, lifted from each
// policy's first location row (mirrors PlanDetailRoute's policy-rollup run).
const POLICY_INPUT_KEYS = ["years_in_business", "is_first_term"];

/** One side's run: the composed policies PLUS the premium basis THIS
 *  side's plan resolves (the two snapshots may legitimately differ —
 *  e.g. a candidate that adds the plan total), or a typed failure the
 *  caller phrases per side. */
export type SideRun =
  | {
      readonly ok: true;
      readonly results: readonly PolicyBookResult[];
      /** What this side's dislocation read is keyed on — the declared
       *  basis, the plan total, the lone tower, or the materialized
       *  `COVERAGE_SUM_COLUMN` for the total-less transcription. */
      readonly premiumField: string;
    }
  | { readonly ok: false; readonly failure: "no_chain" }
  | {
      readonly ok: false;
      readonly failure: "total_less_tail";
      readonly coverageCount: number;
    };

/**
 * Rate ONE side of a book — exported for the Exhibit's book mode
 * (current Exhibits design), which rates the portrait's
 * single side and the comparison's two sides through the SAME
 * projection + policy pipeline this what-if always used. `body` is a
 * snapshot body, or a body-SHAPED record composed from the live
 * substrate ({stages, dimensions, factor_tables, input_mapping,
 * policy_tail}) — the projector reads only those keys.
 */
export function rateBookSide(
  body: RerateSnapshotBody,
  book: readonly RerateBookSubmission[],
  fallbackTail: readonly PolicyAdjustment[] | undefined,
  asOf: string | undefined,
): SideRun {
  return runSide(body, portfolioBookToPolicyRows(book), fallbackTail, asOf);
}

function runSide(
  body: RerateSnapshotBody,
  keyed: ReturnType<typeof portfolioBookToPolicyRows>,
  fallbackTail: readonly PolicyAdjustment[] | undefined,
  asOf: string | undefined,
): SideRun {
  // P2 G9 — this is a POLICY-composed run: the per-row floor is
  // omitted and re-applied once per policy via the tail (below).
  const plan = snapshotBodyToRuntimePlan(body, {
    minPremiumScope: "policy",
  });
  if (!plan) return { ok: false, failure: "no_chain" }; // CT-6
  const stages = (body.stages ?? []) as readonly StageSummary[];
  // The mapping lands in the body as its API ENVELOPE — the old direct
  // `body.input_mapping?.rollup_fields` read resolved undefined on every
  // real snapshot, silently rolling up ZERO fields (v4 G15 live find).
  const mapping = snapshotBodyInputMapping(
    body as unknown as Record<string, unknown>,
  );
  const declared = (mapping?.rollup_fields ??
    []) as readonly AuthoredRollupField[];
  const declaredNames = declared.map((f) => f.fieldName);
  // 93.4 — the side's OWN premium basis, answered by the shared
  // resolver over the projected plan + the frozen stages. A total-less
  // multi-coverage plan (≥2 money outputs, no round stage) with no
  // premium-named roll-up declaration prices as the dec-page SUM.
  const planPremium = resolvePlanPremiumContext(
    plan as unknown as PremiumPlanLike,
    stages,
  );
  const coverageSum = isCoverageSumBook(declaredNames, planPremium);
  const premiumField = premiumBasisField(declaredNames, planPremium);
  // ADR-0055 — each side composes ITS OWN frozen tail (validated per
  // item), so a rate change that edits the tail shows in the dislocation.
  // Legacy bodies without a frozen tail fall back to the caller's live
  // tail (the pre-ADR behavior: same tail both sides, cancels in ratio).
  const rawTail = snapshotBodyPolicyTail(
    body as unknown as Record<string, unknown>,
  );
  const frozenTail = rawTail ? rawTail.filter(isPolicyAdjustment) : null;
  const policyTail = frozenTail ?? fallbackTail;
  // P2 G9 — the plan's authored floor lands as the terminal tail step
  // (once per policy, post-IRPM) instead of per projected row.
  const composedTail = appendPlanFloor(
    policyTail ?? [],
    planMinimumPremium(stages),
  );
  // Law 2 — a tail/floor composes over ONE rolled-up premium field; a
  // total-less plan declares none. The NAMED refusal (mirrors
  // /score-policy + grouped book runs) — never a tail silently taxing
  // the last tower across the whole book.
  if (coverageSum && composedTail.length > 0) {
    return {
      ok: false,
      failure: "total_less_tail",
      coverageCount: planPremium.moneyFields.length,
    };
  }
  // Law 1 — the mapping's declarations PLUS whatever the premium basis
  // needs on top (total-less ⇒ every coverage money output; declared
  // nothing ⇒ the basis field). The SAME shared synthesis `bookRun`,
  // `/score-policy`, and the browser's local composition call — this
  // path read `rollup_fields` raw, so a total-less book rolled only
  // its extras (e.g. `tiv`) and the dislocation compared nothing.
  const rollupFields: readonly AuthoredRollupField[] = [
    ...declared,
    ...extraPolicyRollupFields(declaredNames, planPremium, premiumField).map(
      (fieldName) => ({ fieldName, reducer: "sum" as const }),
    ),
  ];
  const base = policyBookConfigFromPlan(stages, rollupFields);
  const config =
    composedTail.length > 0
      ? {
          ...base,
          policyTail: composedTail,
          // The tail composes on the side's resolved basis — not the
          // `total_premium` → `premium` default, which a custom-named
          // plan total (round `output_field`) silently misses.
          premiumRollupField: premiumField,
          policyInputKeys: POLICY_INPUT_KEYS,
        }
      : base;
  const compiled = compilePlan(plan);
  const results = evaluatePolicyBook(
    compiled,
    keyed,
    config,
    asOf ? { as_of: asOf } : undefined,
  );
  if (!coverageSum) return { ok: true, results, premiumField };
  // Materialize the dec-page sum onto each policy under the name every
  // surface knows it by (COVERAGE_SUM_COLUMN — the same move
  // PlanDetailRoute's local composition makes), so the dislocation's
  // rolled-field read finds a real premium.
  const withSum = results.map((p) => {
    const sum = sumMoneyFields(p.rollup.rolled, planPremium.moneyFields);
    if (sum === null) return p;
    return {
      ...p,
      rollup: {
        ...p.rollup,
        rolled: { ...p.rollup.rolled, [COVERAGE_SUM_COLUMN]: sum },
      },
    };
  });
  return { ok: true, results: withSum, premiumField };
}

/** Phrase a side's typed failure in the surface's calm-block voice. */
function sideReason(
  side: "baseline" | "candidate",
  run: Extract<SideRun, { ok: false }>,
): string {
  const label =
    side === "baseline"
      ? "The published baseline snapshot"
      : "This candidate snapshot";
  if (run.failure === "no_chain") {
    return `${label} has no runnable rating chain.`;
  }
  return `${label} cannot compose a filed premium: ${totalLessTailRefusalMessage(
    run.coverageCount,
  )}`;
}

/**
 * Re-rate the book against a candidate snapshot vs the baseline. Returns a
 * plain-language reason rather than throwing when the book is empty, a
 * snapshot has no runnable rating chain (CT-6), or a policy tail meets a
 * total-less plan (Law 2) — the caller surfaces it as a calm block, never
 * an empty/lying chart.
 */
export function runBookRerate(args: RunBookRerateArgs): RunBookRerateResult {
  const keyed = portfolioBookToPolicyRows(args.book);
  if (keyed.length === 0) {
    return { ok: false, reason: "No bound submissions to re-rate." };
  }
  const baseline = runSide(args.baselineBody, keyed, args.policyTail, args.asOf);
  if (!baseline.ok) {
    return { ok: false, reason: sideReason("baseline", baseline) };
  }
  const candidate = runSide(args.candidateBody, keyed, args.policyTail, args.asOf);
  if (!candidate.ok) {
    return { ok: false, reason: sideReason("candidate", candidate) };
  }
  // An explicit caller-chosen field diffs BOTH sides (the pre-93.4
  // contract); otherwise each side reads its OWN resolved basis, so a
  // total-less baseline and a total-declaring candidate both land on
  // real numbers.
  const dislocation = policyBookDislocation(
    baseline.results,
    candidate.results,
    args.premiumField
      ? { premiumField: args.premiumField }
      : {
          baselinePremiumField: baseline.premiumField,
          candidatePremiumField: candidate.premiumField,
        },
  );
  return { ok: true, dislocation };
}
