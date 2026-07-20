import { geoLookupKeys, isGeographicLookupDim } from "@openrater/contracts";

import type { DimensionRow } from "./DimensionsTable";

/**
 * The level list a factor table keys on for a given dim — the single keying
 * site for the ParametrizeCanvas materialize/viz axes, the FactorTableNode
 * editor grid, the count pill, and PlanDetailRoute's saved-table
 * re-materialization, so the grid, the chart axis, and the saved cells stay
 * consistent.
 *
 * ADR-0038 — for a GEOGRAPHIC dim this delegates to the canonical
 * `geoLookupKeys` (the one lookup domain the factor grid, the input validator,
 * and the engine projector all share). Per the "territory-when-grouped, else
 * level" model it returns:
 *   • the ACTIVE territory ids (those with ≥1 member) — empty-membership
 *     buckets are filtered out (the pre-ADR-0038 bug surfaced them as rows,
 *     while the projector filtered them — the hidden third disagreement);
 *   • plus any UNGROUPED level ids (the mixed-model tail), so a partially
 *     grouped dim keeps the ungrouped levels rateable instead of dropping
 *     them to the 1.0 default;
 *   • or, when no territory is active, the granular levels themselves (the
 *     V21 "rate directly on the states/ZIPs" behavior).
 *
 * A non-geographic dim keys on its own `levels` regardless of any stray
 * `geo_territories` (the `isGeo` gate). The returned pseudo-levels reuse the
 * `geographic` level kind so the grid + viz treat them like any other level
 * (id + label).
 *
 * Lives in this shared leaf module (rather than ParametrizeCanvas) so both
 * ParametrizeCanvas and FactorTableNode can import it without a circular
 * dependency.
 */
export function levelsForKeying(
  dim: Pick<
    DimensionRow,
    "dimension_type" | "shape" | "levels" | "geo_territories"
  >,
): NonNullable<DimensionRow["levels"]> {
  if (isGeographicLookupDim(dim)) {
    return geoLookupKeys(dim).map((k) => ({
      kind: "geographic" as const,
      id: k.id,
      label: k.label,
    }));
  }
  return dim.levels ?? [];
}
