/**
 * `math.op` kind — arithmetic operations.
 *
 * A single block parameterized by `op` that dispatches to:
 *   · clamp(x, lo, hi)
 *   · log(x), exp(x), sigmoid(x)
 *   · min(x, y), max(x, y)
 *   · add(x, y), sub(x, y), mul(x, y), div(x, y)
 *
 * For clamp specifically, `lo` and `hi` are inline literals on the
 * block's params (not wired ports) — they're "small parts" that
 * don't need their own constant nodes.
 *
 * Ported from `<prototype>/plan-builder/src/blocks/kinds/
 * math-op.tsx` (Phase A.1 PR 4). PURE half only — params + execute
 * + jacobian + validate. React renderBody/renderInspector live in
 * the rate-lab frontend in the original port plan.
 *
 * Per P-N1: pure execute(). The runtime errors (division by zero,
 * missing y for binary ops, missing lo/hi for clamp) are thrown as
 * regular Error so the runner can catch + categorize them.
 */

import type { BlockKind, Jacobian, PortSpec } from "../block-types";
import { toFiniteNumber } from "./coerce-numeric";

export type MathOp =
  | "clamp"
  | "log"
  | "exp"
  | "sigmoid"
  | "min"
  | "max"
  | "add"
  | "sub"
  | "mul"
  | "div";

export interface MathOpParams {
  op: MathOp;
  /** Inline literals for clamp (lo/hi). Other ops ignore these. */
  lo?: number;
  hi?: number;
}

export type MathOpInputs = { x: number; y?: number };
export type MathOpOutputs = { result: number };

/**
 * Pure dispatch. Throws on invalid combinations (missing operand,
 * division by zero) — the runner is responsible for categorizing
 * these as `domain-error` per the engine-contract spec.
 */
export function executeMath(
  op: MathOp,
  x: number,
  y: number | undefined,
  lo: number | undefined,
  hi: number | undefined,
): number {
  // A non-numeric operand must REFUSE, not improvise. JS arithmetic
  // silently coerces null/[]/""→0 and true→1, so a required numeric
  // input arriving as any of those produced a WRONG premium served as
  // `row_status:"ok"` (audit A-2026-07-12 P1-01 — the building exposure
  // `expdiv` is a math.op `div`, and `null / 100` was 0, not a refusal).
  // `toFiniteNumber` still coerces a clean numeric STRING (the wire is
  // stringly and the input node isn't always re-typed), so a valid
  // "200000" rates identically; only genuinely non-numeric values become
  // NaN, which the output backstop turns into a withheld premium. A
  // present-but-non-numeric y refuses too; a genuinely ABSENT y
  // (undefined = the wire isn't connected) stays a structural error the
  // switch below still throws on.
  x = toFiniteNumber(x);
  if (Number.isNaN(x)) return NaN;
  if (y !== undefined) {
    y = toFiniteNumber(y);
    if (Number.isNaN(y)) return NaN;
  }
  switch (op) {
    case "clamp":
      if (lo === undefined || hi === undefined) {
        throw new Error("clamp requires lo and hi params");
      }
      return Math.min(hi, Math.max(lo, x));
    case "log":
      return Math.log(x);
    case "exp":
      return Math.exp(x);
    case "sigmoid":
      return 1 / (1 + Math.exp(-x));
    case "min":
      if (y === undefined) throw new Error("min requires y input");
      return Math.min(x, y);
    case "max":
      if (y === undefined) throw new Error("max requires y input");
      return Math.max(x, y);
    case "add":
      if (y === undefined) throw new Error("add requires y input");
      return x + y;
    case "sub":
      if (y === undefined) throw new Error("sub requires y input");
      return x - y;
    case "mul":
      if (y === undefined) throw new Error("mul requires y input");
      return x * y;
    case "div":
      if (y === undefined) throw new Error("div requires y input");
      if (y === 0) throw new Error("Division by zero");
      return x / y;
  }
}

export const MathOpKind: BlockKind<MathOpParams, MathOpInputs, MathOpOutputs> = {
  id: "math.op",
  category: "math",
  label: "Math op",
  description:
    "Arithmetic operations: clamp, log, exp, sigmoid, min, max, +, −, ×, ÷",
  inputs: [
    { name: "x", type: "factor", description: "Primary input" } as PortSpec,
    {
      name: "y",
      type: "factor",
      optional: true,
      description: "Secondary input (binary ops only)",
    } as PortSpec,
  ],
  outputs: [
    { name: "result", type: "factor", description: "Computed result" } as PortSpec,
  ],
  defaultParams: { op: "clamp", lo: 0.75, hi: 1.25 },
  defaultSize: "regular",
  execute: (inputs, params) => ({
    result: executeMath(params.op, inputs.x, inputs.y, params.lo, params.hi),
  }),
  jacobian: (inputs, params, outputs): Jacobian => {
    // Simple Jacobians for unary ops. Binary ops covered when needed.
    const { x } = inputs;
    const r = outputs.result;
    let slope = 0;
    switch (params.op) {
      case "clamp":
        if (params.lo !== undefined && params.hi !== undefined) {
          slope = x > params.lo && x < params.hi ? 1 : 0;
        }
        break;
      case "log":
        slope = 1 / x;
        break;
      case "exp":
        slope = r;
        break;
      case "sigmoid":
        slope = r * (1 - r);
        break;
      default:
        return {};
    }
    return { "result/x": { x: slope } };
  },
  validate: (params) => {
    if (params.op === "clamp") {
      if (params.lo === undefined || params.hi === undefined) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: "Clamp requires both lo and hi bounds",
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
              message: "Lo bound must be ≤ hi bound",
            },
          ],
        };
      }
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    const r = outputs.result;
    switch (params.op) {
      case "clamp":
        return `Clamp ${inputs.x} to [${params.lo}, ${params.hi}] → ${r}`;
      case "log":
        return `log(${inputs.x}) = ${r}`;
      case "exp":
        return `exp(${inputs.x}) = ${r}`;
      case "sigmoid":
        return `sigmoid(${inputs.x}) = ${r}`;
      case "min":
        return `min(${inputs.x}, ${inputs.y}) = ${r}`;
      case "max":
        return `max(${inputs.x}, ${inputs.y}) = ${r}`;
      case "add":
        return `${inputs.x} + ${inputs.y} = ${r}`;
      case "sub":
        return `${inputs.x} − ${inputs.y} = ${r}`;
      case "mul":
        return `${inputs.x} × ${inputs.y} = ${r}`;
      case "div":
        return `${inputs.x} ÷ ${inputs.y} = ${r}`;
    }
  },
};
