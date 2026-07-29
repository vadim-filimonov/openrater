/**
 * `DimensionRow` — the lenient, render-time view of a registered plan
 * dimension.
 *
 * Re-homed here when the `<DimensionsTable>` component was deleted (dead
 * since the v2 BuildUpSheet / ParametrizeCanvas cutover — no JSX mount).
 * The component went; the row type outlived it. `DimensionRow` is the
 * canonical dimension shape consumed across labs-ui (FactorTableNode,
 * ParametrizeCanvas, BuildUpSheet, CsvImportPreview2D, DimensionEditor,
 * DimensionsWorkspace, dimensionMeta, shapeIcon, keying, coverageDimension,
 * inferCsvAxes) and rate-lab (dimensionsSync, PlanDetailRoute, fixtures).
 *
 * Types-only module — no React, no runtime, no CSS. Importers reach it
 * unchanged via the directory barrel (`./DimensionsTable`).
 *
 * As of sub-brief 24.A, this shape mirrors the canonical `Dimension`
 * type in `@openrater/contracts` — but keeps `data_type` and `role`
 * OPTIONAL so legacy callers (today's fixture data, future API Lab
 * slice-4 responses pre-24.B) still work.
 *
 * **Sub-brief 24.A2 extension:** also accepts the subtype fields
 * (`dimension_type`, `class_library_id`, `classification_mapping`,
 * `territory_schema_id`) so fixtures + future API responses that
 * carry them pass the structural check. The fields ride along here for
 * type compatibility only.
 *
 * UI consumers that want strictly-typed dimensions should import
 * `Dimension` from `@openrater/contracts` directly; this shape is the
 * lenient render-time view.
 */
export interface DimensionRow {
  readonly id: string;
  readonly display_name: string;
  readonly slug: string;
  /**
   * Brief 51 — the source input column this dim's value maps from (the
   * CSV header, e.g. `territory` for a dim whose id is `zip`). Populated
   * by `planDimensionToRow` from the API's `PlanDimension.source_field`;
   * Analytics uses it as a fallback when resolving the slice→input-column
   * binding (the plan's `column_map` is the primary source). Optional —
   * legacy rows + dims that aren't mapped inputs leave it unset.
   */
  readonly source_field?: string;
  /**
   * Value type. Free-form string for lenient compatibility; the
   * canonical Dimension type narrows to a fixed union.
   */
  readonly data_type?: string;
  /**
   * Role discriminator (24.A). Optional in the row shape so legacy
   * data still renders. New code should set this explicitly.
   */
  readonly role?: "rating-input" | "structural" | "both";
  /** Optional one-line description rendered under the name. */
  readonly description?: string;
  /**
   * Subtype discriminator (24.A2). Optional + lenient for the same
   * reason as `role` — the canonical Dimension type narrows to a
   * fixed union. Drives which editor pane the 24.C DIMENSIONS
   * workspace opens.
   */
  readonly dimension_type?: "standard" | "geographic" | "classification";
  /**
   * For `dimension_type: "classification"`, the canonical ClassLibrary
   * this dimension uses. Surfaced by the 24.C subtype-specific editor.
   */
  readonly class_library_id?: string;
  /**
   * For `dimension_type: "classification"`, the proprietary
   * input → canonical mapping rules. See `ClassMappingRule` in
   * `@openrater/contracts`; kept structural here to avoid the labs-ui
   * primitive pulling on the contracts package's `unknown`-shaped
   * subtype detail.
   */
  readonly classification_mapping?: ReadonlyArray<{
    readonly input_pattern: string;
    readonly canonical_class_code: string;
    readonly notes?: string;
  }>;
  /**
   * For `dimension_type: "geographic"`, the TerritorySchema this
   * dimension uses. Surfaced by the 24.C subtype-specific editor.
   *
   * @deprecated Brief 44 — replaced by the unified `geo_granularity` /
   * `geo_scope` / `geo_territories` properties below. Kept readable for
   * legacy plan fixtures until Brief 44's migration completes.
   */
  readonly territory_schema_id?: string;

  // ── Brief 44 — Unified geographic dim substrate ─────────────────
  // Mirrors @openrater/contracts `Dimension.geo_*`. Only meaningful when
  // `dimension_type === "geographic"`. Lenient `unknown`-ish typing
  // here so this primitive stays type-agnostic; the wizard + editor
  // own the strict shapes via `@openrater/ui/GeoDimWizard`.

  /**
   * Geographic granularity — `"state" | "county" | "zip"`. Required
   * for `dimension_type === "geographic"`; ignored otherwise.
   */
  readonly geo_granularity?: "state" | "county" | "zip";
  /**
   * Geographic scope — `national` (50 + DC) or `subset` of USPS codes.
   * Discriminated union; mirrors `geoLevelSeeds.GeoScope`.
   */
  readonly geo_scope?:
    | { readonly kind: "national" }
    | { readonly kind: "subset"; readonly states: readonly string[] };
  /**
   * Optional territory groupings. Each entry is one named bucket
   * with a `members[]` list of level ids. See Brief 44 §3.1 lock.
   */
  readonly geo_territories?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly members: readonly string[];
  }>;
  /**
   * For `data_type: "enum"`, the valid options. Mirrors the canonical
   * `Dimension.options` field; surfaced by the 24.C Standard-subtype
   * drawer as comma-separated text.
   */
  readonly options?: readonly string[];

  // ── 26.P1 — Brief 26 v2 fields ─────────────────────────────────
  // Shape declares how the dimension's value space is organized
  // (categorical levels vs. banded continuous). Levels carry richer
  // per-level metadata than the legacy `options[]` (id + label +
  // aliases for categorical, lo/hi for banded). Both optional for
  // backwards compat — legacy dimensions render unchanged.

  /**
   * Shape discriminator (26.P0 + ADR-0025).
   *
   * When absent, treated as "categorical" (the pre-26 default
   * for standard dims). Banded unlocks the banded editor; composite
   * (ADR-0025 / Brief 27) declares an N-way interaction via `axes`.
   */
  readonly shape?: "categorical" | "banded" | "geographic" | "composite";

  /**
   * ADR-0025 (Brief 27) — For shape="composite", the source dim
   * slugs that this composite combines (e.g.,
   * `["building_age", "class_code"]`). Ordered. MIN length 2;
   * v1 soft cap at 3. Each axis slug must reference a non-
   * composite dim that exists in the plan.
   */
  readonly axes?: readonly string[];

  /**
   * ADR-0035 (Brief 51) — for a `structural` dim whose value is DERIVED
   * from a classification dim's class attribute (e.g. `prop_rate_number`
   * derived from `class_code`). `source_dim` is the classification dim's
   * slug; `attribute` is the key into each class's `attributes` map. The
   * `stagesToRuntimePlan` projector reads this to insert a
   * `derive.class_attribute` node. Round-tripped by `dimensionsSync` —
   * Brief 60: dropping it in the API↔UI adapters silently broke the
   * derivation wire (P-N10) so the property rate-number leg never scored.
   */
  readonly derived_from?: {
    readonly source_dim: string;
    readonly attribute: string;
    /**
     * Brief 83 / TV-19 — optional DECLARED override: the submission
     * field whose non-empty value supersedes the class-derived value
     * (ISO BOP's `liab_exposure_basis_override`). Must ride every
     * round-trip or the sync clobbers it (the Brief-60 lesson).
     */
    readonly override_field?: string | null;
  };

  /**
   * Per-level metadata. Lenient `unknown` shape here to keep the
   * UI primitive type-agnostic; strict typing lives in the
   * canonical `DimensionLevel` from `@openrater/contracts`. Consumers
   * that need the discriminated union should narrow there.
   */
  readonly levels?: ReadonlyArray<{
    readonly kind: "categorical" | "banded" | "geographic";
    readonly id: string;
    readonly label: string;
    readonly aliases?: readonly string[];
    readonly lo?: number;
    readonly hi?: number;
    readonly territory_ref?: string;
  }>;
  /**
   * Brief 30 follow-up (locked in Brief 34 §−1) — Whether this
   * dim's factor values are expected to move monotonically when
   * the dim is on the row axis of a banded factor table. Drives
   * the `monotonicity-break` auto-insight in <FactorTableViz>.
   *
   *   • `'increasing'` / `'decreasing'` — fixed direction;
   *     monotonicity-break insights fire on any step that moves
   *     the WRONG way
   *   • `true` — legacy infer-from-data behavior
   *   • `null` / omitted — no monotonicity check (default)
   *
   * Configured by the actuary via the Brief 30 dim editor (when
   * the editor exposes this control — until then this field
   * rides along unset).
   */
  readonly monotonicity_expected?:
    | "increasing"
    | "decreasing"
    | boolean
    | null;
}
