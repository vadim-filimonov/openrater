/**
 * `derive.territory` kind — resolve a raw geographic value (a state
 * code, FIPS code, ZIP, …) into a geographic dim's TERRITORY id.
 *
 * The bridge between raw geographic inputs (e.g., `state = "CA"`) and
 * the territory grouping ids (e.g., `T1`) that a territory-keyed
 * `lookup.direct` factor table keys on.
 *
 * Per ADR-0028 — the value→territory map lives ONLY on the dim's
 * `geo_territories` grouping (single source of truth). This kind takes
 * a snapshot of that map at projection time + does the lookup. It is
 * the geographic analogue of `derive.band` (ADR-0026): same
 * projector-inserts-a-derive-node pattern, same persistence boundary
 * (runtime/projector-generated only — never persisted to the Plan
 * substrate, the backend Pydantic configs, or the persisted-plan zod).
 *
 * Without this kind, the projector fed a geographic dim's RAW value
 * (`"CA"`) straight into `lookup.direct`, which (when the table is
 * keyed by territory) missed every row and silently returned the 1.0
 * default — cold-test finding L13. Now the value resolves THROUGH the
 * territory grouping, so a 5-row T1–T5 table prices `CA` by its tier.
 *
 * Per node-design-principle P-N1 (pure execute): no side effects, no
 * I/O, no state. Same `(value, territoryMap)` → same `territory_id`
 * forever.
 *
 * Per P-N4 + P-N5: the trace records the resolved territory id (+
 * label when supplied); `explainStep` renders a citation-friendly
 * line:
 *
 *   "state = CA → T1 (Tier 1 — high-cost coastal)"
 *
 * Per the Phase D "visible data flow" principle (P-N11 — proposed):
 * territory resolution is its own visible runtime step. The auditor
 * sees raw value → territory → factor as three traceable lines, not
 * one collapsed lookup.
 */

import type { BlockKind, PortSpec } from "../block-types";

export interface DeriveTerritoryParams {
  /**
   * The geographic dim's slug. Audit-facing — appears in the trace as
   * "<dimSlug> = <value> → <territory_id> (<label>)". Doesn't affect
   * lookup behavior; supply the empty string if you don't have a slug
   * at projection time (the explain just reads "value =" then).
   */
  readonly dimSlug: string;
  /**
   * Snapshot of the value→territory map. Per ADR-0028 the projector
   * builds this from `dim.geo_territories` at compile time (each
   * territory's `members[]` level ids each map to that territory's
   * `id`) so the runtime doesn't need to look the dim up. Edits to the
   * dim require a re-projection — the same contract as `lookup.direct`'s
   * embedded `table` and `derive.band`'s embedded `levels`.
   *
   * Keys are compared case-insensitively + trimmed (see `execute`), so
   * the map can be built from canonical level ids ("CA") and still
   * resolve a row that arrives as "ca" / " CA ".
   */
  readonly territoryMap: Readonly<Record<string, string>>;
  /**
   * Optional human labels for territory ids — trace/explain only.
   * Lets the audit line read "→ T1 (Tier 1 — high-cost coastal)"
   * instead of just "→ T1". Built by the projector from
   * `geo_territories[].label`. Never affects resolution.
   */
  readonly territoryLabels?: Readonly<Record<string, string>>;
  /**
   * Optional fallback territory id when the value maps to no territory.
   * When unset, those cases return the empty string — which then
   * propagates to `lookup.direct` and falls back to its `defaultValue`.
   * Useful for plans that carry an explicit "all other states"
   * territory (the analogue of `derive.band`'s `outOfRangeLevelId`).
   *
   * NOTE: unlike `derive.band` there is no "clamp to nearest" option —
   * territories are an UNORDERED set, so "nearest" is undefined. The
   * `unmapped` output (below) is the diagnostic surface instead.
   */
  readonly unmappedTerritoryId?: string;
}

export type DeriveTerritoryInputs = { value: string };
/**
 * `territory_id` — the resolved (or fallback) territory id.
 * `unmapped` — true when the raw value mapped to no territory. Mirrors
 * `derive.band`'s `out_of_range`: diagnostic only, left unwired by the
 * projector but surfaced in the run trace so a score-time UI can count
 * unmapped rows per geographic dim (no silent 1.0). [L13 + the L22
 * surfacing principle.]
 */
export type DeriveTerritoryOutputs = {
  territory_id: string;
  unmapped: boolean;
};

export const DeriveTerritoryKind: BlockKind<
  DeriveTerritoryParams,
  DeriveTerritoryInputs,
  DeriveTerritoryOutputs
> = {
  id: "derive.territory",
  category: "lookup",
  label: "Territory grouping",
  description:
    "Resolve a raw geographic value into a dim's territory id ('CA' → 'T1')",
  inputs: [
    {
      name: "value",
      type: "string",
      description: "The raw geographic value (state code, FIPS, ZIP, …)",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "territory_id",
      type: "string",
      description: "The matching territory's id (or fallback id)",
    } as PortSpec,
    {
      name: "unmapped",
      type: "bool",
      description: "True when the raw value mapped to no territory",
    } as PortSpec,
  ],
  defaultParams: { dimSlug: "", territoryMap: {} },
  defaultSize: "compact",
  execute: (inputs, params) => {
    // The wire type is `string`, but `externalInputs` are `unknown` —
    // a CSV cell or webhook field may arrive as a number/other. Defend
    // all forms so resolution works regardless of how the value
    // reached us:
    //
    //   1. Already a territory id → pass through (idempotent). Lets a
    //      pre-resolved column (or a redundant client-side resolve)
    //      coexist with this runtime step without double-mapping to "".
    //   2. A mapped raw value (case-insensitive, trimmed) → its id.
    //   3. anything else (empty, unknown state) → unmapped fallback.
    const raw = inputs.value as unknown;
    const str = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    const needle = str.trim().toLowerCase();

    if (needle === "") {
      return {
        territory_id: params.unmappedTerritoryId ?? "",
        unmapped: true,
      };
    }

    // 1. Idempotent pass-through: the value IS already a territory id.
    //    Compare case-insensitively against the territory id set (the
    //    map's VALUES), so a re-projected / pre-resolved "T1" survives.
    for (const territoryId of Object.values(params.territoryMap)) {
      if (territoryId.trim().toLowerCase() === needle) {
        return { territory_id: territoryId, unmapped: false };
      }
    }

    // 2. Map a raw level id (state code) → territory id. Keys are
    //    compared case-insensitively + trimmed so "ca" / " CA " resolve
    //    the same as the canonical "CA".
    for (const [levelId, territoryId] of Object.entries(params.territoryMap)) {
      if (levelId.trim().toLowerCase() === needle) {
        return { territory_id: territoryId, unmapped: false };
      }
    }

    // 3. No territory claims this value.
    return { territory_id: params.unmappedTerritoryId ?? "", unmapped: true };
  },
  validate: (params) => {
    if (Object.keys(params.territoryMap).length === 0) {
      // An empty map is valid at the kind level (the dim may have no
      // territories yet, or the editor is mid-author), but the engine
      // will always return the fallback. Surface as a warning, not an
      // error — matches `derive.band` + `lookup.direct`.
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message:
              "No territory groupings set; every value resolves to fallback",
            field: "territoryMap",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
  explainStep: (inputs, params, outputs) => {
    const slug = params.dimSlug || "value";
    if (!outputs.unmapped) {
      const label = params.territoryLabels?.[outputs.territory_id];
      const suffix = label ? ` (${label})` : "";
      return `${slug} = ${inputs.value} → ${outputs.territory_id}${suffix}`;
    }
    return `${slug} = ${inputs.value} → unmapped`;
  },
  // ADR-0056 — an unmapped value is a structured (warning) issue, not
  // just a trace flag. The CONSUMING lookup's onMiss policy governs
  // the row's fate (the unresolved territory id misses its table
  // there); this enricher names the root cause so the ledger shows
  // "ZIP 66049 mapped to no territory", not "key `` not found".
  collectRowIssues: (inputs, params, outputs) => {
    if (!outputs.unmapped) return undefined;
    const slug = params.dimSlug || "value";
    return [
      {
        severity: "warning",
        code: "territory_unmapped",
        message: `\`${slug}\` value \`${String(inputs.value)}\` maps to no territory; the consuming lookup's unknown-key policy decides the outcome.`,
        detail: {
          key: String(inputs.value),
          ...(params.dimSlug ? { field: params.dimSlug } : {}),
        },
      },
    ];
  },
};
