/**
 * Coverage vocabulary — the typed COVERAGE axis (ADR-0033 §2).
 *
 * A `Coverage` is a grant WITHIN a product (Side A within D&O; property
 * + premises_liability within BOP; BI/PD/UM within Auto). It promotes
 * the half-built coverage machinery — the chain's free-text
 * `coverage_value` + `rating_dimension` (`chain-configs.ts`) and the
 * `ExposureBaseDeclaration.coverage_tags` (`exposure-types.ts`) — to a
 * typed entity, and replaces both the backend's free-text `coverages`
 * tuple and the `liability`/`property` *coverages* that were stranded in
 * `LineCode`.
 *
 * ── GENERICITY INVARIANT (ADR-0033 §0) ──
 *
 * `coverage_id` is an OPAQUE TAG, like `ProductCode`. One generic shape
 * serves every product's coverages identically — BOP (property /
 * liability / BI), D&O (Side A / B / C), Auto (BI / PD / UM), Cyber
 * (1st-party / 3rd-party). No machinery branches on a specific
 * `coverage_id`; coverages aggregate via the existing `chain.dim_sum`
 * by explicit id, never by name-heuristic.
 *
 * `coverage_id` is a free slug for v1 (owner decision O-4, 2026-05-29);
 * a controlled vocab tied to the Class Translator is a later refinement
 * that does not change this shape.
 *
 * Pure types. No React, no DOM. See
 * `docs/adr/0033-line-coverage-product-axis-cleanup.md`.
 */

import type { ProductCode } from "./product-types";
import { isProductCode } from "./product-types";

/**
 * A typed coverage grant within a product.
 *
 * A `Plan` carries `coverages: readonly Coverage[]`. The chain's
 * existing `coverage_value` becomes a foreign key into `coverage_id`;
 * `rating_dimension` is unchanged (it already names the splitting dim).
 *
 * `limit` / `retention` / `exposure_ref` are optional in v1 — the entity
 * exists now (this ADR) so the axes are clean; their RUNTIME semantics
 * (how they affect scoring) are a sibling ADR, deliberately not decided
 * here.
 */
export interface Coverage {
  /** Free slug, unique within a plan (O-4). e.g. "property",
   *  "premises_liability", "side_a", "fire". */
  readonly coverage_id: string;
  /** Human-readable name for chips / pickers. */
  readonly display_name: string;
  /** The product this coverage belongs to (opaque tag — never branched). */
  readonly product: ProductCode;
  /** The chain-tip output field this coverage writes (the per-coverage
   *  premium). Summed by `chain.dim_sum` for a bundle, or referenced by
   *  a Policy line's `premium_output`. */
  readonly output_field: string;
  /** Per-occurrence / aggregate limit. Runtime semantics = sibling ADR. */
  readonly limit?: number;
  /** Retention / deductible. Runtime semantics = sibling ADR. */
  readonly retention?: number;
  /** FK to an ExposureBaseDeclaration (the exposure base this coverage
   *  rates on). Re-keyed off Coverage, not LineCode (ADR-0032 §5.3). */
  readonly exposure_ref?: string;
}

/**
 * Type guard: is this value a structurally valid Coverage?
 *
 * Use at the schema-validation boundary (external JSON, persisted plan
 * load). Checks the required fields + that `product` is a real
 * ProductCode (membership, via isProductCode — not a product branch).
 */
export function isCoverage(value: unknown): value is Coverage {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.coverage_id === "string" &&
    c.coverage_id.length > 0 &&
    typeof c.display_name === "string" &&
    isProductCode(c.product) &&
    typeof c.output_field === "string" &&
    c.output_field.length > 0 &&
    (c.limit === undefined || typeof c.limit === "number") &&
    (c.retention === undefined || typeof c.retention === "number") &&
    (c.exposure_ref === undefined || typeof c.exposure_ref === "string")
  );
}

/**
 * Validate a plan's coverage list: `coverage_id` uniqueness + non-empty
 * required fields.
 *
 * Returns null if valid; otherwise a string explaining the first
 * violation (matches `validateExposureDeclarations`). Used by plan
 * authoring + the conformance fixtures.
 */
export function validateCoverages(
  coverages: readonly Coverage[],
): string | null {
  const seen = new Set<string>();
  for (const c of coverages) {
    if (!c.coverage_id) {
      return "Every coverage must have a non-empty coverage_id.";
    }
    if (!c.output_field) {
      return `Coverage "${c.coverage_id}" must declare an output_field.`;
    }
    if (seen.has(c.coverage_id)) {
      return `Duplicate coverage_id "${c.coverage_id}" — ids must be unique within a plan.`;
    }
    seen.add(c.coverage_id);
  }
  return null;
}

/**
 * Filter a coverage list to one product. Generic slice-by-opaque-tag —
 * used by the Policy layer + UI to bind a plan's coverages. Pure.
 *
 * (Demonstrates the invariant: this filters by an opaque tag handed in
 * by the caller; it contains no product literal.)
 */
export function coveragesForProduct(
  coverages: readonly Coverage[],
  product: ProductCode,
): readonly Coverage[] {
  return coverages.filter((c) => c.product === product);
}
