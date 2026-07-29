/**
 * `round` kind — round a value to a fixed number of decimal places.
 *
 * The ISO rate algorithms round at well-defined points: the per-$100
 * RATE rounds to 3 decimals before the exposure/LCM close-out, and the
 * final PREMIUM rounds to the nearest dollar (0 decimals). Those
 * roundings change the answer by a few dollars, so they must live IN
 * the runtime plan, not in a harness post-step — the
 * `stagesToRuntimePlan` projector (ADR-0044) emits a `round` node for
 * each ISO rounding so a UI-authored plan scores exactly.
 *
 * Semantics are byte-identical to the reference build
 * (`sample_bop_track_a.test.ts`): `Math.round(value × 10^decimals) /
 * 10^decimals`. JS `Math.round` is half-up toward +∞ on ties — the
 * `mode` param is reserved for future tie-breaking variants but only
 * `half_up` ships today.
 *
 * Per node-design-principles P-N1 (pure execute): same value + same
 * params → same output forever. P-N5 (trace): `explainStep` reads
 * "round 0.6159 → 0.616 (3 dp)".
 */

import type { BlockKind, PortSpec } from "../block-types";

export interface RoundParams {
  /** Number of decimal places to keep. 0 = nearest whole unit. */
  decimals: number;
  /**
   * Tie-breaking mode. Only `half_up` (JS Math.round — ties toward
   * +∞) is implemented today; reserved for future `half_even` etc.
   */
  mode?: "half_up";
}

export type RoundInputs = { value: number };
export type RoundOutputs = { value: number };

/** Pure rounding helper — `Math.round(value × 10^decimals) / 10^decimals`. */
export function roundToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export const RoundKind: BlockKind<RoundParams, RoundInputs, RoundOutputs> = {
  id: "round",
  category: "math",
  label: "Round",
  description: "Round a value to a fixed number of decimal places (half-up)",
  inputs: [
    {
      name: "value",
      type: "float",
      description: "The value to round",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "float",
      description: "The rounded value",
    } as PortSpec,
  ],
  defaultParams: {
    decimals: 0,
    mode: "half_up",
  },
  defaultSize: "compact",
  provenance: "core",
  certainty: "draft",
  determinism: "strict",
  sideEffects: "none",
  execute: (inputs, params) => ({
    value: roundToDecimals(inputs.value, params.decimals),
  }),
  // Rounding is piecewise-constant: its gradient is 0 almost everywhere
  // (undefined at the breakpoints). Report no slope so an inverse
  // cascade treats it as a flat step rather than a smooth pass-through.
  jacobian: () => ({}),
  validate: (params) => {
    if (
      typeof params.decimals !== "number" ||
      !Number.isFinite(params.decimals) ||
      !Number.isInteger(params.decimals)
    ) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "decimals must be a finite integer",
            field: "decimals",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) =>
    `round ${inputs.value} → ${outputs.value} (${params.decimals} dp)`,
};
