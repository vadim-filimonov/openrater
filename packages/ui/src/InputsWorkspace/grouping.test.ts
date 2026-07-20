/**
 * autoDetectGrouping — policy/location key-column detection (E08 / brief D1).
 */

import { describe, it, expect } from "vitest";
import { autoDetectGrouping, suggestRollupFields } from "./InputsWorkspace";

describe("autoDetectGrouping", () => {
  it("detects policy_id + location_id headers (case / separator insensitive)", () => {
    expect(autoDetectGrouping(["policy_id", "location_id", "building_limit"])).toEqual({
      policy_id_column: "policy_id",
      location_id_column: "location_id",
    });
    expect(autoDetectGrouping(["Policy ID", "Location-Id", "tiv"])).toEqual({
      policy_id_column: "Policy ID",
      location_id_column: "Location-Id",
    });
  });

  it("returns a partial config when only one key column is present", () => {
    expect(autoDetectGrouping(["policy_id", "building_limit"])).toEqual({
      policy_id_column: "policy_id",
    });
  });

  it("returns an empty config when neither column is present", () => {
    expect(autoDetectGrouping(["building_limit", "bpp_limit"])).toEqual({});
  });

  // Brief 80 D-B — detection widened to the common real-world
  // spellings (the E7 book's ACORD-style headers detect now), still
  // exact-token, never fuzzy.
  it("detects the widened real-world spellings (Brief 80 D-B)", () => {
    expect(autoDetectGrouping(["PolicyNumber", "SiteID", "tiv"])).toEqual({
      policy_id_column: "PolicyNumber",
      location_id_column: "SiteID",
    });
    expect(autoDetectGrouping(["pol_id", "loc_id"])).toEqual({
      policy_id_column: "pol_id",
      location_id_column: "loc_id",
    });
    expect(autoDetectGrouping(["account_id", "location_number"])).toEqual({
      policy_id_column: "account_id",
      location_id_column: "location_number",
    });
  });

  it("prefers the canonical policy_id over the widened spellings", () => {
    expect(
      autoDetectGrouping(["account_id", "policy_id", "loc_id", "location_id"]),
    ).toEqual({
      policy_id_column: "policy_id",
      location_id_column: "location_id",
    });
  });

  it("still refuses genuine near-misses (exact-token, never fuzzy)", () => {
    expect(autoDetectGrouping(["loc", "policyholder", "site"])).toEqual({});
    expect(autoDetectGrouping(["my_policy_id_backup"])).toEqual({});
  });
});

describe("suggestRollupFields", () => {
  it("seeds a premium-like + a TIV-like field as sum", () => {
    expect(
      suggestRollupFields(["premium", "tiv", "building_limit", "class_code"]),
    ).toEqual([
      { fieldName: "premium", reducer: "sum" },
      { fieldName: "tiv", reducer: "sum" },
    ]);
  });

  it("matches descriptive names (do_premium, total_insured_value)", () => {
    expect(
      suggestRollupFields(["do_premium", "total_insured_value"]),
    ).toEqual([
      { fieldName: "do_premium", reducer: "sum" },
      { fieldName: "total_insured_value", reducer: "sum" },
    ]);
  });

  it("returns only the fields that exist", () => {
    expect(suggestRollupFields(["premium", "class_code"])).toEqual([
      { fieldName: "premium", reducer: "sum" },
    ]);
    expect(suggestRollupFields(["class_code", "state"])).toEqual([]);
  });
});
