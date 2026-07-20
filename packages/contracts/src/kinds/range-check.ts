/**
 * `range.check` kind — value in [lo, hi] → bool.
 *
 * Per Plan Format Spec v1 §4.5: takes a numeric value, returns true
 * iff the value falls in the range defined by params.lo and
 * params.hi. The boolean output is typically wired into a `branch`
 * block to drive conditional rating logic.
 *
 * `params.inclusive` (default true) controls the upper boundary:
 *   · true  → closed `[lo, hi]`  (value ≤ hi)
 *   · false → half-open `[lo, hi)` (value <  hi)
 *
 * Lower boundary is always inclusive — matches the source.
 */

import type { BlockKind, PortSpec } from "../block-types";

export interface RangeCheckParams {
  /** Lower bound (inclusive). */
  lo: number;
  /** Upper bound (inclusive by default; half-open when inclusive=false). */
  hi: number;
  /** When false, treat the range as half-open `[lo, hi)`. Default true. */
  inclusive?: boolean;
}

export type RangeCheckInputs = { value: number };
export type RangeCheckOutputs = { result: boolean };

export const RangeCheckKind: BlockKind<
  RangeCheckParams,
  RangeCheckInputs,
  RangeCheckOutputs
> = {
  id: "range.check",
  category: "branch",
  label: "Range check",
  description: "True iff value falls in [lo, hi]",
  inputs: [
    {
      name: "value",
      type: "float",
      description: "The value to test",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "result",
      type: "bool",
      description: "True iff lo ≤ value ≤ hi (or value < hi when inclusive=false)",
    } as PortSpec,
  ],
  defaultParams: {
    lo: 0,
    hi: 1,
    inclusive: true,
  },
  defaultSize: "compact",
  provenance: "core",
  certainty: "draft",
  determinism: "strict",
  sideEffects: "none",
  execute: (inputs, params) => {
    const inclusive = params.inclusive ?? true;
    const result = inclusive
      ? inputs.value >= params.lo && inputs.value <= params.hi
      : inputs.value >= params.lo && inputs.value < params.hi;
    return { result };
  },
  validate: (params) => {
    if (typeof params.lo !== "number" || Number.isNaN(params.lo)) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "lo must be a number",
            field: "lo",
          },
        ],
      };
    }
    if (typeof params.hi !== "number" || Number.isNaN(params.hi)) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "hi must be a number",
            field: "hi",
          },
        ],
      };
    }
    if (params.lo > params.hi) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "lo must be ≤ hi",
            field: "lo",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
};
