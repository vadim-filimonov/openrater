/**
 * deriveRunFields — FCA fca-2026-07-25 finding #10 (the Test form
 * omitted gate-only inputs).
 *
 * The Sample-risk form used to render exactly the keys
 * `synthesizeRepresentativeRisk` seeds — the CHAIN-consumed fields.
 * A field the workbook declares but only the eligibility gate reads
 * (vehicle_use, work_above_three_stories…) never got a control, yet
 * the result claimed "policy gates applied" — and since the §12.4
 * refusal contract landed (inputsPreflight), such quotes REFUSE
 * naming the field the form never offered.
 *
 * This module makes the form's field list the plan's DECLARED input
 * dictionary (every non-derived `input_node`, in workbook order) plus
 * whatever the synthesis seeds beyond it (undeclared chain paths keep
 * the Brief 83.2 grace). Each declared field carries its dictionary
 * dtype so the form can render a real control (bool → Yes/No toggle).
 *
 * `buildSampleRisk` is the payload half: declared fields are typed by
 * the dictionary (mirroring `coerceDefault` in inputDictStages), and
 * an UNSET declared field is OMITTED from the request — an empty
 * string would count as "supplied" and dodge the engine's refusal,
 * re-hiding exactly the defect this fixes. Undeclared seeded fields
 * keep the legacy behavior (typed seed; numeric seeds re-coerce their
 * string overrides).
 *
 * The finding's SECOND surface is Ship's API try-it, which shows the
 * wire itself: `overlayVerifiedCase` is the shared seed rule (Run and
 * Ship must not disagree on what the sample risk IS), and
 * `buildWireSampleInputs` renders it as the `{ inputs }` body — with
 * `null` standing in for a required field nothing can honestly answer
 * (see its doc).
 *
 * Pure data in / data out — no React, no I/O. Tested.
 */

import type { PrimitiveType } from "@openrater/contracts";
import type { InputDictEntry } from "../InputDictionary/types";
import { humanizeFieldName } from "../InputDictionary/types";
import { sanitize } from "../InputsWorkspace/stagesToRuntimePlan";
import type { RunField } from "./RunSection";

/** FCA fca-2026-07-25 #12 — one schedule-rating category, as the Run
 *  form needs it: the filed range bounds the judgment the underwriter
 *  types. */
export interface RunScheduleCategory {
  readonly categoryId: string;
  readonly name: string;
  readonly rangePct: number;
}

/** FCA #12 — a plan's schedule-rating structure (modifier.schedule
 *  stage), the door the audit found missing: the engine consumed
 *  `schedule_app_{id}` on every row while no screen, form, or
 *  documented input accepted the judgments. */
export interface RunSchedule {
  readonly scheduleId: string;
  readonly displayName: string;
  readonly totalCapPct: number;
  readonly categories: readonly RunScheduleCategory[];
}

export interface DeriveRunFieldsArgs {
  /** The declared input dictionary — the plan's `input_node` stages,
   *  projected (the route's `stagesToInputDictEntries`). */
  readonly entries: readonly InputDictEntry[];
  /** The seeded risk — representative synthesis, with the build
   *  report's verified test case overlaid where present. */
  readonly seeded: Readonly<Record<string, unknown>>;
  /** The user's edits, keyed by field, held as raw strings. */
  readonly overrides: Readonly<Record<string, string>>;
  /** Resolved display names (dims + dictionary); fields absent from
   *  the map fall back to `humanizeFieldName`. */
  readonly labelByField?: ReadonlyMap<string, string> | undefined;
  /** FCA #12 — the plan's schedule-rating structures; each category
   *  renders a signed-percent judgment field, and `buildSampleRisk`
   *  assembles them into the engine's `schedule_app_{id}` envelope. */
  readonly schedules?: readonly RunSchedule[] | undefined;
}

/** The form key a schedule judgment rides under (never collides with
 *  a declared input — ':' is not a legal field character). */
export function scheduleFieldKey(
  scheduleId: string,
  categoryId: string,
): string {
  return `schedule:${scheduleId}:${categoryId}`;
}

/** Declared, row-suppliable entries — the engine's preflight excludes
 *  `source === "derived"` (computed in-graph, never a form field), and
 *  so must the form. Deduped by fieldName, first declaration wins. */
function rowSuppliedEntries(
  entries: readonly InputDictEntry[],
): Map<string, InputDictEntry> {
  const out = new Map<string, InputDictEntry>();
  for (const e of entries) {
    if (e.source === "derived") continue;
    if (!e.fieldName || out.has(e.fieldName)) continue;
    out.set(e.fieldName, e);
  }
  return out;
}

/** The declared, row-suppliable field keys — the set the seed-case
 *  overlay measures "declared" against. */
export function declaredRowKeys(
  entries: readonly InputDictEntry[],
): ReadonlySet<string> {
  return new Set(rowSuppliedEntries(entries).keys());
}

/**
 * The Brief 95 D2 seed rule, shared by Run's form and Ship's try-it
 * (one definition, so the two surfaces cannot disagree on what the
 * sample risk IS): the build report's verified test-case inputs beat
 * the synthesized representative — but only on keys the plan knows
 * (chain-seeded or declared; workbook-only keys stay out), and a
 * null/undefined case value never erases a seed.
 */
export function overlayVerifiedCase(
  representative: Readonly<Record<string, unknown>>,
  caseInputs: Readonly<Record<string, unknown>> | null | undefined,
  declaredKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...representative };
  if (!caseInputs) return out;
  for (const [key, value] of Object.entries(caseInputs)) {
    if (
      (key in out || declaredKeys.has(key)) &&
      value !== null &&
      value !== undefined
    ) {
      out[key] = value;
    }
  }
  return out;
}

/** The seed a declared field resets to: the synthesized/verified value
 *  when the chains consume it, else the workbook default, else unset. */
function declaredSeed(
  entry: InputDictEntry,
  seeded: Readonly<Record<string, unknown>>,
): string {
  const v = seeded[entry.fieldName];
  if (v !== undefined && v !== null) return String(v);
  return entry.defaultValue ?? "";
}

/**
 * The full Sample-risk field list: every declared non-derived input in
 * dictionary (workbook) order, then any seeded field the dictionary
 * doesn't cover, in synthesis order.
 */
export function deriveRunFields({
  entries,
  seeded,
  overrides,
  labelByField,
  schedules,
}: DeriveRunFieldsArgs): readonly RunField[] {
  const declared = rowSuppliedEntries(entries);
  const fields: RunField[] = [];
  for (const [key, entry] of declared) {
    const seed = declaredSeed(entry, seeded);
    fields.push({
      key,
      label:
        labelByField?.get(key) ??
        (entry.displayName !== key ? entry.displayName : humanizeFieldName(key)),
      value: overrides[key] ?? seed,
      placeholder: seed,
      ...(entry.dataType === "bool" ? { control: "boolean" as const } : {}),
    });
  }
  for (const [key, v] of Object.entries(seeded)) {
    if (declared.has(key)) continue;
    // FCA #12 — the raw schedule_app_* envelope is machinery, not a
    // form field; its judgments render as the per-category fields
    // below.
    if (key.startsWith("schedule_app_")) continue;
    const seed = String(v ?? "");
    fields.push({
      key,
      label: labelByField?.get(key) ?? humanizeFieldName(key),
      value: overrides[key] ?? seed,
      placeholder: seed,
    });
  }
  // FCA #12 — the filed discount/surcharge judgments get real fields:
  // one signed-percent entry per category, the filed range in the
  // label, unset = 0 (no modification — the filed default).
  for (const s of schedules ?? []) {
    for (const c of s.categories) {
      const key = scheduleFieldKey(s.scheduleId, c.categoryId);
      fields.push({
        key,
        label: `${s.displayName} · ${c.name} (±${c.rangePct}%)`,
        value: overrides[key] ?? "",
        placeholder: `0 (cap ±${s.totalCapPct}%)`,
      });
    }
  }
  return fields;
}

/** Mirror of `coerceDefault` (inputDictStages) — the ONE string→typed
 *  vocabulary for declared inputs, so the form submits what the
 *  workbook builder would have stored. */
function coerceByType(trimmed: string, dataType: PrimitiveType): unknown {
  if (dataType === "bool") return trimmed === "true" || trimmed === "yes";
  if (
    dataType === "money" ||
    dataType === "int" ||
    dataType === "float" ||
    dataType === "pct" ||
    dataType === "factor"
  ) {
    const n = Number(trimmed.replace(/[$,%]/g, ""));
    return Number.isFinite(n) ? n : trimmed;
  }
  return trimmed;
}

/**
 * Build the run-request payload from the form state.
 *
 *  · Declared fields are typed by the dictionary dtype; a field left
 *    UNSET (no seed, no default, no edit — or edited to empty) is
 *    OMITTED so the engine's §12.4 refusal can name it. Sending ""
 *    would read as supplied and silently rate past the gate.
 *  · Undeclared seeded fields pass through as before: the typed seed
 *    verbatim, a string override re-coerced to number only when the
 *    seed was numeric.
 */
export function buildSampleRisk({
  entries,
  seeded,
  overrides,
  schedules,
}: DeriveRunFieldsArgs): Record<string, unknown> {
  const declared = rowSuppliedEntries(entries);
  const risk: Record<string, unknown> = {};
  for (const [key, seedValue] of Object.entries(seeded)) {
    if (declared.has(key)) continue;
    const raw = overrides[key];
    if (raw === undefined) {
      risk[key] = seedValue;
    } else if (typeof seedValue === "number") {
      const n = Number(raw);
      risk[key] = Number.isFinite(n) ? n : raw;
    } else {
      risk[key] = raw;
    }
  }
  for (const [key, entry] of declared) {
    const raw: unknown =
      overrides[key] !== undefined
        ? overrides[key]
        : seeded[key] !== undefined && seeded[key] !== null
          ? seeded[key]
          : entry.defaultValue;
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") {
      // A typed seed (verified test case / synthesis) is already the
      // engine's shape — pass it verbatim.
      risk[key] = raw;
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    risk[key] = coerceByType(trimmed, entry.dataType);
  }
  // FCA #12 — assemble the underwriter's judgments into the engine's
  // schedule_app_{id} envelope (the field name mirrors the projector's
  // sanitize exactly). Only non-zero judgments ride; a schedule with
  // none stays OFF the wire — absence is the filed neutral (all
  // categories default_zero), and the trace says so.
  for (const s of schedules ?? []) {
    const values: Record<string, { value_pct: number; source: string }> = {};
    for (const c of s.categories) {
      const raw = overrides[scheduleFieldKey(s.scheduleId, c.categoryId)];
      if (raw === undefined) continue;
      const trimmed = raw.trim().replace(/%$/, "");
      if (trimmed === "") continue;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n === 0) continue;
      values[c.categoryId] = { value_pct: n, source: "underwriter" };
    }
    if (Object.keys(values).length > 0) {
      risk[`schedule_app_${sanitize(s.scheduleId)}`] = {
        schedule_id: s.scheduleId,
        values,
      };
    }
  }
  return risk;
}

/**
 * buildWireSampleInputs — Ship's API try-it body (FCA #10's second
 * surface: the wire sample omitted gate-only declared inputs, so the
 * §12.4 refusal named a field the JSON never showed).
 *
 * The value-carrying part IS `buildSampleRisk` with no edits — the
 * exact payload Run's untouched form submits, so the try-it and the
 * Run tab quote the same risk (Law 1). On top of it, every declared
 * REQUIRED field that stays unset (no chain seed, no verified case
 * value, no workbook default) appears as `"field": null` — the wire
 * shape must show the key, fabricating an eligibility answer would be
 * dishonest, and `null` is the one JSON spelling that supplies no
 * value: the engine treats it as absent and refuses the row naming
 * the field (inputsPreflight) until a real answer replaces it.
 * `placeholders` lists those fields so the panel can say exactly that.
 * Unset OPTIONAL fields stay omitted — nothing demands them.
 */
export function buildWireSampleInputs({
  entries,
  seeded,
}: {
  readonly entries: readonly InputDictEntry[];
  readonly seeded: Readonly<Record<string, unknown>>;
}): {
  readonly inputs: Record<string, unknown>;
  readonly placeholders: readonly string[];
} {
  const inputs = buildSampleRisk({ entries, seeded, overrides: {} });
  const placeholders: string[] = [];
  for (const [key, entry] of rowSuppliedEntries(entries)) {
    if (key in inputs || !entry.required) continue;
    inputs[key] = null;
    placeholders.push(key);
  }
  return { inputs, placeholders };
}
