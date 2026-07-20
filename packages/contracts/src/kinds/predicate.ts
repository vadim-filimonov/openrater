/**
 * `predicate` kind — boolean expression on a numeric input.
 *
 * The simplest classifier. Compare an input to a threshold and emit a
 * bool. Composes naturally with `branch` (which chooses between two
 * values based on a predicate).
 *
 *   x op threshold → bool
 *
 * where op ∈ { eq, ne, lt, le, gt, ge }.
 */

import type { BlockKind, PortSpec } from "../block-types";

export type PredicateOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

export interface PredicateParams {
  op: PredicateOp;
  threshold: number;
  description?: string;
}

export type PredicateInputs = { x: number };
export type PredicateOutputs = { value: boolean };

export function evaluatePredicate(
  op: PredicateOp,
  x: number,
  t: number,
): boolean {
  switch (op) {
    case "eq":
      return x === t;
    case "ne":
      return x !== t;
    case "lt":
      return x < t;
    case "le":
      return x <= t;
    case "gt":
      return x > t;
    case "ge":
      return x >= t;
  }
}

export const PredicateKind: BlockKind<
  PredicateParams,
  PredicateInputs,
  PredicateOutputs
> = {
  id: "predicate",
  category: "transform",
  label: "Predicate",
  description: "Boolean expression on a numeric input",
  inputs: [
    {
      name: "x",
      type: "factor",
      description: "Value to test",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "bool",
      description: "Whether x satisfies the predicate",
    } as PortSpec,
  ],
  defaultParams: { op: "gt", threshold: 0 },
  defaultSize: "regular",
  execute: (inputs, params) => ({
    value: evaluatePredicate(params.op, inputs.x, params.threshold),
  }),
  validate: (params) => {
    if (
      typeof params.threshold !== "number" ||
      Number.isNaN(params.threshold)
    ) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "Threshold must be a number",
            field: "threshold",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
};
