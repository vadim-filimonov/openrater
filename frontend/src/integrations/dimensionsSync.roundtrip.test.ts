/**
 * Brief 66 §3.2 — the round-trip property test that kills the
 * Brief-60 clobber CLASS, not another instance of it.
 *
 * History: this adapter pair silently dropped geo_territories
 * (Brief 44), class_library_id + derived_from (Brief 51/60),
 * source_field (Brief 60 follow-up), and until migration 025,
 * classification_mapping + options — FIVE separate incidents of the
 * same bug, each found in production behavior and patched one field
 * at a time.
 *
 * The structural fix: the fixture below is typed `Required<...>` over
 * DimensionRow's persistable fields — when DimensionRow grows a field,
 * this file STOPS COMPILING until the author either carries the field
 * through both adapters (and the backend) or adds it to the documented
 * drop list. Silent drops become loud build failures.
 */

import { describe, expect, it } from "vitest";
import type { PlanDimension } from "@openrater/api-client";
import type { DimensionRow } from "@openrater/ui";
import {
  dimensionRowToUpsertRequest,
  planDimensionToRow,
} from "./dimensionsSync";

/**
 * Fields that deliberately do NOT round-trip. Each entry needs a
 * reason — this list is the only escape hatch from the compile guard.
 */
const DELIBERATE_DROPS: ReadonlySet<keyof DimensionRow> = new Set([
  // Brief 44 deprecated it in favor of geo_granularity/geo_scope/
  // geo_territories; kept readable on the row for legacy fixtures only.
  "territory_schema_id",
] as const);

/**
 * Every persistable DimensionRow field, populated. `Required<...>`
 * makes a future DimensionRow field a COMPILE ERROR here until it is
 * carried through the adapters or added to DELIBERATE_DROPS.
 */
const FULL_ROW: Required<DimensionRow> = {
  id: "class_code",
  display_name: "Class code",
  slug: "class_code",
  source_field: "class_code_raw",
  data_type: "string",
  role: "rating-input",
  description: "The ISO class code this risk rates under.",
  dimension_type: "classification",
  class_library_id: "sample_bop_2026",
  classification_mapping: [
    {
      input_pattern: "REST*",
      canonical_class_code: "09331",
      notes: "restaurants roll to 09331",
    },
    { input_pattern: "OFF*", canonical_class_code: "63631" },
  ],
  territory_schema_id: "legacy_schema_1",
  geo_granularity: "zip",
  geo_scope: { kind: "subset", states: ["KS", "MO"] },
  geo_territories: [
    { id: "t701", label: "Metro", members: ["66101", "66102"] },
  ],
  options: ["frame", "masonry", "fire_resistive"],
  shape: "categorical",
  levels: [
    { kind: "categorical", id: "frame", label: "Frame", aliases: ["wood"] },
    { kind: "banded", id: "b1", label: "Low", lo: 0, hi: 100 },
  ],
  axes: ["construction", "coverage"],
  derived_from: { source_dim: "class_code", attribute: "rate_number" },
  // The guard's FIRST catch: this field was carried by NOTHING until
  // the Required<> fixture refused to compile without it (Brief 66).
  monotonicity_expected: "increasing",
};

/** Simulate the backend echo: the request lands in the table and is
 *  read back as a PlanDimension (storage adds lifecycle columns). */
function echoThroughApi(
  req: ReturnType<typeof dimensionRowToUpsertRequest>,
): PlanDimension {
  return {
    ...req,
    rating_plan_id: "plan_test",
    created_at: "2026-06-10T00:00:00Z",
    updated_at: "2026-06-10T00:00:00Z",
    content_hash: "abc123",
  } as unknown as PlanDimension;
}

describe("dimensionsSync round-trip (Brief 66 §3.2)", () => {
  it("every persistable DimensionRow field survives row → upsert → API → row", () => {
    const req = dimensionRowToUpsertRequest(FULL_ROW);
    const back = planDimensionToRow(echoThroughApi(req));

    const lost: string[] = [];
    for (const key of Object.keys(FULL_ROW) as (keyof DimensionRow)[]) {
      if (DELIBERATE_DROPS.has(key)) continue;
      const sent = FULL_ROW[key];
      const got = (back as unknown as Record<string, unknown>)[key as string];
      if (JSON.stringify(got) !== JSON.stringify(sent)) {
        lost.push(
          `${String(key)}: sent ${JSON.stringify(sent)} got ${JSON.stringify(got)}`,
        );
      }
    }
    expect(lost, `fields lost in the round-trip:\n  ${lost.join("\n  ")}`).toEqual(
      [],
    );
  });

  it("the deliberate drop list is exactly the deprecated field", () => {
    const req = dimensionRowToUpsertRequest(FULL_ROW);
    expect(
      (req as Record<string, unknown>)["territory_schema_id"],
    ).toBeUndefined();
  });

  it("the new fields reach the wire shape (migration 025)", () => {
    const req = dimensionRowToUpsertRequest(FULL_ROW) as Record<
      string,
      unknown
    >;
    expect(req.classification_mapping).toEqual(FULL_ROW.classification_mapping);
    expect(req.options).toEqual(FULL_ROW.options);
  });
});
