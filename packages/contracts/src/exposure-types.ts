/**
 * Exposure base vocabulary — closed enum + per-class declaration shape.
 *
 * Per Brief 16 (class-conditional exposure base, P-CE2). Insurance
 * classes rate on different exposure bases: restaurants on sales,
 * contractors on payroll, apartment buildings on area or unit count.
 * Today's substrate hardcodes one exposure per chain; this brief makes
 * exposure DECLARATIVE on the class and AUTO-RESOLVED at chain
 * execution.
 *
 * The 6 codes cover the standard P&C exposure vocabulary; `"other"`
 * carves out manuscript exposures with a free-text `custom_label`.
 *
 * Pure types. No React, no DOM. Consumed by:
 *   - The new kind `input.class_exposure` (Brief 16, lands in M1.2)
 *   - Class library declarations (the ClassRecord aggregate; lives
 *     in api-lab today, will expose `exposure_bases` field)
 *   - UI primitives (<ExposureBaseRow>, <ExposureBaseInput>,
 *     <ExposureBadge>; land alongside the Classification section in M4)
 */

/**
 * Closed exposure-base vocabulary.
 *
 *  - sales:     annual receipts in currency (typical for retail,
 *               restaurants, wholesalers, hospitality)
 *  - payroll:   annual payroll in currency (typical for contractors,
 *               services, WC)
 *  - area:      square footage (typical for property managers,
 *               warehouses, apartment buildings)
 *  - receipts:  specialized $ receipts subset (alcohol, admissions,
 *               food vs liquor split)
 *  - units:     integer count (apartments, vehicles, students,
 *               members, boilers)
 *  - other:     free-form (manuscript or niche exposure). Requires a
 *               `custom_label` ("miles driven", "barrels stored",
 *               etc.).
 */
export type ExposureBaseCode =
  | "sales"
  | "payroll"
  | "area"
  | "receipts"
  | "units"
  | "other";

/**
 * Iterable list of every ExposureBaseCode. Sorted for stable UI.
 *
 * Frozen at module load so downstream code can't accidentally mutate
 * the canonical vocabulary (the regulator-facing audit log depends on
 * these codes being immutable for the lifetime of the process).
 */
export const EXPOSURE_BASE_CODES: readonly ExposureBaseCode[] = Object.freeze([
  "sales",
  "payroll",
  "area",
  "receipts",
  "units",
  "other",
] as const);

/**
 * Display label per ExposureBaseCode. UI uses these on
 * <ExposureBaseRow>. Frozen at module load.
 */
export const EXPOSURE_BASE_LABELS: Readonly<Record<ExposureBaseCode, string>> =
  Object.freeze({
    sales: "Sales",
    payroll: "Payroll",
    area: "Area",
    receipts: "Receipts",
    units: "Units",
    other: "Other",
  } as const);

/**
 * Default unit for each ExposureBaseCode (overrideable per declaration).
 * Frozen at module load.
 */
export const EXPOSURE_BASE_DEFAULT_UNIT: Readonly<
  Record<ExposureBaseCode, string>
> = Object.freeze({
  sales: "USD",
  payroll: "USD",
  area: "sq ft",
  receipts: "USD",
  units: "units",
  other: "",
} as const);

/**
 * Long-form description per code. Used in tooltips. Each description
 * is one sentence ending in a period. Frozen at module load.
 */
export const EXPOSURE_BASE_DESCRIPTIONS: Readonly<
  Record<ExposureBaseCode, string>
> = Object.freeze({
  sales:
    "Annual receipts in currency. Typical for retail, restaurants, wholesalers, hospitality.",
  payroll:
    "Annual payroll in currency. Typical for contractors, service businesses, workers comp.",
  area: "Square footage. Typical for property managers, warehouses, apartment buildings.",
  receipts:
    "Specialized $ receipts subset (alcohol, admissions, food/liquor split).",
  units:
    "Integer count of insured items (apartments, vehicles, students, members, boilers).",
  other:
    "Free-form exposure with a custom unit and label (e.g., 'miles driven', 'barrels stored').",
} as const);

/**
 * Standard mapping from ExposureBaseCode to the runtime input key.
 * Frozen at module load.
 */
export const EXPOSURE_INPUT_KEYS: Readonly<Record<ExposureBaseCode, string>> =
  Object.freeze({
    sales: "annual_sales",
    payroll: "annual_payroll",
    area: "area_sqft",
    receipts: "annual_receipts",
    units: "unit_count",
    other: "custom_exposure", // suffixed with slug in resolve helper
  } as const);

/**
 * Per-class declaration of one exposure base.
 *
 * A ClassRecord can declare multiple ExposureBaseDeclarations:
 *   - Exactly ONE has `is_primary = true` (default exposure for the
 *     class)
 *   - Zero-or-more alternates, optionally tagged with `coverage_tags`
 *     to scope to specific LOBs (e.g., payroll for WC + CGL; sales for
 *     BOP property)
 *
 * Pure types. No React, no DOM.
 */
export interface ExposureBaseDeclaration {
  /** Closed-vocabulary code. */
  readonly code: ExposureBaseCode;
  /** Exactly one declaration per class has is_primary = true. */
  readonly is_primary: boolean;
  /** Display unit (e.g., "USD", "sq ft", "units"). Defaults to
   *  EXPOSURE_BASE_DEFAULT_UNIT[code]. */
  readonly unit: string;
  /** Coverage tags this declaration applies to — OPAQUE `coverage_id`
   *  strings (ADR-0033 §0; re-keyed off `LineCode` in gate 5), matched
   *  against `input.class_exposure`'s `coverage_scope`. Empty array =
   *  applies to all coverages. */
  readonly coverage_tags?: readonly string[];
  /** When code = "other", human-readable name of the exposure
   *  (e.g., "miles driven", "boilers"). Required for code="other". */
  readonly custom_label?: string;
  /** Citation to a manual or source (e.g., "Meridian Rule MS-R3.4"). */
  readonly citation?: string;
}

/**
 * Slugify a custom label for use as part of an input key.
 *
 * "Miles driven" → "miles_driven"
 * "Cubic Yards (CY)" → "cubic_yards_cy"
 *
 * Pure + deterministic. Used by exposureInputKey() to build keys for
 * code="other" declarations.
 */
export function slugifyCustomLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Resolve an ExposureBaseDeclaration to its runtime input key.
 *
 *   { code: "payroll", … } → "annual_payroll"
 *   { code: "sales", … }   → "annual_sales"
 *   { code: "other", custom_label: "Miles driven", … } → "custom_exposure_miles_driven"
 *
 * Pure. Used by the `input.class_exposure` kind at execute time.
 */
export function exposureInputKey(decl: ExposureBaseDeclaration): string {
  if (decl.code === "other") {
    const slug = slugifyCustomLabel(decl.custom_label ?? "");
    return slug ? `custom_exposure_${slug}` : "custom_exposure";
  }
  return EXPOSURE_INPUT_KEYS[decl.code];
}

/**
 * Type guard: is this string a valid ExposureBaseCode?
 *
 * Use at the schema-validation boundary.
 */
export function isExposureBaseCode(value: unknown): value is ExposureBaseCode {
  return (
    typeof value === "string" &&
    (EXPOSURE_BASE_CODES as readonly string[]).includes(value)
  );
}

/**
 * Pick the exposure declaration to use for a given coverage scope.
 *
 * Resolution rules (per Brief 16 §6):
 *   1. If `coverage_scope` is null/undefined → return the primary
 *      declaration (the one with is_primary = true).
 *   2. If `coverage_scope` is set (an opaque coverage_id) → find a
 *      declaration whose coverage_tags includes that scope. If multiple
 *      match, prefer the primary. If none match, fall back to the primary.
 *
 * Returns undefined when the class has no declarations at all.
 */
export function pickExposureDeclaration(
  declarations: readonly ExposureBaseDeclaration[],
  coverage_scope?: string | null,
): ExposureBaseDeclaration | undefined {
  if (declarations.length === 0) return undefined;

  if (coverage_scope == null) {
    return declarations.find((d) => d.is_primary) ?? declarations[0];
  }

  const scoped = declarations.filter((d) =>
    (d.coverage_tags ?? []).includes(coverage_scope),
  );
  if (scoped.length > 0) {
    return scoped.find((d) => d.is_primary) ?? scoped[0];
  }
  // Fall back to primary
  return declarations.find((d) => d.is_primary) ?? declarations[0];
}

/**
 * Validate a class's declaration list: exactly-one-primary invariant.
 *
 * Returns null if valid; otherwise a string explaining the violation.
 * Used by class library authoring + the conformance vectors.
 */
export function validateExposureDeclarations(
  declarations: readonly ExposureBaseDeclaration[],
): string | null {
  if (declarations.length === 0) return null; // empty is allowed (legacy classes)

  const primaries = declarations.filter((d) => d.is_primary);
  if (primaries.length === 0) {
    return "A class with declared exposure_bases must have exactly one primary declaration.";
  }
  if (primaries.length > 1) {
    return `A class can have only one primary exposure declaration; found ${primaries.length}.`;
  }

  for (const d of declarations) {
    if (d.code === "other" && !d.custom_label) {
      return 'Declarations with code = "other" must include a custom_label.';
    }
  }

  return null;
}
