/**
 * Policy-level + computed-field appetite (stress-test finding E03).
 *
 * Today the `eligibility.gate` compares ONE raw input with a constant — no
 * computed field, no arithmetic, no policy-level aggregation. So
 * "policy TIV (Σ building+BPP across locations) ≥ $1,000,000" is
 * unauthorable, and a per-row gate wrongly declines an $850k location that
 * is fine once rolled up with its $210k sibling.
 *
 * This module is the foundational primitive. It supplies three pure pieces:
 *
 *   (a) a COMPUTED gate field — a small, closed arithmetic expression over
 *       inputs (e.g. `tiv = building_limit + bpp_limit`). No string `eval`:
 *       a typed AST, deterministic + total.
 *   (b) a POLICY-LEVEL gate evaluation — the same ordered rule-walk + the
 *       same `evaluateEligibilityComparator` the row gate uses, but run
 *       against the policy TOTALS (produced by the E08 roll-up) so it sees
 *       the policy total, not a single location.
 *   (c) explicit TIER PRECEDENCE — most-restrictive-wins across the per-row
 *       verdicts AND the policy verdict, over the ordered `EligibilityTier`.
 *
 * Pure + deterministic (P-N1). No React, no DOM, no I/O. The roll-up that
 * produces the policy totals is E08 (`policy-rollup.ts`); this module reads
 * a totals record so it stays independent of that module.
 */

import { type EligibilityTier, ELIGIBILITY_TIERS } from "./tier-types";
import {
  eligibilityRuleMatches,
  type EligibilityRule,
} from "./kinds/eligibility-gate";

// ── (a) Computed gate field — small arithmetic over inputs ───────────

/** A closed arithmetic expression over named inputs + constants. A typed
 *  AST (NOT a string to eval) — inspectable, portable, deterministic. */
export type ComputedExpr =
  | { readonly kind: "input"; readonly name: string }
  | { readonly kind: "const"; readonly value: number }
  | {
      readonly kind: "op";
      readonly op: "+" | "-" | "*" | "/";
      readonly left: ComputedExpr;
      readonly right: ComputedExpr;
    };

/** A named derived field (e.g. `tiv`). Surfaced as a derived input that the
 *  gate's field-picker references like any other input. */
export interface ComputedField {
  readonly name: string;
  readonly expr: ComputedExpr;
}

const COMPUTED_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/"]);

/**
 * Validate a `ComputedExpr` structurally (Validate-early, P-N6). Returns an
 * error string, or `null` when the AST is well-formed. Used by the
 * `derive.computed` kind's `validate` so a malformed expression is caught at
 * authoring time, not at score time.
 */
export function validateComputedExpr(expr: unknown, path = "expr"): string | null {
  if (typeof expr !== "object" || expr === null) {
    return `${path} is not an expression object`;
  }
  const e = expr as Record<string, unknown>;
  switch (e.kind) {
    case "input":
      return typeof e.name === "string" && e.name.trim() !== ""
        ? null
        : `${path}: input needs a non-empty \`name\``;
    case "const":
      return typeof e.value === "number" && Number.isFinite(e.value)
        ? null
        : `${path}: const needs a finite \`value\``;
    case "op": {
      if (typeof e.op !== "string" || !COMPUTED_OPS.has(e.op)) {
        return `${path}: op must be one of + - * /`;
      }
      return (
        validateComputedExpr(e.left, `${path}.left`) ??
        validateComputedExpr(e.right, `${path}.right`)
      );
    }
    default:
      return `${path}: unknown expression kind "${String(e.kind)}" (expected input/const/op)`;
  }
}

/** Render a `ComputedExpr` as a human-readable string for the trace, e.g.
 *  `building_limit + bpp_limit`. Nested ops are parenthesized. */
export function formatComputedExpr(expr: ComputedExpr): string {
  const fmt = (e: ComputedExpr, top: boolean): string => {
    if (e.kind === "input") return e.name;
    if (e.kind === "const") return String(e.value);
    const s = `${fmt(e.left, false)} ${e.op} ${fmt(e.right, false)}`;
    return top ? s : `(${s})`;
  };
  return fmt(expr, true);
}

/**
 * Evaluate one computed expression against an inputs record. Pure + total —
 * an absent / non-numeric input is 0 (the baseline, matching the gate's
 * graceful evaluation), and division by zero is 0 rather than ±∞/NaN.
 */
export function evaluateComputedExpr(
  expr: ComputedExpr,
  inputs: Readonly<Record<string, unknown>>,
): number {
  switch (expr.kind) {
    case "const":
      return expr.value;
    case "input": {
      const v = inputs[expr.name];
      // CSV / form inputs arrive as strings ("800000") — coerce a numeric
      // string the same way the runtime does, so a computed field works on a
      // raw book row. A non-numeric / absent value is 0 (the baseline).
      if (typeof v === "number") return Number.isFinite(v) ? v : 0;
      if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v.replace(/,/g, ""));
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    }
    case "op": {
      const l = evaluateComputedExpr(expr.left, inputs);
      const r = evaluateComputedExpr(expr.right, inputs);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? 0 : l / r;
      }
    }
  }
}

/**
 * Evaluate computed fields in declaration order, returning name → value.
 * Later fields may reference earlier ones (e.g. derive `tiv`, then a
 * `tiv_band` from it), since each result is merged into the inputs before
 * the next field evaluates.
 */
export function evaluateComputedFields(
  fields: readonly ComputedField[],
  inputs: Readonly<Record<string, unknown>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const merged: Record<string, unknown> = { ...inputs };
  for (const f of fields) {
    const v = evaluateComputedExpr(f.expr, merged);
    out[f.name] = v;
    merged[f.name] = v;
  }
  return out;
}

// ── (b) Policy-level (or row-level) gate evaluation ──────────────────

/** A gate verdict — same shape the `eligibility.gate` kind emits. */
export interface AppetiteVerdict {
  readonly tier: EligibilityTier;
  readonly matched_rule_id: string | null;
  readonly reasoning: string;
}

/**
 * Walk ordered eligibility rules against an inputs record — first match
 * wins, missing variable skips gracefully, else `default_tier`. Identical
 * semantics + comparator to the `eligibility.gate` kind, so a policy gate
 * behaves exactly like a row gate; only the inputs differ (policy totals vs
 * one location's inputs).
 */
export function evaluateAppetiteRules(
  rules: readonly EligibilityRule[],
  default_tier: EligibilityTier,
  default_reasoning: string,
  inputs: Readonly<Record<string, unknown>>,
): AppetiteVerdict {
  for (const rule of rules) {
    // Brief 81 D-C — delegate to THE matcher (the row gate uses the
    // same one), so single AND compound rules mean the same thing in
    // both scopes. Missing variables stay a graceful per-condition
    // no-match.
    if (eligibilityRuleMatches(rule, inputs)) {
      return {
        tier: rule.tier,
        matched_rule_id: rule.rule_id,
        reasoning: rule.reasoning,
      };
    }
  }
  return { tier: default_tier, matched_rule_id: null, reasoning: default_reasoning };
}

// ── (c) Most-restrictive-wins tier precedence ────────────────────────

/** Restrictiveness rank — `ELIGIBILITY_TIERS` is ordered best→worst
 *  (preferred → standard → submit → decline), so a higher index is more
 *  restrictive. Derived from the vocabulary so it can't drift from it. */
const TIER_RANK: Readonly<Record<EligibilityTier, number>> = Object.freeze(
  Object.fromEntries(ELIGIBILITY_TIERS.map((t, i) => [t, i])) as Record<
    EligibilityTier,
    number
  >,
);

/** The most-restrictive tier among the inputs (decline > submit > standard >
 *  preferred). Empty → the least-restrictive tier (`preferred`). */
export function mostRestrictiveTier(
  tiers: readonly EligibilityTier[],
): EligibilityTier {
  let winner: EligibilityTier = ELIGIBILITY_TIERS[0]!;
  for (const t of tiers) {
    if (TIER_RANK[t] > TIER_RANK[winner]) winner = t;
  }
  return winner;
}

/** A gate verdict tagged with where it came from (for the trace). */
export interface ScopedVerdict extends AppetiteVerdict {
  readonly scope: "row" | "policy";
  /** For `scope: "row"` — which location produced it. */
  readonly location_id?: string;
}

/** The combined policy decision: the most-restrictive tier across every
 *  fired verdict, the deciding verdict, and the full list for the trace. */
export interface PolicyAppetiteDecision {
  readonly tier: EligibilityTier;
  readonly deciding: ScopedVerdict | null;
  readonly verdicts: readonly ScopedVerdict[];
}

/**
 * Combine per-row + policy verdicts into one policy decision by
 * most-restrictive-wins (E03 (c)). `deciding` is the first verdict carrying
 * the winning tier (stable). This is what lets a 2-location $1.06M policy be
 * IN appetite while its sub-$1M locations are NOT individually declined:
 * the per-row gates return `standard` (they don't decline on raw location
 * TIV), and the policy gate decides on the rolled-up total.
 */
export function decidePolicyAppetite(
  verdicts: readonly ScopedVerdict[],
): PolicyAppetiteDecision {
  const tier = mostRestrictiveTier(verdicts.map((v) => v.tier));
  const deciding = verdicts.find((v) => v.tier === tier) ?? null;
  return { tier, deciding, verdicts };
}
