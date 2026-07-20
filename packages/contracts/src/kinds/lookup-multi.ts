/**
 * `lookup.multi` kind — N-key composite → factor.
 *
 * Per Plan Format Spec v1 §4.5: takes a record of N input keys, finds
 * the row whose key tuple matches exactly, returns that row's factor.
 * Used for multi-dimensional rating tables like:
 *
 *   (class, territory, protection_class) → factor
 *
 * The composite-key match is positional by `keyNames` order. All
 * declared keys must match for a row to be selected. Falls back to
 * `defaultValue` when no row matches.
 */

import type { BlockKind, PortSpec } from "../block-types";
import type { OnMissPolicy } from "../plan-issues";
import { lookupMissSeed, resolveLookupMiss } from "../plan-issues";
import { interpolateLinear, type InterpolatePoint } from "./interpolate";
import { toFiniteNumber } from "./coerce-numeric";

export interface MultiLookupRow {
  /** Composite key, positional with the kind's `keyNames`. */
  keys: readonly (string | number)[];
  /** Factor returned when this row's keys match the input. */
  factor: number;
}

/**
 * Interpolate the factor across one numeric axis
 * of the composite key. The F14 class: a 2-D relativity (limit-band ×
 * construction-group) that interpolates along the limit axis while a
 * discrete row-match steps. The other
 * ax(es) still match discretely at runtime (the group is resolved from
 * the risk); the flagged axis receives the RAW numeric value and the
 * factor is read linearly between that axis's breakpoints.
 */
export interface MultiLookupInterpolateOn {
  /** Which of `keyNames` is the numeric axis to interpolate across. */
  readonly key: string;
  /**
   * Row-key value on that axis (band id — and any alias of it) → the
   * numeric breakpoint x it represents (the band's LOWER bound; each
   * band's factor is the value at its lower breakpoint).
   */
  readonly breakpoints: Readonly<Record<string, number>>;
}

export interface MultiLookupParams {
  /** Ordered list of key names; must match the input record's fields. */
  keyNames: readonly string[];
  /** Table rows. First positional match wins. */
  rows: readonly MultiLookupRow[];
  /** Factor returned when no row matches. */
  defaultValue: number;
  /** Human-readable name. */
  tableName?: string;
  /** Citation reference. */
  citation?: string;
  /** Authored no-row-match disposition (see lookup.direct). */
  onMiss?: OnMissPolicy;
  /** Raw input field(s) feeding the keys (message-only). */
  keySource?: string;
  /**
   * When set, the named axis interpolates instead of
   * stepping. ABSENT by default: every existing plan is byte-identical.
   * Resolution order: (1) a full discrete match still wins (a
   * pre-binned band id keeps stepping — idempotent, mirrors
   * derive.band); (2) a numeric value on the flagged axis matches the
   * OTHER keys discretely, then interpolates linearly between the
   * matched rows' breakpoints (clamped to the end breakpoints — the
   * tail bands behave exactly as stepping does); (3) anything else is
   * a miss under the authored `onMiss` policy.
   */
  interpolateOn?: MultiLookupInterpolateOn;
}

/**
 * Input: either the legacy single `keys` record (mapping each declared
 * keyName to its value) OR — when wired through the per-key derived
 * ports — one value per keyName, each on its own port. `execute`
 * accepts both: the record wins per-key when present, else the value
 * arrives on `inputs[keyName]`.
 */
export type MultiLookupInputs = {
  keys?: Readonly<Record<string, string | number>>;
  readonly [key: string]: unknown;
};
export type MultiLookupOutputs = { value: number };

/** Gather the positional key tuple (legacy `keys` record wins per-key,
 *  else the per-key derived port). Shared by execute + collectRowIssues. */
function gatherTuple(
  inputs: MultiLookupInputs,
  params: MultiLookupParams,
): readonly unknown[] {
  const rec =
    inputs.keys && typeof inputs.keys === "object"
      ? (inputs.keys as Record<string, unknown>)
      : undefined;
  const bag = inputs as Record<string, unknown>;
  return params.keyNames.map((name) =>
    rec && name in rec ? rec[name] : bag[name],
  );
}

/** First positionally-matching row's factor, else undefined (a miss). */
function matchMultiRow(
  inputs: MultiLookupInputs,
  params: MultiLookupParams,
): number | undefined {
  const inputKeyTuple = gatherTuple(inputs, params);
  for (const row of params.rows) {
    if (row.keys.length !== inputKeyTuple.length) continue;
    let allMatch = true;
    for (let i = 0; i < row.keys.length; i++) {
      const incoming = inputKeyTuple[i];
      // Key equality is STRING equality — row keys are JSON object keys
      // (strings by construction), so a numeric input meaning the same
      // key must match ("1500" ⟂ 1500). `lookup.direct` gets
      // this free from JS object indexing; this kind compared strictly
      // and silently missed. An absent input never matches.
      if (
        incoming === undefined ||
        incoming === null ||
        String(row.keys[i]) !== String(incoming)
      ) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return row.factor;
  }
  return undefined;
}

/** Human form of the composite key for miss messages ("group_c::ded_1000"). */
function describeTuple(
  inputs: MultiLookupInputs,
  params: MultiLookupParams,
): string {
  return gatherTuple(inputs, params)
    .map((k) => (k === undefined || k === null || k === "" ? "∅" : String(k)))
    .join("::");
}

/**
 * Interpolated resolution across the flagged axis. Called
 * only after the full discrete match missed (so a pre-binned band id is
 * byte-identical to the pre-interpolation behavior).
 *
 *   1. The flagged axis's incoming value must coerce to a finite number
 *      (the wire is stringly — "315000" interpolates like 315000);
 *      anything non-numeric is a miss.
 *   2. Rows whose OTHER keys match discretely form the axis's curve:
 *      each row's axis key maps through `breakpoints` to its numeric x
 *      (rows without a breakpoint mapping are invisible to
 *      interpolation); duplicate x (alias-widened rows) keep the first.
 *   3. Linear interpolation between the bracketing points, CLAMPED to
 *      the end breakpoints — beyond the tails the end band's factor
 *      applies, exactly as stepping behaves there. An x exactly on a
 *      breakpoint returns that factor byte-exactly, so every risk
 *      sitting on a breakpoint is unchanged by flagging a table.
 */
function interpolateMultiRow(
  inputs: MultiLookupInputs,
  params: MultiLookupParams,
): number | undefined {
  const spec = params.interpolateOn;
  if (!spec) return undefined;
  const axis = params.keyNames.indexOf(spec.key);
  if (axis < 0) return undefined;

  const tuple = gatherTuple(inputs, params);
  const x = toFiniteNumber(tuple[axis]);
  if (Number.isNaN(x)) return undefined;

  const points: InterpolatePoint[] = [];
  const seenX = new Set<number>();
  for (const row of params.rows) {
    if (row.keys.length !== tuple.length) continue;
    let othersMatch = true;
    for (let i = 0; i < row.keys.length; i++) {
      if (i === axis) continue;
      const incoming = tuple[i];
      if (
        incoming === undefined ||
        incoming === null ||
        String(row.keys[i]) !== String(incoming)
      ) {
        othersMatch = false;
        break;
      }
    }
    if (!othersMatch) continue;
    const bx = spec.breakpoints[String(row.keys[axis])];
    if (typeof bx !== "number" || !Number.isFinite(bx)) continue;
    if (seenX.has(bx)) continue; // alias-widened duplicate of the same band
    seenX.add(bx);
    points.push({ x: bx, y: row.factor });
  }
  if (points.length === 0) return undefined;
  points.sort((a, b) => a.x - b.x);
  const y = interpolateLinear(x, points, true);
  return Number.isFinite(y) ? y : undefined;
}

/** Full resolution: discrete first (idempotent), then interpolation. */
function resolveMulti(
  inputs: MultiLookupInputs,
  params: MultiLookupParams,
): number | undefined {
  const discrete = matchMultiRow(inputs, params);
  if (discrete !== undefined) return discrete;
  return interpolateMultiRow(inputs, params);
}

export const MultiLookupKind: BlockKind<
  MultiLookupParams,
  MultiLookupInputs,
  MultiLookupOutputs
> = {
  id: "lookup.multi",
  category: "lookup",
  label: "Multi-key lookup",
  description: "Composite key → factor (positional match)",
  inputs: [
    {
      name: "keys",
      type: "record",
      description:
        "Record of N key values; field names must match params.keyNames",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "factor",
      description: "The factor for the matching row",
    } as PortSpec,
  ],
  // Derive one input port per declared key. The runtime
  // groups edges by destination port and a single `record` port can
  // only ever carry the first edge's value (runtime gathers
  // `gathered[0]` for non-`N` ports), so N upstream key producers can't
  // assemble a record. Exposing one port per `keyName` lets the
  // projector wire each key producer to its own port; `execute` then
  // reads `inputs[keyName]`. When `keyNames` is empty we keep the
  // legacy single `keys` record port so direct/manual callers are
  // unaffected.
  derivedPorts: (params) =>
    params.keyNames && params.keyNames.length > 0
      ? {
          inputs: params.keyNames.map(
            (name) =>
              ({
                name,
                type: "string",
                description: `Key: ${name}`,
              }) as PortSpec,
          ),
          outputs: [
            {
              name: "value",
              type: "factor",
              description: "The factor for the matching row",
            } as PortSpec,
          ],
        }
      : {
          inputs: [
            {
              name: "keys",
              type: "record",
              description:
                "Record of N key values; field names must match params.keyNames",
            } as PortSpec,
          ],
          outputs: [
            {
              name: "value",
              type: "factor",
              description: "The factor for the matching row",
            } as PortSpec,
          ],
        },
  defaultParams: {
    keyNames: [],
    rows: [],
    defaultValue: 1.0,
  },
  defaultSize: "large",
  provenance: "core",
  certainty: "draft",
  determinism: "strict",
  sideEffects: "none",
  execute: (inputs, params) => {
    const matched = resolveMulti(inputs, params);
    if (matched !== undefined) return { value: matched };
    return {
      value: resolveLookupMiss(params.onMiss, params.defaultValue, {
        key: describeTuple(inputs, params),
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
    if (resolveMulti(inputs, params) !== undefined) return undefined;
    const seed = lookupMissSeed(params.onMiss, params.defaultValue, {
      key: describeTuple(inputs, params),
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
    if (params.keyNames.length === 0) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "keyNames must declare at least one key",
            field: "keyNames",
          },
        ],
      };
    }
    for (let i = 0; i < params.rows.length; i++) {
      if (params.rows[i]!.keys.length !== params.keyNames.length) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: `row ${i}: key count (${params.rows[i]!.keys.length}) does not match keyNames length (${params.keyNames.length})`,
              field: "rows",
            },
          ],
        };
      }
    }
    if (params.interpolateOn) {
      const spec = params.interpolateOn;
      if (!params.keyNames.includes(spec.key)) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: `interpolateOn.key \`${spec.key}\` is not one of keyNames`,
              field: "interpolateOn",
            },
          ],
        };
      }
      const bps = Object.values(spec.breakpoints ?? {});
      if (bps.length === 0) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: "interpolateOn.breakpoints must map at least one axis key to a number",
              field: "interpolateOn",
            },
          ],
        };
      }
      if (bps.some((b) => typeof b !== "number" || !Number.isFinite(b))) {
        return {
          valid: false,
          issues: [
            {
              severity: "error",
              message: "interpolateOn.breakpoints values must all be finite numbers",
              field: "interpolateOn",
            },
          ],
        };
      }
    }
    if (params.rows.length === 0) {
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message: "No rows; every lookup returns defaultValue",
            field: "rows",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
};
