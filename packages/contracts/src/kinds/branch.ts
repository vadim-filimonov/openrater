/**
 * `branch` kind — if-then-else with typed-identical branches.
 *
 * Reads a `predicate` (bool) and chooses between two values of the
 * same type. The output type matches whatever `then` and `else` are
 * wired to — both must agree (enforced upstream by the type checker
 * at edge-creation time).
 *
 * Note: the input port is named `else` (a reserved word in TS), but
 * it's only ever accessed as a property of the `inputs` object, never
 * as a bare identifier — so it works at runtime + compile-time.
 *
 * Ported from `<prototype>/plan-builder/src/blocks/kinds/
 * branch.tsx` (Phase A.1 PR 8). PURE half only.
 */

import type { BlockKind, PortSpec } from "../block-types";

export type BranchParams = Record<string, never>;

export interface BranchInputs {
  predicate: boolean;
  then: unknown;
  else: unknown;
}

export type BranchOutputs = { result: unknown };

export const BranchKind: BlockKind<BranchParams, BranchInputs, BranchOutputs> =
  {
    id: "branch",
    category: "branch",
    label: "Branch",
    description: "If-then-else · choose between two values",
    inputs: [
      {
        name: "predicate",
        type: "bool",
        description: "Selector",
      } as PortSpec,
      {
        name: "then",
        type: "factor",
        description: "Value when predicate is true",
      } as PortSpec,
      {
        name: "else",
        type: "factor",
        description: "Value when predicate is false",
      } as PortSpec,
    ],
    outputs: [
      {
        name: "result",
        type: "factor",
        description: "Selected value",
      } as PortSpec,
    ],
    defaultParams: {},
    defaultSize: "regular",
    execute: (inputs) => ({
      result: inputs.predicate ? inputs.then : inputs.else,
    }),
    validate: (_params) => ({ valid: true, issues: [] }),
  };
