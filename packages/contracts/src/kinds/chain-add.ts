/**
 * `chain.add` kind — additive chain.
 *
 *   result = base + addend₁ + addend₂ + …
 *
 * Used for loss costs, fees, taxes, and any other additive
 * composition. Twin to `chain.mult` — same shape, addition instead
 * of multiplication. `base` is optional with a default of 0 so this
 * kind cleanly handles "pure summation" use cases where no starting
 * value is wired.
 *
 * Ported from `<prototype>/plan-builder/src/blocks/kinds/
 * chain-add.tsx` (Phase A.1 PR 7). PURE half only.
 */

import type { BlockKind, PortSpec } from "../block-types";

export interface ChainAddParams {
  /** Display names for each addend slot (audit-facing). */
  addendNames?: readonly string[];
}

export type ChainAddInputs = { base?: number; addends: readonly number[] };
export type ChainAddOutputs = { result: number };

export const ChainAddKind: BlockKind<
  ChainAddParams,
  ChainAddInputs,
  ChainAddOutputs
> = {
  id: "chain.add",
  category: "chain",
  label: "Additive chain",
  description: "base + addend₁ + addend₂ + … (loss costs, fees, taxes)",
  inputs: [
    {
      name: "base",
      type: "factor",
      optional: true,
      default: 0,
      description: "Starting value",
    } as PortSpec,
    {
      name: "addends",
      type: "factor",
      cardinality: "N",
      description: "Values to add, in order",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "result",
      type: "factor",
      description: "base + Σ addends",
    } as PortSpec,
  ],
  defaultParams: { addendNames: [] },
  defaultSize: "regular",
  execute: (inputs) => {
    // Coerce to number before summing. Unlike chain.mult's `*=` (which JS
    // coerces a string operand to a number), `+=` STRING-CONCATENATES when an
    // input arrives as a string — e.g. a raw form/CSV value. A computed sum
    // like `building_limit + bpp_limit` would become "080000050000" → the
    // downstream derive.band buckets nothing → every row clamps out-of-range →
    // the factor silently resolves to 1.0 (the Sample BOP deductible mispriced
    // $880 vs the oracle $1,210). Number() makes the additive chain robust to
    // string inputs, matching chain.mult's effective coercion.
    const base = Number(inputs.base ?? 0);
    let acc = base;
    for (const a of inputs.addends) acc += Number(a);
    return { result: acc };
  },
  jacobian: (_inputs, _params, _outputs) => ({
    // ∂result/∂base = 1; ∂result/∂addend_i = 1 (canvas-layer concern)
    "result/base": { base: 1 },
  }),
  validate: (_params) => ({ valid: true, issues: [] }),
  explainStep: (inputs, params, outputs) => {
    const base = inputs.base ?? 0;
    if (inputs.addends.length === 0) {
      return `${base} (no addends) → ${outputs.result}`;
    }
    const names = params.addendNames ?? [];
    // FCA #34 (findings 25/53) — the zero accumulator seed opened
    // every package line ("0 + 822 + 211 = 1033"); it's an
    // implementation detail, not arithmetic the manual shows. And a
    // NaN addend drew a MINUS sign (NaN >= 0 is false), so failed
    // rows read "0 − NaN − NaN = NaN". Drop the empty seed; name
    // unresolved addends and end honestly.
    const parts: string[] = base === 0 ? [] : [String(base)];
    const unresolved: string[] = [];
    for (let i = 0; i < inputs.addends.length; i++) {
      const v = inputs.addends[i]!;
      const name = names[i];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        unresolved.push(name ?? `addend ${i + 1}`);
        continue;
      }
      const sign = v >= 0 ? "+" : "−";
      const abs = Math.abs(v);
      const first = parts.length === 0;
      const term = first && v >= 0 ? String(abs) : `${sign} ${abs}`;
      parts.push(name ? `${term} (${name})` : term);
    }
    if (parts.length === 0) parts.push("0");
    if (unresolved.length > 0) {
      return `${parts.join(" ")} — unresolved: ${unresolved.join(
        ", ",
      )} (see this row's issues)`;
    }
    return `${parts.join(" ")} = ${outputs.result}`;
  },
};
