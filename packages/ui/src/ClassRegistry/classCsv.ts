/**
 * CSV → ClassDraft mapping for the bulk-import overlay (Brief 51).
 *
 * The key design choice (Brief 51 §−1 Q8): KNOWN scalar columns map to
 * the matching ClassDraft field; EVERY OTHER column flows into the
 * `attributes` map. That's what makes a real filing's `class_table`
 * load with its derived rating attributes already populated —
 * `prop_rate_number`, `liab_class_group`, `liab_exposure_base`,
 * `liability_kind`, … become `attributes` keys with zero per-filing
 * configuration, ready for `derive.class_attribute` (ADR-0035).
 *
 * Pure module — reuses the RFC-4180 tokenizer in `parseCsv`. No React.
 */

import { parseCsv } from "../InputsWorkspace/parseCsv";
import type { ClassDraft } from "./types";

// Header aliases per scalar field (compared lowercase + trimmed). The
// FIRST present, non-empty column wins; that column is then "consumed"
// and excluded from `attributes`.
// Server-side schema limits (api-lab `ClassCodeIn`). Mirrored here so a
// malformed row (e.g. a filing's trailing documentation row whose long
// text lands in the class_code column) is SKIPPED + reported client-side
// instead of 422-ing — and sinking — the whole bulk import. Parity with
// the geo ZIP→territory importer, which skips bad rows rather than failing
// the batch.
export const MAX_CLASS_CODE_LEN = 40;
export const MAX_DISPLAY_NAME_LEN = 200;

const CODE_KEYS = ["class_code", "code", "class"];
const NAME_KEYS = ["display_name", "name", "class_name"];
const DESC_KEYS = ["description", "desc"];
const FAMILY_KEYS = ["family", "category"];
const NAICS_KEYS = ["naics_code", "naics"];
const SIC_KEYS = ["sic_code", "sic"];
const ELIGIBLE_KEYS = ["eligible_for", "eligible", "lines", "lobs"];
const SOURCE_KEYS = ["source"];
const NOTE_KEYS = ["note", "notes"];
const CITE_RULE_KEYS = ["citation_rule", "citation"];
const CITE_PAGE_KEYS = ["citation_page", "page"];

export interface ClassCsvRow {
  /** 1-based data-row number (excludes the header). */
  readonly rowIndex: number;
  /** The mapped draft, when the row is valid. */
  readonly draft?: ClassDraft;
  /** Why the row was skipped, when invalid. */
  readonly error?: string;
}

export interface ClassCsvParseResult {
  readonly ok: boolean;
  /** Top-level parse failure message (bad CSV), when `ok` is false. */
  readonly error?: string;
  /** Columns in source order (original case). */
  readonly columns: readonly string[];
  /** One entry per data row, in order. */
  readonly rows: readonly ClassCsvRow[];
  /** How many rows produced a valid draft. */
  readonly validCount: number;
}

/** Parse a pasted/uploaded class table into per-row drafts + errors. */
export function parseClassTableCsv(text: string): ClassCsvParseResult {
  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error.message,
      columns: [],
      rows: [],
      validCount: 0,
    };
  }
  const rows: ClassCsvRow[] = [];
  let validCount = 0;
  parsed.rows.forEach((raw, i) => {
    // Normalize header keys to lowercase for matching.
    const norm: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) norm[k.trim().toLowerCase()] = v;
    const { draft, error } = mapRowToDraft(norm);
    if (draft) validCount += 1;
    rows.push({
      rowIndex: i + 1,
      ...(draft ? { draft } : {}),
      ...(error ? { error } : {}),
    });
  });
  return { ok: true, columns: parsed.columns, rows, validCount };
}

/**
 * Map ONE normalized (lowercase-keyed) CSV row to a ClassDraft, or
 * return an error string when the row can't be a class (no class_code).
 */
export function mapRowToDraft(norm: Record<string, string>): {
  draft?: ClassDraft;
  error?: string;
} {
  const consumed = new Set<string>();
  const take = (keys: readonly string[]): string | undefined => {
    for (const k of keys) {
      const v = norm[k];
      if (v !== undefined && v.trim() !== "") {
        consumed.add(k);
        return v.trim();
      }
    }
    return undefined;
  };

  const class_code = take(CODE_KEYS);
  if (!class_code) return { error: "missing class_code" };
  if (class_code.length > MAX_CLASS_CODE_LEN) {
    return {
      error: `class_code too long (${class_code.length} chars; max ${MAX_CLASS_CODE_LEN})`,
    };
  }

  const name = take(NAME_KEYS);
  let description = take(DESC_KEYS);
  let display_name = name;
  if (!display_name) {
    // class_table convention: the name lives in the `description` column.
    display_name = description ?? `Class ${class_code}`;
    if (display_name === description) description = undefined; // don't duplicate
  }
  if (display_name.length > MAX_DISPLAY_NAME_LEN) {
    return {
      error: `display_name too long (${display_name.length} chars; max ${MAX_DISPLAY_NAME_LEN})`,
    };
  }

  const family = take(FAMILY_KEYS) ?? "";
  const naics_code = take(NAICS_KEYS);
  const sic_code = take(SIC_KEYS);
  const eligibleRaw = take(ELIGIBLE_KEYS);
  const eligible_for = eligibleRaw
    ? eligibleRaw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)
    : [];
  const sourceRaw = take(SOURCE_KEYS);
  const source: "iso" | "custom" = sourceRaw === "iso" ? "iso" : "custom";
  const note = take(NOTE_KEYS);
  const citation_rule = take(CITE_RULE_KEYS);
  const citation_page = take(CITE_PAGE_KEYS);

  // Every remaining non-empty column → a derived attribute.
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(norm)) {
    if (consumed.has(k)) continue;
    const val = (v ?? "").trim();
    if (val !== "") attributes[k] = val;
  }

  const draft: ClassDraft = {
    class_code,
    display_name,
    family,
    eligible_for,
    attributes,
    source,
    ...(description ? { description } : {}),
    ...(naics_code ? { naics_code } : {}),
    ...(sic_code ? { sic_code } : {}),
    ...(note ? { note } : {}),
    ...(citation_rule ? { citation_rule } : {}),
    ...(citation_page ? { citation_page } : {}),
  };
  return { draft };
}
