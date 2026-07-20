/**
 * RequiredInputCategory — the categorical buckets the Inputs rail +
 * ColumnMappingTable render as separate sections (Brief 38 mockup
 * Frame 1).
 *
 * Extracted to a PURE module (no React, no DOM) so the pure projector
 * chain `stagesToRuntimePlan → deriveRequiredInputs → (this)` carries no
 * React-component type dependency. That lets the backend scoring service
 * (services/scoring, ADR-0045) deep-import the projector for server-side
 * `plan_stages` scoring WITHOUT dragging the React `.tsx` graph into its
 * non-DOM typecheck. This is the first, minimal step of ADR-0045's
 * "extract the pure projector into a pure package" follow-up.
 *
 * Canonical definition lives here; ColumnMappingTable.tsx re-exports it
 * for back-compat, so existing `@openrater/ui` consumers are unchanged.
 */
export type RequiredInputCategory =
  | "dimensions"
  | "inputs"
  | "models"
  | "factors";
