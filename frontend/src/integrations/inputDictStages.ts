/**
 * inputDictStages — Brief 52 adapter between the <InputDictionaryEditor>
 * view-model (`InputDictEntry`) and `input_node` stages.
 *
 * D1: a plan's input dictionary IS its set of `input_node` stages. This
 * module is the pure mapping layer the InputsWorkspace mount uses to
 * (a) project the plan's stages into editor entries and (b) build the
 * stage CRUD requests on save.
 *
 * The load-bearing field is `config_json.source_path`: we write the
 * declared `fieldName` there (raw), which `deriveRequiredInputs`
 * normalizes to the `externalInputs` key — the same string the CSV
 * column maps TO and the Gate rule reads. So declaring an input here
 * lights it up in both the CSV column-mapper and the Gate field-picker.
 *
 * The display name + citation live in `config_json` (name / citation),
 * not the stage-level fields, because the config-patch endpoint is the
 * only stage mutation that round-trips after creation (P-N3 / WA-2).
 */

import { type ComputedExpr, type PrimitiveType, validateComputedExpr } from "@openrater/contracts";
import type { AddStageRequest, StageConfigPatch, StageSummary } from "@openrater/api-client";
import {
  fieldNameToStageId,
  resolveInputDisplayName,
  type InputDictEntry,
  type InputSourceKindValue,
} from "@openrater/ui";

const PRIMITIVE_TYPES: ReadonlySet<string> = new Set([
  "money",
  "factor",
  "pct",
  "class_code",
  "string",
  "date",
  "bool",
  "int",
  "float",
  "model_output",
  "record",
]);

const EDITOR_SOURCES: ReadonlySet<string> = new Set([
  "form",
  "api",
  "lookup",
  "manual",
  "derived",
]);

/** Strip the substrate's path prefixes to the raw runtime key. */
function normalizeFieldName(path: string | undefined): string {
  if (!path) return "";
  const s = String(path).trim();
  if (s.startsWith("form_input.")) return s.slice("form_input.".length);
  if (s.startsWith("stages.")) return s.split(".")[1] ?? s;
  return s;
}

/** Map a stored data_type (PrimitiveType or legacy) onto the editor vocab. */
function toEditorDataType(raw: unknown): PrimitiveType {
  const t = typeof raw === "string" ? raw : "";
  if (PRIMITIVE_TYPES.has(t)) return t as PrimitiveType;
  // Legacy InputNodeConfig values.
  if (t === "number") return "float";
  if (t === "currency") return "money";
  if (t === "boolean") return "bool";
  if (t === "enum") return "string";
  return "string";
}

/** Map a stored source (editor vocab or legacy) onto the editor vocab. */
function toEditorSource(raw: unknown): InputSourceKindValue {
  const s = typeof raw === "string" ? raw : "";
  if (EDITOR_SOURCES.has(s)) return s as InputSourceKindValue;
  if (s === "form_input") return "form";
  if (s === "api_pull" || s === "submission_field") return "api";
  if (s === "literal") return "manual";
  return "form";
}

function readObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function asStringArray(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.map((x) => String(x)).filter((x) => x !== "");
  return arr.length > 0 ? arr : undefined;
}

/** Read a stored `derived_expr` as a `ComputedExpr` (E03 / brief D3), reusing
 *  the contract's validator so a malformed blob round-trips to `undefined`
 *  rather than corrupting the editor. */
function asComputedExpr(v: unknown): ComputedExpr | undefined {
  return v && typeof v === "object" && validateComputedExpr(v) === null
    ? (v as ComputedExpr)
    : undefined;
}

/** Project the plan's `input_node` stages into editor entries. */
export function stagesToInputDictEntries(
  stages: readonly StageSummary[],
): InputDictEntry[] {
  const out: InputDictEntry[] = [];
  for (const s of stages) {
    if (s.stage_kind !== "input_node") continue;
    const cfg = readObject(s.config_json);
    const validation = readObject(cfg.validation);
    const fieldName =
      normalizeFieldName(asString(cfg.source_path)) ||
      asString(cfg.name) ||
      s.stage_id;
    const dv = cfg.default_value;
    // Bind once so exactOptionalPropertyTypes narrows inside each spread.
    const allowedValues = asStringArray(validation.enum);
    const derivedExpr = asComputedExpr(cfg.derived_expr);
    const unit = asString(cfg.unit);
    const category = asString(cfg.category);
    const description = asString(cfg.description);
    const derivedFrom = asString(cfg.derived_from);
    const citation = asString(cfg.citation);
    out.push({
      id: s.stage_id,
      fieldName,
      //  — config.name is the display name only when it differs
      // from the field key (the workbook builder writes the slug there;
      // the label rides stage.display_name). One shared rule.
      displayName: resolveInputDisplayName({
        fieldKey: fieldName,
        configName: asString(cfg.name),
        stageDisplayName: s.display_name,
      }),
      dataType: toEditorDataType(cfg.data_type),
      source: toEditorSource(cfg.source),
      required: cfg.required !== false,
      ...(allowedValues ? { allowedValues } : {}),
      ...(unit ? { unit } : {}),
      ...(category ? { category } : {}),
      ...(dv !== undefined && dv !== null ? { defaultValue: String(dv) } : {}),
      ...(description ? { description } : {}),
      ...(derivedFrom ? { derivedFrom } : {}),
      ...(derivedExpr ? { derivedExpr } : {}),
      ...(citation ? { citation } : {}),
    });
  }
  return out;
}

/** Coerce the editor's string default into the backend's typed value. */
function coerceDefault(value: string, dataType: PrimitiveType): unknown {
  const t = value.trim();
  if (t === "") return undefined;
  if (dataType === "bool") return t === "true" || t === "yes";
  if (
    dataType === "money" ||
    dataType === "int" ||
    dataType === "float" ||
    dataType === "pct" ||
    dataType === "factor"
  ) {
    const n = Number(t.replace(/[$,%]/g, ""));
    return Number.isFinite(n) ? n : t;
  }
  return t;
}

/** Build the `input_node` config_json for one declared input. */
export function entryToConfigJson(entry: InputDictEntry): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    name: entry.displayName.trim() || entry.fieldName,
    data_type: entry.dataType,
    source: entry.source,
    // The runtime key — deriveRequiredInputs normalizes this to the id.
    source_path: entry.fieldName,
    required: entry.required,
    output_field: "value",
  };
  if (entry.allowedValues && entry.allowedValues.length > 0) {
    cfg.validation = { enum: [...entry.allowedValues] };
  }
  if (entry.unit) cfg.unit = entry.unit;
  if (entry.category) cfg.category = entry.category;
  if (entry.derivedFrom) cfg.derived_from = entry.derivedFrom;
  if (entry.derivedExpr) cfg.derived_expr = entry.derivedExpr;
  if (entry.description) cfg.description = entry.description;
  if (entry.citation) cfg.citation = entry.citation;
  if (entry.defaultValue !== undefined && entry.defaultValue !== "") {
    const coerced = coerceDefault(entry.defaultValue, entry.dataType);
    if (coerced !== undefined) cfg.default_value = coerced;
  }
  return cfg;
}

/** Port data_type for the stage's single `value` output. */
function toPortDataType(dataType: PrimitiveType): string {
  if (
    dataType === "money" ||
    dataType === "int" ||
    dataType === "float" ||
    dataType === "pct" ||
    dataType === "factor"
  )
    return "number";
  if (dataType === "bool") return "bool";
  return "string";
}

/** Build an AddStageRequest to create a new declared input. */
export function entryToAddStageRequest(
  entry: InputDictEntry,
  insertAfterStageId: string | null,
): AddStageRequest {
  return {
    stage_id: entry.id || fieldNameToStageId(entry.fieldName),
    stage_kind: "input_node",
    display_name: entry.displayName.trim() || entry.fieldName,
    config_json: entryToConfigJson(entry),
    insert_after_stage_id: insertAfterStageId,
    inputs: [],
    outputs: [
      {
        output_name: "value",
        data_type: toPortDataType(entry.dataType),
        description: null,
      },
    ],
  };
}

/** Build a config patch to update an existing declared input. */
export function entryToConfigPatch(entry: InputDictEntry): StageConfigPatch {
  return {
    stage_id: entry.id,
    config_json: entryToConfigJson(entry),
  };
}
