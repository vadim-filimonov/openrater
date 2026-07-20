/**
 * `input.class_exposure` kind — class-driven exposure resolution.
 *
 * The cornerstone of Brief 16 (class-conditional exposure base). At
 * execute time:
 *
 *   1. Reads the bound class_code from externalInputs
 *      (via `params.classCodeFieldName`, default "class_code").
 *   2. Looks up the class in `ctx.classLibrary`.
 *   3. Picks the right exposure declaration based on
 *      `params.coverage_scope` (or primary, if scope is null).
 *   4. Resolves to the runtime input key (e.g., "annual_payroll").
 *   5. Reads that value from externalInputs.
 *   6. Returns it as the node's output.
 *
 * The runtime SPECIAL-CASES this kind (in `runtime.ts`) so the
 * resolution flow can read externalInputs + classLibrary + write the
 * rich `explanation` to the trace entry. The `execute()` stub below
 * exists to satisfy the BlockKind contract for direct callers who
 * bypass the runtime — it returns `{ value: 0 }` rather than throwing
 * so they get a deterministic result they can detect as "you forgot
 * to use the runtime."
 *
 * Why a stub instead of a full execute? The resolution needs the
 * runtime's externalInputs + classLibrary. Threading those through the
 * BlockKind contract for every kind would bloat the surface. Special-
 * casing in the runtime mirrors the pattern used for `input` and
 * `input.source` since v0.
 */

import type { BlockKind, PortSpec } from "../block-types";

export interface InputClassExposureParams {
  /**
   * The coverage scope this factor resolves under — an OPAQUE
   * `coverage_id` (ADR-0033 §0; re-keyed off `LineCode` in gate 5).
   * When null/undefined, the runtime uses the class's PRIMARY exposure
   * declaration. When set, the runtime prefers a declaration whose
   * `coverage_tags` includes that scope, falling back to primary if
   * none matches. The runtime never branches on the value.
   */
  readonly coverage_scope?: string | null;
  /**
   * The externalInputs key from which to read the bound class_code.
   * Defaults to "class_code". Overrideable so a plan that names its
   * class input differently (e.g., "primary_class") still works.
   */
  readonly classCodeFieldName?: string;
}

/** No wire inputs — the kind reads from `ctx.externalInputs`. */
export type InputClassExposureInputs = Record<string, never>;

/** Single output: the resolved exposure value (money). */
export type InputClassExposureOutputs = { value: number };

export const InputClassExposureKind: BlockKind<
  InputClassExposureParams,
  InputClassExposureInputs,
  InputClassExposureOutputs
> = {
  id: "input.class_exposure",
  category: "input",
  label: "Class exposure",
  description:
    "Resolves to the bound class's declared exposure value (sales / payroll / area / receipts / units / other).",
  inputs: [],
  outputs: [
    {
      name: "value",
      type: "money",
      description: "The resolved exposure value (USD or other unit).",
    } as PortSpec,
  ],
  defaultParams: { coverage_scope: null, classCodeFieldName: "class_code" },
  defaultSize: "regular",
  execute: (_inputs, _params, _ctx) => {
    // Stub — the runtime substitutes the resolved value before reaching
    // here. See runtime.ts special-case for `input.class_exposure`.
    // Returning 0 (instead of throwing) keeps direct callers
    // deterministic; they get an obvious "you bypassed the runtime"
    // signal rather than an exception.
    return { value: 0 };
  },
  validate: (params) => {
    if (
      params.classCodeFieldName !== undefined &&
      params.classCodeFieldName.trim() === ""
    ) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "classCodeFieldName must be a non-empty string when set",
            field: "classCodeFieldName",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  // explainStep intentionally omitted — the runtime constructs a richer
  // explanation directly in the trace entry (it has access to the
  // resolved class display_name + declaration), and the stub execute()
  // doesn't carry enough info to produce a useful one. Per Brief 16 §6
  // (resolution sentence written verbatim into the trace).
};
