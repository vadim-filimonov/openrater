/**
 * REAL-PATH band-normalization oracle — the in-app Score-all proof.
 *
 * The labs-ui harnesses (`sampleBopPersistedAsIs.verify.test.ts`) proved the
 * PERSISTED plan + the labs-ui projector score the Sample BOP oracle Δ=0 — but
 * the LIVE rate-lab UI still showed wrong premiums + a persistent
 * "prop_limit_band — N of N rows fell outside every band" clamp. That harness
 * could NOT import the production rate-lab API→projector adapter
 * (`planDimensionToRow`), so it inlined a VERBATIM copy — which masked the one
 * place the real UI diverges.
 *
 * Root cause: the Sample BOP banded dims were seeded with the editor's
 * `min`/`max` level vocabulary (`/tmp/seed_dims.py`: `{kind:'banded', id,
 * label, min, max}`). The engine's `derive.band` / `resolveBandedLevel` key
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
 *     → projectRowsToExternalInputs(row, column_map)        [labs-ui, pure]
 *     → stagesToRuntimePlan(stages, dims.map(planDimensionToRow), …)
 *                                                            [production adapter]
 *     → executePlanBatch(plan, inputs)                       [the engine]
 *
 * on the Sample BOP property-deductible leg — the dual-input lookup.multi
 * (`prop_limit_band` = building_limit + bpp_limit, computed-sum → derive.band)
 * × `property_deductible`, with the EXACT seeded cells + a min/max-only
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

// ── The seeded property-deductible substrate (verbatim from /tmp/seed_*.py) ──
// property_deductible 2-D table: keys "<deductible>::<prop_limit_band>".
const PBANDS = ["up_to_50k", "50k_250k", "250k_500k", "500k_1m", "over_1m"];
const DEDV: Record<string, readonly number[]> = {
  ded_500: [1, 1, 1, 1, 1],
  ded_1000: [0.945, 0.964, 0.974, 0.982, 0.987],
  ded_1500: [0.88, 0.921, 0.943, 0.96, 0.972],
  ded_2500: [0.815, 0.878, 0.912, 0.937, 0.957],
  ded_5000: [0.668, 0.773, 0.835, 0.879, 0.917],
  ded_7500: [0.574, 0.7, 0.778, 0.835, 0.886],
  ded_10000: [0.508, 0.646, 0.735, 0.801, 0.86],
  ded_250: [1.05, 1.05, 1.05, 1.05, 1.05],
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
// ONLY (the seed shape that broke the live UI). Edges mirror the PBANDS labels.
const PROP_LIMIT_BAND_DIM: PlanDimension = {
  rating_plan_id: "bop_ks_band",
  dim_id: "prop_limit_band",
  display_name: "Total property limit band",
  slug: "prop_limit_band",
  data_type: "number",
  role: "rating-input",
  dimension_type: "standard",
  shape: "banded",
  levels: [
    { kind: "banded", id: "up_to_50k", label: "≤ $50k", min: 0, max: 50000 },
    { kind: "banded", id: "50k_250k", label: "$50k–250k", min: 50000, max: 250000 },
    { kind: "banded", id: "250k_500k", label: "$250k–500k", min: 250000, max: 500000 },
    { kind: "banded", id: "500k_1m", label: "$500k–1m", min: 500000, max: 1000000 },
    { kind: "banded", id: "over_1m", label: "> $1m", min: 1000000, max: 999999999 },
  ] as unknown as PlanDimension["levels"],
  created_at: TS,
  updated_at: TS,
};

const PROPERTY_DEDUCTIBLE_DIM: PlanDimension = {
  rating_plan_id: "bop_ks_band",
  dim_id: "property_deductible",
  display_name: "Property deductible",
  slug: "property_deductible",
  data_type: "string",
  role: "rating-input",
  dimension_type: "standard",
  shape: "categorical",
  levels: (
    [250, 500, 1000, 1500, 2500, 5000, 7500, 10000] as const
  ).map((n) => ({ kind: "categorical", id: `ded_${n}`, label: `$${n}`, aliases: [] })) as unknown as PlanDimension["levels"],
  created_at: TS,
  updated_at: TS,
};

// Two raw inputs the deductible leg reads — building_limit + bpp_limit (summed
// in-plan) + property_deductible. The chain.add fields are the bare field
// names (matching /tmp/fix_live_chain.py: fields:["building_limit","bpp_limit"]).
const BUILDING_LIMIT_DIM: PlanDimension = {
  rating_plan_id: "bop_ks_band",
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
  rating_plan_id: "bop_ks_band",
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
 * binding shape /tmp/fix_live_chain.py persisted on the live plan.
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
  // KS-10: 800000 + 50000 = 850000 → 500k_1m (idx 3); ded_1500 → 0.96
  { id: "KS-10", building_limit: "800000", bpp_limit: "50000", property_deductible: "ded_1500", expected: 0.96 },
  // KS-12: 150000 + 60000 = 210000 → 50k_250k (idx 1); ded_1500 → 0.921
  { id: "KS-12", building_limit: "150000", bpp_limit: "60000", property_deductible: "ded_1500", expected: 0.921 },
  // KS-06: 200000 + 60000 = 260000 → 250k_500k (idx 2); ded_1500 → 0.943
  { id: "KS-06", building_limit: "200000", bpp_limit: "60000", property_deductible: "ded_1500", expected: 0.943 },
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
    planId: "bop_ks_band-runtime",
  }).plan as unknown as Plan;
}

describe("REAL-PATH Sample BOP deductible band resolves through the production adapter", () => {
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
