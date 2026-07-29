/**
 * Zod schemas for `config_json` payloads on chain-related stages.
 *
 * Mirrors the Pydantic models in
 * `api-lab/backend/src/openrater/rates/plans/configs.py`:
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
 * Consumers (api-client, the factorDraftAdapter in labs-ui, route
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
 * (ADR-0044 D5 / ADR-0047 — this is the authoring half of the runtime
 * projector's `BindingShape`, which already reads these):
 *   · `literal`    — a constant key in `value`, e.g. the KS building-
 *     limit group "group_c"; declared in data, never hardcoded.
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
const bindingBaseSchema = z.object({
  source: z.enum([
    "context",
    "form_input",
    "literal",
    "derived",
    "computed",
    "composite",
  ]),
  path: z.string().min(1).max(200).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  op: z.enum(["sum"]).optional(),
  fields: z.array(z.string().min(1).max(200)).min(1).optional(),
  format: z.string().nullable().optional(),
});

// ADR-0025 / FCA #21 — a `composite` axis carries its MEMBER dims'
// bindings (member slug → binding). One level of recursion only:
// members cannot themselves be composite (v1), enforced in the refine.
export interface DimensionBinding extends z.infer<typeof bindingBaseSchema> {
  axes?: Record<string, DimensionBinding> | undefined;
}

export const dimensionBindingSchema: z.ZodType<DimensionBinding> =
  bindingBaseSchema
    .extend({
      axes: z
        .lazy(() => z.record(z.string(), dimensionBindingSchema))
        .optional(),
    })
    .refine(
      (b) => {
        if (b.source === "literal") return b.value !== undefined;
        if (b.source === "computed")
          return (
            b.op !== undefined && Array.isArray(b.fields) && b.fields.length > 0
          );
        if (b.source === "composite")
          return (
            b.axes !== undefined &&
            Object.keys(b.axes).length >= 2 &&
            Object.values(b.axes).every((m) => m.source !== "composite")
          );
        // context | form_input | derived
        return typeof b.path === "string" && b.path.length > 0;
      },
      {
        message:
          "DimensionBinding: source 'literal' needs `value`; 'computed' needs `op`+`fields`; 'composite' needs 2+ non-composite `axes`; otherwise `path` is required",
      },
    );

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
 *   · "interpolated" ← legacy curve concept (Brief 19; removed in
 *                       Brief 34 PR 34.7). Kept on the wire format
 *                       for back-compat with plans authored before
 *                       the supersession; the reverse adapter maps
 *                       it to `lookup.range` in the UI today.
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
 * ADR-0056 — the authored disposition for a lookup key that doesn't
 * resolve at score time (Law 2: refuse or resolve, never improvise):
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
  // ADR-0056 — absent ⇒ error (Law 2's authoring default).
  unknown_key_policy: unknownKeyPolicySchema.nullable().optional(),
});
export type FactorLookup = z.infer<typeof factorLookupSchema>;

// ===========================================================================
// ChainSpec + MultiplicativeChainConfig
// ===========================================================================

/**
 * The carrier LCM, applied as the last factor in a chain.
 *
 * Brief 54 / ADR-0047 — the LCM scalar is authored ON the chain
 * (`value`, e.g. 1.401) rather than resolved from a `form_input.lcm`
 * column, so the ISO `rate → round(3 dp) → × LCM` order holds (folding
 * the LCM into `base_value` rounds at the wrong point → 1216 vs 1210).
 * The Pydantic `LcmApplication` already carries these fields; this Zod
 * mirror was reverted on `origin/main` (the two sides drifted) and PR-1
 * realigns it. `input_path` is now optional (an authored-constant LCM
 * carries none); `overridable` (D3 escape hatch) re-exposes the mappable
 * input for the rare per-risk override. At least one of
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
 * `coverage_value` (Brief 25.B.2): identifies which value of the
 * config's rating dimension this chain is for (e.g., "Bld", "BPP",
 * "BI"). When set, the ASSEMBLE Calculation Tower projects one
 * tower per coverage_value and renders the segmented control at
 * the top to switch between them. Optional + lenient — chains
 * authored before this field landed default to undefined (the
 * single-tower fallback).
 *
 * `base_value` (cold-test L30): the chain's base rate as an
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
  // ADR-0044 D3 / ADR-0047 — explicit opt-in to exposure-rated scoring
  // (rate × exposure ÷ divisor × LCM with ISO roundings) for a PER-ACCOUNT
  // tower. Coverage towers (coverage_value set) auto-apply exposure in the
  // projector (PR #325) and don't need this. Optional → legacy chains omit
  // it (no exposure scaling unless coverage-driven). The runtime projector
  // already reads `apply_exposure`; this models the authoring side.
  apply_exposure: z.boolean().nullable().optional(),
  output_field: z.string().min(1).max(80),
  predicate: factorPredicateSchema.nullable().optional(),
  coverage_value: z.string().min(1).max(80).optional(),
  // Brief 95 C4 — the plan marked this coverage electable (spec §4.1
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
 * `rating_dimension` (Brief 25.B.2): the id of the dimension that
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
