/**
 * seedInputsFromCsv — Brief 52 "Seed from CSV headers".
 *
 * Turns a dropped risk CSV's column headers (+ optional sample rows)
 * into proposed `InputDictEntry` declarations. The author reviews +
 * edits before committing — this proposes, it does not auto-create.
 *
 * Type inference is DETERMINISTIC and explainable (Brief 52 §6 — the
 * no-gimmick line: no LLM, no model). Rules, in order:
 *   · all sampled values parse as integers          → int
 *   · all sampled values parse as finite numbers     → money if the
 *     column name reads monetary ($ / limit / sales / payroll /
 *     premium / value), else float
 *   · all sampled values are true/false              → bool
 *   · otherwise                                       → string
 * With no sample rows, inference falls back to the column NAME alone.
 *
 * Convention skip: columns matching /^expected_/ and a bare `case_id`
 * are outputs/identifiers, not inputs — they're dropped (the worked
 * ISO sample CSV carries `expected_*` premium columns). Everything
 * else is proposed; the author removes what doesn't belong.
 */

import type { PrimitiveType } from "@openrater/contracts";
import {
  fieldNameToStageId,
  humanizeFieldName,
  type InputDictEntry,
} from "./types";

const MONEY_NAME = /(_|^)(limit|sales|payroll|premium|value|amount|cost|price|tiv|revenue)(_|$)|\$/i;
const SKIP_EXACT = new Set(["case_id", "name", "id"]);

function isSkippedColumn(col: string): boolean {
  const c = col.trim().toLowerCase();
  return SKIP_EXACT.has(c) || /^expected_/.test(c);
}

function looksBoolean(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "true" || s === "false" || s === "yes" || s === "no";
}

function looksInteger(v: string): boolean {
  const s = v.trim().replace(/[$,]/g, "");
  return s !== "" && /^-?\d+$/.test(s);
}

function looksNumber(v: string): boolean {
  const s = v.trim().replace(/[$,%]/g, "");
  return s !== "" && Number.isFinite(Number(s));
}

function inferType(
  column: string,
  samples: readonly string[],
): PrimitiveType {
  const nonEmpty = samples.map((s) => String(s ?? "").trim()).filter((s) => s !== "");
  const monetaryName = MONEY_NAME.test(column);

  if (nonEmpty.length === 0) {
    // No data — infer from the name only.
    if (monetaryName) return "money";
    if (/(_|^)(is_|has_|sprinklered|elected|flag)/i.test(column)) return "bool";
    if (/(sqft|count|year|years|age|num|number)/i.test(column)) return "int";
    return "string";
  }
  if (nonEmpty.every(looksBoolean)) return "bool";
  if (nonEmpty.every(looksInteger)) return monetaryName ? "money" : "int";
  if (nonEmpty.every(looksNumber)) return monetaryName ? "money" : "float";
  return "string";
}

export interface SeedFromCsvOptions {
  /** Field names already declared — skipped so seeding never duplicates. */
  readonly existingFieldNames?: readonly string[];
  /** Up to N sample rows (keyed by column) for value-based inference. */
  readonly sampleRows?: readonly Readonly<Record<string, unknown>>[];
}

/**
 * Propose input declarations from CSV column headers. Pure +
 * deterministic. Skips `expected_*` / identifier columns and any
 * already-declared field. New entries are `form`-sourced + optional
 * (the author opts into `required`).
 */
export function seedInputsFromCsv(
  columns: readonly string[],
  options: SeedFromCsvOptions = {},
): readonly InputDictEntry[] {
  const existing = new Set(
    (options.existingFieldNames ?? []).map((f) => f.trim()),
  );
  const rows = options.sampleRows ?? [];
  const seen = new Set<string>();
  const out: InputDictEntry[] = [];

  for (const rawCol of columns) {
    const fieldName = rawCol.trim();
    if (fieldName === "") continue;
    if (isSkippedColumn(fieldName)) continue;
    if (existing.has(fieldName) || seen.has(fieldName)) continue;
    seen.add(fieldName);

    const samples = rows
      .map((r) => r[rawCol])
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v));

    out.push({
      id: fieldNameToStageId(fieldName),
      fieldName,
      displayName: humanizeFieldName(fieldName),
      dataType: inferType(fieldName, samples),
      source: "form",
      required: false,
    });
  }

  return out;
}
