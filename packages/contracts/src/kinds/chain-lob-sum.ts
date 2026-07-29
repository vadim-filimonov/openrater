/**
 * `chain.lob_sum` kind — per-LOB premium summing.
 *
 * The companion to Brief 17 (multi-LOB plans). For a multi-LOB plan
 * (e.g., a CMP with property + liability), each coverage chain feeds
 * into a `chain.lob_sum` node tagged with its LOB code. The lob_sum
 * adds up all coverage premiums for that LOB and outputs the LOB-level
 * total. A plan-level summing block then adds the LOB totals together
 * to produce the final plan premium.
 *
 *   Building chain         ─┐
 *   Contents chain         ─┼─→ chain.lob_sum {lob_tag: "property"} ─→ $8,450
 *   (other property)       ─┘
 *
 *   Premises liability     ─┐
 *   Products liability     ─┼─→ chain.lob_sum {lob_tag: "liability"} ─→ $4,100
 *   ...                    ─┘
 *
 *   Property LOB premium + Liability LOB premium = Plan-level total
 *
 * This kind is the structural bridge between per-coverage rating and
 * the plan-level outputs. The cardinality-N `premiums` input port
 * accepts any number of upstream coverage chain outputs; the runtime
 * collects them via the fan-in path.
 *
 * Pure. No special-casing in the runtime. Per Brief 17 P-ML8 (LOB
 * grouping is consistent + structural).
 *
 * See `docs/design-briefs/multi-lob-plans.md` §6 for the data shape
 * + §7 for the rendering semantics.
 */

import type { BlockKind, PortSpec } from "../block-types";

export interface ChainLobSumParams {
  /**
   * The tag this sum represents — an OPAQUE identifier (a `coverage_id`
   * or `product` code; ADR-0033 §0). Drives the `explainStep` label +
   * the trace's grouping only; the runtime never branches on its value.
   * Any non-empty string is valid (re-keyed off the closed `LineCode`
   * vocabulary in ADR-0033 gate 5).
   */
  readonly lob_tag: string;
}

export type ChainLobSumInputs = { premiums: readonly number[] };
export type ChainLobSumOutputs = { value: number };

export const ChainLobSumKind: BlockKind<
  ChainLobSumParams,
  ChainLobSumInputs,
  ChainLobSumOutputs
> = {
  id: "chain.lob_sum",
  category: "chain",
  label: "LOB premium",
  description:
    "Sums all coverage premiums for a single line of business (Brief 17).",
  inputs: [
    {
      name: "premiums",
      type: "money",
      cardinality: "N",
      description: "Per-coverage premiums to sum (fan-in).",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "money",
      description: "Total LOB premium (sum of all coverage premiums).",
    } as PortSpec,
  ],
  defaultParams: { lob_tag: "liability" },
  defaultSize: "regular",
  execute: (inputs) => {
    // Cardinality-N: the runtime gathers all wired upstream outputs
    // into an array. Defensive coercion: skip non-numeric entries
    // (the conformance vector for missing values catches this; we
    // don't poison the sum with NaN).
    const arr = Array.isArray(inputs.premiums) ? inputs.premiums : [];
    let total = 0;
    for (const p of arr) {
      if (typeof p === "number" && Number.isFinite(p)) {
        total += p;
      }
    }
    return { value: total };
  },
  validate: (params) => {
    // The tag is an opaque identifier (ADR-0033 §0) — any non-empty
    // string is valid; we only confirm the field is populated. An
    // empty/missing tag is a configuration error.
    if (!params.lob_tag) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "lob_tag is required",
            field: "lob_tag",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    const arr = Array.isArray(inputs.premiums) ? inputs.premiums : [];
    const n = arr.length;
    // The tag is opaque — titleize it for display (no fixed vocabulary
    // to map against). "premises_liability" → "Premises Liability".
    const label = params.lob_tag
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return `${label} LOB premium = sum of ${n} coverage chain${
      n === 1 ? "" : "s"
    } → ${outputs.value}`;
  },
};
