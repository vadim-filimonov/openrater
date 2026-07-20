// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * Portfolio R1 "what-if" — re-rate the stored book against a candidate
 * snapshot (Brief 73). The two PURE adapters that bracket the engine:
 *
 *   73.0 · `portfolioBookToPolicyRows` — the stored book → the
 *          `KeyedRiskRow[]` the policy pipeline (`evaluatePolicyBook`)
 *          consumes. The faithful re-rate is POLICY grain (locations roll
 *          up + the policy tail applies), so the unit is the submission's
 *          locations keyed by submission_id + location_key.
 *
 *   73.1 · `policyBookDislocation` — two `PolicyBookResult[]` (baseline +
 *          candidate, each from one `evaluatePolicyBook` run) → the
 *          book-altitude dislocation, reusing Brief 64's `computeDislocation`
 *          math UNTOUCHED. Matched by policy_id; baseline-only and
 *          candidate-only policies are counted, never silently dropped.
 *
 * No I/O, no engine, no React — the orchestration (compile the snapshot,
 * run `evaluatePolicyBook` twice) lives in the rate-lab mount (73.2).
 */

import type { KeyedRiskRow, PolicyBookResult } from "@openrater/contracts";
import { computeDislocation, type Dislocation } from "../AnalyticsWorkspace/dislocation";
import type { AnalyticsScoredRow } from "../AnalyticsWorkspace/exhibit-math";

// ── 73.0 · stored book → policy-pipeline rows ────────────────────────

/** The slice of a stored submission the re-rate needs: its locations'
 *  inputs, keyed for roll-up. Structurally satisfied by the api client's
 *  `PortfolioSubmissionDetail` (submission_id + locations[].inputs). */
export interface RerateBookSubmission {
  readonly submission_id: string;
  readonly locations: ReadonlyArray<{
    readonly location_key: string;
    readonly inputs: Record<string, unknown>;
  }>;
}

/**
 * Unpack the stored book into `KeyedRiskRow[]` — one row per location,
 * `policy_id` = submission_id, `location_id` = location_key. The inputs
 * are the SAME stored field values both snapshots re-rate against, so the
 * dislocation isolates the rate change (same population, two algorithms).
 */
export function portfolioBookToPolicyRows(
  submissions: readonly RerateBookSubmission[],
): KeyedRiskRow[] {
  const rows: KeyedRiskRow[] = [];
  for (const s of submissions) {
    for (const loc of s.locations) {
      rows.push({
        policy_id: s.submission_id,
        location_id: loc.location_key,
        inputs: { ...loc.inputs },
      });
    }
  }
  return rows;
}

// ── 73.1 · policy-grain dislocation ──────────────────────────────────

/** Default premium keys on `rollup.rolled`, in resolution order — mirrors
 *  `PolicyBookConfig.premiumRollupField`'s `total_premium` → `premium`. */
const PREMIUM_ROLLUP_KEYS = ["total_premium", "premium"] as const;

/**
 * The policy's FINAL premium: the IRPM-composed `composed.final` when a
 * policy tail ran, else the rolled premium subtotal. Null when neither
 * resolves to a finite number (→ the dislocation's n/a bucket).
 */
export function policyFinalPremium(
  result: PolicyBookResult,
  premiumField?: string,
): number | null {
  if (result.composed && Number.isFinite(result.composed.final)) {
    return result.composed.final;
  }
  const rolled = result.rollup.rolled;
  const keys = premiumField
    ? [premiumField, ...PREMIUM_ROLLUP_KEYS]
    : PREMIUM_ROLLUP_KEYS;
  for (const k of keys) {
    const v = rolled[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export interface PolicyDislocation {
  readonly dislocation: Dislocation;
  /** Policies matched on both sides (the dislocation population). */
  readonly matched: number;
  /** In the candidate but not the baseline — new under the candidate. */
  readonly candidateOnly: number;
  /** In the baseline but not the candidate — dropped under the candidate. */
  readonly baselineOnly: number;
}

export interface PolicyBookDislocationOptions {
  /** Rolled premium field to diff on; defaults to total_premium → premium. */
  readonly premiumField?: string;
  /** Per-side overrides (93.4) — the two snapshots may resolve DIFFERENT
   *  premium bases (e.g. a candidate that ADDS the plan total to a
   *  total-less baseline, where the baseline's premium is the
   *  materialized `coverage_sum_premium`). Each falls back to
   *  `premiumField`, then the default chain. */
  readonly baselinePremiumField?: string;
  readonly candidatePremiumField?: string;
  readonly binWidth?: number;
  readonly displayRange?: readonly [number, number];
}

const PREMIUM_COL = "policy_premium";

/**
 * Book-altitude dislocation between two policy-pipeline runs. Pairs are
 * matched by `policy_id` and emitted in lockstep (same index = same
 * policy) so the shipped index-aligned `computeDislocation` reads them
 * correctly; its zero-old / beyond-range / weighted-avg math is reused
 * untouched. Unmatched policies are COUNTED (CT-2/CT-3 honesty), never
 * folded into the histogram.
 */
export function policyBookDislocation(
  baseline: readonly PolicyBookResult[],
  candidate: readonly PolicyBookResult[],
  opts: PolicyBookDislocationOptions = {},
): PolicyDislocation {
  const baseById = new Map(baseline.map((r) => [r.policy_id, r]));
  const candById = new Map(candidate.map((r) => [r.policy_id, r]));
  const baseField = opts.baselinePremiumField ?? opts.premiumField;
  const candField = opts.candidatePremiumField ?? opts.premiumField;

  const baselineRows: AnalyticsScoredRow[] = [];
  const candidateRows: AnalyticsScoredRow[] = [];
  let matched = 0;
  let candidateOnly = 0;

  for (const [id, cand] of candById) {
    const base = baseById.get(id);
    if (!base) {
      candidateOnly += 1;
      continue;
    }
    matched += 1;
    baselineRows.push({
      inputs: { policy_id: id },
      outputs: { [PREMIUM_COL]: policyFinalPremium(base, baseField) },
    });
    candidateRows.push({
      inputs: { policy_id: id },
      outputs: { [PREMIUM_COL]: policyFinalPremium(cand, candField) },
    });
  }

  let baselineOnly = 0;
  for (const id of baseById.keys()) {
    if (!candById.has(id)) baselineOnly += 1;
  }

  const dislocation = computeDislocation({
    baselineRows,
    comparisonRows: candidateRows,
    premiumColumn: PREMIUM_COL,
    ...(opts.binWidth !== undefined ? { binWidth: opts.binWidth } : {}),
    ...(opts.displayRange !== undefined ? { displayRange: opts.displayRange } : {}),
  });

  return { dislocation, matched, candidateOnly, baselineOnly };
}
