/**
 * Multi-location → policy roll-up (stress-test finding E08).
 *
 * Today a `Policy` (policy-types.ts) composes N product *lines* against ONE
 * risk; `composePolicy` sums line premiums. Neither models a policy that
 * holds MULTIPLE LOCATION rows of the same plan — so "policy TIV = Σ
 * building+BPP across locations" and "policy premium = Σ location premiums"
 * have nowhere to live.
 *
 * This module is the foundational primitive: a book of rated location rows,
 * each tagged with `policy_id` + `location_id`, is GROUPED by policy and
 * REDUCED by declared reducers (default `sum` for premium + TIV). The
 * per-location breakdown is retained for the trace / drill-in. The policy-
 * level appetite gate (E03) runs AFTER this so it sees the policy total.
 *
 * Recommended wiring: a `policy_id` / `location_id` convention in the book CSV drives the roll-up
 * in the batch runner; the policy composer renders the grouped result.
 *
 * Pure + deterministic (P-N1): grouping preserves first-seen policy order +
 * input row order; no clock, no randomness. No React, no DOM, no I/O. The
 * `rateAndRollUp` convenience runs the (pure) batch runner then reduces.
 */

import type { CompiledPlan, RunOptions } from "./plan-types";
import { runPlanBatch } from "./runtime";

/** The closed set of reducers a policy field can roll up by. */
export type RollupReducer = "sum" | "avg" | "max" | "min" | "count" | "first";

export const ROLLUP_REDUCERS: readonly RollupReducer[] = Object.freeze([
  "sum",
  "avg",
  "max",
  "min",
  "count",
  "first",
] as const);

/** Declares one field to roll up to the policy level. `as` renames the
 *  rolled output (defaults to `field`). Premium + TIV both default to `sum`
 *  at the call site — there is no implicit field list, so a plan declares
 *  exactly what aggregates. */
export interface RollupField {
  readonly field: string;
  readonly reducer: RollupReducer;
  readonly as?: string;
}

/** One rated location row, already scored, tagged to its policy. `values`
 *  is the row's inputs merged with its run outputs (outputs win on a key
 *  clash) so a reducer can roll up an exposure input (TIV) AND an output
 *  (premium) uniformly. */
export interface BookRow {
  readonly policy_id: string;
  readonly location_id: string;
  readonly values: Readonly<Record<string, unknown>>;
}

/** A field's value at one location (null = absent / non-numeric). Retained
 *  so the policy trace can show "Σ from L1 $850k + L2 $210k". */
export interface LocationValue {
  readonly location_id: string;
  readonly value: number | null;
}

/** The rolled-up result for one policy. */
export interface PolicyRollup {
  readonly policy_id: string;
  readonly location_count: number;
  readonly location_ids: readonly string[];
  /** The reduced value per declared field, keyed by `field.as ?? field.field`. */
  readonly rolled: Readonly<Record<string, number>>;
  /** Per-field, per-location values (input order) for the drill-in trace. */
  readonly breakdown: Readonly<Record<string, readonly LocationValue[]>>;
}

/** A keyed, not-yet-rated location row for `rateAndRollUp`. */
export interface KeyedRiskRow {
  readonly policy_id: string;
  readonly location_id: string;
  readonly inputs: Record<string, unknown>;
}

/** Finite number, else null (absent / non-numeric / NaN / ±∞). */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // A RAW numeric input projects to a string (the book path doesn't coerce
  // inputs to their dtype before the roll-up), so accept a plain numeric string
  // — otherwise a rolled raw input (e.g. an enriched `total_floor_area_sqft`)
  // would silently sum to 0. Mirrors `coerceNumber` (strips thousands commas).
  // A non-numeric string stays null (→ 0 for sum/avg; ignored by max/min/first).
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Normalize -0 → 0 so rolled values serialize identically everywhere. */
function denormZero(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * Reduce one field's ordered per-location values. `values` carries one
 * entry per row (null where the field was absent/non-numeric). `sum`/`avg`
 * treat null as 0; `max`/`min`/`first` ignore null (no finite value → 0);
 * `count` counts ROWS regardless of value. Pure + total.
 */
export function reduceRollup(
  reducer: RollupReducer,
  values: readonly (number | null)[],
): number {
  const finite = values.filter((v): v is number => v !== null);
  switch (reducer) {
    case "sum":
      return denormZero(finite.reduce((a, b) => a + b, 0));
    case "avg":
      return values.length === 0
        ? 0
        : denormZero(finite.reduce((a, b) => a + b, 0) / values.length);
    case "max":
      return finite.length === 0 ? 0 : Math.max(...finite);
    case "min":
      return finite.length === 0 ? 0 : Math.min(...finite);
    case "count":
      return values.length;
    case "first":
      return values.length === 0 ? 0 : (values[0] ?? 0);
  }
}

/**
 * Group rated location rows by `policy_id` and reduce each declared field
 * to the policy level. Deterministic: policies appear in first-seen order,
 * locations in input order.
 */
export function rollUpBook(
  rows: readonly BookRow[],
  fields: readonly RollupField[],
): readonly PolicyRollup[] {
  // Preserve first-seen policy order (Map insertion order).
  const groups = new Map<string, BookRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.policy_id);
    if (bucket) bucket.push(row);
    else groups.set(row.policy_id, [row]);
  }

  const out: PolicyRollup[] = [];
  for (const [policy_id, group] of groups) {
    const rolled: Record<string, number> = {};
    const breakdown: Record<string, LocationValue[]> = {};
    for (const f of fields) {
      const key = f.as ?? f.field;
      const perLocation = group.map((r) => ({
        location_id: r.location_id,
        value: toNumber(r.values[f.field]),
      }));
      breakdown[key] = perLocation;
      rolled[key] = reduceRollup(
        f.reducer,
        perLocation.map((l) => l.value),
      );
    }
    out.push({
      policy_id,
      location_count: group.length,
      location_ids: group.map((r) => r.location_id),
      rolled,
      breakdown,
    });
  }
  return out;
}

/**
 * Rate each keyed location row against the compiled plan, then roll up to
 * the policy. The "rate each location, reduce to the policy" foundational
 * batch primitive (E08). `values` for the reducer = each row's inputs
 * merged with its run outputs (outputs win). Pure (runs the pure batch
 * runner); `as_of` is resolved once for the whole book by `runPlanBatch`.
 */
export function rateAndRollUp(
  compiled: CompiledPlan,
  rows: readonly KeyedRiskRow[],
  fields: readonly RollupField[],
  options?: RunOptions,
): readonly PolicyRollup[] {
  const results = runPlanBatch(
    compiled,
    rows.map((r) => r.inputs),
    options,
  );
  const book: BookRow[] = rows.map((r, i) => ({
    policy_id: r.policy_id,
    location_id: r.location_id,
    values: { ...r.inputs, ...results[i]!.outputs },
  }));
  return rollUpBook(book, fields);
}
