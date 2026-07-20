/**
 * parseInputDictCsv — I3: import a typed input dictionary from a CSV.
 *
 * A filing ships its data dictionary as a CSV (e.g. the Sample BOP
 * `*_input_variables.csv`: category, input_key, display_name, data_type,
 * required, source, allowed_values, description) — NOT as JSON. Previously
 * the only typed-import path was Paste-JSON, so the actuary had to hand-
 * convert. This parses the dictionary CSV directly into `InputDictEntry`s,
 * mirroring `parseInputDictJson`'s tolerant, never-throw contract.
 *
 * Reuses the RFC-4180 tokenizer (`parseCsv`) and the same data-type / source
 * normalization as the JSON path. Returns the SAME `ParseResult` shape so the
 * overlay can use either format interchangeably.
 */

import { parseCsv } from "../InputsWorkspace/parseCsv";
import {
  SOURCE_LABEL,
  fieldNameToStageId,
  humanizeFieldName,
  isEnumTypeWord,
  splitAllowedValues,
  type InputDictEntry,
  type InputSourceKindValue,
} from "./types";
import { normalizeType, parseInputDictJson, type ParseResult } from "./parseJson";

const FIELD_KEYS = ["fieldname", "field_name", "input_key", "name", "key"];
const NAME_KEYS = ["display_name", "displayname", "label"];
const TYPE_KEYS = ["data_type", "datatype", "type"];
const SOURCE_KEYS = ["source", "source_type", "sourcetype"];
const REQUIRED_KEYS = ["required", "is_required"];
const ALLOWED_KEYS = ["allowed_values", "allowedvalues", "enum"];
const UNIT_KEYS = ["unit"];
const DEFAULT_KEYS = ["default", "default_value", "defaultvalue"];
const CATEGORY_KEYS = ["category"];
const DESC_KEYS = ["description", "desc"];
const CITE_KEYS = ["citation", "citation_rule"];

const VALID_SOURCES: ReadonlySet<string> = new Set(Object.keys(SOURCE_LABEL));

/** Map a filing's source word to an InputSourceKindValue (defaults to form). */
function normalizeSource(raw: string | undefined): InputSourceKindValue {
  const s = (raw ?? "").trim().toLowerCase();
  if (VALID_SOURCES.has(s)) return s as InputSourceKindValue;
  if (s.startsWith("derived")) return "derived";
  if (s.startsWith("form")) return "form";
  if (s === "lookup" || s === "resolved" || s.includes("zip")) return "lookup";
  if (s === "api" || s.includes("payload")) return "api";
  if (s === "manual") return "manual";
  return "form";
}

/**
 * Allowed values (E01). The split delimiters + the keep threshold both
 * depend on whether the row's `data_type` marks the field as an enum:
 *
 * - enum/select: commas count as delimiters (the filing's natural list
 *   format, e.g. `"t1, t2, t3"`), and even a single token is a valid
 *   one-option enum. Previously a comma-delimited enum was silently
 *   dropped — the bug E01 reports.
 * - non-enum: only `/ | ;` split, and a lone token is treated as prose
 *   (">= 0", "see rate table") → no enum, preserving the original guard.
 */
function parseAllowed(
  raw: string | undefined,
  isEnumType: boolean,
): readonly string[] | undefined {
  const parts = splitAllowedValues(raw, { allowCommas: isEnumType });
  const keep = isEnumType ? parts.length >= 1 : parts.length > 1;
  return keep ? parts : undefined;
}

export function parseInputDictCsv(text: string): ParseResult {
  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return { entries: [], errors: [parsed.error.message] };
  }
  // Map header → normalized key once.
  const lower: Record<string, string> = {};
  for (const col of parsed.columns) lower[col.trim().toLowerCase()] = col;
  const col = (keys: readonly string[]): string | undefined => {
    for (const k of keys) if (lower[k] !== undefined) return lower[k];
    return undefined;
  };
  const fField = col(FIELD_KEYS);
  if (!fField) {
    return {
      entries: [],
      errors: ['No field-name column (expected one of: fieldName, input_key, name).'],
    };
  }
  const fName = col(NAME_KEYS);
  const fType = col(TYPE_KEYS);
  const fSource = col(SOURCE_KEYS);
  const fRequired = col(REQUIRED_KEYS);
  const fAllowed = col(ALLOWED_KEYS);
  const fUnit = col(UNIT_KEYS);
  const fDefault = col(DEFAULT_KEYS);
  const fCategory = col(CATEGORY_KEYS);
  const fDesc = col(DESC_KEYS);
  const fCite = col(CITE_KEYS);

  const entries: InputDictEntry[] = [];
  const errors: string[] = [];

  parsed.rows.forEach((row, i) => {
    const fieldName = (row[fField] ?? "").trim();
    if (fieldName === "") {
      errors.push(`Row ${i + 1}: missing field name.`);
      return;
    }
    const required =
      fRequired !== undefined &&
      ["true", "1", "yes", "y"].includes((row[fRequired] ?? "").trim().toLowerCase());
    const allowedValues = fAllowed
      ? parseAllowed(row[fAllowed], isEnumTypeWord(fType ? row[fType] : undefined))
      : undefined;
    const unit = fUnit ? (row[fUnit] ?? "").trim() || undefined : undefined;
    const category = fCategory ? (row[fCategory] ?? "").trim() || undefined : undefined;
    const defaultValue = fDefault ? (row[fDefault] ?? "").trim() || undefined : undefined;
    const description = fDesc ? (row[fDesc] ?? "").trim() || undefined : undefined;
    const citation = fCite ? (row[fCite] ?? "").trim() || undefined : undefined;
    const displayName =
      (fName ? (row[fName] ?? "").trim() : "") || humanizeFieldName(fieldName);

    entries.push({
      id: fieldNameToStageId(fieldName),
      fieldName,
      displayName,
      dataType: normalizeType(fType ? row[fType] : undefined),
      source: normalizeSource(fSource ? row[fSource] : undefined),
      required,
      ...(allowedValues ? { allowedValues } : {}),
      ...(unit ? { unit } : {}),
      ...(category ? { category } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(description ? { description } : {}),
      ...(citation ? { citation } : {}),
    });
  });

  return { entries, errors };
}

/**
 * Format-detecting entry point used by the paste overlay: JSON when the text
 * looks like JSON (`{`/`[`), otherwise the dictionary-CSV path.
 */
export function parseInputDictText(text: string): ParseResult {
  const t = text.trim();
  if (t === "") return { entries: [], errors: [] };
  // JSON when it looks like JSON; otherwise the dictionary-CSV path.
  return t.startsWith("{") || t.startsWith("[")
    ? parseInputDictJson(t)
    : parseInputDictCsv(text);
}
