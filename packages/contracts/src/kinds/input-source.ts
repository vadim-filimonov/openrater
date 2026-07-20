/**
 * `input.source` kind — entity-compiled input binding.
 *
 * Per Plan Format Spec v1 §4.5: the entity compiler emits this kind
 * for chain factors of type "input" that resolve via the InputSource
 * registry. The runtime substitutes the value from `externalInputs`
 * (keyed by `params.fieldName`) at execute-time; if no external value
 * is supplied, `params.defaultValue` is the fallback.
 *
 * `execute()` is a contract-only stub. The runtime SPECIAL-CASES the
 * `input.source` kind id (see `runtime.ts` line ~231) and substitutes
 * the external value before reaching `execute`.
 *
 * Distinct from `input` because:
 *   · it carries source-type metadata (`api`, `form`, `lookup`,
 *     `manual`) that the audit trace records
 *   · the entity compiler emits this kind (not `input`)
 *   · its output port type is DERIVED from `params.fieldType` so the
 *     declared port type matches the runtime-substituted value
 */

import type {
  BlockKind,
  PortSpec,
  PrimitiveType,
  ValidationIssue,
} from "../block-types";

export type InputSourceSourceType =
  | "api" //     submission payload field
  | "form" //    operator-entered form field
  | "lookup" //  resolved from another lookup
  | "manual" //  typed by the operator at runtime
  | "derived"; // Brief 52 (D3): computed from another input/dim. In V1
//               the value still arrives via externalInputs (CSV /
//               connector); `derivedFrom` records the dependency for
//               authoring + validation. Runtime auto-derivation is a
//               documented fast-follow (Brief 52 §9 FF-6), so this is
//               runtime-inert today — see the V32 conformance vector.

export interface InputSourceParams {
  /** External-inputs key. The runtime reads externalInputs[fieldName]. */
  fieldName: string;
  /** Primitive type of the value (drives the output port type). */
  fieldType: PrimitiveType;
  /** Where the value is sourced from (semantic; affects UI affordances). */
  sourceType: InputSourceSourceType;
  /** Optional dotted path inside the raw quote payload. */
  sourcePath?: string;
  /** Fallback value when externalInputs has no value for this field. */
  defaultValue?: unknown;
  /** Human-readable description (shown in inspector + audit trace). */
  description?: string;

  // ── Brief 52 — input-dictionary fields ──────────────────────
  // All optional; when absent, behavior is identical to pre-Brief-51
  // (existing plans round-trip unchanged). They turn an `input.source`
  // node into a first-class declared dictionary entry.
  /**
   * Must `externalInputs` carry this key for a complete run? Default
   * true for declared inputs. `validateExternalInputs` reports a
   * `missing-required` issue when a required input has no value AND no
   * `defaultValue`. NOT enforced by the (lenient) runtime — surfaced
   * pre-flight so the author fixes it before scoring.
   */
  required?: boolean;
  /**
   * Closed value set (enum). When non-empty, both authoring (`validate`)
   * and pre-flight (`validateExternalInputs`) check membership. Holds
   * literal members only (e.g. `["701","702"]`); numeric RANGE
   * constraints ("≥ 0", "≤ 35000") are NOT modeled here in V1 — they
   * live in `description` until a future min/max field lands.
   */
  allowedValues?: readonly unknown[];
  /** Display + domain hint (e.g. "USD", "sqft", "years", "%"). Non-semantic in V1. */
  unit?: string;
  /** Grouping label for the dictionary UI (e.g. "A. Classification" … "J. Derived"). Free-text per Risk-Inputs Q14. */
  category?: string;
  /** For `sourceType="derived"`: the upstream input/dim fieldName this is computed from (e.g. "zip", "class_code"). V1: documentation + validation only. */
  derivedFrom?: string;
  /** For `sourceType="derived"`: human/expression description of the derivation rule. V1: not executed. */
  derivedRule?: string;
}

export type InputSourceInputs = Record<string, never>;
export type InputSourceOutputs = { value: unknown };

export const InputSourceKind: BlockKind<
  InputSourceParams,
  InputSourceInputs,
  InputSourceOutputs
> = {
  id: "input.source",
  category: "input",
  label: "Input source",
  description:
    "Entity-compiled binding to an InputSource (quote-payload field)",
  inputs: [],
  outputs: [
    {
      name: "value",
      type: "string",
      description:
        "The input value (output type narrows per params.fieldType at runtime)",
    } as PortSpec,
  ],
  defaultParams: {
    fieldName: "",
    fieldType: "string",
    sourceType: "api",
  },
  // Derive the output port type from params.fieldType so the value
  // port's declared type matches the actual data the runtime substitutes.
  derivedPorts: (params) => ({
    inputs: [],
    outputs: [
      {
        name: "value",
        type: params.fieldType ?? "string",
        description: "The input value",
      } as PortSpec,
    ],
  }),
  defaultSize: "compact",
  provenance: "core",
  certainty: "draft",
  determinism: "strict",
  sideEffects: "none",
  execute: (_inputs, _params) => {
    // Stub — the runtime substitutes the external value before
    // reaching here. See runtime.ts special-case for `input.source`.
    return { value: null };
  },
  validate: (params) => {
    const issues: ValidationIssue[] = [];
    if (!params.fieldName || params.fieldName.trim() === "") {
      issues.push({
        severity: "error",
        message: "fieldName is required",
        field: "fieldName",
      });
    }
    // Brief 52 — a declared default must be a member of the closed set.
    const allowed = params.allowedValues;
    if (
      allowed &&
      allowed.length > 0 &&
      params.defaultValue !== undefined &&
      !allowed.some((v) => Object.is(v, params.defaultValue))
    ) {
      issues.push({
        severity: "error",
        message: `Default value ${JSON.stringify(
          params.defaultValue,
        )} is not one of the allowed values`,
        field: "defaultValue",
      });
    }
    // Brief 52 — a derived input with no recorded source is authorable
    // but suspicious (where does its value come from?). Soft warning.
    if (
      params.sourceType === "derived" &&
      (!params.derivedFrom || params.derivedFrom.trim() === "")
    ) {
      issues.push({
        severity: "warning",
        message:
          "Derived input has no source field — set `derivedFrom` so the dependency is auditable",
        field: "derivedFrom",
      });
    }
    return { valid: !issues.some((i) => i.severity === "error"), issues };
  },
  explainStep: (_inputs, params, outputs) => {
    if (outputs.value === undefined) {
      return `Input source \`${params.fieldName}\` (from ${params.sourceType}) not supplied`;
    }
    return `Input source \`${params.fieldName}\` (from ${params.sourceType}) → ${outputs.value}`;
  },
};
