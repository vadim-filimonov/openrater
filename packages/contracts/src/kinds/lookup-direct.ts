/**
 * `lookup.direct` kind — single string key → single number value.
 *
 * The bread-and-butter brick of insurance pricing. Given a key
 * (class code, construction type, …), return the filed factor.
 *
 * Tables are stored as `Record<string, number>`. v0 supports string
 * keys only; multi-dim lookups use `lookup.multi`.
 */

import type { BlockKind, PortSpec } from "../block-types";
import type { OnMissPolicy } from "../plan-issues";
import { lookupMissSeed, resolveLookupMiss } from "../plan-issues";

export interface DirectLookupParams {
  /** The lookup table — key (string) → value (number). */
  table: Readonly<Record<string, number>>;
  /** Default value when the key is not found. */
  defaultValue: number;
  /** Human-readable name for the table (audit / inspector). */
  tableName?: string;
  /** Citation reference (e.g., "Meridian Rule MS-R5.2"). */
  citation?: string;
  /**
   * ADR-0056 — the authored disposition for a key that doesn't
   * resolve: refuse the row (`error`), apply an authored value
   * (`default`), or rate 1.0 indicative + refer (`refer`). ABSENT ⇒
   * legacy `defaultValue` fallback (raw-engine back-compat); the
   * projector always stamps this on authored factor lookups, with
   * `error` as the authoring default (Law 2).
   */
  onMiss?: OnMissPolicy;
  /**
   * ADR-0056 — the raw input field feeding this lookup's key path
   * (projector-stamped, message-only: lets a miss say WHICH submission
   * field was missing/unresolved instead of "key `undefined`").
   */
  keySource?: string;
}

export type DirectLookupInputs = { key: string };
export type DirectLookupOutputs = { value: number };

export const DirectLookupKind: BlockKind<
  DirectLookupParams,
  DirectLookupInputs,
  DirectLookupOutputs
> = {
  id: "lookup.direct",
  category: "lookup",
  label: "Direct lookup",
  description: "Single key → single value table",
  inputs: [
    { name: "key", type: "string", description: "The lookup key" } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "factor",
      description: "The looked-up value",
    } as PortSpec,
  ],
  defaultParams: {
    table: {},
    defaultValue: 1.0,
  },
  defaultSize: "regular",
  execute: (inputs, params) => {
    const hit = Object.prototype.hasOwnProperty.call(params.table, inputs.key);
    if (hit) return { value: params.table[inputs.key]! };
    // Miss — resolve per the authored policy (throws RowIssueError on
    // mode "error"); absent policy keeps the legacy default fallback.
    return {
      value: resolveLookupMiss(params.onMiss, params.defaultValue, {
        key: inputs.key,
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
    if (Object.prototype.hasOwnProperty.call(params.table, inputs.key)) {
      return undefined;
    }
    const seed = lookupMissSeed(params.onMiss, params.defaultValue, {
      key: inputs.key,
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
            message: "Default value must be a number",
            field: "defaultValue",
          },
        ],
      };
    }
    if (Object.keys(params.table).length === 0) {
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message: "Table is empty; all lookups will return default",
            field: "table",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    const tableName = params.tableName ? `${params.tableName}: ` : "";
    if (Object.prototype.hasOwnProperty.call(params.table, inputs.key)) {
      return `${tableName}Looked up \`${inputs.key}\` → ${outputs.value}`;
    }
    return `${tableName}\`${inputs.key}\` not in table → ${outputs.value} (default)`;
  },
};
