/**
 * InputDictionary — view-model + vocabulary for the declared-input
 * editor (Brief 52).
 *
 * `InputDictEntry` is the EDITOR's shape of one declared input. It maps
 * 1:1 to an `input_node` stage: rate-lab translates entry ⇄ stage
 * (config_json + display_name + citation) when it wires the editor to
 * the stage CRUD hooks (PR 52.4). Keeping the view-model here (not the
 * backend `InputNodeConfig` nor the runtime `InputSourceParams`) lets
 * the primitive stay pure + framework-agnostic.
 *
 * `fieldName` is the load-bearing key: it becomes the input_node's
 * `config_json.source_path`, which `deriveRequiredInputs` normalizes to
 * the `externalInputs` key — the same string the CSV column maps TO and
 * the gate rule reads. Declare `total_floor_area_sqft` and it shows up
 * in the Gate field-picker + the CSV column-mapper automatically.
 */

import type { ComputedExpr, PrimitiveType } from "@openrater/contracts";
import { fixAcronymCase } from "../format/acronyms";

/** Source vocabulary (risk-inputs Q2 + Brief 52 D3 `derived`). */
export type InputSourceKindValue =
  | "form"
  | "api"
  | "lookup"
  | "manual"
  | "derived";

export interface InputDictEntry {
  /** Stable id — equals the input_node `stage_id`. */
  readonly id: string;
  /** Runtime `externalInputs` key (the CSV column maps to this; the gate reads it). */
  readonly fieldName: string;
  /** Actuary-facing display name. */
  readonly displayName: string;
  readonly dataType: PrimitiveType;
  readonly source: InputSourceKindValue;
  readonly required: boolean;
  /** Closed value set (enum). Empty/undefined = open. Stored as strings. */
  readonly allowedValues?: readonly string[];
  /** Display/domain hint, e.g. "USD", "sqft", "%". */
  readonly unit?: string;
  /** Grouping label, e.g. "A. Classification" … "J. Derived". */
  readonly category?: string;
  /** Default value, held as the raw input string; coerced to the type on save. */
  readonly defaultValue?: string;
  readonly description?: string;
  /** For source="derived": the upstream input/dim it's computed from. */
  readonly derivedFrom?: string;
  /** For source="derived" (E03 / brief D3): a closed arithmetic expression
   *  over other inputs — `tiv = building_limit + bpp_limit`. When set, the
   *  projector emits a `derive.computed` node; the gate field-picker + the
   *  policy roll-up can read the result. */
  readonly derivedExpr?: ComputedExpr;
  /** Filing citation (e.g. "Sample BOP Rule 22.A"). */
  readonly citation?: string;
}

// ─────────────────────────────────────────────────────────────────
// Vocabulary — grouped type dropdown (risk-inputs Q1) + source list
// ─────────────────────────────────────────────────────────────────

export interface DataTypeOption {
  readonly value: PrimitiveType;
  readonly label: string;
}

export interface DataTypeGroup {
  readonly label: string;
  readonly options: readonly DataTypeOption[];
}

/** The grouped data-type vocabulary the editor offers (actuary language). */
export const DATA_TYPE_GROUPS: readonly DataTypeGroup[] = [
  {
    label: "Numbers",
    options: [
      { value: "money", label: "Money ($)" },
      { value: "int", label: "Whole number" },
      { value: "float", label: "Decimal" },
      { value: "pct", label: "Percentage (%)" },
      { value: "factor", label: "Factor" },
    ],
  },
  {
    label: "Text",
    options: [
      { value: "string", label: "Text" },
      { value: "class_code", label: "Class code" },
    ],
  },
  { label: "Time", options: [{ value: "date", label: "Date" }] },
  { label: "Boolean", options: [{ value: "bool", label: "Yes / No" }] },
];

/** Flat lookup: PrimitiveType → actuary label. */
export const DATA_TYPE_LABEL: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    DATA_TYPE_GROUPS.flatMap((g) => g.options).map((o) => [o.value, o.label]),
  ),
);

export interface SourceOption {
  readonly value: InputSourceKindValue;
  readonly label: string;
}

export const SOURCE_OPTIONS: readonly SourceOption[] = [
  { value: "form", label: "Form (operator-entered)" },
  { value: "api", label: "API (submission payload)" },
  { value: "lookup", label: "Lookup (resolved)" },
  { value: "manual", label: "Manual (typed at quote-time)" },
  { value: "derived", label: "Derived (computed)" },
];

export const SOURCE_LABEL: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.label])),
);

/** Numeric primitive types — drives the type-aware default-value control. */
export function isNumericType(t: PrimitiveType): boolean {
  return (
    t === "money" ||
    t === "int" ||
    t === "float" ||
    t === "pct" ||
    t === "factor"
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Derive a stable `input_node` stage_id from a fieldName. Deterministic
 * (no randomness) so a re-declared field keeps its id — slugs the name
 * and prefixes `input_`.
 */
export function fieldNameToStageId(fieldName: string): string {
  const slug = fieldName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `input_${slug || "field"}`;
}

/**
 * True iff `name` may be DECLARED as an input field. A `:` marks a
 * binding namespace (the filing-transcription grammar's
 * `literal:<number>`, spec §4.6) and can never appear in an input
 * slug (ingest lint R-006) — one-click Declare used to mint a junk
 * `literal:1` input from exactly such a binding. Deliberately narrow:
 * this rejects only names that can NEVER be a runtime field, so
 * existing dictionaries (mixed-case book columns etc.) stay valid.
 */
export function isDeclarableFieldName(name: string): boolean {
  const s = name.trim();
  return s !== "" && !s.includes(":");
}

/** Data-type words that signal a closed value set (enum). */
const ENUM_TYPE_WORDS: ReadonlySet<string> = new Set([
  "enum",
  "select",
  "categorical",
  "category",
]);

/** True iff a filing's data-type word denotes an enum / closed value set. */
export function isEnumTypeWord(raw: string | undefined): boolean {
  return ENUM_TYPE_WORDS.has((raw ?? "").trim().toLowerCase());
}

/**
 * Split an `allowed_values` cell into its option tokens (E01).
 *
 * Enum delimiters are `/ | ;`. Commas are split ONLY when the field is
 * known to be an enum (`allowCommas`), because dictionary prose in a
 * non-enum cell uses commas ("limit combos, see table") — splitting
 * those would manufacture bogus options. So a comma-delimited list like
 * `"t1, t2, t3"` parses iff its `data_type` is enum/select, which is
 * exactly the column the filing marks as constrained.
 */
export function splitAllowedValues(
  raw: string | undefined,
  opts: { readonly allowCommas: boolean },
): readonly string[] {
  const v = (raw ?? "").trim();
  if (v === "") return [];
  const delim = opts.allowCommas ? /[,/|;]/ : /[/|;]/;
  return v
    .split(delim)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Humanize a snake/camel field name into a display label. */
export function humanizeFieldName(fieldName: string): string {
  const spaced = fieldName
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (spaced === "") return fieldName;
  //  — the title-caser honors the acronym allowlist
  // ("bpp_limit" → "BPP limit", never "Bpp limit").
  return fixAcronymCase(spaced.charAt(0).toUpperCase() + spaced.slice(1));
}

// ─────────────────────────────────────────────────────────────────
// Validation (authoring-time, P-N6) — pure
// ─────────────────────────────────────────────────────────────────

export interface DictIssue {
  /** The entry id the issue attaches to ("" for collection-level). */
  readonly id: string;
  readonly field: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}

/**
 * Validate the whole dictionary: blank/duplicate fieldNames, a default
 * outside the allowed set, and derived inputs missing their source.
 * Returns one issue per problem; empty when clean.
 */
export function validateDictionary(
  entries: readonly InputDictEntry[],
): readonly DictIssue[] {
  const issues: DictIssue[] = [];
  const byField = new Map<string, number>();

  for (const e of entries) {
    const fn = e.fieldName.trim();
    if (fn === "") {
      issues.push({
        id: e.id,
        field: "fieldName",
        severity: "error",
        message: "Field name is required",
      });
    } else if (!isDeclarableFieldName(fn)) {
      issues.push({
        id: e.id,
        field: "fieldName",
        severity: "error",
        message: `"${fn}" isn't a field name — ':' marks a binding namespace (like literal:1), not an input`,
      });
    } else {
      byField.set(fn, (byField.get(fn) ?? 0) + 1);
    }

    if (
      e.allowedValues &&
      e.allowedValues.length > 0 &&
      e.defaultValue !== undefined &&
      e.defaultValue !== "" &&
      !e.allowedValues.some((v) => String(v) === String(e.defaultValue))
    ) {
      issues.push({
        id: e.id,
        field: "defaultValue",
        severity: "error",
        message: `Default "${e.defaultValue}" is not one of the allowed values`,
      });
    }

    if (e.source === "derived" && (!e.derivedFrom || e.derivedFrom.trim() === "")) {
      issues.push({
        id: e.id,
        field: "derivedFrom",
        severity: "warning",
        message: "Derived input has no source field — set what it's computed from",
      });
    }
  }

  for (const [fn, count] of byField) {
    if (count > 1) {
      // Attach the duplicate error to every entry that shares the name.
      for (const e of entries) {
        if (e.fieldName.trim() === fn) {
          issues.push({
            id: e.id,
            field: "fieldName",
            severity: "error",
            message: `Field name "${fn}" is declared ${count} times — names must be unique`,
          });
        }
      }
    }
  }

  return issues;
}
