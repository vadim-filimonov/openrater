/**
 * <CalculationTower> — public types.
 *
 * Per Brief 25 (Calculation Tower / ASSEMBLE v2). The tower is a
 * **derived projection** of the plan's substrate stages — it is not
 * a new schema. The converters in `./stages-to-tower-plan.ts` and
 * `./tower-plan-to-stages.ts` project between the two.
 *
 * Three things this module owns:
 *   1. Categorical taxonomy: node category + subtype + 8 operators.
 *   2. Tower shape: nodes, groups, operator chips between entries,
 *      drop slots, output cap.
 *   3. Model node fan-in semantics: input manifest binding model
 *      params to sources (submission field / dimension / tower
 *      output / constant).
 */

/**
 * UI mode — drives value-chip display.
 *
 *   "design"      → metadata (e.g., "16 values · 0.85↔1.45")
 *   "single-risk" → resolved value (e.g., "× 1.250 · class=BOPC51")
 *   "book"        → distribution (e.g., "μ 1.110 · 0.85↔1.45")
 */
export type TowerMode = "design" | "single-risk" | "book";

/**
 * The 6 categorical roles a node can take (per ADR-0023 §7).
 *
 *   input     — submission-side dimensions (azure)
 *   transform — dimension lookups: tables, curves (violet)
 *   lookup    — factor tables, curves, ML models (amber)
 *   math      — constants, math results (emerald)
 *   loading   — modifiers, gates (orange)
 *   output    — terminal output node (red)
 */
export type NodeCategory =
  | "input"
  | "transform"
  | "lookup"
  | "math"
  | "loading"
  | "output";

/**
 * Subtype refines a category. Used for icon-square hue-shifting and
 * the right inspector pane's content.
 */
export type NodeSubtype =
  // transform subtypes
  | "key"
  | "geographic"
  | "classification"
  // lookup subtypes
  | "table"
  | "curve"
  | "model"
  // math subtypes
  | "constant"
  | "math-op"
  // loading subtypes
  | "modifier"
  | "loading";

/**
 * The 8 closed-vocabulary operators a chip can hold. Operators render
 * as neutral mono glyphs (Brief 48; color governance keeps cat-* for
 * computation KINDS — an operator is a verb, not a kind).
 */
export type Operator =
  | "multiply"
  | "divide"
  | "plus"
  | "minus"
  | "max"
  | "min"
  | "round"
  | "pair";

/**
 * Two-line metadata chip for a node. In Design mode this shows the
 * node's *shape* (range, count, dtype). In Single-risk mode the
 * converter swaps the chip's content (not the slot) to the resolved
 * value for that risk.
 */
export interface ValueChip {
  /** Primary line — short, emphasized. */
  readonly primary: string;
  /** Optional secondary line — muted, often a range/dtype. */
  readonly secondary?: string;
}

/**
 * Optional warning badge that appears in the top-right of a node.
 */
export type NodeBadge =
  | "broken-ref" // a referenced field has no producer in this tower
  | "unwired" // node has no upstream operator chip (orphan)
  | "model-pending"; // model node with no engine-resolution (V1)

/**
 * Source for a model input — what the param binds to.
 *
 *   submission     — directly off the policy/submission payload
 *                    (e.g., "submission.fico")
 *   dimension      — a dimension already declared in the Dimensions
 *                    workspace; will be resolved per-risk
 *   tower-output   — another tower's output (cross-coverage ref)
 *   tower-internal — a node *inside the same tower above* this one
 *                    (consumes that node's resolved value)
 *   constant       — a named scalar
 */
export type ModelInputSourceKind =
  | "submission"
  | "dimension"
  | "tower-output"
  | "tower-internal"
  | "constant";

/**
 * One row in a model node's input manifest. Each row binds a model
 * parameter to a source.
 */
export interface ModelInputBinding {
  /** The model's parameter name (e.g., "credit_score"). */
  readonly param: string;
  /** Where this input comes from. */
  readonly sourceKind: ModelInputSourceKind;
  /** Stable identifier — depends on sourceKind:
   *    submission     → field path  ("submission.fico")
   *    dimension      → dimension id ("class_code")
   *    tower-output   → output name  ("BI_premium")
   *    tower-internal → node id      ("node_xyz")
   *    constant       → constant id  ("LCM")
   */
  readonly sourceId: string;
  /** Optional display label; falls back to sourceId. */
  readonly sourceLabel?: string;
}

/**
 * ADR-0047 — how a 2-D factor table's secondary axis resolves at runtime.
 * Mirrors the contract `DimensionBinding` source modes:
 *   · form_input — read the named column (the default; `path` = the dim slug)
 *   · literal    — a constant key (e.g. the KS building-limit group "group_c")
 *   · computed   — op:"sum" over input fields (e.g. property total limit),
 *                  then the bound dim's banded resolution buckets it
 *   · derived    — the bound dim's own derived_from (e.g. a class attribute);
 *                  `path` names the derived dim
 * Round-trips onto `factor_lookups[].dimensions[axis]`.
 */
export type AxisSource =
  | { readonly source: "form_input"; readonly path: string }
  | { readonly source: "literal"; readonly value: string | number | boolean }
  | {
      readonly source: "computed";
      readonly op: "sum";
      readonly fields: readonly string[];
    }
  | { readonly source: "derived"; readonly path: string };

/**
 * Reference to whatever underlying entity this node represents.
 * `ref` is a discriminated union — the converter writes the right
 * variant per `NodeCategory` + `NodeSubtype`.
 */
export type NodeRef =
  | { readonly kind: "dimension"; readonly dimensionId: string }
  | {
      readonly kind: "factor-table";
      readonly tableId: string;
      /**
       * ADR-0047 / ADR-0044 D6 — an optional gate: the factor applies only
       * when `externalInputs[path] === equals` (else it is the
       * multiplicative identity 1.0, projected via a `branch`). Round-trips
       * onto `FactorLookup.predicate`. Absent/null = always applies (the
       * sprinkler-credit case: `{ path: form_input.sprinklered, equals: true }`).
       */
      readonly predicate?: {
        readonly path: string;
        readonly equals: boolean | number | string;
      } | null;
      /**
       * ADR-0047 — per-axis source overrides for a 2-D table's secondary
       * axis, keyed by axis (dimension) slug. Absent axes default to a
       * form_input binding on the slug. Round-trips onto
       * factor_lookups[].dimensions[axis].
       */
      readonly axisSources?: Readonly<Record<string, AxisSource>>;
    }
  | { readonly kind: "curve"; readonly curveId: string }
  | { readonly kind: "model"; readonly modelId: string }
  | {
      readonly kind: "constant";
      readonly constantId: string;
      /**
       * Brief 70.1 / Brief 68 §3.1 — the TYPED role. Persistence keys
       * on THIS, not the display name: the legacy `/lcm/i` name-regex
       * meant renaming "Carrier LCM" → "Multiplier" silently dropped
       * the constant from the saved chain. `flat` / `min_premium` are
       * reserved for the Phase-3 tail (they are NOT chain content and
       * the chain converter refuses them).
       */
      readonly role?: "lcm" | "flat" | "min_premium";
      /**
       * ADR-0047 / Brief 54 — an authored carrier constant (the LCM)
       * carries its scalar directly on the ref, mirroring `chain-base`'s
       * `baseValue`. `null`/absent = not authored (legacy column-driven
       * LCM via `form_input.<id>`). The save converter reverse-projects a
       * finite `value` onto `ChainSpec.lcm.value`, so the projector applies
       * it AFTER the 3-dp rate round (folding it into the base rounds at the
       * wrong point — KS-10 1216 vs the 1210 oracle). `overridable: true`
       * re-exposes the column (the per-risk escape hatch).
       */
      readonly value?: number | null;
      readonly overridable?: boolean;
    }
  | { readonly kind: "submission-field"; readonly field: string }
  | { readonly kind: "tower-output"; readonly outputName: string }
  | { readonly kind: "modifier"; readonly modifierStageId: string }
  | { readonly kind: "output"; readonly outputField: string }
  /**
   * Cold-test L30 — the chain's authored literal base rate. The base
   * node carries its scalar value directly on the ref (the value IS
   * the data; there's no external producer). The inspector renders an
   * editable number field for this variant; the save converter
   * reverse-projects `baseValue` onto `ChainSpec.base_value`.
   *
   * `baseValue: null` means "no literal authored yet" — the node is a
   * prompt to set one. The projector falls back to `base_input` only
   * when the substrate has no literal at all (a node that loaded from
   * a pre-`base_value` plan projects as a `submission-field` instead,
   * preserving the legacy column-driven base).
   */
  | { readonly kind: "chain-base"; readonly baseValue: number | null };

/**
 * A single node in a tower. Width = 460px (per Brief 25 §5.3);
 * height adapts for model nodes (which carry an input manifest).
 */
export interface TowerNode {
  readonly id: string;
  readonly category: NodeCategory;
  readonly subtype?: NodeSubtype;
  /** Display name in the node header. */
  readonly title: string;
  /** Subtitle — humanized kind label (e.g., "Lookup · 18 zones"). */
  readonly subtitle?: string;
  readonly valueChip: ValueChip;
  /** Lucide icon name (e.g., "DollarSign", "Brain"). */
  readonly icon: string;
  /** Reference to the substrate entity this node represents. */
  readonly ref?: NodeRef;
  /** For model nodes — the input manifest. Empty for non-model nodes. */
  readonly modelInputs?: readonly ModelInputBinding[];
  readonly badge?: NodeBadge;
}

/**
 * A group container — wraps a contiguous run of nodes with their
 * inner operators into a logical unit. Group has its own optional
 * name + output reference.
 */
export interface TowerGroup {
  readonly id: string;
  /** Optional user-defined name (e.g., "Structural factors"). */
  readonly name?: string;
  /** Ordered list of node IDs inside the group. */
  readonly nodeIds: readonly string[];
  /** Inner operators between consecutive nodes; length = nodeIds.length - 1. */
  readonly innerOps: readonly Operator[];
  /** Optional name for the group's output (saved in metadata). */
  readonly outputName?: string;
}

/**
 * A tower entry — what occupies one "row" in the tower's vertical
 * stack. Either a node, a group, or a (transient) drop-slot marker.
 *
 * The drop slot is a UI-only entry — converters drop it on save.
 */
export type TowerEntry =
  | { readonly kind: "node"; readonly nodeId: string }
  | { readonly kind: "group"; readonly groupId: string }
  | { readonly kind: "drop-slot" };

/**
 * A single tower — represents one value of the rating dimension.
 * The output cap node at the bottom is part of `entries`; it always
 * comes last and has category "output".
 */
export interface Tower {
  readonly id: string;
  /** The rating-dimension value this tower applies to (e.g., "Bld"). */
  readonly ratingDimensionValue?: string;
  /** Display name in the tower title card (e.g., "Building premium"). */
  readonly name: string;
  /** The field this tower's output writes (e.g., "bld_premium"). */
  readonly outputField: string;
  /** Ordered entries, top → bottom. */
  readonly entries: readonly TowerEntry[];
  /** Operators in the gaps; length = entries.length - 1. */
  readonly entryOps: readonly Operator[];
  /** Optional final unary op (round / clamp wrapping the result). */
  readonly finalOp?: Operator;
  /**
   * ADR-0047 — exposure-rated tower wiring (affordance a). `exposureInput`
   * names the per-coverage exposure base (e.g. "building_limit") and
   * `exposureUnitDivisor` the unit (e.g. 100). `applyExposure` opts a
   * PER-ACCOUNT tower into exposure-rated scoring; coverage towers
   * auto-apply exposure in the projector (PR #325), so the flag is only
   * load-bearing for non-coverage towers. Round-trip onto the chainSpec's
   * `exposure_input` / `exposure_unit_divisor` / `apply_exposure`.
   */
  readonly applyExposure?: boolean;
  readonly exposureInput?: string;
  readonly exposureUnitDivisor?: number;
  /**
   * Brief 78 P5.3c (§3.3-2) — the ORIGINAL chain spec this tower was
   * projected from, verbatim. The save path (`towerPlanToStages`)
   * patches the sheet-editable fields OVER this clone instead of
   * rebuilding from scratch, so an untouched chain round-trips
   * byte-identically (the route's dirty signal is a raw
   * `JSON.stringify` — key order included) and fields the tower
   * model doesn't carry (class-conditional `exposure_options`,
   * citations, description templates) survive every edit. Absent
   * only on towers born in the sheet (no original to patch over).
   */
  readonly chainVerbatim?: Readonly<Record<string, unknown>>;
  /**
   * Brief 78 P5.3c — non-empty class-conditional `exposure_options`
   * count (ADR-0044 D9). Drives the sheet's "Varies by class"
   * exposure pill; such a tower's exposure family is frozen verbatim
   * on save (the class-conditional editor is its own brief).
   */
  readonly exposureOptionCount?: number;
}

export interface ConstantDef {
  readonly id: string;
  /** Display name (e.g., "LCM"). */
  readonly name: string;
  readonly value: number;
  readonly description?: string;
  readonly citationRule?: string;
  readonly citationPage?: string;
}

export interface ModelDef {
  readonly id: string;
  /** Display name (e.g., "Discretionary credit"). */
  readonly name: string;
  /** Version pin (immutable per filing). */
  readonly version: string;
  /** ISO date string, optional. */
  readonly lastFit?: string;
  /**
   * Informational only — the engine doesn't enforce this. UI shows
   * it as the model node's value-chip secondary line in Design mode.
   */
  readonly outputRange?: readonly [number, number];
  /** Expected input parameters; the manifest binds each to a source. */
  readonly inputs: readonly {
    readonly param: string;
    readonly dtype: "number" | "string" | "boolean";
    readonly required: boolean;
  }[];
}

/**
 * The full plan tower projection — N+1 towers (per coverage value
 * + the Total tower), plus indexed nodes/groups/constants/models.
 *
 * This is what the UI consumes; the converters maintain
 * round-trippability with the substrate.
 */
export interface TowerPlan {
  /** The rating dimension being split on (typically "coverage"). */
  readonly ratingDimension: string;
  /** Ordered list of values (e.g., ["BI", "Liab", "Bld", "BPP"]). */
  readonly ratingDimensionValues: readonly string[];
  /** Towers — one per value + the Total tower at index `length-1`. */
  readonly towers: readonly Tower[];
  /** All nodes referenced by towers, keyed by node.id. */
  readonly nodes: ReadonlyMap<string, TowerNode>;
  /** All groups, keyed by group.id. */
  readonly groups: ReadonlyMap<string, TowerGroup>;
  /** Named constants reusable across towers. */
  readonly constants: ReadonlyMap<string, ConstantDef>;
  /** Connected models. */
  readonly models: ReadonlyMap<string, ModelDef>;
}

/**
 * Inventory item shape — used by the inventory rail. The converters
 * project from the user's plan + the dimension/gate workspaces into
 * these.
 */
export type InventoryKind =
  | "factor-table" // Brief 35 §5 — saved factor tables from Parametrize
  | "constant"
  | "dimension"
  | "gate"
  | "model"
  | "input" // Brief 35 §5 — submission-field inputs
  | "math" // Brief 25 carry — closed-vocabulary math operators
  | "tower-output"; // Brief 25 carry — other towers' outputs

export interface InventoryItem {
  readonly id: string;
  readonly kind: InventoryKind;
  readonly category: NodeCategory;
  readonly subtype?: NodeSubtype;
  readonly title: string;
  /** Optional metadata chip (e.g., "USD", "key", "geo"). */
  readonly meta?: string;
  /** Lucide icon name. */
  readonly icon: string;
  /**
   * Brief 35 PR 35.2 — Optional shape indicator on factor-table chips
   * (e.g., "1-D · 8 levels", "2-D · 5×8", "2-D banded"). Surfaced in
   * the chip's meta slot when the inventory rail's count-chip aware
   * renderer wants to differentiate factor tables by their shape.
   * Other kinds may set this to null/undefined.
   */
  readonly shapeBadge?: string;
}

/** Converter options. */
export interface TowerProjectionOptions {
  /** The rating dimension to split on. Defaults to "coverage". */
  readonly ratingDimension?: string;
  /** Strict mode — throw on round-trip-incompatible config. */
  readonly strict?: boolean;
}
