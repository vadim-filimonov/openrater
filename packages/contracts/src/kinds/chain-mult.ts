/**
 * `chain.mult` kind — multiplicative chain.
 *
 * The heart of every rating cascade:
 *   premium = base × hazard × class × territory × schedule × credits × …
 *
 * Takes a `base` (money) input and N `factors` (factor, cardinality
 * 'N' fan-in), produces `result` (money). Order matters for audit /
 * explain output even though multiplication is commutative; the
 * runtime preserves the wiring order when gathering the fan-in port.
 *
 * Optional `stopOnZero` short-circuits to 0 when any factor is zero
 * (useful for binary kill-switches encoded as 0/1 factors).
 */

import type { BlockKind, PortSpec } from "../block-types";
import { toFiniteNumber } from "./coerce-numeric";

export interface ChainMultParams {
  /** Optional display names for the factor slots, in order. Audit-facing. */
  factorNames?: readonly string[];
  /** When true, a single 0 factor short-circuits the chain to 0. */
  stopOnZero?: boolean;
}

export type ChainMultInputs = { base: number; factors: readonly number[] };
export type ChainMultOutputs = { result: number };

export const ChainMultKind: BlockKind<
  ChainMultParams,
  ChainMultInputs,
  ChainMultOutputs
> = {
  id: "chain.mult",
  category: "chain",
  label: "Multiplicative chain",
  description: "base × factor₁ × factor₂ × … — the heart of every cascade",
  inputs: [
    {
      name: "base",
      type: "money",
      description: "Starting value",
    } as PortSpec,
    {
      name: "factors",
      type: "factor",
      cardinality: "N",
      description: "Factors to multiply, in order",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "result",
      type: "money",
      description: "base × ∏ factors",
    } as PortSpec,
  ],
  defaultParams: { factorNames: [], stopOnZero: false },
  defaultSize: "regular",
  execute: (inputs, params) => {
    // A non-finite base or factor must REFUSE, not improvise. JS
    // arithmetic silently coerces `null`/`[]`/`""`→0 and `true`→1, so a
    // required money input arriving as any of those produced a WRONG
    // premium served as `row_status:"ok"` (audit A-2026-07-12 P1-01).
    // Emitting NaN routes through the output node's unresolved-output
    // backstop, which WITHHOLDS the premium and names the refusal (the
    // gate already treats NaN/±Infinity as broken arithmetic). A value
    // that is genuinely a finite number is byte-identical to before.
    const base = toFiniteNumber(inputs.base);
    if (Number.isNaN(base)) return { result: NaN };
    let acc = base;
    for (const raw of inputs.factors as readonly unknown[]) {
      const f = toFiniteNumber(raw);
      if (Number.isNaN(f)) return { result: NaN };
      if (params.stopOnZero && f === 0) return { result: 0 };
      acc *= f;
    }
    return { result: acc };
  },
  jacobian: (inputs, _params, outputs) => {
    // ∂result/∂base = ∏ factors = result / base
    // Per-factor partials live in the canvas/inspector layer that
    // knows the wiring — the fan-in port has no per-index keys at
    // the contract level so we only emit the base partial here.
    return {
      "result/base": {
        base: inputs.base !== 0 ? outputs.result / inputs.base : 0,
      },
    };
  },
  validate: (_params) => ({ valid: true, issues: [] }),
  explainStep: (inputs, params, outputs) => {
    if (inputs.factors.length === 0) {
      return `${inputs.base} (no factors) → ${outputs.result}`;
    }
    const names = params.factorNames ?? [];
    const parts: string[] = [String(inputs.base)];
    for (let i = 0; i < inputs.factors.length; i++) {
      const v = inputs.factors[i];
      const name = names[i];
      parts.push(name ? `${v} (${name})` : String(v));
    }
    return `${parts.join(" × ")} = ${outputs.result}`;
  },
};
