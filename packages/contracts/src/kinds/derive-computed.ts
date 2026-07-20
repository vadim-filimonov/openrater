/**
 * `derive.computed` kind — a derived field from arithmetic over inputs (E03).
 *
 * The bridge that lets an appetite gate read a COMPUTED quantity (e.g.
 * `tiv = building_limit + bpp_limit`) instead of only a raw input. The
 * expression is a closed, typed AST (`ComputedExpr`) — `+ − × ÷` over named
 * inputs + constants — NOT a string to `eval`, so it is inspectable, portable,
 * and deterministic.
 *
 * Like `eligibility.gate` + `input.source`, it reads `ctx.externalInputs`
 * (the expression names input keys) and has no wire inputs; it emits the
 * derived value on its single `value` output. When the batch orchestrator
 * (`evaluatePolicyBook`) runs a book, it surfaces each derived field back into
 * `externalInputs` before the per-row run so the gate + the roll-up see it.
 *
 * Per node-design-principle P-N1 (pure execute): no side effects, no I/O.
 * Same `(expr, inputs)` → same value forever. P-N5/P-N4: `explainStep` renders
 * a citation-friendly line `tiv = building_limit + bpp_limit = 1060000`.
 * P-N6: `validate` rejects a malformed AST at authoring time.
 */

import type { BlockKind, PortSpec, ValidationIssue } from "../block-types";
import {
  type ComputedExpr,
  evaluateComputedExpr,
  validateComputedExpr,
  formatComputedExpr,
} from "../policy-appetite";

export interface DeriveComputedParams {
  /** The derived field's name — audit/trace facing + the key the orchestrator
   *  merges back into externalInputs (e.g. `tiv`). */
  readonly fieldName: string;
  /** The arithmetic AST evaluated against `ctx.externalInputs`. */
  readonly expr: ComputedExpr;
}

export type DeriveComputedInputs = Record<string, never>;
export type DeriveComputedOutputs = { value: number };

export const DeriveComputedKind: BlockKind<
  DeriveComputedParams,
  DeriveComputedInputs,
  DeriveComputedOutputs
> = {
  id: "derive.computed",
  category: "transform",
  label: "Computed field",
  description:
    "Derive a field by arithmetic over inputs (e.g. tiv = building_limit + bpp_limit)",
  inputs: [],
  outputs: [
    {
      name: "value",
      type: "float",
      description: "The computed value",
    } as PortSpec,
  ],
  defaultParams: { fieldName: "", expr: { kind: "const", value: 0 } },
  defaultSize: "compact",
  execute: (_inputs, params, ctx) => ({
    value: evaluateComputedExpr(params.expr, ctx?.externalInputs ?? {}),
  }),
  validate: (params) => {
    const issues: ValidationIssue[] = [];
    if (!params.fieldName || params.fieldName.trim() === "") {
      issues.push({
        severity: "error",
        message: "A derived field needs a non-empty fieldName.",
        field: "fieldName",
      });
    }
    const exprErr = validateComputedExpr(params.expr);
    if (exprErr) {
      issues.push({ severity: "error", message: exprErr, field: "expr" });
    }
    return { valid: !issues.some((i) => i.severity === "error"), issues };
  },
  explainStep: (_inputs, params, outputs) =>
    `${params.fieldName || "value"} = ${formatComputedExpr(params.expr)} = ${outputs.value}`,
};
