/**
 * Shared types for the writable class registry primitives (Brief 51).
 *
 * Re-declared here (not imported from @openrater/contracts) so @openrater/ui stays
 * dependency-light — the same convention `<ClassBrowser>` follows. The
 * shapes mirror `ClassRecord` / `PlanClassCode` 1:1.
 */

/** A class as the registry READS it (≈ PlanClassCode wire shape).
 *  Nullable fields carry `| undefined` so the wire shape (optional +
 *  nullable) round-trips under `exactOptionalPropertyTypes`. */
export interface ClassRegistryRecord {
  readonly class_code: string;
  readonly display_name: string;
  readonly family?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly naics_code?: string | null | undefined;
  readonly sic_code?: string | null | undefined;
  readonly eligible_for: readonly string[];
  readonly exposure_bases?: readonly {
    readonly code: string;
    readonly custom_label?: string | undefined;
    readonly coverage_tags?: readonly string[] | undefined;
  }[];
  /** Derived rating attributes — opaque keys (ADR-0035). */
  readonly attributes?: Readonly<Record<string, string>> | undefined;
  readonly source?: "iso" | "custom" | undefined;
  readonly note?: string | null | undefined;
  readonly citation_rule?: string | null | undefined;
  readonly citation_page?: string | null | undefined;
}

/**
 * A class as the registry EDITS / WRITES it (≈ UpsertClassCodeRequest).
 * `family` is "" rather than null so the form inputs stay controlled.
 */
export interface ClassDraft {
  class_code: string;
  display_name: string;
  family: string;
  description?: string;
  naics_code?: string;
  sic_code?: string;
  eligible_for: string[];
  attributes: Record<string, string>;
  source: "iso" | "custom";
  note?: string;
  citation_rule?: string;
  citation_page?: string;
}

/** Project a read-record into an editable draft (for the edit drawer). */
export function recordToDraft(rec: ClassRegistryRecord): ClassDraft {
  return {
    class_code: rec.class_code,
    display_name: rec.display_name,
    family: rec.family ?? "",
    eligible_for: [...rec.eligible_for],
    attributes: { ...(rec.attributes ?? {}) },
    source: rec.source ?? "custom",
    ...(rec.description ? { description: rec.description } : {}),
    ...(rec.naics_code ? { naics_code: rec.naics_code } : {}),
    ...(rec.sic_code ? { sic_code: rec.sic_code } : {}),
    ...(rec.note ? { note: rec.note } : {}),
    ...(rec.citation_rule ? { citation_rule: rec.citation_rule } : {}),
    ...(rec.citation_page ? { citation_page: rec.citation_page } : {}),
  };
}

/** A fresh, empty draft for the "+ New class" flow. */
export function emptyDraft(): ClassDraft {
  return {
    class_code: "",
    display_name: "",
    family: "",
    eligible_for: [],
    attributes: {},
    source: "custom",
  };
}
