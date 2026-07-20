/**
 * inputsPreflight — G5 (ADR-0056): name what the caller got wrong.
 *
 * The ENGINE already refuses honestly (G8: a missing/unknown key errors
 * the row — `row_status: "error"`, premium withheld). This pre-flight is
 * the API-ergonomics half: structured `missing_inputs` /
 * `unknown_inputs` in the response, derived from the fields the
 * COMPILED plan actually consumes — so a misspelled column is named,
 * not hunted.
 *
 * Consumed = every `input` / `input.source` node's fieldName; required
 * = consumed with no authored defaultValue. Pure over (plan, inputs).
 */

import type { Plan } from "@openrater/contracts";

export interface InputsPreflight {
  /** Required (no-default) consumed fields absent from the request. */
  readonly missing_inputs: readonly string[];
  /** Supplied fields the plan does not consume (typo tell). */
  readonly unknown_inputs: readonly string[];
}

export function preflightInputs(
  plan: Plan,
  supplied: Readonly<Record<string, unknown>>,
): InputsPreflight {
  const consumed = new Set<string>();
  const required = new Set<string>();
  for (const node of plan.nodes ?? []) {
    // Brief 83.2 — eligibility-gate rule variables are CONSUMED (they
    // read externalInputs directly, no input node) but never REQUIRED:
    // the missing-variable grace means an absent variable is a rule
    // no-match, not a refusal. Without this, a gate-only field like
    // `state` reported as an "unknown input" typo tell.
    if (node.kind === "eligibility.gate") {
      const rules = (node.params as { rules?: readonly unknown[] } | undefined)
        ?.rules;
      for (const rule of rules ?? []) {
        const r = rule as {
          variable?: unknown;
          conditions?: readonly { variable?: unknown }[];
        };
        if (typeof r.variable === "string" && r.variable !== "") {
          consumed.add(r.variable);
        }
        for (const c of r.conditions ?? []) {
          if (typeof c?.variable === "string" && c.variable !== "") {
            consumed.add(c.variable);
          }
        }
      }
      continue;
    }
    if (node.kind !== "input" && node.kind !== "input.source") continue;
    const params = node.params as
      | { fieldName?: unknown; defaultValue?: unknown; optional?: unknown }
      | undefined;
    const fieldName = params?.fieldName;
    if (typeof fieldName !== "string" || fieldName === "") continue;
    consumed.add(fieldName);
    // Brief 83.2 — `optional: true` marks structurally-optional inputs
    // (declared overrides, exposure-option branch inputs, the schedule
    // application): consumed, never demanded.
    if (params?.defaultValue === undefined && params?.optional !== true) {
      required.add(fieldName);
    }
  }
  const suppliedKeys = Object.keys(supplied);
  const missing_inputs = [...required]
    .filter((f) => supplied[f] === undefined)
    .sort();
  const unknown_inputs = suppliedKeys.filter((k) => !consumed.has(k)).sort();
  return { missing_inputs, unknown_inputs };
}
