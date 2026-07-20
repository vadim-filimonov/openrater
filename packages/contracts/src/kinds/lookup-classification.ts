/**
 * `lookup.classification` kind — class code → factor.
 *
 * Per Plan Format Spec v1 §4.5: takes a classification code and returns
 * the filed base-rate factor for that class. Structurally identical to
 * `lookup.direct` (string key → number) but typed with the `class_code`
 * semantic port so the engine + UI can route class-code flows
 * specifically.
 *
 * Distinguishing classification from generic direct lookup lets authoring
 * tools route class-code flows and report class-table dependencies separately.
 */

import type { BlockKind, PortSpec } from "../block-types";
import type { OnMissPolicy } from "../plan-issues";
import { lookupMissSeed, resolveLookupMiss } from "../plan-issues";

export interface ClassificationLookupParams {
  /** The class-code → factor table. */
  table: Readonly<Record<string, number>>;
  /** Factor returned when the class code is not in the table. */
  defaultValue: number;
  /** Human-readable name. */
  tableName?: string;
  /** Citation reference. */
  citation?: string;
  /** ADR-0056 — authored unknown-class disposition (see lookup.direct). */
  onMiss?: OnMissPolicy;
  /** ADR-0056 — raw input field feeding the class code (message-only). */
  keySource?: string;
}

export type ClassificationLookupInputs = { class_code: string };
export type ClassificationLookupOutputs = { value: number };

export const ClassificationLookupKind: BlockKind<
  ClassificationLookupParams,
  ClassificationLookupInputs,
  ClassificationLookupOutputs
> = {
  id: "lookup.classification",
  category: "lookup",
  label: "Class-code lookup",
  description: "Class code → filed base-rate factor",
  inputs: [
    {
      name: "class_code",
      type: "class_code",
      description: "The class code to resolve",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "value",
      type: "factor",
      description: "The filed factor for the class",
    } as PortSpec,
  ],
  defaultParams: {
    table: {},
    defaultValue: 1.0,
  },
  defaultSize: "regular",
  provenance: "core",
  certainty: "draft",
  determinism: "strict",
  sideEffects: "none",
  execute: (inputs, params) => {
    const hit = Object.prototype.hasOwnProperty.call(
      params.table,
      inputs.class_code,
    );
    if (hit) return { value: params.table[inputs.class_code]! };
    return {
      value: resolveLookupMiss(params.onMiss, params.defaultValue, {
        key: inputs.class_code,
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
    if (
      Object.prototype.hasOwnProperty.call(params.table, inputs.class_code)
    ) {
      return undefined;
    }
    const seed = lookupMissSeed(params.onMiss, params.defaultValue, {
      key: inputs.class_code,
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
    if (Object.keys(params.table).length === 0) {
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message:
              "Class table is empty; every lookup returns defaultValue",
            field: "table",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    if (Object.prototype.hasOwnProperty.call(params.table, inputs.class_code)) {
      return `Classified \`${inputs.class_code}\` → ${outputs.value}`;
    }
    return `Class \`${inputs.class_code}\` not in table → ${outputs.value} (default)`;
  },
};
