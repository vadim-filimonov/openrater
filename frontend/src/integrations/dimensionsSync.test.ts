import { describe, it, expect } from "vitest";
import type { PlanDimension } from "@openrater/api-client";
import {
  dimensionRowToUpsertRequest,
  dimensionRowsToBulkRequest,
  planDimensionToRow,
} from "./dimensionsSync";

/**
 * Brief 60 — the dimensions-sync adapters MUST round-trip a class-derived
 * structural dim's `derived_from` marker (ADR-0035) and a classification
 * dim's `class_library_id`.
 *
 * The regression they lock: pre-fix, both adapters silently dropped these
 * two fields. So when the Dimensions Workspace hydrated the API dims and
 * re-persisted them via its bulk replace-all, every class-derived dim came
 * back WITHOUT `derived_from`. The `stagesToRuntimePlan` projector keys its
 * `derive.class_attribute` branch off `derived_from`; with the wire gone the
 * branch never fired and `prop_rate_number` (and the whole property leg)
 * silently priced at 1.0. (P-N10 — connection-as-data.)
 */

const TS = "2026-05-31T00:00:00.000Z";

const propRateNumberDim: PlanDimension = {
  rating_plan_id: "meridian_bop_ne_demo",
  dim_id: "prop_rate_number",
  display_name: "Property rate number",
  slug: "prop_rate_number",
  data_type: "string",
  role: "structural",
  dimension_type: "standard",
  shape: "categorical",
  derived_from: { source_dim: "class_code", attribute: "prop_rate_number" },
  levels: [
    { kind: "categorical", id: "07", label: "07", aliases: [] },
    { kind: "categorical", id: "11", label: "11", aliases: [] },
  ],
  created_at: TS,
  updated_at: TS,
};

const classCodeDim: PlanDimension = {
  rating_plan_id: "meridian_bop_ne_demo",
  dim_id: "class_code",
  display_name: "Class code",
  slug: "class_code",
  data_type: "string",
  role: "rating-input",
  dimension_type: "classification",
  shape: "categorical",
  class_library_id: "meridian_bop_ne_demo",
  levels: [
    {
      kind: "categorical",
      id: "c101",
      label: "Meridian Neighborhood Bakery",
      aliases: [],
      attributes: { prop_rate_number: "07" },
    },
  ],
  created_at: TS,
  updated_at: TS,
};

describe("dimensionsSync — derived_from / class_library_id round-trip (Brief 60)", () => {
  it("planDimensionToRow carries derived_from (API → UI)", () => {
    const row = planDimensionToRow(propRateNumberDim);
    expect(row.derived_from).toEqual({
      source_dim: "class_code",
      attribute: "prop_rate_number",
    });
  });

  it("planDimensionToRow carries class_library_id for a classification dim", () => {
    const row = planDimensionToRow(classCodeDim);
    expect(row.class_library_id).toBe("meridian_bop_ne_demo");
  });

  it("dimensionRowToUpsertRequest carries derived_from (UI → API)", () => {
    const req = dimensionRowToUpsertRequest(planDimensionToRow(propRateNumberDim));
    expect(req.derived_from).toEqual({
      source_dim: "class_code",
      attribute: "prop_rate_number",
    });
  });

  it("dimensionRowToUpsertRequest carries class_library_id", () => {
    const req = dimensionRowToUpsertRequest(planDimensionToRow(classCodeDim));
    expect(req.class_library_id).toBe("meridian_bop_ne_demo");
  });

  it("the full bulk round-trip (the workspace's replace-all write path) preserves the wire", () => {
    // PlanDimension (API GET) → DimensionRow (workspace hydration) →
    // bulk UpsertDimensionRequest — the exact path that dropped the wire.
    const rows = [classCodeDim, propRateNumberDim].map(planDimensionToRow);
    const bulk = dimensionRowsToBulkRequest(rows);
    const prn = bulk.dimensions.find((d) => d.slug === "prop_rate_number");
    expect(prn?.derived_from).toEqual({
      source_dim: "class_code",
      attribute: "prop_rate_number",
    });
    const cc = bulk.dimensions.find((d) => d.slug === "class_code");
    expect(cc?.class_library_id).toBe("meridian_bop_ne_demo");
  });

  it("planDimensionToRow backfills lo/hi from min/max on banded levels", () => {
    // The Sample BOP limit/deductible bands were seeded with the editor's
    // min/max vocabulary only (seed_dims.py: {kind:'banded', id, label,
    // min, max}). The engine's derive.band keys on lo/hi; without the
    // backfill every value falls outside every band → the deductible /
    // limit relativity prices at 1.0 (oracle $1,210 → $880).
    const bandedDim: PlanDimension = {
      rating_plan_id: "meridian_bop_ne_demo",
      dim_id: "prop_limit_band",
      display_name: "Total property limit band",
      slug: "prop_limit_band",
      data_type: "number",
      role: "rating-input",
      dimension_type: "standard",
      shape: "banded",
      levels: [
        { kind: "banded", id: "b1_0_250k", label: "0–250k", min: 0, max: 250000 },
        {
          kind: "banded",
          id: "b2_250k_500k",
          label: "250k–500k",
          min: 250000,
          max: 500000,
        },
      ] as unknown as PlanDimension["levels"],
      created_at: TS,
      updated_at: TS,
    };
    const row = planDimensionToRow(bandedDim);
    const lvls = row.levels as unknown as ReadonlyArray<Record<string, unknown>>;
    expect(lvls[0]).toMatchObject({ id: "b1_0_250k", lo: 0, hi: 250000 });
    expect(lvls[1]).toMatchObject({ id: "b2_250k_500k", lo: 250000, hi: 500000 });
    // min/max preserved for the editor vocabulary.
    expect(lvls[0]).toMatchObject({ min: 0, max: 250000 });
  });

  it("planDimensionToRow does NOT clobber an existing lo/hi (lo/hi wins)", () => {
    const bandedDim: PlanDimension = {
      rating_plan_id: "meridian_bop_ne_demo",
      dim_id: "rev_band",
      display_name: "Revenue band",
      slug: "rev_band",
      data_type: "number",
      role: "rating-input",
      dimension_type: "standard",
      shape: "banded",
      levels: [
        // lo/hi already authoritative; min/max stale — lo/hi must win.
        { kind: "banded", id: "r1", label: "<25k", lo: 0, hi: 25000, min: 999, max: 999 },
      ] as unknown as PlanDimension["levels"],
      created_at: TS,
      updated_at: TS,
    };
    const row = planDimensionToRow(bandedDim);
    const lvls = row.levels as unknown as ReadonlyArray<Record<string, unknown>>;
    expect(lvls[0]).toMatchObject({ lo: 0, hi: 25000 });
  });

  it("the bulk replace-all write path re-persists lo/hi (no clobber-back)", () => {
    // The steady-state debounced write must not round-trip a min/max-only
    // level back to the API — otherwise the next API-wins hydration reads it
    // bare again and derive.band re-breaks. Backfill is symmetric.
    const bandedDim: PlanDimension = {
      rating_plan_id: "meridian_bop_ne_demo",
      dim_id: "prop_limit_band",
      display_name: "Total property limit band",
      slug: "prop_limit_band",
      data_type: "number",
      role: "rating-input",
      dimension_type: "standard",
      shape: "banded",
      levels: [
        { kind: "banded", id: "b1", label: "0–250k", min: 0, max: 250000 },
      ] as unknown as PlanDimension["levels"],
      created_at: TS,
      updated_at: TS,
    };
    const bulk = dimensionRowsToBulkRequest([planDimensionToRow(bandedDim)]);
    const dim = bulk.dimensions.find((d) => d.slug === "prop_limit_band");
    const lvls = dim?.levels as unknown as ReadonlyArray<Record<string, unknown>>;
    expect(lvls[0]).toMatchObject({ lo: 0, hi: 250000 });
  });

  it("categorical levels pass through untouched (no spurious lo/hi)", () => {
    const row = planDimensionToRow(classCodeDim);
    const lvls = row.levels as unknown as ReadonlyArray<Record<string, unknown>>;
    expect(lvls[0]).not.toHaveProperty("lo");
    expect(lvls[0]).not.toHaveProperty("hi");
  });

  it("a non-derived dim round-trips with the fields absent (no false positives)", () => {
    const territory: PlanDimension = {
      rating_plan_id: "meridian_bop_ne_demo",
      dim_id: "territory",
      display_name: "Territory",
      slug: "territory",
      data_type: "string",
      role: "rating-input",
      dimension_type: "standard",
      shape: "categorical",
      levels: [],
      created_at: TS,
      updated_at: TS,
    };
    const req = dimensionRowToUpsertRequest(planDimensionToRow(territory));
    expect(req.derived_from).toBeUndefined();
    expect(req.class_library_id).toBeUndefined();
  });
});

describe("dimensionsSync — source_field round-trip (Brief 60 follow-up)", () => {
  // A geographic dim resolves its lookup key (a territory id) FROM a raw
  // submission column declared in `source_field` (territory ← zip). The bulk
  // replace-all write dropped it → the next hydration read a geo dim with no
  // source column → `derive.territory` lost its input.
  const territoryGeoDim: PlanDimension = {
    rating_plan_id: "meridian_bop_ne_demo",
    dim_id: "territory",
    display_name: "Territory",
    slug: "territory",
    data_type: "string",
    role: "rating-input",
    dimension_type: "geographic",
    shape: "geographic",
    source_field: "zip",
    geo_territories: [{ id: "t1", label: "t1", members: ["66101", "66102"] }],
    levels: [],
    created_at: TS,
    updated_at: TS,
  };

  it("planDimensionToRow carries source_field (API → UI)", () => {
    expect(planDimensionToRow(territoryGeoDim).source_field).toBe("zip");
  });

  it("dimensionRowToUpsertRequest carries source_field (UI → API)", () => {
    const req = dimensionRowToUpsertRequest(planDimensionToRow(territoryGeoDim));
    expect(req.source_field).toBe("zip");
  });

  it("the full bulk replace-all write path preserves source_field", () => {
    const bulk = dimensionRowsToBulkRequest(
      [territoryGeoDim].map(planDimensionToRow),
    );
    const terr = bulk.dimensions.find((d) => d.slug === "territory");
    expect(terr?.source_field).toBe("zip");
  });

  it("a dim without source_field round-trips with it absent (no false positive)", () => {
    const req = dimensionRowToUpsertRequest(planDimensionToRow(propRateNumberDim));
    expect(req.source_field).toBeUndefined();
  });
});
