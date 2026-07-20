/**
 * ClassRecord — the rich, UI-facing class-library shape.
 *
 * `ClassLibraryEntry` is the runtime-minimal slice used by
 * `input.class_exposure`; `ClassRecord` is the richer aggregate used by
 * the Classification section, ClassPicker, and ClassDetailPane.
 *
 * ## Two-tier design
 *
 *   · `ClassLibraryEntry` (`class-library-types.ts`) — what the
 *     runtime sees. Just `class_code`, `display_name`, `exposure_bases`.
 *     Minimal because the engine is hot-path.
 *
 *   · `ClassRecord` (this file) — what the UI sees. Adds
 *     `family`, `description`, `naics_code`, `eligible_for`,
 *     `note`. The Classification section browser renders this; the
 *     ClassPicker uses the subset that fits the picker option shape.
 *
 *   · An adapter (`classRecordToLibraryEntry`) projects the rich
 *     shape down to the runtime shape, so the API Lab `class_codes`
 *     table feeds both consumers from one source of truth.
 *
 * The backend's `class_codes` table is plan-scoped and filing-defined;
 * `GET /api/v1/class-codes` returns its rows in this shape. Fixture mode
 * uses the same wire contract for deterministic tests.
 *
 * Pure types + a small adapter. No React, no DOM.
 */

import type { ExposureBaseDeclaration } from "./exposure-types";
import type { ClassLibraryEntry } from "./class-library-types";

/**
 * The full per-class record as the UI sees it.
 *
 * One `ClassRecord` corresponds to one row in the future `class_codes`
 * backend table. The class_code is the natural key; everything else
 * is denormalized for fast UI display + filter.
 */
export interface ClassRecord {
  /** The filing-defined class code (e.g., fictional "c101"). */
  readonly class_code: string;

  /** Display name shown in lists and detail views. */
  readonly display_name: string;

  /** Industry family / category (e.g., "Recreation",
   *  "Wholesale Trade", "Manufacturing"). Drives the `family` filter
   *  in ClassBrowser. */
  readonly family: string;

  /** Optional long-form description from the filed manual.
   *  Rendered in ClassDetailPane. */
  readonly description?: string;

  /** 6-digit NAICS mapping (e.g., "713950" for bowling centers).
   *  Helps actuaries cross-reference with external data. */
  readonly naics_code?: string;

  /** Which products/coverages the class is eligible for — OPAQUE
   *  strings (ADR-0033 §0; re-keyed off `LineCode` in gate 5). A BOP
   *  class might be `["bop", "property"]`; a WC-only class is `["wc"]`.
   *  Drives the `eligible_for` filter in ClassBrowser when the plan's
   *  product is set. */
  readonly eligible_for: readonly string[];

  /** Exposure declarations — what the class rates on. May be empty
   *  for legacy classes that haven't been declared yet. Same shape
   *  as `ClassLibraryEntry.exposure_bases`. */
  readonly exposure_bases: readonly ExposureBaseDeclaration[];

  /** 4-digit SIC mapping (e.g., "5812" for restaurants). A crosswalk
   *  target for the class-translator (Brief 21); not used by the engine. */
  readonly sic_code?: string;

  /** Derived rating attributes — OPAQUE string keys (ADR-0033 precedent),
   *  e.g. `{ prop_rate_number: "09", liab_class_group: "cg_40",
   *  liab_exposure_base: "sales" }`. A `derive.class_attribute` node
   *  (ADR-0035) reads one key to produce a derived STRUCTURAL dimension.
   *  Opaque keys keep the substrate LOB-agnostic: a WC class carries
   *  different keys with no schema change. May be empty. */
  readonly attributes?: Readonly<Record<string, string>>;

  /** Whether this row came from a filed library (legacy value "iso") or the
   *  carrier authored it ("custom"). This drives the "Custom" badge.
   *  Treated as "custom" when absent (anything hand- or bulk-entered). */
  readonly source?: "iso" | "custom";

  /** The manual rule and page this class was filed under.
   *  Read-only for filed-library rows; editable for custom classes. */
  readonly citation_rule?: string;
  readonly citation_page?: string;

  /** Optional editorial note for the actuary
   *  (e.g., "Classifies all bowling lanes including pro shops"). */
  readonly note?: string;
}

/**
 * Filter shape for `GET /api/v1/class-codes`.
 *
 * Frontend uses this to scope the browse list. Backend echoes the
 * same shape (slice 3).
 */
export interface ListClassesFilter {
  /** Free-text query — matches class_code + display_name + family. */
  readonly q?: string;
  /** Filter by family (exact match). */
  readonly family?: string;
  /** Filter by product/coverage eligibility (opaque string; ADR-0033
   *  §0). Typically set to the plan's product. */
  readonly eligible_for?: string;
  /** Pagination: max rows. Default 200. */
  readonly limit?: number;
  /** Pagination: skip. Default 0. */
  readonly offset?: number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Project a `ClassRecord` (UI-facing) down to a `ClassLibraryEntry`
 * (runtime-facing).
 *
 * Used when building the runtime `ClassLibrary` from the backend
 * registry: pull `ClassRecord`s from `GET /api/v1/class-codes`,
 * project to entries, hand to `makeClassLibrary()`.
 */
export function classRecordToLibraryEntry(
  record: ClassRecord,
): ClassLibraryEntry {
  return {
    class_code: record.class_code,
    display_name: record.display_name,
    exposure_bases: record.exposure_bases,
  };
}
