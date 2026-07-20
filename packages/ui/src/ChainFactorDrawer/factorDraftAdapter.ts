/**
 * factorDraftToMutation — pure adapter from UI draft to backend mutation.
 *
 * Mapping rules:
 *   · `lookup.direct` / `lookup.classification`
 *     → row in `ChainSpec.factor_lookups` (target "chain_row")
 *   · `constant` / `flat_factor`
 *     → standalone sibling stage placed adjacent to the chain
 *     (target "sibling_stage"; stage_kind "flat_factor")
 *
 * The retired `curve.evaluate` kind is represented by 1-D banded
 * factor tables rendered via <FactorTableViz>.
 *
 * Pure function. No HTTP, no state. The route wiring calls this at
 * `onSave` time and dispatches the returned mutation against
 * api-client:
 *   · `chain_row`     → patchStageConfig() on the chain stage,
 *                       appending the new FactorLookup to its
 *                       config_json.chains[i].factor_lookups
 *   · `sibling_stage` → addStage() with stage_kind / config / etc.
 *                       assembled by the route from the seed fields
 *                       this adapter emits
 *
 * Layering note: this primitive lives in @openrater/ui (which is
 * deliberately HTTP-free), so it consumes wire shapes from
 * @openrater/contracts and emits "seed-level" data — never the full
 * HTTP request envelope. The route assembles the envelope, validates
 * via api-client schemas, and dispatches.
 *
 * Deferred kinds (`formula` UI editor not built yet, `lookup.range`
 * UI editor partially built) throw — the drawer's Save button is
 * disabled for these, so the adapter should never be called with
 * them. Throwing keeps the contract honest.
 */

import type {
  FactorLookup,
  FactorLookupMethod,
  FlatFactorConfig,
  FormulaConfig,
} from "@openrater/contracts";
import type { FactorDraft } from "../FactorEditor";

/**
 * The tagged-union mutation the route should dispatch.
 *
 * `chain_row` patches the chain stage's
 * `config_json` to append/replace a row; sibling_stage → POST a
 * new stage adjacent to the chain.
 *
 * For sibling_stage, the adapter emits the *seed* fields — the
 * route wraps them in an AddStageRequest before dispatch (this is
 * the layering boundary that keeps @openrater/ui HTTP-free).
 */
export type FactorDraftMutation =
  | {
      readonly target: "chain_row";
      readonly chainStageId: string;
      readonly factorLookup: FactorLookup;
    }
  | {
      readonly target: "sibling_stage";
      readonly siblingStageKind: "flat_factor" | "formula";
      readonly stageId: string;
      readonly displayName: string;
      readonly config: FlatFactorConfig | FormulaConfig;
      readonly insertAfterStageId?: string;
    };

/**
 * Context the route supplies to the adapter.
 *
 * `chainStageId`, `chainName`, and `chainOutputPath` come from the
 * chain stage being edited; the rest fall back to derived defaults
 * when omitted.
 */
export interface FactorDraftAdapterContext {
  /** Stage id of the chain being edited. */
  readonly chainStageId: string;
  /** Display name of the chain (for trace/audit). */
  readonly chainName: string;
  /**
   * Where in the form-input tree a sibling stage should read its
   * subtotal from. Typically `"stages.{chainStageId}.value"` or
   * `"stages.{chainStageId}.subtotal_after_chain_usd"` depending
   * on the chain's `output_field`.
   */
  readonly chainOutputPath: string;
  /** Display name for the new factor. Falls back to draft.reason
   *  or a kind-keyed default ("Constant", "Direct lookup", etc.). */
  readonly factorName?: string;
  /** factor_kind slug. Falls back to a derived value. */
  readonly factorKindSlug?: string;
  /** Optional override for the sibling stage's stage_id. */
  readonly siblingStageId?: string;
  /** Optional override for AddStageRequest.insert_after_stage_id. */
  readonly insertAfterStageId?: string;
}

/**
 * Maps a completed FactorDraft to the mutation the route should
 * dispatch. Throws if the draft is incomplete or represents a
 * deferred kind (lookup.range with no bins, formula).
 *
 * Callers should gate with `isFactorDraftComplete` first; this
 * adapter's throw is a contract-failure backstop, not a normal
 * code path.
 */
export function factorDraftToMutation(
  draft: FactorDraft,
  context: FactorDraftAdapterContext,
): FactorDraftMutation {
  switch (draft.kind) {
    case "":
      throw new Error(
        "factorDraftToMutation: draft.kind is unset; gate with isFactorDraftComplete before calling.",
      );
    case "lookup.direct":
      return mapDirectLookup(draft, context);
    case "lookup.classification":
      return mapClassificationLookup(draft, context);
    case "lookup.range":
      throw new Error(
        "factorDraftToMutation: lookup.range editor not implemented yet; the UI Save button should be disabled for this kind.",
      );
    case "constant":
      return mapConstant(draft, context);
    case "flat_factor":
      return mapFlatFactor(draft, context);
    case "formula":
      throw new Error(
        "factorDraftToMutation: formula editor not implemented yet; the UI Save button should be disabled for this kind.",
      );
  }
}

// ---------------------------------------------------------------------------
// Chain-row mappers (lookup.*)
// ---------------------------------------------------------------------------

function mapDirectLookup(
  draft: Extract<FactorDraft, { kind: "lookup.direct" }>,
  ctx: FactorDraftAdapterContext,
): FactorDraftMutation {
  const factor_kind = ctx.factorKindSlug ?? draft.factor_table_id;
  // Thread the authored unknown-key policy onto the wire
  // shape. Absent/`error` writes nothing: error IS the schema default,
  // so configs stay lean and self-documenting.
  const p = draft.unknown_key_policy;
  const unknown_key_policy =
    p === undefined || p.mode === "error"
      ? undefined
      : p.mode === "default"
        ? typeof p.value === "number" && Number.isFinite(p.value)
          ? ({ mode: "default", value: p.value } as const)
          : undefined
        : ({ mode: "refer" } as const);
  return {
    target: "chain_row",
    chainStageId: ctx.chainStageId,
    factorLookup: makeFactorLookup({
      name: ctx.factorName ?? deriveLookupName(draft.dimension_id),
      factor_kind,
      lookup_method: "direct",
      dimensions: {
        [draft.dimension_id]: {
          source: "form_input",
          path: draft.dimension_id,
        },
      },
      description_template: `${humanizeSlug(factor_kind)}: ×{value}`,
      ...(unknown_key_policy !== undefined ? { unknown_key_policy } : {}),
    }),
  };
}

function mapClassificationLookup(
  draft: Extract<FactorDraft, { kind: "lookup.classification" }>,
  ctx: FactorDraftAdapterContext,
): FactorDraftMutation {
  // class_code is the implicit dimension; the chosen class_code is
  // *not* a dimension binding (that's a value the runtime sees on
  // the rated risk). The UI's class_code selection authors which
  // class library row the runtime reads; the wire format here just
  // declares "read class_code from form input" + the runtime does
  // the rest.
  void draft.class_code; // surfaces in the audit trail at runtime
  const factor_kind = ctx.factorKindSlug ?? "class_factor";
  return {
    target: "chain_row",
    chainStageId: ctx.chainStageId,
    factorLookup: makeFactorLookup({
      name: ctx.factorName ?? "Class factor",
      factor_kind,
      lookup_method: "direct",
      dimensions: {
        class_code: { source: "form_input", path: "class_code" },
      },
      description_template: "Class factor: ×{value}",
    }),
  };
}

// ---------------------------------------------------------------------------
// Sibling-stage mappers (constant, flat_factor)
// ---------------------------------------------------------------------------

function mapConstant(
  draft: Extract<FactorDraft, { kind: "constant" }>,
  ctx: FactorDraftAdapterContext,
): FactorDraftMutation {
  if (typeof draft.value !== "number" || !Number.isFinite(draft.value)) {
    throw new Error(
      `factorDraftToMutation: constant draft has non-numeric value (${draft.value}); gate with isFactorDraftComplete before calling.`,
    );
  }
  const factor_kind = ctx.factorKindSlug ?? "constant";
  const displayName =
    ctx.factorName ?? (draft.reason.trim() !== "" ? draft.reason : "Constant");
  const stageId = ctx.siblingStageId ?? slugify(displayName);
  return {
    target: "sibling_stage",
    siblingStageKind: "flat_factor",
    stageId,
    displayName,
    config: makeFlatFactorConfig({
      input_path: ctx.chainOutputPath,
      factor: draft.value,
      factor_kind,
      citation_rule: draft.reason,
      description_template: "{factor_kind}: ×{value}",
    }),
    ...(ctx.insertAfterStageId !== undefined
      ? { insertAfterStageId: ctx.insertAfterStageId }
      : {}),
  };
}

function mapFlatFactor(
  draft: Extract<FactorDraft, { kind: "flat_factor" }>,
  ctx: FactorDraftAdapterContext,
): FactorDraftMutation {
  if (typeof draft.factor !== "number" || !Number.isFinite(draft.factor)) {
    throw new Error(
      `factorDraftToMutation: flat_factor draft has non-numeric factor (${draft.factor}); gate with isFactorDraftComplete before calling.`,
    );
  }
  const factor_kind = ctx.factorKindSlug ?? "flat_factor";
  const displayName =
    ctx.factorName ??
    (draft.reason.trim() !== "" ? draft.reason : "Flat factor");
  const stageId = ctx.siblingStageId ?? slugify(displayName);
  return {
    target: "sibling_stage",
    siblingStageKind: "flat_factor",
    stageId,
    displayName,
    config: makeFlatFactorConfig({
      input_path: ctx.chainOutputPath,
      factor: draft.factor,
      factor_kind,
      citation_rule: draft.reason,
      description_template: "{factor_kind}: ×{value}",
    }),
    ...(ctx.insertAfterStageId !== undefined
      ? { insertAfterStageId: ctx.insertAfterStageId }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

interface FactorLookupSeed {
  readonly name: string;
  readonly factor_kind: string;
  readonly lookup_method: FactorLookupMethod;
  readonly dimensions: Record<string, { source: "form_input"; path: string }>;
  readonly description_template: string;
  /** Authored unknown-key policy (absent means the error default). */
  readonly unknown_key_policy?:
    | { readonly mode: "default"; readonly value: number }
    | { readonly mode: "refer" };
}

function makeFactorLookup(seed: FactorLookupSeed): FactorLookup {
  return {
    name: seed.name,
    factor_kind: seed.factor_kind,
    table: "rate_factors",
    lookup_method: seed.lookup_method,
    dimensions: seed.dimensions,
    citation_rule: "",
    citation_page: "",
    description_template: seed.description_template,
    ...(seed.unknown_key_policy !== undefined
      ? { unknown_key_policy: seed.unknown_key_policy }
      : {}),
  };
}

interface FlatFactorSeed {
  readonly input_path: string;
  readonly factor: number;
  readonly factor_kind: string;
  readonly citation_rule: string;
  readonly description_template: string;
}

function makeFlatFactorConfig(seed: FlatFactorSeed): FlatFactorConfig {
  // Mirrors FlatFactorConfig Pydantic defaults — factor_unit
  // "multiplier", output_field "value", citation_page "".
  return {
    input_path: seed.input_path,
    factor: seed.factor,
    factor_kind: seed.factor_kind,
    factor_unit: "multiplier",
    citation_rule: seed.citation_rule,
    citation_page: "",
    description_template: seed.description_template,
    output_field: "value",
  };
}

// ---------------------------------------------------------------------------
// Naming helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Best-effort display name from a dimension slug.
 *   "construction_class" → "Construction class factor"
 */
function deriveLookupName(dimensionId: string): string {
  return `${humanizeSlug(dimensionId)} factor`;
}

/**
 * Convert a slug to a sentence-case display string.
 *   "construction_class" → "Construction class"
 */
function humanizeSlug(slug: string): string {
  const spaced = slug.replace(/[_.-]+/g, " ").trim();
  if (spaced === "") return "Factor";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Convert a display string to a stable, URL-safe slug.
 *   "Sprinkler credit" → "sprinkler_credit"
 *   "  Foo  Bar  "     → "foo_bar"
 *
 * Used to generate sibling stage_ids when the caller doesn't supply
 * one. Deterministic + idempotent + ascii-only.
 */
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? "factor" : slug;
}

// Test-only exports kept named so the test file doesn't reach for
// private internals. Keep this list short.
export const __internals = { slugify, humanizeSlug };
