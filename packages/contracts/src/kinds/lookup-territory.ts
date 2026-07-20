/**
 * `lookup.territory` kind — (state, ZIP5) → filing-defined factor record.
 *
 * Per Plan Format Spec v1 §4.5 + §6.5: takes a 2-letter state code
 * and a 5-digit ZIP, finds the Territory whose `state_code` matches
 * AND whose `zips` list contains the ZIP, returns that territory's
 * numeric factor record.
 *
 * Territories are snapshotted into `params.territories` at publish
 * time (per ADR-0015 invariant 3 — vendor data frozen into the plan).
 * A caller-defined fallback Territory supplies the factors when no
 * match resolves. The generic default id is the fictional Meridian
 * reference program's `t0`; plans should set their own filed code.
 */

import type { BlockKind, PortSpec } from "../block-types";

/**
 * Filing-defined numeric factors for one territory. Key names are plan
 * data; the platform does not prescribe a line of business or coverage set.
 */
export type TerritoryRates = Readonly<Record<string, number>>;

export interface SnapshottedTerritory {
  /** Stable territory id (slug). */
  territory_id: string;
  /** Filing-defined territory code. */
  territory_code: string;
  /** Two-letter state code. */
  state_code: string;
  /** ZIP5 strings, ascending in canonical form. */
  zips: readonly string[];
  /** The territory's filing-defined numeric factors. */
  base_rates: TerritoryRates;
}

export interface TerritoryLookupParams {
  /** Snapshotted Territory entities the plan rates against. */
  territories: readonly SnapshottedTerritory[];
  /** Fallback rates when no (state, zip5) match resolves. */
  fallbackRates: TerritoryRates;
  /** Fallback territory_code reported when fallback fires. */
  fallbackCode?: string;
  /** Citation reference. */
  citation?: string;
}

export type TerritoryLookupInputs = { state: string; zip5: string };
export type TerritoryLookupOutputs = {
  territory_code: string;
  rates: TerritoryRates;
};

const EMPTY_RATES: TerritoryRates = Object.freeze({});

export const TerritoryLookupKind: BlockKind<
  TerritoryLookupParams,
  TerritoryLookupInputs,
  TerritoryLookupOutputs
> = {
  id: "lookup.territory",
  category: "lookup",
  label: "Territory lookup",
  description: "(state, ZIP5) → filing-defined factor record",
  inputs: [
    {
      name: "state",
      type: "string",
      description: "Two-letter state code",
    } as PortSpec,
    {
      name: "zip5",
      type: "string",
      description: "5-digit ZIP code",
    } as PortSpec,
  ],
  outputs: [
    {
      name: "territory_code",
      type: "string",
      description: "The resolved territory code",
    } as PortSpec,
    {
      name: "rates",
      type: "record",
      description: "The territory's filing-defined numeric factors",
    } as PortSpec,
  ],
  defaultParams: {
    territories: [],
    fallbackRates: EMPTY_RATES,
    fallbackCode: "t0",
  },
  defaultSize: "large",
  provenance: "core",
  certainty: "draft",
  determinism: "strict",
  sideEffects: "none",
  execute: (inputs, params) => {
    const state = inputs.state?.toUpperCase();
    const zip5 = inputs.zip5;
    for (const territory of params.territories) {
      if (territory.state_code.toUpperCase() !== state) continue;
      if (territory.zips.includes(zip5)) {
        return {
          territory_code: territory.territory_code,
          rates: territory.base_rates,
        };
      }
    }
    return {
      territory_code: params.fallbackCode ?? "t0",
      rates: params.fallbackRates,
    };
  },
  validate: (params) => {
    if (!params.fallbackRates) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "fallbackRates is required",
            field: "fallbackRates",
          },
        ],
      };
    }
    if (params.territories.length === 0) {
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message:
              "No territories snapshotted; every lookup returns the fallback",
            field: "territories",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
};
