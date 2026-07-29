/**
 * `chain.dim_sum` kind — per-rating-dimension premium summing.
 *
 * The substrate companion to Brief 35 (Assemble: dimensioned premium
 * towers). For a plan whose multiplicative chain is split across the
 * levels of a rating dimension (e.g., `coverage` ∈ {Building, BPP, BI,
 * GL}), each per-level chain produces a level-tagged premium. A
 * `chain.dim_sum` node fans those level premiums in and outputs a
 * single Total premium for the plan.
 *
 *   Building chain (rating_dimension.level_id = "building")  ─┐
 *   BPP chain      (rating_dimension.level_id = "bpp")       ─┤
 *   BI chain       (rating_dimension.level_id = "bi")        ─┼─→ chain.dim_sum
 *   GL chain       (rating_dimension.level_id = "gl")        ─┘    {dim_slug: "coverage"}
 *                                                                  → total_premium
 *
 * Sibling of `chain.lob_sum` (Brief 17): identical fan-in shape +
 * defensive coercion. The difference is what they aggregate over —
 * `lob_sum` sums coverage premiums **within** a single LOB; `dim_sum`
 * sums per-level chain outputs **within** a single rating dimension.
 * A multi-LOB plan that also splits each LOB's chain by coverage
 * uses both: per-LOB `dim_sum`s feeding into plan-level `lob_sum`s.
 *
 * Pure. No special-casing in the runtime — the cardinality-N
 * `level_outputs` port is the same fan-in path `chain.lob_sum` uses.
 * Per node-design-principle P-N1 (pure execute) + P-N2 (typed I/O).
 *
 * See `docs/design-briefs/35-assemble-dimensioned-towers.md` §4.1
 * for the wire-format spec + §7 for the rendering semantics.
 */

import type { BlockKind, PortSpec } from "../block-types";

export interface ChainDimSumParams {
  /**
   * Slug of the rating dimension this Total tower sums over (e.g.,
   * `coverage`). Drives the `explainStep` label + the trace's
   * dim-grouping. Cross-checked at compile time against the plan's
   * dimensions; the kind itself just verifies non-empty.
   */
  readonly dim_slug: string;
  /**
   * Bookkeeping map of `level_id → upstream_output_field_name` (e.g.,
   * `{ building: "building_premium", bi: "bi_premium" }`). The
   * runtime does NOT use the map to read values — fan-in via the
   * `level_outputs` port collects whatever is wired. The map exists
   * so the converter + trace can label values by level and so the UI
   * knows which level a missing wire belongs to (for the
   * "BPP premium not computed; total excludes it" warn-level issue).
   */
  readonly level_field_map: { readonly [level_id: string]: string };
  /**
   * Optional name for the output field this Total tower writes (e.g.,
   * `total_premium`). The engine routes outputs via wires, not via
   * this field — it lives here so the converter can wire the right
   * downstream port. Defaults to `total_premium` when absent.
   */
  readonly output_field?: string;
}

export type ChainDimSumInputs = { level_outputs: readonly number[] };
export type ChainDimSumOutputs = { value: number };

export const DEFAULT_DIM_SUM_OUTPUT_FIELD = "total_premium";

export const ChainDimSumKind: BlockKind<
  ChainDimSumParams,
  ChainDimSumInputs,
  ChainDimSumOutputs
> = {
  id: "chain.dim_sum",
  category: "chain",
  label: "Total premium",
  description:
    "Sums per-level chain outputs for a single rating dimension (Brief 35).",
  inputs: [
    {
      name: "level_outputs",
      type: "money",
      cardinality: "N",
      description: "Per-level chain outputs to sum (fan-in).",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "money",
      description: "Total premium (sum of all level outputs).",
    } as PortSpec,
  ],
  defaultParams: {
    dim_slug: "coverage",
    level_field_map: {},
    output_field: DEFAULT_DIM_SUM_OUTPUT_FIELD,
  },
  defaultSize: "regular",
  execute: (inputs) => {
    // Cardinality-N: the runtime gathers all wired upstream outputs
    // into an array. Defensive coercion — skip non-numeric entries
    // (we don't poison the sum with NaN; missing levels are a
    // graph-level concern surfaced by validators / trace warnings,
    // not an arithmetic concern).
    const arr = Array.isArray(inputs.level_outputs)
      ? inputs.level_outputs
      : [];
    let total = 0;
    for (const p of arr) {
      if (typeof p === "number" && Number.isFinite(p)) {
        total += p;
      }
    }
    return { value: total };
  },
  validate: (params) => {
    // The dim_slug is the only field a kind-level validator can
    // check without graph context. level_field_map shape + cross-
    // references to actual dimensions happen at plan-level
    // validation (collectIssues), not here.
    if (!params.dim_slug) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "dim_slug is required",
            field: "dim_slug",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    const arr = Array.isArray(inputs.level_outputs)
      ? inputs.level_outputs
      : [];
    const wiredCount = arr.length;
    const expectedCount = Object.keys(params.level_field_map ?? {}).length;
    const dim = params.dim_slug;
    const noun = wiredCount === 1 ? "level chain" : "level chains";
    // Surface the gap if some expected levels weren't wired. Helps
    // an actuary spot a missing per-level tower at trace-read time.
    const gap =
      expectedCount > wiredCount
        ? ` (${expectedCount - wiredCount} level${
            expectedCount - wiredCount === 1 ? "" : "s"
          } missing)`
        : "";
    return `Total ${dim} premium = sum of ${wiredCount} ${noun}${gap} → ${outputs.value}`;
  },
};
