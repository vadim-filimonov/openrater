/**
 * `constant` kind — a literal value with a type.
 *
 * The smallest brick in the box. Stores one value of one type; exposes
 * it through one output port. Useful for parameters that don't come
 * from elsewhere in the plan (caps, default factors, thresholds).
 *
 * Ported from `<prototype>/plan-builder/src/blocks/kinds/
 * constant.tsx` (Phase A.1 PR 4). The PURE half only — params type,
 * execute(), jacobian(), validate(). React renderBody/renderInspector
 * are NOT here; they live in the rate-lab frontend in the original port plan.
 *
 * Per node-design-principles P-N1 (pure execute): zero side effects.
 * Same params → same output forever.
 */

import type { BlockKind, PortSpec, PrimitiveType } from "../block-types";

export interface ConstantParams {
  value: number | string | boolean;
  type: PrimitiveType;
  /** Optional human-readable note */
  description?: string;
}

export type ConstantInputs = Record<string, never>;
export type ConstantOutputs = { value: number | string | boolean };

export const ConstantKind: BlockKind<
  ConstantParams,
  ConstantInputs,
  ConstantOutputs
> = {
  id: "constant",
  category: "constant",
  label: "Constant",
  description:
    "A literal value with a type — useful for caps, defaults, thresholds",
  inputs: [],
  outputs: [
    { name: "value", type: "factor", description: "The constant value" } as PortSpec,
  ],
  defaultParams: {
    value: 1.0,
    type: "factor",
  },
  defaultSize: "compact",
  execute: (_inputs, params) => ({ value: params.value }),
  // Constants have zero gradient — useful when downstream consumers
  // run an inverse-cascade analysis.
  jacobian: (_inputs, _params, _outputs) => ({}),
  validate: (params) => {
    if (params.value === undefined || params.value === null) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "Constant value is required",
            field: "value",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (_inputs, params, _outputs) =>
    `Constant ${params.type}: ${params.value}`,
};
