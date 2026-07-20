/**
 * Input dictionary — pre-flight validation of `externalInputs` against
 * a plan's declared inputs (Brief 52).
 *
 * A plan's input dictionary is the set of its `input.source` (`input_node`
 * stage) declarations. This module is the PURE helper that integrators
 * and the scoring UI call BEFORE `runPlan` to get typed, actuary-readable
 * pre-flight errors — "you declared `total_floor_area_sqft` as required
 * but the data doesn't carry it" — instead of a silent `undefined`
 * propagating through a gate.
 *
 * Per node-design-principle P-N6 (validate early): the same dictionary
 * drives authoring-time validation (the editor) AND this pre-flight pass
 * (the scoring preview + the Gate's honest readiness status).
 *
 * The runtime itself stays LENIENT (engine-contract §error-categories:
 * NaN / undefined propagation rather than raising) — this helper is the
 * opt-in pre-flight layer, never a hard gate inside `runPlan`.
 *
 * V1 emits two issue codes (both acceptance-critical + unambiguous):
 *   · `missing-required` — declared `required`, no value, no default
 *   · `not-in-allowed`   — value outside the declared closed set
 * A lenient `wrong-type` check is deliberately deferred (Brief 52 §9):
 * currency-string vs number ambiguity ("$1,000") makes it false-positive
 * prone, and the runtime is lenient anyway.
 */

import type { InputSourceParams } from "./kinds/input-source";

export type InputIssueCode = "missing-required" | "not-in-allowed";

export interface InputIssue {
  /** The declared input's `fieldName` (the externalInputs key). */
  readonly fieldName: string;
  readonly severity: "error" | "warning";
  readonly code: InputIssueCode;
  /** Actuary-readable, no jargon (P-N5). */
  readonly message: string;
}

/**
 * The subset of an `input.source` declaration that pre-flight validation
 * reads. `InputSourceParams` is structurally a superset, so callers pass
 * the live dictionary (the plan's input_node configs) directly.
 */
export type InputDictionaryEntry = Pick<
  InputSourceParams,
  "fieldName" | "fieldType" | "required" | "allowedValues" | "defaultValue"
>;

/** A CSV cell / payload value counts as "absent" when it's nullish or empty-string. */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Membership test that tolerates number↔string drift. Declared
 * `allowedValues` are typically strings ("701"); values projected from a
 * CSV may arrive as numbers (701) or strings. Compare on the string
 * projection so the honest cases match and we don't false-positive on
 * representation alone.
 */
function isAllowed(value: unknown, allowed: readonly unknown[]): boolean {
  return allowed.some((v) => v === value || String(v) === String(value));
}

/**
 * Validate a record of external inputs against a declared dictionary.
 * Pure + deterministic — same dictionary + same inputs → same issues.
 * Returns an empty array when everything checks out.
 */
export function validateExternalInputs(
  dictionary: readonly InputDictionaryEntry[],
  externalInputs: Readonly<Record<string, unknown>>,
): readonly InputIssue[] {
  const issues: InputIssue[] = [];

  for (const entry of dictionary) {
    const fieldName = entry.fieldName;
    if (!fieldName || fieldName.trim() === "") continue;

    const value = externalInputs[fieldName];
    const present = isPresent(value);
    const hasDefault = entry.defaultValue !== undefined;

    if (entry.required && !present && !hasDefault) {
      issues.push({
        fieldName,
        severity: "error",
        code: "missing-required",
        message: `Required input \`${fieldName}\` has no value and no default`,
      });
      continue; // no point range-checking an absent value
    }

    if (
      present &&
      entry.allowedValues &&
      entry.allowedValues.length > 0 &&
      !isAllowed(value, entry.allowedValues)
    ) {
      issues.push({
        fieldName,
        severity: "error",
        code: "not-in-allowed",
        message: `Value ${JSON.stringify(
          value,
        )} for \`${fieldName}\` is not one of the allowed values`,
      });
    }
  }

  return issues;
}
