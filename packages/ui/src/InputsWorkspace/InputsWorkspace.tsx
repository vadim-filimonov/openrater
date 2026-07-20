/**
 * InputsWorkspace — shared substrate (Brief 38).
 *
 * The v1 `<InputsWorkspace>` orchestrator COMPONENT was deleted in the
 * v2 cutover (2026-06-09); `<InputsPanelV2>` replaces it. This module
 * now holds only the pure, reused pieces the v2 surface (and the route)
 * still import:
 *   - the substrate TYPES — `PlanInputMapping`, `ProductModeSpec`,
 *     `PolicyGroupingConfig`, `RollupFieldSpec`
 *   - pure HELPERS — `suggestRollupFields`, `autoDetectGrouping`,
 *     `deriveBasicRequiredInputs`, `emptyPlanInputMapping`
 */

import type { Plan, RollupReducer } from "@openrater/contracts";
import type { RequiredInputEntry } from "./ColumnMappingTable";
import type { WebhookConfig } from "./WebhookConfigDrawer";
import type { AliasOverrides } from "./detectMismatches";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/**
 * Multi-product (Brief 35 carry). When set, the workspace renders a
 * top-level tab bar; each product gets its own column_map.
 */
export interface ProductModeSpec {
  readonly dimSlug: string;
  readonly products: readonly {
    readonly id: string;
    readonly label: string;
  }[];
}

/**
 * The narrow substrate shape this orchestrator emits/consumes —
 * mirrors PR 38.1's PlanInputMapping. Defined locally for stack
 * portability; swap to @openrater/contracts once PR 38.1 merges.
 */
export interface PlanInputMapping {
  readonly source:
    | {
        readonly kind: "csv";
        readonly columns: readonly string[];
        readonly sample_rows?: readonly Readonly<Record<string, unknown>>[];
        /**
         * G12 — the row count of the ORIGINAL file at parse time. The parser
         * caps `sample_rows` at `maxSampleRows`; when this exceeds
         * `sample_rows.length` the book was truncated at upload and every
         * surface must say so (the backend stores the envelope opaquely, so
         * this survives the API round-trip and reloads keep the warning).
         */
        readonly totalRowCount?: number;
      }
    // The webhook arm IS WebhookConfig (it carries `kind: "webhook"`). Spelling
    // it inline as `auth?: WebhookConfig["auth"]` widened `auth` to
    // `AuthSpec | undefined` (indexed-access of an optional includes undefined),
    // which broke assignment back to WebhookConfig under exactOptionalPropertyTypes.
    | WebhookConfig;
  readonly column_map: Readonly<Record<string, string>>;
  readonly alias_overrides?: AliasOverrides;
  readonly product_mode?: ProductModeSpec;
  /**
   * E08 / brief D1 — when set, the batch runner groups rows into policies by
   * the named columns + rolls each location up to its policy. Absent ⇒ today's
   * per-row scoring (full back-compat). Carried opaquely in the mapping blob.
   */
  readonly grouping_config?: PolicyGroupingConfig;
  /**
   * E08 / brief D2 — which scored fields roll up to the policy + by which
   * reducer (premium + TIV default to `sum`). Read by `evaluatePolicyBook`.
   * Carried opaquely in the mapping blob.
   */
  readonly rollup_fields?: readonly RollupFieldSpec[];
}

/** The two reserved columns that key the multi-location roll-up (brief D1). */
export interface PolicyGroupingConfig {
  readonly policy_id_column?: string;
  readonly location_id_column?: string;
}

/** One declared roll-up: a scored field + how it reduces to the policy (D2). */
export interface RollupFieldSpec {
  readonly fieldName: string;
  readonly reducer: RollupReducer;
}

/** Suggest the conventional roll-up fields from a candidate list: a
 *  premium-like field + a TIV/limit-like field, both as `sum` (brief D2).
 *  Pure; returns only candidates that actually exist. */
export function suggestRollupFields(
  candidates: readonly string[],
): RollupFieldSpec[] {
  const out: RollupFieldSpec[] = [];
  const premium = candidates.find((c) => /premium/i.test(c));
  const tiv = candidates.find((c) => /\btiv\b|total.*(insured|value)/i.test(c));
  if (premium) out.push({ fieldName: premium, reducer: "sum" });
  if (tiv && tiv !== premium) out.push({ fieldName: tiv, reducer: "sum" });
  return out;
}

/** Auto-detect the policy/location key columns from the CSV headers.
 *  Brief 80 D-B (finding E7) — widened to the common real-world
 *  spellings (a `PolicyNumber` export detects now), but each pattern
 *  stays an exact-token match, never fuzzy: detection failing is
 *  fine (the Policies card's manual pickers are the escape hatch);
 *  detecting the WRONG column is not. Preference order = pattern
 *  order (canonical `policy_id` first). Pure. */
export function autoDetectGrouping(
  columns: readonly string[],
): PolicyGroupingConfig {
  const find = (res: readonly RegExp[]): string | undefined => {
    for (const re of res) {
      const hit = columns.find((c) => re.test(c.trim()));
      if (hit) return hit;
    }
    return undefined;
  };
  const policy = find([
    /^policy[_\s-]?id$/i,
    /^policy[_\s-]?(no|num|number)$/i,
    /^pol[_\s-]?id$/i,
    /^account[_\s-]?id$/i,
  ]);
  const location = find([
    /^location[_\s-]?id$/i,
    /^location[_\s-]?(no|num|number)$/i,
    /^loc[_\s-]?id$/i,
    /^site[_\s-]?id$/i,
  ]);
  return {
    ...(policy ? { policy_id_column: policy } : {}),
    ...(location ? { location_id_column: location } : {}),
  };
}


// ─────────────────────────────────────────────────────────────────
// Optional: hook the consumer uses to build required inputs
// ─────────────────────────────────────────────────────────────────

/**
 * Derive a basic required-inputs list from a Plan's `input` and
 * `output` nodes. The consumer route typically extends this with
 * model param inputs + factor key dimensions.
 *
 * Pure function — exported for tests + consumer routes.
 */
export function deriveBasicRequiredInputs(
  plan: Plan,
): readonly RequiredInputEntry[] {
  const out: RequiredInputEntry[] = [];
  for (const node of plan.nodes) {
    if (node.kind !== "input") continue;
    const params = node.params as { fieldName?: string; fieldType?: string };
    if (!params.fieldName) continue;
    out.push({
      id: params.fieldName,
      name: params.fieldName,
      category: "inputs",
      ...(params.fieldType
        ? { subLabel: params.fieldType }
        : {}),
    });
  }
  return out;
}

/**
 * Re-export: a convenience for consumers that want to receive a
 * "default empty mapping" handle the first time the workspace
 * mounts. The orchestrator handles nulls gracefully, but some
 * consumers prefer seeding state.
 */
export function emptyPlanInputMapping(): PlanInputMapping {
  return {
    source: { kind: "csv", columns: [], sample_rows: [] },
    column_map: {},
  };
}
