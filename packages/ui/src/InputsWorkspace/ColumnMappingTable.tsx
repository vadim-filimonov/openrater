/**
 * <ColumnMappingTable> — Brief 38 PR 38.3 core mapping UX.
 *
 * The center column of the Inputs workspace. Renders a sectioned
 * table of required-input rows × source-column dropdowns, with
 * confidence chips + status badges + sample values. The visual
 * language matches Frames 2-4 of the Brief 38 mockup (see
 * `rate-lab/frontend/public/mockup/38-inputs-workspace.html`).
 *
 * Controlled. The parent owns the mapping (`value`) and handles
 * mutations (`onChange`). The auto-match candidates (from
 * `autoMatchColumns` in PR 38.2) flow in as `candidates` — the
 * table renders them as suggestions and never auto-applies them.
 * The orchestrator (PR 38.8) decides when to call
 * `applyAutoMatchToMapping` and update `value`.
 *
 * Sections (Dimensions / Inputs / Factors / Models) come from the
 * `category` on each required input. The filter bar above scopes
 * which rows are visible (All / Unmapped / Mismatches).
 *
 * Pure presentation. No HTTP, no app state, no routing. Composes
 * <Combobox> from @openrater/design-system for the source-column
 * picker (full typeahead + keyboard nav for free).
 */

// The v1 <ColumnMappingTable> primitive was deleted in the v2 cutover
// (2026-06-09); this module now exports only the reused types.
import type { RequiredInput } from "./autoMatch";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/**
 * The categorical buckets the table renders as separate sections.
 * Matches the rail categories from Brief 38 mockup Frame 1.
 *
 * Canonical definition moved to the pure `./requiredInputCategory`
 * module (so the pure projector chain carries no React type dep — see
 * ADR-0045); imported for local use + re-exported here for back-compat.
 */
import type { RequiredInputCategory } from "./requiredInputCategory";
export type { RequiredInputCategory };

/** Required input extended with category + optional secondary label. */
export interface RequiredInputEntry extends RequiredInput {
  /** Which section of the table this input belongs to. */
  readonly category: RequiredInputCategory;
  /**
   * Optional secondary line shown under the name. Common content:
   * dim shape + level count ("categorical · 3 lvls"), input dtype
   * ("number · USD"), model version ("v0.4.1 · 3 inputs").
   */
  readonly subLabel?: string;
  /**
   * Optional friendly section sub-key. When multiple inputs in the
   * same category share a parent (e.g., a model's params), this
   * groups them together within their section header.
   */
  readonly groupLabel?: string;
  /**
   * Brief 44 PR 44.11.c — Geographic metadata for inputs whose
   * dim is `dimension_type === "geographic"`. When set + a column
   * is mapped, the row renders an inline <GeoTransformerPicker>
   * underneath so the user can pick a transformer (zip5_to_state
   * etc.) when the CSV column doesn't natively match the dim's
   * granularity. Optional — non-geographic inputs leave it
   * undefined.
   */
  readonly geo?: {
    readonly granularity: "state" | "county" | "zip";
    readonly displayName: string;
  };
  /**
   * Brief 89 R8 — an unset chain constant (column-shaped LCM): the
   * dictionary/Match lanes exclude it while undeclared (repair lives
   * in Rating); a deliberately declared input with this id is legit.
   */
  readonly constantSlot?: true;
}

/** Filter tab values. */
export type MappingFilter = "all" | "unmapped" | "mismatches";

