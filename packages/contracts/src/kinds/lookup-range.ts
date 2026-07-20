/**
 * `lookup.range` kind — value → bucketed factor.
 *
 * Per Plan Format Spec v1 §4.5: takes a numeric value, finds the
 * first bucket whose `[lo, hi)` range contains it, returns that
 * bucket's factor. Used for banded rating moves like:
 *
 *   TIV ≤ $250k → 0.95
 *   TIV ≤ $1M   → 1.00
 *   TIV > $1M   → 1.10
 *
 * Buckets are inclusive on the low side, half-open on the high side
 * (`value < hi`) so adjacent buckets don't overlap. The last bucket's
 * `hi` may be `null` (or `+Infinity` in-memory) for an open top —
 * platform-test finding E5: JSON has no Infinity, so open ends
 * persist as null and the matcher treats null as ±∞.
 */

import type { BlockKind, PortSpec } from "../block-types";
import type { OnMissPolicy } from "../plan-issues";
import { lookupMissSeed, resolveLookupMiss } from "../plan-issues";

export interface RangeBucket {
  /** Low boundary (inclusive). null = open below (E5, JSON-safe -∞). */
  lo: number | null;
  /** High boundary (half-open: `value < hi`). null = open above (E5, JSON-safe +∞). */
  hi: number | null;
  /** Factor returned when the value falls in this bucket. */
  factor: number;
}

/**
 * One bucket's half-open `[lo, hi)` membership test, treating null
 * bounds as open ends (finding E5 — dropping or mismatching no-cap
 * bands clamped values onto the nearest BOUNDED band instead).
 */
function inBucket(value: number, bucket: RangeBucket): boolean {
  return (
    (bucket.lo == null || value >= bucket.lo) &&
    (bucket.hi == null || value < bucket.hi)
  );
}

export interface RangeLookupParams {
  /** Ordered bucket list. First matching bucket wins. */
  buckets: readonly RangeBucket[];
  /** Factor returned when no bucket matches. */
  defaultValue: number;
  /** Human-readable name (shown in inspector + audit trace). */
  tableName?: string;
  /** Citation reference. */
  citation?: string;
  /** ADR-0056 — authored no-bucket disposition (see lookup.direct). */
  onMiss?: OnMissPolicy;
  /** ADR-0056 — raw input field feeding the value (message-only). */
  keySource?: string;
}

export type RangeLookupInputs = { value: number };
export type RangeLookupOutputs = { value: number };

export const RangeLookupKind: BlockKind<
  RangeLookupParams,
  RangeLookupInputs,
  RangeLookupOutputs
> = {
  id: "lookup.range",
  category: "lookup",
  label: "Range lookup",
  description: "Value → bucketed factor (first matching bucket wins)",
  inputs: [
    {
      name: "value",
      type: "float",
      description: "The value to look up",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "factor",
      description: "The bucketed factor",
    } as PortSpec,
  ],
  defaultParams: {
    buckets: [],
    defaultValue: 1.0,
  },
  defaultSize: "regular",
  provenance: "core",
  certainty: "draft",
  determinism: "strict",
  sideEffects: "none",
  execute: (inputs, params) => {
    for (const bucket of params.buckets) {
      if (inBucket(inputs.value, bucket)) {
        return { value: bucket.factor };
      }
    }
    return {
      value: resolveLookupMiss(params.onMiss, params.defaultValue, {
        key: inputs.value,
        ...(params.tableName !== undefined
          ? { tableName: params.tableName }
          : {}),
        ...(params.keySource !== undefined
          ? { keySource: params.keySource }
          : {}),
      }),
    };
  },
  collectRowIssues: (inputs, params) => {
    const matched = params.buckets.some((b) => inBucket(inputs.value, b));
    if (matched) return undefined;
    const seed = lookupMissSeed(params.onMiss, params.defaultValue, {
      key: inputs.value,
      ...(params.tableName !== undefined
        ? { tableName: params.tableName }
        : {}),
      ...(params.keySource !== undefined
        ? { keySource: params.keySource }
        : {}),
    });
    return seed ? [seed] : undefined;
  },
  validate: (params) => {
    if (
      typeof params.defaultValue !== "number" ||
      Number.isNaN(params.defaultValue)
    ) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "defaultValue must be a number",
            field: "defaultValue",
          },
        ],
      };
    }
    for (let i = 0; i < params.buckets.length; i++) {
      const b = params.buckets[i]!;
      // E5 — a null bound is an open end; only two FINITE bounds can
      // be inverted.
      if (b.lo != null && b.hi != null && b.lo > b.hi) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: `bucket ${i}: lo > hi`,
              field: "buckets",
            },
          ],
        };
      }
    }
    if (params.buckets.length === 0) {
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message: "No buckets; every lookup returns defaultValue",
            field: "buckets",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    for (const b of params.buckets) {
      if (inBucket(inputs.value, b)) {
        // Open ends: null is the JSON-safe encoding (E5); 1e308 is the
        // legacy conformance sentinel for "open top" — render both ∞.
        const loStr = b.lo == null ? "-∞" : String(b.lo);
        const hiStr = b.hi == null || b.hi >= 1e308 ? "∞" : String(b.hi);
        return `${inputs.value} in [${loStr}, ${hiStr}) → ${outputs.value}`;
      }
    }
    return `${inputs.value} matched no bucket → ${outputs.value} (default)`;
  },
};
