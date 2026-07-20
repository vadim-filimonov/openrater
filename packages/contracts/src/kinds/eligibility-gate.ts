/**
 * `eligibility.gate` kind — appetite-driven tier verdict.
 *
 * Brief 10 (Eligibility & Appetite section). Walks an ORDERED list of
 * eligibility rules against the per-risk inputs; the first matching
 * rule's tier becomes the verdict. When no rule matches, falls back
 * to `default_tier`.
 *
 * Inputs come from `ctx.externalInputs` — the kind has NO wire input
 * ports. Each rule specifies the variable name + comparator + value;
 * the runtime reads variables from externalInputs at execute time.
 *
 *   Example:
 *     Rules (in declared order):
 *       1. years_in_business < 1   → decline    "New ventures excluded"
 *       2. state in [WI, MN, IL]   → preferred  "Core market state"
 *       3. (always)                 → standard   "Standard appetite"
 *
 *     Inputs:
 *       { years_in_business: 5, state: "WI" }
 *
 *     Verdict:
 *       tier: "preferred"
 *       matched_rule_id: "core_market"
 *       reasoning: "Core market state"
 *
 * Outputs:
 *   - tier: EligibilityTier — the verdict
 *   - matched_rule_id: string | null — which rule fired, or null when default
 *   - reasoning: string — verbatim from the matching rule (or the default
 *     reasoning when nothing matched)
 *
 * Pure. No special-casing in the runtime — `execute` reads from
 * `ctx.externalInputs` directly.
 */

import type { BlockKind, PortSpec } from "../block-types";
import {
  type EligibilityOp,
  type EligibilityTier,
  ELIGIBILITY_TIER_LABELS,
  evaluateEligibilityComparator,
} from "../tier-types";

/**
 * One condition inside an eligibility rule (Brief 81 D-A). The same
 * `{variable, op, value}` triple a V1 rule carries inline.
 */
export interface EligibilityCondition {
  /** The externalInputs key to read at evaluation. Must be present
   *  in externalInputs OR the condition doesn't hold (graceful —
   *  appetite gates evaluate against partial accounts). */
  readonly variable: string;
  /** Comparator operator. */
  readonly op: EligibilityOp;
  /** Right-hand side of the comparison. For "in" / "nin" this is an
   *  array; for others it's a primitive. */
  readonly value: unknown;
}

/** The fields every rule shape shares. */
interface EligibilityRuleBase {
  /** Stable id for the rule. Surfaces in the matched_rule_id output
   *  + the trace's matching-rule citation. */
  readonly rule_id: string;
  /** The tier verdict when this rule fires. */
  readonly tier: EligibilityTier;
  /** Reasoning verbatim into the trace + audit log. */
  readonly reasoning: string;
  /** Optional citation (e.g., "Underwriting Guide §3.2"). */
  readonly citation?: string;
}

/** The V1 single-comparator rule — persisted plans carry this shape
 *  verbatim forever (Brief 81 D-B: never migrated). */
export interface SingleConditionEligibilityRule
  extends EligibilityRuleBase,
    EligibilityCondition {
  readonly conditions?: undefined;
}

/** Brief 81 (finding E8) — a compound rule: `conditions[]` with
 *  implicit AND. OR stays first-match rule multiplicity (sibling
 *  rules); there are no nested trees (D-A). */
export interface CompoundEligibilityRule extends EligibilityRuleBase {
  /** Every condition must hold for the rule to fire. */
  readonly conditions: readonly EligibilityCondition[];
  readonly variable?: undefined;
  readonly op?: undefined;
  readonly value?: undefined;
}

/**
 * One eligibility rule. The eligibility gate walks rules in order;
 * the first match wins.
 *
 * Two shapes (Brief 81 D-B, the additive V2 the V1 docstring
 * promised): the single comparator (variable + op + value) or the
 * compound `conditions[]` (implicit AND) — exactly one of the two.
 */
export type EligibilityRule =
  | SingleConditionEligibilityRule
  | CompoundEligibilityRule;

/**
 * A rule's conditions as ONE list, whichever shape it carries — the
 * V1 inline triple becomes a single-element list.
 */
export function ruleConditions(
  rule: EligibilityRule,
): readonly EligibilityCondition[] {
  if (rule.conditions !== undefined) return rule.conditions;
  return [{ variable: rule.variable, op: rule.op, value: rule.value }];
}

/**
 * THE rule matcher (Brief 81 D-C) — the one place a rule's semantics
 * live. Both the row gate (`eligibility.gate.execute`) and the policy
 * gate (`evaluateAppetiteRules`) delegate here, so a rule cannot mean
 * two things in two scopes (Law 1).
 *
 * A rule matches when EVERY condition holds. The missing-variable
 * grace applies per condition: any condition whose variable is absent
 * from `inputs` makes the whole rule a no-match (never a raise —
 * identical to the V1 skip). A compound rule with an EMPTY conditions
 * list never matches (a rule that would always fire must say so with
 * a real condition; `validate` flags the empty list).
 */
export function eligibilityRuleMatches(
  rule: EligibilityRule,
  inputs: Readonly<Record<string, unknown>>,
): boolean {
  const conditions = ruleConditions(rule);
  if (conditions.length === 0) return false;
  return conditions.every((c) => {
    const left = inputs[c.variable];
    if (left === undefined) return false;
    return evaluateEligibilityComparator(c.op, left, c.value);
  });
}

export interface EligibilityGateParams {
  /** Ordered rule list. First matching rule wins. */
  readonly rules: readonly EligibilityRule[];
  /** Tier used when no rule matches. Required (no implicit fallback
   *  to "standard" — the actuary explicitly declares default behavior). */
  readonly default_tier: EligibilityTier;
  /** Reasoning for the default verdict. Surfaces in trace when no rule
   *  matches. */
  readonly default_reasoning: string;
  /** Brief 94.5 (T5) — the filed default row's citation (a workbook's
   *  `__default__` gate row carries one like any rule). Optional +
   *  additive; mirrors the backend's EligibilityGateConfig. */
  readonly default_citation?: string;
  /**
   * E03 / brief D4 — the pipeline phase this gate evaluates in:
   *   · `"row"` (default) — per-location, runs in the per-row DAG against
   *     the location's inputs (today's behavior).
   *   · `"policy"` — runs AFTER the multi-location roll-up (E08), against
   *     the policy TOTALS: the declared roll-up fields by their RAW names
   *     (e.g. `tiv`, `premium` — the rolled key === the declared field name,
   *     not `policy_tiv`) plus the synthetic `location_count` (ADR-0046).
   *     The per-row engine ignores a policy-scope gate (it has no per-row
   *     meaning); the batch orchestrator `evaluatePolicyBook` evaluates it.
   *     See ADR-016.
   * Additive + default `"row"` — every existing plan + conformance vector is
   * byte-identical (the per-row `execute` is unchanged; `scope` is metadata
   * the batch layer + the GateCanvas read).
   */
  readonly scope?: "row" | "policy";
  /**
   * Brief 87 P5 (ADR-0062 Part B) — optional per-variable source arms.
   * A variable listed here resolves BEFORE the gate walks: `{from:"model"}`
   * scores the risk's inputs through the pinned registry artifact (the
   * shipped IRPM pattern — glm_coeff only, P-N6) and lands the prediction
   * under the variable's name. A missing or unevaluable model is a NAMED
   * refusal at the resolution seam, never a silent no-match. Additive —
   * absent means every variable reads externalInputs directly, as always.
   */
  readonly variable_sources?: Readonly<Record<string, unknown>>;
}

/** No wire inputs — the kind reads from ctx.externalInputs. */
export type EligibilityGateInputs = Record<string, never>;

/** Three outputs (one for each downstream concern: filtering, audit, UX). */
export interface EligibilityGateOutputs {
  /** The tier verdict. Wires into modifier.schedule's tier_filter,
   *  the output banner, and the audit log. */
  tier: EligibilityTier;
  /** Which rule fired (rule_id), or null when no rule matched. */
  matched_rule_id: string | null;
  /** Reasoning verbatim into the trace. From the matching rule's
   *  reasoning, or default_reasoning when nothing matched. */
  reasoning: string;
}

export const EligibilityGateKind: BlockKind<
  EligibilityGateParams,
  EligibilityGateInputs,
  EligibilityGateOutputs
> = {
  id: "eligibility.gate",
  category: "transform",
  label: "Eligibility gate",
  description:
    "Produces a tier verdict (preferred / standard / submit / decline) by walking ordered eligibility rules.",
  inputs: [],
  outputs: [
    {
      name: "tier",
      type: "string",
      description:
        "Eligibility tier verdict (preferred / standard / submit / decline).",
    } as PortSpec,
    {
      name: "matched_rule_id",
      type: "string",
      description: "Which rule fired; null when default.",
    } as PortSpec,
    {
      name: "reasoning",
      type: "string",
      description: "Verbatim reasoning from the matching rule.",
    } as PortSpec,
  ],
  defaultParams: {
    rules: [],
    default_tier: "submit",
    default_reasoning: "No rules matched; default to manual underwriter review.",
  },
  defaultSize: "regular",
  execute: (_inputs, params, ctx) => {
    const externalInputs = ctx?.externalInputs ?? {};
    for (const rule of params.rules) {
      // Brief 81 D-C — the ONE matcher. A missing variable is
      // gracefully a "no match" (per condition) rather than an error —
      // appetite gates evaluate against partial accounts during
      // intake. The unified error panel (Brief 13) can surface missing
      // variables when the actuary opts in to strict mode.
      if (eligibilityRuleMatches(rule, externalInputs)) {
        return {
          tier: rule.tier,
          matched_rule_id: rule.rule_id,
          reasoning: rule.reasoning,
        };
      }
    }
    return {
      tier: params.default_tier,
      matched_rule_id: null,
      reasoning: params.default_reasoning,
    };
  },
  validate: (params) => {
    if (!params.default_tier) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "default_tier is required",
            field: "default_tier",
          },
        ],
      };
    }
    if (!params.default_reasoning || params.default_reasoning.trim() === "") {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "default_reasoning is required (cannot be empty).",
            field: "default_reasoning",
          },
        ],
      };
    }
    const seenIds = new Set<string>();
    for (const r of params.rules) {
      if (!r.rule_id || r.rule_id.trim() === "") {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: "Every rule must have a non-empty rule_id.",
              field: "rules",
            },
          ],
        };
      }
      if (seenIds.has(r.rule_id)) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: `Duplicate rule_id "${r.rule_id}". Rule ids must be unique within a gate.`,
              field: "rules",
            },
          ],
        };
      }
      seenIds.add(r.rule_id);
      // Brief 81 D-B — exactly one shape per rule. The union makes
      // both-defined impossible BY TYPE, but validate guards RUNTIME
      // data (JSON configs cast at the boundary can carry both), so
      // the check reads through a structural view.
      const shape = r as {
        readonly conditions?: unknown;
        readonly variable?: unknown;
      };
      if (shape.conditions !== undefined && shape.variable !== undefined) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: `Rule "${r.rule_id}" carries BOTH a single comparator and conditions[] — exactly one shape is allowed.`,
              field: "rules",
            },
          ],
        };
      }
      if (r.conditions !== undefined) {
        if (r.conditions.length === 0) {
          return {
            valid: false,
            issues: [
              {
                severity: "error",
                message: `Rule "${r.rule_id}" has an empty conditions list — a compound rule needs at least one condition.`,
                field: "rules",
              },
            ],
          };
        }
        for (const c of r.conditions) {
          if (!c.variable || c.variable.trim() === "") {
            return {
              valid: false,
              issues: [
                {
                  severity: "error",
                  message: `Rule "${r.rule_id}" has a condition missing a variable name.`,
                  field: "rules",
                },
              ],
            };
          }
        }
      } else if (!r.variable || r.variable.trim() === "") {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: `Rule "${r.rule_id}" is missing a variable name.`,
              field: "rules",
            },
          ],
        };
      }
    }
    return { valid: true, issues: [] };
  },
  explainStep: (_inputs, params, outputs) => {
    const tierLabel = ELIGIBILITY_TIER_LABELS[outputs.tier];
    if (outputs.matched_rule_id === null) {
      return `No rule matched → ${tierLabel} (default): ${outputs.reasoning}`;
    }
    const rule = params.rules.find((r) => r.rule_id === outputs.matched_rule_id);
    // Brief 81 D-D — the audit line reads a compound rule's clauses
    // joined by "and", the same grammar the composer authors in.
    const ruleLabel = rule
      ? `Rule "${rule.rule_id}" (${ruleConditions(rule)
          .map((c) => `${c.variable} ${c.op} ${formatValue(c.value)}`)
          .join(" and ")})`
      : `Rule "${outputs.matched_rule_id}"`;
    return `${ruleLabel} → ${tierLabel}: ${outputs.reasoning}`;
  },
};

/**
 * Format a rule's RHS value for the explainStep sentence.
 * Strings get quoted; arrays use bracket syntax; primitives go raw.
 * Internal helper — keep terse.
 */
function formatValue(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (Array.isArray(v)) return `[${v.map(formatValue).join(", ")}]`;
  if (v === null) return "null";
  return String(v);
}
