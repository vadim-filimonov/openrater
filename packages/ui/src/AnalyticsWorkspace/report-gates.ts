/**
 * report-gates — Brief 93 §1.1.6 (93.2): "Where the plan says no."
 *
 * Projects the plan's eligibility rules into the report's stated
 * rows: one English sentence per rule (the SAME grammar the
 * Eligibility document speaks — appetitePhrases) + its outcome tier.
 * Pure data-in / data-out; the consumer supplies the rules (the
 * appetite read model) and a field-meta lookup for labels + dtypes.
 */

import type { EligibilityTier } from "@openrater/contracts";
import {
  fmtAppetiteValue,
  isNumericDtype,
  opPhrase,
} from "../AppetiteStatement/appetitePhrases";

/** One clause, in display form (the gatesSync coercion contract). */
export interface ReportGateCondition {
  readonly variable: string;
  readonly op: string;
  readonly value: string;
}

export interface ReportGateRuleLike {
  readonly id: string;
  readonly tier: EligibilityTier;
  /** ALL clauses (length ≥ 1, implicit AND). */
  readonly conditions: readonly ReportGateCondition[];
}

export interface ReportGateFieldMeta {
  readonly label?: string;
  readonly dtype?: string;
}

export interface ReportGateRow {
  readonly id: string;
  /** "Construction class is Fire Resistive and TIV is at least 5,000,000" */
  readonly text: string;
  readonly tier: EligibilityTier;
}

export function buildGateRows(
  rules: readonly ReportGateRuleLike[],
  metaFor: (variable: string) => ReportGateFieldMeta | undefined,
): readonly ReportGateRow[] {
  return rules.map((rule) => {
    const text = rule.conditions
      .map((c) => {
        const meta = metaFor(c.variable);
        const numeric = isNumericDtype(meta?.dtype);
        return `${meta?.label || c.variable} ${opPhrase(c.op, numeric)} ${fmtAppetiteValue(c.value, meta?.dtype)}`;
      })
      .join(" and ");
    return { id: rule.id, text, tier: rule.tier };
  });
}
