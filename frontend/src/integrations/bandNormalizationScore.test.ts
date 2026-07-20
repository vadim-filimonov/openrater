/**
 * Production-path band-normalization regression using fictional Meridian data.
 *
 * The regression begins with banded dimensions using the editor's `min`/`max`
 * vocabulary. The engine's `derive.band` / `resolveBandedLevel` key
 * ONLY on `lo`/`hi`. The backend stores `levels` as an opaque JSON blob, so a
 * min/max-only level round-trips through the production `planDimensionToRow`
 * verbatim → the projector snapshots `lo:undefined, hi:undefined` into the
 * `derive.band` node → `value >= undefined && value < undefined` is `false`
 * for every band → EVERY row falls outside every band → the bound relativity
 * (here the property-deductible) misses its 2-D cell and resolves to the
 * lookup's neutral 1.0 → mis-priced premium.
 *
 * This test exercises the ACTUAL production path the live Score-all runs:
 *
 *   raw CSV row
 *     → projectRowsToExternalInputs(row, column_map)        [@openrater/ui, pure]
 *     → stagesToRuntimePlan(stages, dims.map(planDimensionToRow), …)
 *                                                            [production adapter]
 *     → executePlanBatch(plan, inputs)                       [the engine]
 *
 * on a synthetic property-deductible leg — the dual-input lookup.multi
 * (`prop_limit_band` = building_limit + bpp_limit, computed-sum → derive.band)
 * × `property_deductible`, with invented cells + a min/max-only
 * `prop_limit_band` dim. It asserts the deductible relativity resolves to the
 * authored banded cell (NOT the neutral 1.0) for the three oracle locations.
 *
 * RED before the `normalizeBandedLevels` backfill in `planDimensionToRow`
 * (every band out-of-range → deductible factor 1.0); GREEN after. The
 * deterministic adapter unit tests live in `dimensionsSync.test.ts`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  registerBuiltinKinds,
  compilePlan,
  runPlan,
  type Plan,
  type Dimension,
} from "@openrater/contracts";
import {
  stagesToRuntimePlan,
  projectRowsToExternalInputs,
  type FactorTableCellsMap,
} from "@openrater/ui";
import type { PlanDimension, PlanFactorTable } from "@openrater/api-client";
import { planDimensionToRow } from "./dimensionsSync";
import {
  planFactorTableToRow,
  planFactorTablesToCellMap,
} from "./factorTablesSync";

const TS = "2026-06-04T00:00:00.000Z";

// ── Fictional Meridian property-deductible substrate ──
// property_deductible 2-D table: keys "<deductible>::<prop_limit_band>".
const PBANDS = ["band_1", "band_2", "band_3", "band_4", "band_5"];
const DEDV: Record<string, readonly number[]> = {
  ded_low: [1.02, 1.01, 1.0, 0.99, 0.98],
  ded_standard: [0.94, 0.92, 0.9, 0.88, 0.86],
  ded_high: [0.82, 0.8, 0.78, 0.76, 0.74],
};

function deductibleCells(): Record<string, number> {
  const cells: Record<string, number> = {};
  for (const [ded, vals] of Object.entries(DEDV)) {
    for (let i = 0; i < PBANDS.length; i++) {
      // Brief 80.3 — cell keys follow the table's DECLARED
      // key_dimensions order ([property_deductible, prop_limit_band]
      // → `deductible::band`), the shape the live KS plan persists.
      // The old fixture keyed `band::deductible` to satisfy the
      // projector's then map-order dependence — the exact fragility
      // 80.3 removed (the 2-D axis order is a catalog contract now,
      // immune to sort_keys JSON round-trips).
      cells[`${ded}::${PBANDS[i]}`] = vals[i]!;
    }
  }
  return cells;
}

// prop_limit_band banded dim — authored with the editor's min/max vocabulary
// ONLY (the persistence shape covered by this regression).
const PROP_LIMIT_BAND_DIM: PlanDimension = {
  rating_plan_id: "meridian_band_demo",
  dim_id: "prop_limit_band",
  display_name: "Total property limit band",
  slug: "prop_limit_band",
  data_type: "number",
  role: "rating-input",
  dimension_type: "standard",
  shape: "banded",
  levels: [
    { kind: "banded", id: "band_1", label: "Band 1", min: 0, max: 50000 },
    { kind: "banded", id: "band_2", label: "Band 2", min: 50000, max: 250000 },
    { kind: "banded", id: "band_3", label: "Band 3", min: 250000, max: 500000 },
    { kind: "banded", id: "band_4", label: "Band 4", min: 500000, max: 1000000 },
    { kind: "banded", id: "band_5", label: "Band 5", min: 1000000, max: 999999999 },
  ] as unknown as PlanDimension["levels"],
  created_at: TS,
  updated_at: TS,
};

const PROPERTY_DEDUCTIBLE_DIM: PlanDimension = {
  rating_plan_id: "meridian_band_demo",
  dim_id: "property_deductible",
  display_name: "Property deductible",
  slug: "property_deductible",
  data_type: "string",
  role: "rating-input",
  dimension_type: "standard",
  shape: "categorical",
  levels: [
    { kind: "categorical", id: "ded_low", label: "Low deductible", aliases: [] },
    { kind: "categorical", id: "ded_standard", label: "Standard deductible", aliases: [] },
    { kind: "categorical", id: "ded_high", label: "High deductible", aliases: [] },
  ] as unknown as PlanDimension["levels"],
  created_at: TS,
  updated_at: TS,
};

// Two raw inputs the deductible leg reads — building_limit + bpp_limit (summed
// in-plan) + property_deductible. The chain.add fields are the bare field
// names used by the computed-sum binding.
const BUILDING_LIMIT_DIM: PlanDimension = {
  rating_plan_id: "meridian_band_demo",
  dim_id: "building_limit",
  display_name: "Building limit",
  slug: "building_limit",
  data_type: "number",
  role: "rating-input",
  dimension_type: "standard",
  shape: "categorical",
  levels: [] as unknown as PlanDimension["levels"],
  created_at: TS,
  updated_at: TS,
};
const BPP_LIMIT_DIM: PlanDimension = {
  ...BUILDING_LIMIT_DIM,
  dim_id: "bpp_limit",
  display_name: "BPP limit",
  slug: "bpp_limit",
};

// The property-deductible factor table — 2-D, key axes [property_deductible,
// prop_limit_band]. Cell key "<deductible>::<prop_limit_band>" matches the
// DECLARED axis order — the contract the projector keys lookup.multi by
// (Brief 80.3), regardless of the chain's dimensions-map JSON key order.
const DEDUCTIBLE_FT: PlanFactorTable = {
  rating_plan_id: "meridian_band_demo",
  table_id: "property_deductible",
  display_name: "Property deductible",
  slug: "property_deductible",
  key_dimensions: ["property_deductible", "prop_limit_band"],
  cells: deductibleCells(),
  created_at: TS,
  updated_at: TS,
} as unknown as PlanFactorTable;

/**
 * A single-chain plan whose ONLY factor is the property-deductible dual-input
 * lookup — base 1 × deductible-relativity, no LCM, no exposure. Output =
 * the resolved deductible factor, so we can read it back directly. The
 * `prop_limit_band` axis is a computed-sum (building_limit + bpp_limit) →
 * derive.band; `property_deductible` is a form_input. This is the exact
 * binding shape persisted by the production adapter.
 */
const STAGES = [
  {
    stage_id: "multiplicative_chain_main",
    stage_kind: "multiplicative_chain",
    sequence: 0,
    config_json: {
      chains: [
        {
          name: "Deductible",
          base_value: 1.0,
          base_input: "literal.base_value",
          factor_lookups: [
            {
              name: "Deductible rel",
              factor_kind: "property_deductible",
              lookup_method: "direct",
              description_template: "Deductible rel: {value}",
              dimensions: {
                prop_limit_band: {
                  source: "computed",
                  op: "sum",
                  fields: ["building_limit", "bpp_limit"],
                },
                property_deductible: {
                  source: "form_input",
                  path: "property_deductible",
                },
              },
            },
          ],
        },
      ],
    },
  },
] as unknown as Parameters<typeof stagesToRuntimePlan>[0];

// The three oracle locations' raw submission columns (policies.csv).
// Expected deductible factor = DEDV[deductible][band index] for sum =
// building_limit + bpp_limit.
const ROWS = [
  // M-01: 800000 + 50000 = 850000 → band_4; ded_standard → 0.88
  { id: "M-01", building_limit: "800000", bpp_limit: "50000", property_deductible: "ded_standard", expected: 0.88 },
  // M-02: 150000 + 60000 = 210000 → band_2; ded_standard → 0.92
  { id: "M-02", building_limit: "150000", bpp_limit: "60000", property_deductible: "ded_standard", expected: 0.92 },
  // M-03: 200000 + 60000 = 260000 → band_3; ded_standard → 0.90
  { id: "M-03", building_limit: "200000", bpp_limit: "60000", property_deductible: "ded_standard", expected: 0.9 },
] as const;

// The column_map the live Inputs workspace builds — raw CSV column → the
// required-input id (each axis path / exposure field, normalized).
const COLUMN_MAP: Readonly<Record<string, string>> = {
  building_limit: "building_limit",
  bpp_limit: "bpp_limit",
  property_deductible: "property_deductible",
};

function buildPlan(): Plan {
  // The EXACT production hop: API dims → planDimensionToRow → projector.
  const dims = [
    PROP_LIMIT_BAND_DIM,
    PROPERTY_DEDUCTIBLE_DIM,
    BUILDING_LIMIT_DIM,
    BPP_LIMIT_DIM,
  ].map(planDimensionToRow) as unknown as Dimension[];
  const fts = [DEDUCTIBLE_FT].map(
    planFactorTableToRow,
  ) as unknown as Parameters<typeof stagesToRuntimePlan>[2];
  const cells: FactorTableCellsMap = planFactorTablesToCellMap([DEDUCTIBLE_FT]);
  return stagesToRuntimePlan(STAGES, dims, fts, cells, {
    planId: "meridian-band-demo-runtime",
  }).plan as unknown as Plan;
}

describe("production-path Meridian deductible band resolves through the adapter", () => {
  beforeAll(() => registerBuiltinKinds());

  it("derive.band bins the computed sum (no row falls outside every band)", () => {
    const plan = buildPlan();
    const inputs = projectRowsToExternalInputs(
      ROWS.map((r) => ({
        building_limit: r.building_limit,
        bpp_limit: r.bpp_limit,
        property_deductible: r.property_deductible,
      })),
      COLUMN_MAP,
    );
    const compiled = compilePlan(plan);
    for (let i = 0; i < ROWS.length; i++) {
      const res = runPlan(compiled, inputs[i]!);
      // Find the derive.band trace entry for prop_limit_band; assert it
      // resolved a real band id + did NOT flag out_of_range.
      const bandEntry = Object.values(res.trace).find(
        (t) =>
          (t as { outputs?: { level_id?: unknown; out_of_range?: unknown } })
            .outputs?.out_of_range !== undefined,
      ) as { outputs?: { level_id?: string; out_of_range?: boolean } } | undefined;
      expect(bandEntry, `band trace for ${ROWS[i]!.id}`).toBeTruthy();
      expect(
        bandEntry?.outputs?.out_of_range,
        `${ROWS[i]!.id} prop_limit_band out_of_range`,
      ).toBe(false);
    }
  });

  for (const r of ROWS) {
    it(`${r.id}: deductible relativity = ${r.expected} (banded cell, not 1.0)`, () => {
      const plan = buildPlan();
      const [inputs] = projectRowsToExternalInputs(
        [
          {
            building_limit: r.building_limit,
            bpp_limit: r.bpp_limit,
            property_deductible: r.property_deductible,
          },
        ],
        COLUMN_MAP,
      );
      const res = runPlan(compilePlan(plan), inputs!);
      // Base 1.0 × deductible relativity → the chain output equals the factor.
      const out = res.outputs as Record<string, number>;
      const premium = Object.values(out).find((v) => typeof v === "number");
      expect(premium, `${r.id} chain output`).toBeCloseTo(r.expected, 6);
      // And it is NOT the neutral default (the out-of-range failure mode).
      expect(premium).not.toBe(1.0);
    });
  }
});
