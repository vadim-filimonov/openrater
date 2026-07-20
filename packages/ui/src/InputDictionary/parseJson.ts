/**
 * parseInputDictJson — Brief 52 paste-JSON bulk import (risk-inputs Q5).
 *
 * Accepts either `{ "inputs": [ … ] }` or a bare array. Each item is
 * tolerant of snake/camel key variants (fieldName | field_name | name;
 * dataType | data_type | type; allowedValues | allowed_values;
 * derivedFrom | derived_from). Round-trippable with the dictionary's
 * own JSON export. Returns parsed entries + per-item errors (it never
 * throws on bad input — the editor surfaces the errors inline).
 */

import type { PrimitiveType } from "@openrater/contracts";
import {
  DATA_TYPE_LABEL,
  SOURCE_LABEL,
  fieldNameToStageId,
  humanizeFieldName,
  isEnumTypeWord,
  splitAllowedValues,
  type InputDictEntry,
  type InputSourceKindValue,
} from "./types";

export interface ParseResult {
  readonly entries: readonly InputDictEntry[];
  readonly errors: readonly string[];
}

function pick(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function asStringArray(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.map((x) => asString(x)).filter((x): x is string => x !== undefined);
  return arr.length > 0 ? arr : undefined;
}

/**
 * The allowed-value set (E01). Accepts a JSON array (the canonical form)
 * OR a delimited string — so a dictionary exported with
 * `"allowed_values": "t1, t2, t3"` round-trips instead of silently
 * dropping the enum. A string is comma-split only when the field's
 * `data_type` is an enum (same prose guard as the CSV path).
 */
function asAllowedValues(
  v: unknown,
  isEnumType: boolean,
): readonly string[] | undefined {
  const arr = asStringArray(v);
  if (arr) return arr;
  const s = asString(v);
  if (s === undefined) return undefined;
  const parts = splitAllowedValues(s, { allowCommas: isEnumType });
  const keep = isEnumType ? parts.length >= 1 : parts.length > 1;
  return keep ? parts : undefined;
}

const VALID_SOURCES: ReadonlySet<string> = new Set(Object.keys(SOURCE_LABEL));

/**
 * Map a filing's data-type word to a PrimitiveType (defaults to string).
 * Shared by BOTH the JSON and CSV paste paths so common aliases (number→int,
 * boolean→bool, currency→money, …) normalize identically. F19 — the JSON path
 * previously checked only the canonical labels and silently coerced
 * `number`/`boolean`→`string`, diverging from the CSV path's aliasing.
 */
export function normalizeType(raw: string | undefined): PrimitiveType {
  const t = (raw ?? "").trim().toLowerCase();
  if (DATA_TYPE_LABEL[t]) return t as PrimitiveType;
  const alias: Record<string, PrimitiveType> = {
    currency: "money",
    money: "money",
    number: "int",
    integer: "int",
    int: "int",
    decimal: "float",
    float: "float",
    percent: "pct",
    percentage: "pct",
    pct: "pct",
    factor: "factor",
    boolean: "bool",
    bool: "bool",
    enum: "string",
    text: "string",
    string: "string",
    date: "date",
    class_code: "class_code",
    classcode: "class_code",
  };
  return alias[t] ?? "string";
}

export function parseInputDictJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { entries: [], errors: ["Not valid JSON."] };
  }

  const list: unknown = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).inputs
      : undefined;

  if (!Array.isArray(list)) {
    return {
      entries: [],
      errors: ['Expected an array or { "inputs": [ … ] }.'],
    };
  }

  const entries: InputDictEntry[] = [];
  const errors: string[] = [];

  list.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      errors.push(`Item ${i + 1}: not an object.`);
      return;
    }
    const o = item as Record<string, unknown>;
    const fieldName = asString(pick(o, ["fieldName", "field_name", "name", "key"]));
    if (!fieldName || fieldName.trim() === "") {
      errors.push(`Item ${i + 1}: missing "fieldName".`);
      return;
    }

    const typeRaw = asString(pick(o, ["dataType", "data_type", "type"])) ?? "string";
    const dataType: PrimitiveType = normalizeType(typeRaw);

    const sourceRaw = asString(pick(o, ["source", "sourceType", "source_type"])) ?? "form";
    const source: InputSourceKindValue = (
      VALID_SOURCES.has(sourceRaw) ? sourceRaw : "form"
    ) as InputSourceKindValue;

    const requiredRaw = pick(o, ["required"]);
    const required =
      typeof requiredRaw === "boolean"
        ? requiredRaw
        : asString(requiredRaw)?.toLowerCase() === "true";

    const entry: InputDictEntry = {
      id: fieldNameToStageId(fieldName),
      fieldName: fieldName.trim(),
      displayName:
        asString(pick(o, ["displayName", "display_name", "label"])) ??
        humanizeFieldName(fieldName),
      dataType,
      source,
      required,
    };
    const allowedValues = asAllowedValues(
      pick(o, ["allowedValues", "allowed_values", "enum"]),
      isEnumTypeWord(typeRaw),
    );
    const unit = asString(pick(o, ["unit"]));
    const category = asString(pick(o, ["category"]));
    const defaultValue = asString(pick(o, ["defaultValue", "default_value", "default"]));
    const description = asString(pick(o, ["description"]));
    const derivedFrom = asString(pick(o, ["derivedFrom", "derived_from"]));
    const citation = asString(pick(o, ["citation"]));

    entries.push({
      ...entry,
      ...(allowedValues ? { allowedValues } : {}),
      ...(unit ? { unit } : {}),
      ...(category ? { category } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(description ? { description } : {}),
      ...(derivedFrom ? { derivedFrom } : {}),
      ...(citation ? { citation } : {}),
    });
  });

  return { entries, errors };
}
