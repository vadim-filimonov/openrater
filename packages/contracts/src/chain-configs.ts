/**
 * Zod schemas for `config_json` payloads on chain-related stages.
 *
 * Mirrors the Pydantic models in
 * `server/src/openrater/rates/plans/configs.py`:
 *
 *   · DimensionBinding
 *   · FactorPredicate
 *   · FactorLookup
 *   · LcmApplication
 *   · ChainSpec
 *   · MultiplicativeChainConfig
 *   · FlatFactorConfig
 *   · FormulaConfig (subset — only the fields the M4.3 path touches)
 *
 * If the backend Pydantic shapes change, this file updates first.
 * Consumers (api-client, the factorDraftAdapter in @openrater/ui, route
 * wiring) read the inferred TypeScript types from here.
 *
 * Field lengths + value constraints are kept in sync with the
 * Pydantic `Field(min_length=…, max_length=…)` calls so that drift
 * surfaces at parse time, not at HTTP-error time.
 */

import { z } from "zod";

// ===========================================================================
// Shared building blocks
// ===========================================================================

/**
 * How a single dimension column resolves at runtime.
 *
 * A 2-D lookup axis can be sourced beyond a raw `form_input` column
 * (this is the authoring half of the runtime projector's `BindingShape`):
 *   · `literal`    — a constant key in `value`, e.g. the fictional
 *     Meridian building-limit group "group_c"; declared in data.
 *   · `computed`   — `op:"sum"` over `fields`, e.g. property total limit
 *     = building_limit + bpp_limit, then the bound dim's banded
 *     resolution buckets it.
 *   · `derived`    — the bound dim's own `derived_from` (e.g. a class
 *     attribute like prop_rate_number); `path` names the derived dim.
 *   · `form_input` / `context` — `path` names the column.
 *
 * `value` / `op` / `fields` are additive + optional so legacy
 * `{ source, path }` bindings round-trip unchanged. The refine enforces
 * exactly the source-shape each `source` needs.
 *
 * Pydantic source: `DimensionBinding` in `configs.py`.
 */
export const dimensionBindingSchema = z
  .object({
    source: z.enum(["context", "form_input", "literal", "derived", "computed"]),
    path: z.string().min(1).max(200).optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    op: z.enum(["sum"]).optional(),
    fields: z.array(z.string().min(1).max(200)).min(1).optional(),
    format: z.string().nullable().optional(),
  })
  .refine(
    (b) => {
      if (b.source === "literal") return b.value !== undefined;
      if (b.source === "computed")
        return (
          b.op !== undefined && Array.isArray(b.fields) && b.fields.length > 0
        );
      // context | form_input | derived
      return typeof b.path === "string" && b.path.length > 0;
    },
    {
      message:
        "DimensionBinding: source 'literal' needs `value`; 'computed' needs `op`+`fields`; otherwise `path` is required",
    },
  );
export type DimensionBinding = z.infer<typeof dimensionBindingSchema>;

/**
 * Optional gate on whether a factor is applied.
 *
 * Pydantic source: `FactorPredicate`.
 */
export const factorPredicateSchema = z.object({
  path: z.string().min(1).max(200),
  equals: z.union([z.boolean(), z.number(), z.string()]),
});
export type FactorPredicate = z.infer<typeof factorPredicateSchema>;

// ===========================================================================
// FactorLookup — one row inside ChainSpec.factor_lookups
// ===========================================================================

/**
 * The four lookup methods the substrate's `FactorLookup` accepts.
 * Maps to UI's FactorDraft.kind via the adapter:
 *   · "direct"       ← lookup.direct / lookup.classification
 *   · "interpolated" ← legacy curve concept kept on the wire for
 *                       backward compatibility; the reverse adapter
 *                       maps it to `lookup.range` in the UI.
 *   · "binned"       ← lookup.range (when half-open intervals)
 *   · "bracketed"    ← lookup.range (when explicit-upper intervals; default)
 */
export const factorLookupMethodSchema = z.enum([
  "direct",
  "interpolated",
  "binned",
  "bracketed",
]);
export type FactorLookupMethod = z.infer<typeof factorLookupMethodSchema>;

/**
 * The authored disposition for a lookup key that doesn't resolve at
 * score time: refuse or resolve, never improvise.
 *
 *   · `{ mode: "error" }`               → refuse the row (THE DEFAULT
 *     when the field is absent — the projector stamps it)
 *   · `{ mode: "default", value: x }`   → apply the authored value,
 *     visibly (the filed "All other classes → 1.00" row as DATA)
 *   · `{ mode: "refer" }`               → rate 1.0 indicative and
 *     escalate the row's eligibility to `submit`
 *
 * Pydantic source: `UnknownKeyPolicy`.
 */
export const unknownKeyPolicySchema = z.union([
  z.object({ mode: z.literal("error") }),
  z.object({ mode: z.literal("default"), value: z.number().finite() }),
  z.object({ mode: z.literal("refer") }),
]);
export type UnknownKeyPolicy = z.infer<typeof unknownKeyPolicySchema>;

/**
 * One factor row to look up + apply as a multiplier in a chain.
 *
 * Pydantic source: `FactorLookup`.
 */
export const factorLookupSchema = z.object({
  name: z.string().min(1).max(120),
  factor_kind: z.string().min(1).max(80),
  table: z.literal("rate_factors").default("rate_factors"),
  lookup_method: factorLookupMethodSchema,
  dimensions: z.record(dimensionBindingSchema).default({}),
  citation_rule: z.string().max(200).default(""),
  citation_page: z.string().max(200).default(""),
  description_template: z.string().min(1).max(500),
  predicate: factorPredicateSchema.nullable().optional(),
  // Absent ⇒ error, the safe authoring default.
  unknown_key_policy: unknownKeyPolicySchema.nullable().optional(),
});
export type FactorLookup = z.infer<typeof factorLookupSchema>;

// ===========================================================================
// ChainSpec + MultiplicativeChainConfig
// ===========================================================================

/**
 * The carrier LCM, applied as the last factor in a chain.
 *
 * The LCM scalar may be authored on the chain (`value`, e.g. 1.4)
 * rather than resolved from a `form_input.lcm` column. This preserves
 * the configured `rate → round(3 dp) → × LCM` order. `input_path` is
 * optional because an authored constant carries none; `overridable`
 * exposes the mapped input for a per-risk override. At least one of
 * `{ value, input_path }` must resolve the LCM; all additions are
 * optional → legacy `input_path`-only configs round-trip unchanged.
 *
 * Pydantic source: `LcmApplication`.
 */
export const lcmApplicationSchema = z
  .object({
    factor_kind: z.string().default("lcm"),
    value: z.number().nullable().optional(),
    input_path: z.string().min(1).max(200).nullable().optional(),
    overridable: z.boolean().optional().default(false),
    citation_rule: z.string().default("(carrier-set)"),
    citation_page: z.string().default("(carrier-set)"),
    description_template: z
      .string()
      .default("Loss Cost Multiplier (carrier): {value}"),
  })
  .refine(
    (lcm) =>
      (lcm.value !== null && lcm.value !== undefined) ||
      (typeof lcm.input_path === "string" && lcm.input_path.length > 0),
    {
      message:
        "LcmApplication: at least one of { value, input_path } must resolve the LCM",
    },
  );
export type LcmApplication = z.infer<typeof lcmApplicationSchema>;

/**
 * One multiplicative chain — building, BPP, or liability.
 *
 * Pydantic source: `ChainSpec`.
 *
 * `coverage_value` identifies which value of the
 * config's rating dimension this chain is for (e.g., "Bld", "BPP",
 * "BI"). When set, the ASSEMBLE Calculation Tower projects one
 * tower per coverage_value and renders the segmented control at
 * the top to switch between them. Optional + lenient — chains
 * older configs default to undefined (the
 * single-tower fallback).
 *
 * `base_value` is the chain's base rate as an
 * **authored literal scalar** (e.g., 600 for a $600 D&O base). This
 * is the first-class, editable property of the chain — set in the
 * ASSEMBLE base node's number field, persisted here, consumed by
 * the runtime projector as a `constant` base node. It removes the
 * dependency on `plan.template_id`-keyed runtime defaults: a
 * from-scratch plan sets `base_value = 600` and scores real
 * premiums with no template.
 *
 * `base_input` remains the wire-format reference path — load-bearing
 * for round-trip (it names the input_node a chain consumes) and the
 * back-compat fallback the projector uses when `base_value` is
 * unset (a column-driven base). When BOTH are present, the literal
 * wins. Optional + nullable so plans authored before this field
 * round-trip unchanged.
 */
export const chainSpecSchema = z.object({
  name: z.string().min(1).max(80),
  base_input: z.string().min(1).max(200),
  base_value: z.number().nullable().optional(),
  factor_lookups: z.array(factorLookupSchema).default([]),
  lcm: lcmApplicationSchema,
  exposure_input: z.string().min(1).max(200),
  exposure_unit_divisor: z.number().positive(),
  // Explicit opt-in to exposure-rated scoring
  // (rate × exposure ÷ divisor × LCM with configured roundings) for a PER-ACCOUNT
  // tower. Coverage towers (coverage_value set) auto-apply exposure in the
  // projector and don't need this. Optional → legacy chains omit
  // it (no exposure scaling unless coverage-driven). The runtime projector
  // already reads `apply_exposure`; this models the authoring side.
  apply_exposure: z.boolean().nullable().optional(),
  output_field: z.string().min(1).max(80),
  predicate: factorPredicateSchema.nullable().optional(),
  coverage_value: z.string().min(1).max(80).optional(),
  // The plan marked this coverage electable (spec §4.1
  // `building?`): an EXPLICIT 0 exposure elects the tower out (it
  // contributes $0, its nodes skip); absence still withholds. Omitted
  // → required (an explicit 0 refuses; zero is not an elect-out).
  elective: z.boolean().optional(),
});
export type ChainSpec = z.infer<typeof chainSpecSchema>;

/**
 * The `config_json` of a `multiplicative_chain` stage.
 *
 * Pydantic source: `MultiplicativeChainConfig`.
 *
 * `rating_dimension` is the id of the dimension that
 * this config's ChainSpecs split on. Set when the user drops a
 * dimension on the ASSEMBLE workspace's "Rating dimension" slot.
 * Optional — when unset, the workspace renders a single tower.
 */
export const multiplicativeChainConfigSchema = z.object({
  chains: z.array(chainSpecSchema).min(1),
  output_total_field: z.string().min(1).max(80),
  rating_dimension: z.string().min(1).max(80).optional(),
});
export type MultiplicativeChainConfig = z.infer<
  typeof multiplicativeChainConfigSchema
>;

// ===========================================================================
// FlatFactorConfig — sibling stage for constant/flat_factor UI kinds
// ===========================================================================

/**
 * The `config_json` of a `flat_factor` stage.
 *
 * Pydantic source: `FlatFactorConfig`. Note the Pydantic
 * `@model_validator(mode="after")` requires *exactly one* of
 * `input_path` / `input_paths`. We honor that with a Zod `refine`
 * below.
 */
export const flatFactorConfigSchema = z
  .object({
    input_path: z.string().min(1).max(200).nullable().optional(),
    input_paths: z.array(z.string()).min(1).nullable().optional(),
    factor: z.number(),
    factor_unit: z.string().default("multiplier"),
    predicate: factorPredicateSchema.nullable().optional(),
    citation_rule: z.string().default(""),
    citation_page: z.string().default(""),
    description_template: z.string().default("{factor_kind}: ×{value}"),
    factor_kind: z.string().min(1).max(80),
    output_field: z.string().min(1).max(80).default("value"),
  })
  .refine(
    (cfg) =>
      (cfg.input_path !== null && cfg.input_path !== undefined) !==
      (cfg.input_paths !== null && cfg.input_paths !== undefined),
    {
      message:
        "FlatFactorConfig: exactly one of input_path / input_paths must be set",
    },
  );
export type FlatFactorConfig = z.infer<typeof flatFactorConfigSchema>;

// ===========================================================================
// FormulaConfig — sibling stage for the (deferred) formula UI kind
// ===========================================================================

/**
 * The `config_json` of a `formula` stage.
 *
 * Pydantic source: `FormulaConfig`. The UI doesn't author this
 * shape yet (M4.3.x deferred), but the schema is here so the
 * adapter type-checks when we wire it.
 */
export const formulaConfigSchema = z.object({
  name: z.string().min(1).max(120),
  expression: z.string().min(1).max(400),
  inputs: z.record(z.string()).default({}),
  data_type: z.enum(["number", "string", "boolean"]).default("number"),
  output_field: z.string().min(1).max(80).default("value"),
  description: z.string().max(200).default(""),
  citation_rule: z.string().max(120).nullable().optional(),
  citation_page: z.string().max(40).nullable().optional(),
});
export type FormulaConfig = z.infer<typeof formulaConfigSchema>;
