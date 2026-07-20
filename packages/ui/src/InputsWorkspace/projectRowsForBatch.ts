/**
 * projectRowsForBatch — Brief 38 PR 38.6.
 *
 * Pure module. Translates parsed CSV rows + column_map + (optional)
 * alias_overrides + (optional) dtype hints into the `externalInputs`
 * shape that `executePlanBatch(plan, externalInputs[], …)` accepts.
 *
 * Brief 38 §3 J1 + Frame 3: the live preview pane projects the first
 * 10 rows on every mapping change, calls executePlanBatch, and
 * renders the result in real time. The projection is the BRIDGE
 * between the CSV substrate (PR 38.5) and the engine runtime
 * (@openrater/contracts).
 *
 * Three normalizations happen here:
 *
 *   1. COLUMN MAPPING — for each `[inputId, columnName]` in column_map,
 *      copy `row[columnName]` to `out[inputId]`. If `inputId` is
 *      namespace-prefixed (e.g., "model:discr_credit:class_code")
 *      the orchestrator handles that BEFORE calling here — this
 *      module just walks the map verbatim.
 *
 *   2. ALIAS OVERRIDE — when an `alias_overrides[dimSlug][value]`
 *      entry exists, the projected value is the canonical level id
 *      (e.g., "frame") instead of the raw CSV value ("WOOD"). The
 *      caller passes a per-input dimSlug index so we know which
 *      input → dim binding applies.
 *
 *   3. DTYPE COERCION — when dtypes hint at numbers / booleans /
 *      dates, coerce strings to typed values so the engine doesn't
 *      receive "1,360,000" where it expects a number. Coercion is
 *      best-effort; on failure, the raw string passes through.
 *
 * Pure data in / pure data out. No I/O, no React, no engine.
 */

import type { MatchDtype } from "./autoMatch";
import type { AliasOverrides } from "./detectMismatches";
// Deep import of the PURE module (not the barrel): the barrel exports
// the React picker, and this file is consumed by the Node scoring
// service (Brief 75 book runs) — a component in the type graph breaks
// its DOM-less tsconfig.
import {
  applyTransformer,
  type GeoTransformerId,
} from "../GeoTransformerPicker/geoTransformers";
import { computeRatioForRow, isRatioMapping, parseRatio } from "./ratioMapping";

// Banded-dim binning is owned by the runtime `derive.band` node
// (ADR-0026), NOT this projection layer. The projector passes the raw
// numeric value through; the engine bins it with a traceable step
// ("revenue = 850000 → 06_500k_1m"). An earlier client-side pre-bin
// here was redundant with that runtime step and double-binned the
// value to "" — removed once derive.band learned to coerce string
// inputs (see packages/contracts derive-band.ts).

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/**
 * Per-input dim binding the projection consults when resolving alias
 * overrides. Built by the orchestrator (PR 38.8) from the plan's
 * required inputs.
 */
export type InputDimMap = Readonly<Record<string, string>>;

/** Per-input dtype hint. Drives coercion. */
export type InputDtypeMap = Readonly<Record<string, MatchDtype | undefined>>;

export interface ProjectRowOptions {
  /**
   * Per-input dim slug. When `column_map[inputId]` produces a value
   * that matches `alias_overrides[dimSlug][value]`, the projected
   * value is the canonical level id instead.
   */
  readonly inputDimMap?: InputDimMap;
  /**
   * Per-source-column dtype hints (from parseCsv inference).
   *
   * NOTE: keyed by COLUMN NAME (not input id) — because the same
   * source column could feed multiple inputs.
   */
  readonly columnDtypes?: InputDtypeMap;
  /**
   * Per-input dtype overrides — used when the input expects a
   * specific type (e.g., a number input + a string-typed column).
   * Looked up AFTER columnDtypes.
   */
  readonly inputDtypes?: InputDtypeMap;
  /** Plan-level alias overrides (Brief 38 PR 38.1 substrate). */
  readonly aliasOverrides?: AliasOverrides;
  /**
   * Brief 44 PR 44.11.e — Per-input geographic transformer.
   * Maps `inputId` to a `GeoTransformerId` (e.g., `zip5_to_state`).
   * When set + the input has a non-empty raw value, the transformer
   * runs against the raw string and the transformed result becomes
   * the projected value. Applied AFTER alias-overrides (user intent
   * wins) and BEFORE dtype coercion (the transformer always emits
   * a string-shaped level id). The `identity` transformer is a
   * no-op pass-through; callers can use it to explicitly opt out.
   */
  readonly geoTransformers?: Readonly<Record<string, GeoTransformerId>>;
}

/** Errors collected during projection (per row, not blocking). */
export interface ProjectRowError {
  readonly inputId: string;
  readonly columnName: string;
  readonly rawValue: string;
  readonly intendedDtype: MatchDtype;
  readonly message: string;
}

/** Result of projecting a single row. */
export interface ProjectedRow {
  /** Engine-ready externalInputs (one row's worth). */
  readonly externalInputs: Readonly<Record<string, unknown>>;
  /** Non-blocking coercion errors. Empty when the row projects cleanly. */
  readonly errors: readonly ProjectRowError[];
}

// ─────────────────────────────────────────────────────────────────
// Coercion
// ─────────────────────────────────────────────────────────────────

function coerceNumber(raw: string): { ok: true; value: number } | { ok: false } {
  if (raw === "") return { ok: false };
  // Strip thousands commas before parseFloat.
  const cleaned = raw.replace(/,/g, "");
  const n = Number(cleaned);
  if (Number.isFinite(n)) return { ok: true, value: n };
  return { ok: false };
}

function coerceBoolean(raw: string): { ok: true; value: boolean } | { ok: false } {
  const lc = raw.trim().toLowerCase();
  if (lc === "true" || lc === "yes" || lc === "y" || lc === "1" || lc === "t") {
    return { ok: true, value: true };
  }
  if (lc === "false" || lc === "no" || lc === "n" || lc === "0" || lc === "f") {
    return { ok: true, value: false };
  }
  return { ok: false };
}

function coerceDate(raw: string): { ok: true; value: string } | { ok: false } {
  if (raw === "") return { ok: false };
  // Try Date.parse — it handles ISO 8601, slash dates, and common
  // free-form. Returns NaN for unparseable values.
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return { ok: false };
  // Normalize to ISO 8601 (UTC) for stability. Strip the time
  // component when the source was a pure date.
  const d = new Date(t);
  // If raw matches a date-only shape (no time component), emit
  // YYYY-MM-DD; otherwise emit ISO.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: true, value: raw };
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(raw)) {
    const iso = d.toISOString();
    return { ok: true, value: iso.slice(0, 10) };
  }
  return { ok: true, value: d.toISOString() };
}

/**
 * Coerce a raw string to a typed value per the dtype hint. Returns
 * `{ ok: true, value }` on success or `{ ok: false }` to signal the
 * raw should pass through unchanged (and an error logged).
 */
function coerce(
  raw: string,
  dtype: MatchDtype,
): { ok: true; value: unknown } | { ok: false } {
  if (dtype === "string") return { ok: true, value: raw };
  if (dtype === "number") return coerceNumber(raw);
  if (dtype === "boolean") return coerceBoolean(raw);
  if (dtype === "date") return coerceDate(raw);
  return { ok: false };
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Project a single CSV row into engine-ready externalInputs.
 *
 * For each `[inputId, columnName]` in `columnMap`:
 *
 *   0. DERIVED RATIO — when `columnName` is a `@ratio:num/den`
 *      sentinel (Brief 45 K8), compute `Number(row[num]) /
 *      Number(row[den])` and project the resulting number. If either
 *      component is missing / non-numeric or the denominator is 0,
 *      skip the input (treated like an empty cell). The engine's
 *      `derive.band` coerces + bins the number. Ratios bypass alias
 *      override + dtype coercion (the value is already a number).
 *
 *   1. Read `row[columnName]`. If missing or empty string, skip this
 *      input entirely (engine handles missing inputs per kind).
 *
 *   2. If `inputDimMap[inputId]` is set AND
 *      `aliasOverrides[dimSlug][rawValue]` exists, project the
 *      canonical level id instead of the raw value.
 *
 *   3. Otherwise apply dtype coercion:
 *        - `inputDtypes[inputId]` wins when set;
 *        - else `columnDtypes[columnName]`;
 *        - else pass the raw string through.
 *
 *   4. On coercion failure (e.g., "abc" → number), pass the raw
 *      string AND record a ProjectRowError so the caller can
 *      surface it.
 */
export function projectRow(
  row: Readonly<Record<string, string>>,
  columnMap: Readonly<Record<string, string>>,
  options: ProjectRowOptions = {},
): ProjectedRow {
  const externalInputs: Record<string, unknown> = {};
  const errors: ProjectRowError[] = [];

  for (const [inputId, columnName] of Object.entries(columnMap)) {
    if (!columnName) continue;

    // 0. Derived-ratio sentinel — compute num/den and project the
    //    number (no alias/dtype path; the value is already typed).
    if (isRatioMapping(columnName)) {
      const ratio = parseRatio(columnName);
      if (!ratio) continue; // malformed sentinel — skip like an empty cell
      const computed = computeRatioForRow(row, ratio);
      if (computed === null) continue; // missing/non-numeric/zero-denominator
      externalInputs[inputId] = computed;
      continue;
    }

    const raw = row[columnName];
    if (raw == null) continue;

    // 1. Alias override path — projects to canonical level id.
    const dimSlug = options.inputDimMap?.[inputId];
    if (dimSlug && options.aliasOverrides?.[dimSlug]?.[raw] !== undefined) {
      externalInputs[inputId] = options.aliasOverrides[dimSlug]![raw];
      continue;
    }

    // 2. Empty cells flow through as undefined → engine treats as missing.
    if (raw === "") continue;

    // 2.5. Brief 44 PR 44.11.e — Geographic transformer. When the
    // input is bound to a geographic dim AND the user picked a
    // transformer (e.g., `zip5_to_state`), run the raw string
    // through it. `identity` is a no-op pass-through. A `null`
    // result (e.g., out-of-range ZIP) gets logged + the raw value
    // flows through — the engine + downstream dim lookup will
    // surface the miss.
    const transformerId = options.geoTransformers?.[inputId];
    if (transformerId && transformerId !== "identity") {
      const transformed = applyTransformer(transformerId, raw);
      if (transformed !== null) {
        externalInputs[inputId] = transformed;
        continue;
      }
      errors.push({
        inputId,
        columnName,
        rawValue: raw,
        intendedDtype: "string",
        message: `Geo transformer "${transformerId}" returned null for "${raw}" (out of range or unrecognized).`,
      });
      // Fall through to the dtype path so the raw value still
      // reaches the engine; the level lookup downstream will miss
      // and the row will surface as unmatched in the trace.
    }

    // Banded dims are NOT pre-binned here. The raw numeric value (as a
    // string from the CSV) passes through to the engine, where the
    // `derive.band` runtime node bins it with a traceable step
    // (ADR-0026 — single binning authority). derive.band coerces the
    // string, so no numeric coercion is needed in this layer either.

    // 3. Dtype coercion.
    const dtype =
      options.inputDtypes?.[inputId] ??
      options.columnDtypes?.[columnName] ??
      "string";

    if (dtype === "string") {
      externalInputs[inputId] = raw;
      continue;
    }

    const coerced = coerce(raw, dtype);
    if (coerced.ok) {
      externalInputs[inputId] = coerced.value;
    } else {
      // Pass raw through but log the error.
      externalInputs[inputId] = raw;
      errors.push({
        inputId,
        columnName,
        rawValue: raw,
        intendedDtype: dtype,
        message: `Could not coerce "${raw}" to ${dtype} for input ${inputId}.`,
      });
    }
  }

  return { externalInputs, errors };
}

/**
 * Project an array of rows. Each row is independent — one row's
 * coercion failure doesn't affect others. Useful for the live
 * preview's first-N batch + the full-batch Score-all run.
 */
export function projectRows(
  rows: readonly Readonly<Record<string, string>>[],
  columnMap: Readonly<Record<string, string>>,
  options: ProjectRowOptions = {},
): readonly ProjectedRow[] {
  return rows.map((r) => projectRow(r, columnMap, options));
}

/**
 * Convenience for code paths that only want the externalInputs array
 * without per-row error tracking. Used by the live preview when
 * errors are surfaced through a different channel.
 */
export function projectRowsToExternalInputs(
  rows: readonly Readonly<Record<string, string>>[],
  columnMap: Readonly<Record<string, string>>,
  options: ProjectRowOptions = {},
): readonly Readonly<Record<string, unknown>>[] {
  return rows.map((r) => projectRow(r, columnMap, options).externalInputs);
}
