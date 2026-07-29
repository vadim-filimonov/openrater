/**
 * `input` kind — declares an external input port for the plan.
 *
 * The plan needs an external value to start with (e.g.,
 * `account.tiv_building`, `account.alcohol_intensity`). An `input`
 * block declares one of those values.
 *
 * `execute()` is a contract-only stub. The runtime SPECIAL-CASES the
 * `input` and `input.source` kind ids (see `runtime.ts` line ~231)
 * and substitutes `externalInputs[params.fieldName]` (falling back to
 * `params.defaultValue`) before reaching `execute`. The stub here
 * returns `{ value: null }` so the BlockKind contract is satisfied
 * if a caller bypasses the runtime.
 *
 * Ported from `<prototype>/plan-builder/src/blocks/kinds/
 * input.tsx` (Phase A.1 PR 5). PURE half only — params + execute +
 * validate. React renderBody/renderInspector live in the rate-lab
 * frontend in the original port plan.
 */

import type { BlockKind, PortSpec, PrimitiveType } from "../block-types";

export interface InputParams {
  /** External-inputs key. The runtime reads externalInputs[fieldName]. */
  fieldName: string;
  /** Primitive type of the value (drives the output port type). */
  fieldType: PrimitiveType;
  /** Fallback value when externalInputs has no value for this field. */
  defaultValue?: unknown;
  /** Human-readable description (shown in inspector + audit trace). */
  description?: string;
}

export type InputInputs = Record<string, never>;
export type InputOutputs = { value: unknown };

export const InputKind: BlockKind<InputParams, InputInputs, InputOutputs> = {
  id: "input",
  category: "input",
  label: "Input",
  description: "Declares an external input port for the plan",
  inputs: [],
  outputs: [
    {
      name: "value",
      type: "money",
      description: "The value provided at runtime",
    } as PortSpec,
  ],
  defaultParams: {
    fieldName: "untitled_input",
    fieldType: "money",
  },
  defaultSize: "regular",
  execute: (_inputs, _params) => {
    // Stub — the runtime substitutes the external value before
    // reaching here. See runtime.ts special-case for `input`.
    return { value: null as unknown };
  },
  validate: (params) => {
    if (!params.fieldName || params.fieldName.trim() === "") {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "Field name is required",
            field: "fieldName",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (_inputs, params, outputs) => {
    if (outputs.value === undefined) {
      return `External input \`${params.fieldName}\` not supplied (no default)`;
    }
    return `External input \`${params.fieldName}\` → ${outputs.value}`;
  },
};
