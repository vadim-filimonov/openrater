/**
 * CANONICAL_COVERAGE_DIMENSION — the seeded "coverage" structural axis
 * (Brief 53).
 *
 * Property factor tables in ISO BOP are 2-D `risk-input × coverage`
 * (e.g. base_lc_property = territory × coverage). The second axis is
 * always Building vs BPP. Rather than make the actuary hand-author that
 * dimension before every 2-D table, the Parametrize column slot offers a
 * one-click "+ Coverage split" that drops THIS canonical dim onto the
 * column axis.
 *
 * It is a STRUCTURAL dimension (ADR-0025): it indexes the rating
 * algorithm (which coverage tower) and is never asked of the risk —
 * which is exactly why the engine can treat the tower's coverage level
 * as a compile-time constant and slice the 2-D table to that column
 * (ADR-0039). The slug + levels match the Sample BOP filing
 * (Rule 23.C.6.a / BP-RF-3).
 *
 * Lives in a neutral top-level module (like `keying.ts`) so both
 * `<FactorTableNode>` (the affordance) and `<ParametrizeCanvas>` (the
 * draft-axes handler) import it without a cycle.
 */

import type { DimensionRow } from "./DimensionsTable";

/** The stable slug of the canonical coverage dimension. */
export const CANONICAL_COVERAGE_SLUG = "coverage";

/**
 * The canonical Building / BPP coverage structural dimension. Building
 * and BPP are the property-coverage minimum; an actuary rating liability
 * towers adds BI / GL levels in the dimension editor.
 */
export const CANONICAL_COVERAGE_DIMENSION: DimensionRow = {
  id: CANONICAL_COVERAGE_SLUG,
  slug: CANONICAL_COVERAGE_SLUG,
  display_name: "Coverage",
  data_type: "string",
  role: "structural",
  dimension_type: "standard",
  shape: "categorical",
  description:
    "Coverage rating axis — Building vs BPP — for 2-D property relativity tables (ISO BOP Rule 23.C.6.a). Structural: it indexes the algorithm, never asked of the risk.",
  levels: [
    { kind: "categorical", id: "building", label: "Building" },
    { kind: "categorical", id: "bpp", label: "BPP" },
  ],
};
