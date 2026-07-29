/**
 * Canonical Dimension contract — sub-brief 24.A + 24.A2.
 *
 * A Dimension is the substrate's concept of a rate-plan variable —
 * BOTH the inputs a policy supplies (class_code, deductible, limit)
 * AND the structural axes used to expand multi-dimensional tables
 * (peril, coverage, sub-coverage). The `role` field discriminates.
 *
 * **24.A2 extension:** Dimensions also have a *subtype*
 * (`dimension_type`) that says what KIND of dimension this is —
 * a plain Standard variable, a Geographic territory, or a
 * Classification with proprietary input-string mapping. The subtype
 * drives which editor pane the UI opens; the engine ignores it.
 *
 * Per Brief 24 v3 §3.1 (Dimension umbrella with subtypes). Both
 * `role` and `dimension_type` are UI hints. The engine treats every
 * dimension as a substitutable variable; chained lookups operate
 * the same regardless of subtype.
 *
 * Cross-references:
 *   docs/design-briefs/24a-substrate-prep.md — original 24.A sub-brief
 *   docs/design-briefs/plan-builder-flow.md §3.1 — v3 Dimension umbrella
 *   packages/contracts/src/class-record-types.ts — ClassRecord (used by classification subtype)
 *   packages/contracts/src/class-vocab.ts — ClassVocab + translateClass (used by Classification mapping)
 */

/**
 * The role discriminator.
 *
 * - "rating-input" — an input variable the actuary binds from
 *   policy data (class_code, deductible, limit). Bindable from
 *   ACORD form fields, API enrichment, or derivation.
 *
 * - "structural" — a non-input axis used to expand rating
 *   structures (peril, coverage, sub-coverage). NOT bound from
 *   policy data; supplied as a static axis in multi-dim tables.
 *
 * - "both" — an input that's ALSO a structural axis (e.g.,
 *   construction is bound from form data AND expands a 2-D
 *   Construction × Class table).
 */
export type DimensionRole = "rating-input" | "structural" | "both";

/**
 * The data-type discriminator for a dimension's values.
 *
 * - "string" — free-form text (e.g., class code as raw identifier)
 * - "number" — numeric value (TIV, year_built)
 * - "currency" — monetary value (limit, deductible)
 * - "boolean" — true/false flag (sprinklered, has_alarm)
 * - "enum" — finite list of options declared via `options[]`
 *   (construction class, protection class)
 */
export type DimensionDataType =
  | "string"
  | "number"
  | "currency"
  | "boolean"
  | "enum";

/**
 * The canonical Dimension type. Every UI consumer (the Variables
 * editor, the Tables editor, the DimensionRefPicker) reads from
 * this single shape.
 *
 * Storage: `plan.dimensions[]` (array of Dimension records).
 *
 * Sourcing:
 *   - Slice-4 (API Lab) — backend persists + serves
 *   - Frontend fixtures (today) — `SAMPLE_DIMENSIONS`
 *
 * Invariants:
 *   - `id` is unique within a plan
 *   - `slug` is unique within a plan + URL-safe (lowercase, _-only)
 *   - `data_type: "enum"` REQUIRES `options[]` to be non-empty
 */
export interface Dimension {
  /** Stable unique identifier within a plan. */
  readonly id: string;
  /** Human-readable name (e.g., "Construction class"). */
  readonly display_name: string;
  /** URL-safe identifier (e.g., "construction_class"). */
  readonly slug: string;
  /** What kind of value this dimension holds. */
  readonly data_type: DimensionDataType;
  /**
   * What this dimension is FOR. See DimensionRole jsdoc.
   *
   * Defaults to DEFAULT_DIMENSION_ROLE for pre-24.A dimensions
   * that don't ship a role. New code should always set this
   * explicitly.
   */
  readonly role: DimensionRole;
  /** One-line human description. Optional but encouraged. */
  readonly description?: string;
  /**
   * For `data_type: "enum"`, the valid options. Empty / missing
   * for non-enum types. Validation invariant: enum data_type
   * MUST have at least one option.
   */
  readonly options?: readonly string[];

  // ── 24.A2 — Dimension subtype (the umbrella concept) ──────
  // See DimensionType jsdoc + Brief 24 v3 §2.2.1.
  //
  // Optional only for backwards-compat: pre-24.A2 dimensions get
  // DEFAULT_DIMENSION_TYPE via normalizeDimension(). New code
  // should always set this explicitly.

  /**
   * Which kind of dimension this is. Drives the editor pane the
   * DIMENSIONS workspace opens. Defaults to "standard" when absent.
   */
  readonly dimension_type?: DimensionType;

  /**
   * For `dimension_type: "classification"`, the canonical ClassLibrary
   * this dimension uses. References a ClassLibrary entity (see
   * class-library-types). Optional only for backwards-compat; required
   * in any new Classification-subtype dimension.
   */
  readonly class_library_id?: string;

  /**
   * For `dimension_type: "classification"`, the proprietary input →
   * canonical mapping rules. Evaluated top-to-bottom; first match
   * wins. Use the `__default__` sentinel for the fallback rule.
   */
  readonly classification_mapping?: readonly ClassMappingRule[];

  // ── ADR-0035 (Brief 51) — class-derived structural dimension ────
  /**
   * For a `structural` dim whose value is DERIVED from another
   * dimension's class attribute (e.g. `prop_rate_number` derived from
   * the `class_code` classification dim). `source_dim` is the slug of
   * the classification dim; `attribute` is the key into each class's
   * `attributes` map (`ClassRecord.attributes`). The projector inserts a
   * `derive.class_attribute` node from this; the engine otherwise treats
   * the dim as an ordinary substitutable variable. Absent for non-derived
   * dims.
   */
  readonly derived_from?: {
    readonly source_dim: string;
    readonly attribute: string;
  };

  /**
   * @deprecated Brief 20 carry-over. Brief 44 PR 44.9 deprecates the
   * standalone /territories route; new geographic dims persist their
   * structure via `geo_granularity` + `geo_scope` + `geo_territories`
   * below. Kept here for backwards-compat with pre-Brief-44 plans.
   */
  readonly territory_schema_id?: string;

  // ── Brief 44 — Geographic rating substrate (PR 44.1) ───────────
  // The trio is set IFF `dimension_type === "geographic"`. The
  // backend CHECK constraint (011_*.sql) + the Pydantic validator
  // enforce the coupling; the frontend treats them as joint optionals.

  /**
   * Granularity of a geographic dim. Locked at creation per Brief 44
   * Q1 — switching requires delete + recreate.
   */
  readonly geo_granularity?: "state" | "county" | "zip";

  /**
   * Scope of a geographic dim — either whole-country or an explicit
   * subset of states (USPS 2-letter codes). National plans set
   * `{ kind: "national" }`; bounded plans set
   * `{ kind: "subset", states: [...] }` per Brief 44 Q3.
   */
  readonly geo_scope?:
    | { readonly kind: "national" }
    | { readonly kind: "subset"; readonly states: readonly string[] };

  /**
   * Optional grouping layer on top of the geographic levels. Empty
   * array == "rate directly on the levels"; missing/undefined == not
   * a geographic dim. Each territory references levels of the parent
   * dim via `members`. See Brief 44 Q2 + Q9.
   */
  readonly geo_territories?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly members: readonly string[];
  }>;

  // ── 26.P0 — Brief 26 (Dimensions v2) fields ──────────────────
  // Orthogonal to `data_type` + `dimension_type`. See the type
  // definitions below for full semantics. All optional; existing
  // dimensions render unchanged when these are absent.

  /**
   * The dimension's organizational shape. Optional for backwards
   * compat — `inferDimensionShape()` derives the shape from the
   * other fields when this is absent. New v2 banded dimensions
   * MUST set this to "banded" explicitly (there's no other
   * derivable signal for continuous bucketing).
   */
  readonly shape?: DimensionShape;

  /**
   * The dimension's level list. Optional during the v1 → v2
   * transition; v1 dimensions continue to use `options[]` (for
   * enum) or `classification_mapping[]` (for classification) +
   * an empty `levels`.
   *
   * For `shape: "banded"`, this is the only valid value source —
   * `options` doesn't make sense for continuous ranges.
   */
  readonly levels?: readonly DimensionLevel[];

  // ── 26.P0 — PDF ingestion future-proofing (Phase E) ──────────
  // Reserved fields for the future Claude-driven PDF ingestion
  // pipeline. No UI today; persisted by the future PDF brief.

  /** Lifecycle status of an ingestion draft. Default = "committed". */
  readonly draft_status?: "extracted" | "reviewed" | "committed";

  /** Source PDF URL when this dimension was extracted from a circular. */
  readonly source_pdf_url?: string;

  /** Page within the source PDF (1-indexed). */
  readonly source_page?: number;

  // ── ADR-0025 (Brief 27) — composite axes ───────────────────────
  // For shape="composite", the source dimension slugs that this
  // composite combines. Order matters — the resolved level id
  // concatenates axis-resolved levels in this order with "·".
  //
  // Constraints (enforced by validateCompositeDimension):
  //   • MIN length = 2
  //   • MAX length = 3 (v1 soft cap; UI warns past 3)
  //   • Each axis MUST reference a dimension with shape !==
  //     "composite" (no nested composites in v1)
  //   • All referenced dims MUST exist at plan-load time
  readonly axes?: readonly string[];
}

/**
 * The default role applied to dimensions missing the field
 * (backwards compatibility for pre-24.A plans). Rating-input is
 * the safer default — it implies the dimension comes from policy
 * data, which is the common case. Mistakenly marking a structural
 * dimension as rating-input shows it in the wrong UI bucket but
 * doesn't break the engine.
 */
export const DEFAULT_DIMENSION_ROLE: DimensionRole = "rating-input";

/**
 * Returns true when this dimension acts as a rating input (bindable
 * from policy data + read by lookups). True for "rating-input" and
 * "both".
 */
export function isRatingInput(d: Pick<Dimension, "role">): boolean {
  return d.role === "rating-input" || d.role === "both";
}

/**
 * Returns true when this dimension acts as a structural axis (used
 * to expand multi-dim tables). True for "structural" and "both".
 */
export function isStructural(d: Pick<Dimension, "role">): boolean {
  return d.role === "structural" || d.role === "both";
}

/**
 * Normalizes a dimension that may be missing `role` (e.g., from a
 * legacy backend response or fixture). Applies DEFAULT_DIMENSION_ROLE
 * when absent.
 *
 * Use at the boundary where dimensions enter the system; once
 * normalized, downstream code can rely on `role` being present.
 *
 * **24.A2 update:** also applies DEFAULT_DIMENSION_TYPE when
 * `dimension_type` is absent.
 */
export function normalizeDimension(
  raw: Omit<Dimension, "role" | "dimension_type"> & {
    readonly role?: DimensionRole;
    readonly dimension_type?: DimensionType;
    readonly class_library_id?: string;
    readonly territory_schema_id?: string;
    readonly classification_mapping?: readonly ClassMappingRule[];
    readonly geo_granularity?: "state" | "county" | "zip";
    readonly geo_scope?: Dimension["geo_scope"];
    readonly geo_territories?: Dimension["geo_territories"];
  },
): Dimension {
  return {
    ...raw,
    role: raw.role ?? DEFAULT_DIMENSION_ROLE,
    dimension_type: raw.dimension_type ?? DEFAULT_DIMENSION_TYPE,
    ...(raw.class_library_id !== undefined
      ? { class_library_id: raw.class_library_id }
      : {}),
    ...(raw.territory_schema_id !== undefined
      ? { territory_schema_id: raw.territory_schema_id }
      : {}),
    ...(raw.classification_mapping !== undefined
      ? { classification_mapping: raw.classification_mapping }
      : {}),
  };
}

// ============================================================================
// 24.A2 — Dimension subtype discriminator
//
// A Dimension can be one of three subtypes. Each subtype carries
// different optional metadata + opens a different editor pane in
// the DIMENSIONS workspace (per Brief 24 v3 §2.2.1).
// ============================================================================

/**
 * The subtype discriminator.
 *
 * - "standard" — a simple variable. Just name + data_type + options.
 *   Examples: deductible (currency), construction (enum), TIV (number),
 *   sprinklered (boolean), peril (structural enum), coverage
 *   (structural enum). Editor: plain form fields.
 *
 * - "geographic" — a territory schema. References a TerritorySchema
 *   entity (which holds the boundary list — ZIP set / FIPS set /
 *   polygon — and the coverage diagnostics). The "value" of a
 *   geographic dimension for a risk is the territory ID the risk's
 *   address falls into. Editor: <TerritoryMapEditor> (Brief 20).
 *
 * - "classification" — a class library. References a ClassLibrary
 *   entity (the canonical class codes). Carries proprietary
 *   `classification_mapping` rules that translate raw input
 *   strings (e.g., "restaurants", "bar & grill") into canonical
 *   class codes (e.g., "71641 — limited cooking"). Editor:
 *   <ClassBrowser> + <ClassDetailPane> + the in-line mapping rules
 *   editor.
 */
export type DimensionType = "standard" | "geographic" | "classification";

/**
 * Default dimension subtype. Applied when migrating pre-24.A2
 * dimensions that don't ship a `dimension_type` field. Standard is
 * the safer default — it implies "just a variable, no special UI."
 * A misclassified standard dimension shows in the right UI bucket
 * with a slightly less rich editor; it doesn't break anything.
 */
export const DEFAULT_DIMENSION_TYPE: DimensionType = "standard";

/**
 * One mapping rule for a Classification dimension. Translates a raw
 * input string (whatever the policy data carries — e.g., "restaurants",
 * "bar & grill", "no match") into a canonical class code from the
 * referenced ClassLibrary.
 *
 * Rules are evaluated top-to-bottom; first match wins. The special
 * input_pattern "__default__" (or any rule whose input_pattern is
 * the literal default sentinel) is the fallback when no other rule
 * matches.
 *
 * The pattern syntax is intentionally simple (exact string match,
 * lowercase-normalized). Regex / wildcards can land later if real
 * usage demands them; not in 24.A2 scope.
 */
export interface ClassMappingRule {
  /**
   * The raw input string to match (lowercase-normalized comparison).
   * Use the literal `"__default__"` for the fallback rule.
   */
  readonly input_pattern: string;
  /**
   * The canonical class code to map to. Must exist in the
   * referenced ClassLibrary.
   */
  readonly canonical_class_code: string;
  /** Optional rationale / source citation. */
  readonly notes?: string;
}

/**
 * The literal sentinel for the default-fallback ClassMappingRule.
 * A rule with this `input_pattern` matches any input that no other
 * rule has matched.
 */
export const CLASS_MAPPING_DEFAULT_PATTERN = "__default__" as const;

/**
 * Helper: does this dimension act as the Standard subtype? (Default
 * when subtype is absent.)
 */
export function isStandardDimension(
  d: Pick<Dimension, "dimension_type">,
): boolean {
  // Treat missing dimension_type as "standard" (backwards compat).
  return d.dimension_type === undefined || d.dimension_type === "standard";
}

/** Helper: does this dimension carry a TerritorySchema reference? */
export function isGeographicDimension(
  d: Pick<Dimension, "dimension_type">,
): boolean {
  return d.dimension_type === "geographic";
}

/**
 * Helper: does this dimension carry a ClassLibrary reference and
 * mapping rules?
 */
export function isClassificationDimension(
  d: Pick<Dimension, "dimension_type">,
): boolean {
  return d.dimension_type === "classification";
}

/**
 * Helper: given a Classification dimension + a raw input string,
 * resolve to the canonical class code using the dimension's mapping
 * rules. Returns `null` when no rule matches AND no default-pattern
 * rule is configured.
 *
 * Comparison is lowercase + trimmed. Engine code that needs to
 * resolve a classification value calls this; UI code that edits the
 * mapping table uses the rule list directly.
 */
export function resolveClassMapping(
  rules: readonly ClassMappingRule[] | undefined,
  rawInput: string,
): string | null {
  if (!rules || rules.length === 0) return null;
  const needle = rawInput.trim().toLowerCase();
  let defaultRule: ClassMappingRule | null = null;
  for (const rule of rules) {
    if (rule.input_pattern === CLASS_MAPPING_DEFAULT_PATTERN) {
      defaultRule = rule;
      continue;
    }
    if (rule.input_pattern.trim().toLowerCase() === needle) {
      return rule.canonical_class_code;
    }
  }
  return defaultRule?.canonical_class_code ?? null;
}

// ============================================================================
// 26.P0 — Brief 26 (Dimensions v2) extension
//
// Adds the three-shape model on top of the existing 24.A2 subtype.
// `shape` is orthogonal to `data_type` and to `dimension_type`:
//
//   data_type    — the underlying primitive (string / number / etc.)
//   dimension_type — 24.A2 subtype (standard / geographic / classification)
//   shape        — 26.P0 organization (categorical / banded / geographic)
//
// `shape` is the primary axis for the v2 DIMENSIONS workspace: the
// banded shape unlocks bucketing of continuous variables (Building
// Age in years → 5 bands), which the 24.A model couldn't express.
//
// Both new fields (`shape`, `levels`) are OPTIONAL so existing
// dimensions keep working without migration. `inferDimensionShape()`
// gives consumers a single read path that derives the shape from
// the dimension's data even when the field is absent.
//
// Cross-reference: docs/design-briefs/26-dimensions-v2.md §−1 + §6.
// ============================================================================

/**
 * The shape discriminator (26.P0).
 *
 * - "categorical" — a finite set of levels each carrying their own
 *   id, label, and alias list. Replaces "enum" data_type for v2
 *   authoring; the v1 `data_type: "enum"` + `options[]` continues
 *   to work and is treated as categorical at read time.
 *
 * - "banded" — a continuous range bucketed into N levels with
 *   half-open `[lo, hi)` ranges. Unlocks Building Age / TIV Tier /
 *   Construction Year. No v1 equivalent.
 *
 * - "geographic" — a territory-schema reference. Levels carry
 *   `territory_ref` pointing at a TerritorySchema entity (Brief 20).
 *   The legacy `dimension_type: "geographic"` + `territory_schema_id`
 *   keeps working and is treated as geographic at read time.
 */
export type DimensionShape =
  | "categorical"
  | "banded"
  | "geographic"
  // ── ADR-0025 (Brief 27) — composite as first-class shape ─────
  // A composite dim combines 2+ source dims as axes. The resolved
  // level id concatenates the per-axis resolved ids with "·".
  // Reverses Brief 26 §−1 Q1 ("composite is a FactorTable, not a
  // Dimension"). See `Dimension.axes` + `resolveCompositeLevel`.
  | "composite";

/** A categorical level. Many input aliases → one canonical level id. */
export interface CategoricalLevel {
  readonly kind: "categorical";
  readonly id: string;
  readonly label: string;
  /**
   * Input strings that should resolve to this level. Case-insensitive,
   * trimmed exact match. The level id itself is implicitly an alias.
   */
  readonly aliases: readonly string[];
}

/**
 * A banded level. Half-open interval `[lo, hi)`. The first band's
 * `lo` MAY be open (no lower bound) and the last band's `hi` MAY be
 * open (no upper bound).
 *
 * Open ends have TWO encodings (platform-test finding E5):
 * `±Infinity` in-memory, and `null` on the wire — JSON has no
 * Infinity, so levels persisted through `levels_json` round-trip
 * open ends as `null`. Every band resolver treats `null` as the
 * matching infinity; producers SHOULD write `null` (JSON-safe)
 * rather than materializing Infinity.
 */
export interface BandedLevel {
  readonly kind: "banded";
  readonly id: string;
  readonly label: string;
  /** Inclusive lower bound. null (or -Infinity) for an open lower end. */
  readonly lo: number | null;
  /** Exclusive upper bound. null (or +Infinity) for an open upper end. */
  readonly hi: number | null;
}

/** Coalesce a banded lower bound's JSON-safe `null` onto -Infinity (E5). */
export function bandLo(l: { readonly lo: number | null }): number {
  return l.lo ?? Number.NEGATIVE_INFINITY;
}

/** Coalesce a banded upper bound's JSON-safe `null` onto +Infinity (E5). */
export function bandHi(l: { readonly hi: number | null }): number {
  return l.hi ?? Number.POSITIVE_INFINITY;
}

/** A geographic level. References a Territory entity (Brief 20). */
export interface GeographicLevel {
  readonly kind: "geographic";
  readonly id: string;
  readonly label: string;
  /** TerritorySchema.territory_id this level represents. */
  readonly territory_ref: string;
}

/**
 * Discriminated union of all level kinds. The `kind` field
 * disambiguates at runtime; consumers should always switch on it
 * rather than infer from sibling fields.
 */
export type DimensionLevel = CategoricalLevel | BandedLevel | GeographicLevel;

/**
 * The default shape applied to dimensions missing the `shape` field
 * (backwards compatibility for pre-26 plans). Categorical is the
 * safest default — it matches the legacy `enum`/`options[]` model
 * + every pre-26 standard dimension that wasn't geographic.
 */
export const DEFAULT_DIMENSION_SHAPE: DimensionShape = "categorical";

/**
 * Infers the shape of a dimension that may not have explicitly set
 * `shape`. Uses the following heuristics, in order:
 *
 *   1. Explicit `shape` field — return as-is.
 *   2. `dimension_type === "geographic"` → "geographic".
 *   3. `dimension_type === "classification"` → "categorical" (it
 *      always is — the class-library is a finite set with rich
 *      mapping rules).
 *   4. Default: "categorical".
 *
 * Banded shapes always carry an explicit `shape: "banded"` because
 * there's no other field that signals "this is bucketed continuous."
 */
export function inferDimensionShape(
  d: Pick<Dimension, "shape" | "dimension_type">,
): DimensionShape {
  if (d.shape !== undefined) return d.shape;
  if (d.dimension_type === "geographic") return "geographic";
  if (d.dimension_type === "classification") return "categorical";
  return DEFAULT_DIMENSION_SHAPE;
}

/** Helper: does this dimension organize values into bands? */
export function isBandedDimension(
  d: Pick<Dimension, "shape" | "dimension_type">,
): boolean {
  return inferDimensionShape(d) === "banded";
}

/**
 * FCA fca-2026-07-25 #26 (finding 119) — numeric-aware display
 * ordering for territory/level identifiers. Every list surface used
 * to present territories in workbook SOURCE order (T6, T8, T4, T5,
 * T7, T1, T2, T3), so cross-referencing against the filing's own
 * Exhibit T-1 meant hunting an arbitrary sequence. `localeCompare`
 * with `numeric` sorts T1 < T2 < T10 (plain lexicographic puts T10
 * before T2). Display-only: never reorders stored data.
 */
export function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** Helper: ADR-0025 — is this dimension a composite of 2+ source dims? */
export function isCompositeDimension(
  d: Pick<Dimension, "shape" | "dimension_type">,
): boolean {
  return inferDimensionShape(d) === "composite";
}

/** Helper: does this dimension organize values into categorical levels? */
export function isCategoricalDimension(
  d: Pick<Dimension, "shape" | "dimension_type">,
): boolean {
  return inferDimensionShape(d) === "categorical";
}

/**
 * Validates a banded-level list. Returns the first violation
 * encountered, or `null` when the list is valid.
 *
 * Rules:
 *   • Non-empty.
 *   • Every level has `kind === "banded"`.
 *   • Sorted ascending by `lo`.
 *   • Adjacent bands are contiguous: `bands[i].hi === bands[i+1].lo`.
 *   • Strictly positive width per band: `lo < hi`.
 *   • At most one band has an open lower end — `lo` null or
 *     `-Infinity` — and it must be the first (E5: null is the
 *     JSON-safe encoding).
 *   • At most one band has an open upper end — `hi` null or
 *     `+Infinity` — and it must be the last.
 *
 * UI consumers (DimensionBandedDrawer) call this on every edit;
 * the engine calls it at plan load.
 */
export function validateBandedLevels(
  levels: readonly DimensionLevel[],
): string | null {
  if (levels.length === 0) return "Banded dimension needs at least one band.";
  for (let i = 0; i < levels.length; i++) {
    const l = levels[i]!;
    if (l.kind !== "banded") {
      return `Band ${i}: expected kind 'banded', got '${l.kind}'.`;
    }
    const lo = bandLo(l);
    const hi = bandHi(l);
    if (!(lo < hi)) {
      return `Band ${i} ("${l.label}"): lo (${lo}) must be strictly less than hi (${hi}).`;
    }
    if (lo === Number.NEGATIVE_INFINITY && i !== 0) {
      return `Band ${i} ("${l.label}"): an open lower bound is only allowed on the first band.`;
    }
    if (hi === Number.POSITIVE_INFINITY && i !== levels.length - 1) {
      return `Band ${i} ("${l.label}"): an open upper bound is only allowed on the last band.`;
    }
    if (i > 0) {
      const prev = levels[i - 1]! as BandedLevel;
      if (bandHi(prev) !== lo) {
        return `Bands ${i - 1} → ${i}: gap or overlap (${bandHi(prev)} ≠ ${lo}).`;
      }
    }
  }
  return null;
}

/**
 * Derives a list of banded levels from a sorted breakpoint vector +
 * optional labels. Pure helper used by the UI's scrubber / paste /
 * type-breakpoints paths to materialize bands.
 *
 * Conventions:
 *   • `breakpoints` must be sorted ascending + length ≥ 2 (two
 *     breakpoints produce one band).
 *   • Produces `breakpoints.length - 1` bands; band i covers
 *     `[breakpoints[i], breakpoints[i+1])`.
 *   • Labels default to `"{lo}–{hi}"`; supply `labels` to override.
 *     Pass an empty label to fall back to the default for that band.
 *   • Ids are stable slugs derived from `(lo, hi)` so editing a
 *     label doesn't change the id (downstream references survive
 *     a relabel).
 *
 * Pass `Number.NEGATIVE_INFINITY` / `Number.POSITIVE_INFINITY` at
 * the ends to express open intervals (the first band's lo or the
 * last band's hi).
 */
export function deriveBandsFromBreakpoints(
  breakpoints: readonly number[],
  labels?: readonly string[],
): readonly BandedLevel[] {
  if (breakpoints.length < 2) {
    throw new Error(
      `deriveBandsFromBreakpoints: need ≥ 2 breakpoints (got ${breakpoints.length}).`,
    );
  }
  for (let i = 1; i < breakpoints.length; i++) {
    if (!(breakpoints[i - 1]! < breakpoints[i]!)) {
      throw new Error(
        `deriveBandsFromBreakpoints: breakpoints must be strictly ascending; saw ${breakpoints[i - 1]} ≥ ${breakpoints[i]} at index ${i}.`,
      );
    }
  }
  const result: BandedLevel[] = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const lo = breakpoints[i]!;
    const hi = breakpoints[i + 1]!;
    const customLabel = labels?.[i];
    const label =
      customLabel && customLabel.trim() !== ""
        ? customLabel
        : `${formatBound(lo)}–${formatBound(hi)}`;
    result.push({
      kind: "banded",
      id: bandIdFromBounds(lo, hi),
      label,
      lo,
      hi,
    });
  }
  return result;
}

function formatBound(x: number): string {
  if (x === Number.NEGATIVE_INFINITY) return "−∞";
  if (x === Number.POSITIVE_INFINITY) return "+∞";
  // Trim trailing zeros from integers for cleaner labels.
  return Number.isInteger(x) ? String(x) : String(x);
}

function bandIdFromBounds(lo: number, hi: number): string {
  // Stable slug. `lo_hi` for finite bounds; "neginf" / "posinf"
  // for open ends; decimals → "_" to keep the id URL-safe.
  const slugify = (x: number): string => {
    if (x === Number.NEGATIVE_INFINITY) return "neginf";
    if (x === Number.POSITIVE_INFINITY) return "posinf";
    return String(x).replace(/[.-]/g, "_");
  };
  return `band_${slugify(lo)}_${slugify(hi)}`;
}

/**
 * Resolves a numeric input against a list of banded levels using
 * half-open `[lo, hi)` semantics. Returns the matching level's id
 * or `null` if no band contains the value.
 *
 * Engine code calls this when a chain factor needs to map a raw
 * input (e.g., `building_age = 17`) onto the banded dimension's
 * level id (e.g., "L3"). The trace records the resolved level.
 */
export function resolveBandedLevel(
  levels: readonly DimensionLevel[],
  value: number,
): string | null {
  for (const l of levels) {
    if (l.kind !== "banded") continue;
    // Finding E5 — null bounds are JSON-safe open ends (±∞).
    if (value >= bandLo(l) && value < bandHi(l)) return l.id;
  }
  return null;
}

/**
 * Resolves a categorical input string against a list of categorical
 * levels. Returns the matching level's id (case-insensitive + trimmed
 * alias match) or `null` if no level claims the input.
 *
 * Engine code calls this when a chain factor needs to map a raw
 * input (e.g., `class = "Restaurant — full service"`) onto a
 * canonical level id (e.g., "71641"). The level's own id is
 * implicitly an alias — actuaries don't have to list "73911" in
 * the aliases of a level whose id is already "73911".
 */
export function resolveCategoricalLevel(
  levels: readonly DimensionLevel[],
  rawInput: string,
): string | null {
  const needle = rawInput.trim().toLowerCase();
  for (const l of levels) {
    if (l.kind !== "categorical") continue;
    if (l.id.toLowerCase() === needle) return l.id;
    for (const alias of l.aliases) {
      if (alias.trim().toLowerCase() === needle) return l.id;
    }
  }
  return null;
}

// ============================================================================
// ADR-0038 — Canonical geographic-dimension lookup domain
//
// A geographic dim is keyed on ONE canonical lookup domain that the factor
// grid, the input validator, and the engine projector ALL read through, so
// they can never disagree (the F3 root cause was three consumers each
// inventing their own answer). Per the locked "territory-when-grouped, else
// level" model:
//
//   • no ACTIVE territory (none with ≥1 member) → key space = the granular
//     levels (the V21 "rate directly on the states/ZIPs" behavior).
//   • ≥1 active territory → key space = { active territory ids } ∪
//     { ungrouped level ids }. Grouped levels collapse to their territory;
//     ungrouped levels stay rateable on their own. A fully-grouped dim (KS:
//     every ZIP in 701 or 702) collapses to exactly { 701, 702 }.
//
// Resolution is idempotent on keys (a value that is already a key passes
// through), so an input column may carry EITHER the granular level (a ZIP)
// OR the rollup (701/702) and both resolve — matching `derive.territory`'s
// runtime contract (ADR-0028) and the sample policies' "carries territory
// or ZIP" shape.
//
// These joins the resolve*Level family above; pure + structural-typed so the
// canonical `Dimension` AND the lenient labs-ui `DimensionRow` both satisfy
// the param. Cross-reference: docs/adr/0038-geographic-dimension-lookup-domain.md.
// ============================================================================

/**
 * Minimal structural view a geographic dim must expose for lookup-domain
 * resolution. Both `Dimension` and labs-ui's `DimensionRow` satisfy it.
 */
export interface GeoLookupDimLike {
  readonly levels?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly geo_territories?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly members: readonly string[];
  }>;
}

/**
 * True when a dim must resolve through the geographic lookup domain —
 * `dimension_type === "geographic"` OR `shape === "geographic"`.
 *
 * This is intentionally BROADER than `inferDimensionShape(dim) ===
 * "geographic"`: `inferDimensionShape` returns the *explicit* `shape` when one
 * is set, so a dim authored with `shape: "categorical"` but
 * `dimension_type: "geographic"` (the live-bug shape that caused F3) would
 * read back as "categorical" and be mis-routed to the categorical validator.
 * Every lookup-domain consumer (the factor grid `levelsForKeying`, the engine
 * projector, the input validator, the Parametrize rail) MUST use THIS
 * predicate so they agree — and so the fix lands at the read boundary with no
 * data migration. (`isGeographicDimension` checks only `dimension_type`; this
 * also catches the shape-discriminator-alone case.)
 */
export function isGeographicLookupDim(
  dim: Pick<Dimension, "dimension_type" | "shape">,
): boolean {
  return dim.dimension_type === "geographic" || dim.shape === "geographic";
}

/**
 * Territories that actually claim ≥1 member. Empty-membership buckets are
 * metadata-only (a freshly-created, not-yet-populated bucket) and contribute
 * nothing to the lookup domain — they must NOT key the grid or the engine.
 * (The pre-ADR-0038 `levelsForKeying` ignored this filter while the projector
 * applied it; that mismatch was the hidden third disagreement.)
 */
export function activeGeoTerritories(
  dim: GeoLookupDimLike,
): ReadonlyArray<{ id: string; label: string; members: readonly string[] }> {
  return (dim.geo_territories ?? []).filter(
    (t) => !!t && Array.isArray(t.members) && t.members.length > 0,
  );
}

/**
 * The rating/lookup KEY SPACE — the rows a territory factor table is keyed on
 * (the factor grid renders exactly these). Per the model above:
 *   • no active territories → the granular levels
 *   • active territories    → active territory ids, then any ungrouped levels
 *
 * Order is stable: territories in declared order, then ungrouped levels in
 * level order. Pure.
 */
export function geoLookupKeys(
  dim: GeoLookupDimLike,
): ReadonlyArray<{ id: string; label: string }> {
  const active = activeGeoTerritories(dim);
  const levels = dim.levels ?? [];
  if (active.length === 0) {
    return levels.map((l) => ({ id: l.id, label: l.label }));
  }
  const grouped = new Set<string>();
  for (const t of active) for (const m of t.members) grouped.add(m);
  const keys: { id: string; label: string }[] = active.map((t) => ({
    id: t.id,
    label: t.label,
  }));
  for (const l of levels) {
    if (!grouped.has(l.id)) keys.push({ id: l.id, label: l.label });
  }
  return keys;
}

/**
 * Resolve a raw input value (a level id OR a territory id) to its lookup key.
 * Comparison is case-insensitive + trimmed (mirrors `derive.territory`).
 *
 *   1. already an active territory id → itself (idempotent pass-through)
 *   2. a grouped member level id      → its active territory id
 *   3. an ungrouped level id          → itself
 *   4. otherwise                      → { key: null, unmapped: true }
 *
 * With no active territories, only step 3 applies (value must be a level id).
 * Pure + deterministic — the engine analogue is `derive.territory.execute`.
 */
export function resolveGeographicValue(
  dim: GeoLookupDimLike,
  raw: string,
): { key: string | null; unmapped: boolean } {
  const needle = raw.trim().toLowerCase();
  if (needle === "") return { key: null, unmapped: true };
  const active = activeGeoTerritories(dim);
  const levels = dim.levels ?? [];

  if (active.length === 0) {
    for (const l of levels) {
      if (l.id.trim().toLowerCase() === needle) {
        return { key: l.id, unmapped: false };
      }
    }
    return { key: null, unmapped: true };
  }

  // 1. idempotent: the value IS already an active territory id.
  for (const t of active) {
    if (t.id.trim().toLowerCase() === needle) {
      return { key: t.id, unmapped: false };
    }
  }
  // 2. a grouped member level id → its territory.
  const groupedNorm = new Set<string>();
  for (const t of active) {
    for (const m of t.members) {
      const mn = m.trim().toLowerCase();
      groupedNorm.add(mn);
      if (mn === needle) return { key: t.id, unmapped: false };
    }
  }
  // 3. an ungrouped level id → itself.
  for (const l of levels) {
    const ln = l.id.trim().toLowerCase();
    if (ln === needle && !groupedNorm.has(ln)) {
      return { key: l.id, unmapped: false };
    }
  }
  return { key: null, unmapped: true };
}

/**
 * The ACCEPTANCE domain — every raw value the input validator must accept
 * WITHOUT flagging a mismatch, normalized (lowercase + trim, matching the
 * validator's own `normalize`). Equals exactly the set of `v` for which
 * `resolveGeographicValue(dim, v).key !== null`:
 *
 *   { all level ids } ∪ { active territory ids } ∪ { their member ids }
 *
 * (Members are included because a territory may reference a level id that
 * isn't in `levels[]` — that value still resolves, so the validator must
 * accept it. The invariant is unit-pinned.)
 */
export function geoAcceptanceSet(dim: GeoLookupDimLike): ReadonlySet<string> {
  const out = new Set<string>();
  for (const l of dim.levels ?? []) out.add(l.id.trim().toLowerCase());
  for (const t of activeGeoTerritories(dim)) {
    out.add(t.id.trim().toLowerCase());
    for (const m of t.members) out.add(m.trim().toLowerCase());
  }
  return out;
}

/**
 * The value→key map a `derive.territory` node embeds for the mixed model:
 * every grouped member level id → its territory id, AND every ungrouped level
 * id → itself (so a territory-keyed `lookup.direct`, keyed on `geoLookupKeys`,
 * also resolves the ungrouped tail). Territory ids themselves need not appear
 * — `derive.territory`'s idempotent pass-through handles key-valued inputs.
 *
 * Returns `{}` when there are no active territories (the projector then keeps
 * the direct per-value lookup — V21 path, no `derive.territory`). The single
 * source of truth for the projector's map build (ADR-0038 §2).
 */
export function geoValueToKeyMap(dim: GeoLookupDimLike): Record<string, string> {
  const active = activeGeoTerritories(dim);
  if (active.length === 0) return {};
  const out: Record<string, string> = {};
  const grouped = new Set<string>();
  for (const t of active) {
    for (const m of t.members) {
      out[m] = t.id;
      grouped.add(m);
    }
  }
  for (const l of dim.levels ?? []) {
    if (!grouped.has(l.id)) out[l.id] = l.id; // ungrouped → itself
  }
  return out;
}

// ============================================================================
// ADR-0025 (Brief 27) — Composite dimension resolution
// ============================================================================

/**
 * Separator used to concatenate per-axis resolved level ids into a
 * single composite key. e.g. "band_15_30·71641". The "·" is a
 * mid-dot (U+00B7), chosen because it doesn't appear in slugs or
 * class codes — collision-free in the substrate's existing id
 * vocabulary.
 */
export const COMPOSITE_LEVEL_SEPARATOR = "·" as const; // "·"

/**
 * Resolves a composite dimension's level by independently resolving
 * each axis against the raw inputs, then concatenating the resolved
 * level ids with `COMPOSITE_LEVEL_SEPARATOR`.
 *
 * Returns `null` if any axis fails to resolve OR if the composite
 * has an invalid `axes[]` (length < 2, missing axis dim, etc.).
 *
 * Pure + deterministic. Engine + UI both call this.
 *
 * Constraints (all-or-nothing — any violation returns null):
 *   • `composite.shape === "composite"`
 *   • `composite.axes !== undefined` AND `length >= 2`
 *   • Each axis slug references a `Dimension` in `registry`
 *   • Each axis dimension's shape !== "composite" (no nested
 *     composites in v1)
 *   • Each axis has a non-null/undefined value in `rawInputs`
 *     keyed by the axis slug
 *   • Each axis resolves to a non-null level id via its
 *     shape-appropriate resolver
 *
 * @example
 *   resolveCompositeLevel(
 *     { id: "ba_x_cc", shape: "composite", axes: ["building_age", "class_code"], … },
 *     new Map([
 *       ["building_age", { … shape: "banded", levels: [...] }],
 *       ["class_code",   { … levels: [...categorical] }],
 *     ]),
 *     { building_age: 17, class_code: "Restaurant" },
 *   )
 *   // → "band_15_30·71641"
 */
export function resolveCompositeLevel(
  composite: Pick<Dimension, "shape" | "axes">,
  registry: ReadonlyMap<string, Dimension>,
  rawInputs: Readonly<Record<string, unknown>>,
): string | null {
  if (composite.shape !== "composite") return null;
  if (!composite.axes || composite.axes.length < 2) return null;

  const resolvedIds: string[] = [];
  for (const axisSlug of composite.axes) {
    const axisDim = registry.get(axisSlug);
    if (!axisDim) return null;
    // Nested composites blocked in v1 (ADR-0025 constraint).
    if (inferDimensionShape(axisDim) === "composite") return null;

    const rawValue = rawInputs[axisSlug];
    if (rawValue === undefined || rawValue === null) return null;

    const axisShape = inferDimensionShape(axisDim);
    let levelId: string | null = null;
    if (axisShape === "categorical") {
      levelId = resolveCategoricalLevel(
        axisDim.levels ?? [],
        String(rawValue),
      );
    } else if (axisShape === "banded") {
      const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
      if (!Number.isFinite(num)) return null;
      levelId = resolveBandedLevel(axisDim.levels ?? [], num);
    } else if (axisShape === "geographic") {
      // Geographic axes resolve via the territory schema — for v1
      // we treat the raw input as the already-resolved territory
      // id. Brief 28 will tighten this with proper (state, zip5)
      // → territory_id resolution.
      levelId = String(rawValue);
    } else {
      // Unreachable — composite was filtered above; any other
      // future shape should add an explicit branch here.
      return null;
    }
    if (levelId === null) return null;
    resolvedIds.push(levelId);
  }
  return resolvedIds.join(COMPOSITE_LEVEL_SEPARATOR);
}

/**
 * Validates a composite dimension against the constraints declared
 * in ADR-0025. Returns the first violation as a human-readable
 * message, or `null` when the composite is valid.
 *
 * UI consumers (`<DimensionCompositePicker>` in Brief 27 PR 5) call
 * this on every edit; the engine calls it at plan load.
 *
 * Constraints checked:
 *   • shape === "composite"
 *   • axes is non-empty + length ≥ 2
 *   • axes length ≤ 3 in v1 (soft cap — returns null past 3 but
 *     the UI surfaces a warning separately)
 *   • Every axis slug exists in the registry
 *   • No axis references a composite dim (v1 — no nesting)
 *   • No duplicate axes (a dim crossed with itself is meaningless)
 */
export function validateCompositeDimension(
  composite: Pick<Dimension, "shape" | "axes">,
  registry: ReadonlyMap<string, Dimension>,
): string | null {
  if (composite.shape !== "composite") {
    return "Composite dimension must have shape='composite'.";
  }
  const axes = composite.axes;
  if (!axes || axes.length < 2) {
    return "Composite dimension needs at least 2 axes.";
  }
  // Duplicate-axis check.
  const seen = new Set<string>();
  for (const a of axes) {
    if (seen.has(a)) {
      return `Composite axis "${a}" appears more than once.`;
    }
    seen.add(a);
  }
  // Registry membership + no-nested-composite check.
  for (const axisSlug of axes) {
    const axisDim = registry.get(axisSlug);
    if (!axisDim) {
      return `Composite axis "${axisSlug}" references a dimension that doesn't exist in this plan.`;
    }
    if (inferDimensionShape(axisDim) === "composite") {
      return `Composite axis "${axisSlug}" itself is composite. Nested composites aren't supported in v1.`;
    }
  }
  return null;
}

/**
 * Pure helper: count the cartesian-product level count of a
 * composite dimension. Used by `<DimensionCompositePicker>` to
 * preview "Building Age (5) × Class (12) = 60 levels" inline.
 *
 * Returns 0 if validation would fail (any axis missing / nested
 * composite / fewer than 2 axes).
 */
export function compositeLevelCount(
  composite: Pick<Dimension, "shape" | "axes">,
  registry: ReadonlyMap<string, Dimension>,
): number {
  if (composite.shape !== "composite") return 0;
  if (!composite.axes || composite.axes.length < 2) return 0;
  let product = 1;
  for (const axisSlug of composite.axes) {
    const axisDim = registry.get(axisSlug);
    if (!axisDim) return 0;
    if (inferDimensionShape(axisDim) === "composite") return 0;
    const n = axisDim.levels?.length ?? 0;
    if (n === 0) return 0;
    product *= n;
  }
  return product;
}
