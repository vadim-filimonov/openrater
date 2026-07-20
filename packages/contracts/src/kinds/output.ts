/**
 * `output` kind — declares an external output port for the plan.
 *
 * The plan exposes a computed value to its caller (e.g.,
 * `indicated_premium`). An `output` block declares one of those
 * values. Wire whatever you want exposed into the block's `value`
 * input port.
 *
 * `execute()` returns `{}` (the kind has no output ports — it's a
 * sink). The runtime SPECIAL-CASES `output` (see `runtime.ts` line
 * ~288): after gathering the node's `value` input, it copies that
 * value into `result.outputs[params.fieldName]` so the caller sees
 * it in the run's outputs map.
 */

import type { BlockKind, PortSpec, PrimitiveType } from "../block-types";

export interface OutputParams {
  /** Key under which the value appears in `result.outputs`. */
  fieldName: string;
  /** Primitive type of the value (drives the input port type). */
  fieldType: PrimitiveType;
  /** Human-readable description (shown in inspector + audit trace). */
  description?: string;
}

export type OutputInputs = { value: unknown };
export type OutputOutputs = Record<string, never>;

export const OutputKind: BlockKind<OutputParams, OutputInputs, OutputOutputs> =
  {
    id: "output",
    category: "output",
    label: "Output",
    description: "Declares an external output port that this plan produces",
    inputs: [
      {
        name: "value",
        type: "money",
        description: "The value to expose to the plan caller",
      } as PortSpec,
    ],
    outputs: [],
    defaultParams: {
      fieldName: "untitled_output",
      fieldType: "money",
    },
    defaultSize: "regular",
    execute: (_inputs, _params) => {
      // The kind has no output ports — the runtime collects the
      // gathered `value` input into result.outputs[fieldName].
      return {} as OutputOutputs;
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
    explainStep: (inputs, params, _outputs) =>
      `Output \`${params.fieldName}\` = ${inputs.value}`,
  };
