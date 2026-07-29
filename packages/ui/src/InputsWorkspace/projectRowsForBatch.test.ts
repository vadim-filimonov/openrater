/**
 * projectRowsForBatch tests — Brief 38 PR 38.6.
 *
 * Covers each axis of the projection independently:
 *   - Column mapping (single + multiple inputs, missing column,
 *     missing row value, empty value treatment)
 *   - Alias override resolution (matches dim slug + bypasses dtype)
 *   - Dtype coercion (number / boolean / date) — happy paths +
 *     failure-with-error path
 *   - Per-input dtype overrides outranking per-column hints
 *   - Whole-row + multi-row projection
 */

import { describe, it, expect } from "vitest";

import {
  projectRow,
  projectRows,
  projectRowsToExternalInputs,
} from "./projectRowsForBatch";
import type { AliasOverrides } from "./detectMismatches";

// ─────────────────────────────────────────────────────────────────
// Column mapping
// ─────────────────────────────────────────────────────────────────

describe("projectRow — column mapping", () => {
  it("maps a single input by columnName", () => {
    const result = projectRow(
      { CLASS_CODE: "09011" },
      { class_code: "CLASS_CODE" },
    );
    expect(result.externalInputs).toEqual({ class_code: "09011" });
    expect(result.errors).toEqual([]);
  });

  it("maps multiple inputs in one pass", () => {
    const result = projectRow(
      { CLASS_CODE: "09011", CONSTR: "Frame", TIV_USD: "1247438" },
      {
        class_code: "CLASS_CODE",
        construction: "CONSTR",
        tiv: "TIV_USD",
      },
    );
    expect(result.externalInputs).toEqual({
      class_code: "09011",
      construction: "Frame",
      tiv: "1247438",
    });
  });

  it("skips inputs whose mapped column is missing from the row", () => {
    const result = projectRow(
      { CLASS_CODE: "09011" },
      { class_code: "CLASS_CODE", construction: "CONSTR" },
    );
    expect(result.externalInputs).toEqual({ class_code: "09011" });
    // construction stays unmapped — no error (the upstream column map
    // is the source of truth; the engine reports missing inputs per
    // node, not here).
    expect(result.errors).toEqual([]);
  });

  it("skips inputs whose column has an empty value", () => {
    const result = projectRow(
      { CLASS_CODE: "", CONSTR: "Frame" },
      { class_code: "CLASS_CODE", construction: "CONSTR" },
    );
    expect(result.externalInputs).toEqual({ construction: "Frame" });
  });

  it("ignores empty-string column names in the map (defensive)", () => {
    const result = projectRow(
      { CLASS_CODE: "09011" },
      { class_code: "" },
    );
    expect(result.externalInputs).toEqual({});
  });

  it("does not include keys for unmapped row columns", () => {
    const result = projectRow(
      { CLASS_CODE: "09011", AGENT_ID: "A001" },
      { class_code: "CLASS_CODE" },
    );
    expect(Object.keys(result.externalInputs)).toEqual(["class_code"]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Alias overrides
// ─────────────────────────────────────────────────────────────────

describe("projectRow — alias overrides", () => {
  const aliasOverrides: AliasOverrides = {
    construction: { WOOD: "frame", BRICK: "masonry" },
  };

  it("substitutes canonical level id when alias_overrides matches", () => {
    const result = projectRow(
      { CONSTR: "WOOD" },
      { construction: "CONSTR" },
      {
        inputDimMap: { construction: "construction" },
        aliasOverrides,
      },
    );
    expect(result.externalInputs).toEqual({ construction: "frame" });
  });

  it("passes raw value through when no alias_overrides match", () => {
    const result = projectRow(
      { CONSTR: "Frame" }, // canonical, not an override
      { construction: "CONSTR" },
      {
        inputDimMap: { construction: "construction" },
        aliasOverrides,
      },
    );
    expect(result.externalInputs).toEqual({ construction: "Frame" });
  });

  it("ignores aliases when the input has no dimSlug binding", () => {
    const result = projectRow(
      { CONSTR: "WOOD" },
      { construction: "CONSTR" },
      {
        inputDimMap: {}, // no binding for construction
        aliasOverrides,
      },
    );
    expect(result.externalInputs).toEqual({ construction: "WOOD" });
  });

  it("ignores alias_overrides for a different dim", () => {
    const result = projectRow(
      { CONSTR: "WOOD" },
      { construction: "CONSTR" },
      {
        inputDimMap: { construction: "construction" },
        aliasOverrides: { protection_class: { foo: "bar" } },
      },
    );
    expect(result.externalInputs).toEqual({ construction: "WOOD" });
  });

  it("bypasses dtype coercion for aliased values (canonical id is correct as-is)", () => {
    const result = projectRow(
      { CONSTR: "WOOD" },
      { construction: "CONSTR" },
      {
        inputDimMap: { construction: "construction" },
        aliasOverrides,
        inputDtypes: { construction: "number" }, // would otherwise coerce
      },
    );
    expect(result.externalInputs).toEqual({ construction: "frame" });
    expect(result.errors).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Derived ratio (@ratio:num/den) — Brief 45 K8
// ─────────────────────────────────────────────────────────────────

describe("projectRow — derived ratio", () => {
  it("computes num/den and projects the resulting number", () => {
    const result = projectRow(
      { total_expenses: "750000", revenue: "1000000" },
      { stress: "@ratio:total_expenses/revenue" },
    );
    expect(result.externalInputs.stress).toBeCloseTo(0.75, 10);
    expect(result.errors).toEqual([]);
  });

  it("strips thousands commas in both components", () => {
    const result = projectRow(
      { occupancy_expense: "150,000", revenue: "1,000,000" },
      { occupancy_intensity: "@ratio:occupancy_expense/revenue" },
    );
    expect(result.externalInputs.occupancy_intensity).toBeCloseTo(0.15, 10);
  });

  it("skips the input when a component column is missing from the row", () => {
    const result = projectRow(
      { revenue: "1000000" }, // total_expenses absent
      { stress: "@ratio:total_expenses/revenue" },
    );
    expect(result.externalInputs).toEqual({});
    expect(result.errors).toEqual([]);
  });

  it("skips the input when a component is non-numeric", () => {
    const result = projectRow(
      { total_expenses: "n/a", revenue: "1000000" },
      { stress: "@ratio:total_expenses/revenue" },
    );
    expect(result.externalInputs).toEqual({});
  });

  it("skips the input when the denominator is zero", () => {
    const result = projectRow(
      { total_expenses: "750000", revenue: "0" },
      { stress: "@ratio:total_expenses/revenue" },
    );
    expect(result.externalInputs).toEqual({});
  });

  it("skips a malformed ratio sentinel like an empty cell", () => {
    const result = projectRow(
      { revenue: "1000000" },
      { stress: "@ratio:revenue" }, // no slash → malformed
    );
    expect(result.externalInputs).toEqual({});
    expect(result.errors).toEqual([]);
  });

  it("ignores dtype + alias options for ratio inputs (value is already numeric)", () => {
    const result = projectRow(
      { total_expenses: "750000", revenue: "1000000" },
      { stress: "@ratio:total_expenses/revenue" },
      {
        inputDtypes: { stress: "string" }, // would otherwise pass through as string
        inputDimMap: { stress: "stress" },
        aliasOverrides: { stress: { "0.75": "high" } },
      },
    );
    // Ratio path runs before alias/dtype — projects the raw number.
    expect(result.externalInputs.stress).toBeCloseTo(0.75, 10);
  });

  it("projects ratios alongside plain mapped columns in one pass", () => {
    const result = projectRow(
      {
        CLASS_CODE: "09011",
        total_expenses: "750000",
        revenue: "1000000",
      },
      {
        class_code: "CLASS_CODE",
        stress: "@ratio:total_expenses/revenue",
      },
    );
    expect(result.externalInputs.class_code).toBe("09011");
    expect(result.externalInputs.stress).toBeCloseTo(0.75, 10);
  });
});

// ─────────────────────────────────────────────────────────────────
// Scaled column (@times:column*multiplier) — FCA #23 finding 13
// ─────────────────────────────────────────────────────────────────

describe("projectRow — scaled column", () => {
  it("the audited shape: payroll in thousands × 1000 projects dollars", () => {
    const result = projectRow(
      { PAYROLL_K: "240" },
      { payroll: "@times:PAYROLL_K*1000" },
    );
    expect(result.externalInputs.payroll).toBe(240_000);
    expect(result.errors).toEqual([]);
  });

  it("strips thousands commas in the component", () => {
    const result = projectRow(
      { PAYROLL_K: "1,247" },
      { payroll: "@times:PAYROLL_K*1000" },
    );
    expect(result.externalInputs.payroll).toBe(1_247_000);
  });

  it("skips missing / non-numeric cells like empty cells (engine owns the outcome)", () => {
    expect(
      projectRow({}, { payroll: "@times:PAYROLL_K*1000" }).externalInputs,
    ).toEqual({});
    expect(
      projectRow({ PAYROLL_K: "n/a" }, { payroll: "@times:PAYROLL_K*1000" })
        .externalInputs,
    ).toEqual({});
  });

  it("skips a malformed times sentinel like an empty cell", () => {
    const result = projectRow(
      { PAYROLL_K: "240" },
      { payroll: "@times:PAYROLL_K" }, // no multiplier → malformed
    );
    expect(result.externalInputs).toEqual({});
    expect(result.errors).toEqual([]);
  });

  it("bypasses dtype coercion (the value is already a number)", () => {
    const result = projectRow(
      { PAYROLL_K: "240" },
      { payroll: "@times:PAYROLL_K*1000" },
      { inputDtypes: { payroll: "string" } },
    );
    expect(result.externalInputs.payroll).toBe(240_000);
  });
});

// ─────────────────────────────────────────────────────────────────
// Dtype coercion
// ─────────────────────────────────────────────────────────────────

describe("projectRow — number coercion", () => {
  it("strips thousands commas before parsing", () => {
    const result = projectRow(
      { TIV: "1,247,438" },
      { tiv: "TIV" },
      { columnDtypes: { TIV: "number" } },
    );
    expect(result.externalInputs).toEqual({ tiv: 1247438 });
  });

  it("parses negative + decimal numbers", () => {
    const result = projectRow(
      { x: "-3.14" },
      { x: "x" },
      { columnDtypes: { x: "number" } },
    );
    expect(result.externalInputs.x).toBe(-3.14);
  });

  it("records an error on unparseable numbers and passes raw through", () => {
    const result = projectRow(
      { x: "abc" },
      { x: "x" },
      { columnDtypes: { x: "number" } },
    );
    expect(result.externalInputs.x).toBe("abc");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.intendedDtype).toBe("number");
  });
});

describe("projectRow — boolean coercion", () => {
  it("coerces text-true → true (yes/y/true/1/t)", () => {
    const truthy = ["yes", "YES", "true", "Y", "y", "1", "t"];
    for (const value of truthy) {
      const result = projectRow(
        { B: value },
        { b: "B" },
        { columnDtypes: { B: "boolean" } },
      );
      expect(result.externalInputs.b, `for "${value}"`).toBe(true);
    }
  });

  it("coerces text-false → false (no/n/false/0/f)", () => {
    const falsy = ["no", "NO", "false", "N", "n", "0", "f"];
    for (const value of falsy) {
      const result = projectRow(
        { B: value },
        { b: "B" },
        { columnDtypes: { B: "boolean" } },
      );
      expect(result.externalInputs.b, `for "${value}"`).toBe(false);
    }
  });

  it("records an error for unknown boolean strings", () => {
    const result = projectRow(
      { B: "maybe" },
      { b: "B" },
      { columnDtypes: { B: "boolean" } },
    );
    expect(result.errors).toHaveLength(1);
    expect(result.externalInputs.b).toBe("maybe");
  });
});

describe("projectRow — date coercion", () => {
  it("preserves ISO 8601 date-only inputs as YYYY-MM-DD", () => {
    const result = projectRow(
      { D: "2026-07-01" },
      { d: "D" },
      { columnDtypes: { D: "date" } },
    );
    expect(result.externalInputs.d).toBe("2026-07-01");
  });

  it("normalizes slash-dates to YYYY-MM-DD", () => {
    const result = projectRow(
      { D: "07/01/2026" },
      { d: "D" },
      { columnDtypes: { D: "date" } },
    );
    expect(result.externalInputs.d).toBe("2026-07-01");
  });

  it("emits ISO timestamps for datetime inputs", () => {
    const result = projectRow(
      { D: "2026-07-01T14:00:00Z" },
      { d: "D" },
      { columnDtypes: { D: "date" } },
    );
    const value = result.externalInputs.d as string;
    expect(value).toMatch(/^2026-07-01T14:00:00/);
  });

  it("records an error for unparseable dates", () => {
    const result = projectRow(
      { D: "not_a_date" },
      { d: "D" },
      { columnDtypes: { D: "date" } },
    );
    expect(result.errors).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// Dtype hint precedence
// ─────────────────────────────────────────────────────────────────

describe("projectRow — dtype precedence", () => {
  it("inputDtypes outrank columnDtypes when both set", () => {
    const result = projectRow(
      { X: "1247438" },
      { tiv: "X" },
      {
        columnDtypes: { X: "string" }, // would pass through
        inputDtypes: { tiv: "number" }, // wins
      },
    );
    expect(result.externalInputs.tiv).toBe(1247438);
  });

  it("falls back to columnDtypes when inputDtypes lacks an entry", () => {
    const result = projectRow(
      { X: "1247438" },
      { tiv: "X" },
      { columnDtypes: { X: "number" } },
    );
    expect(result.externalInputs.tiv).toBe(1247438);
  });

  it("falls back to string passthrough when no dtype hint at all", () => {
    const result = projectRow(
      { X: "1247438" },
      { tiv: "X" },
    );
    expect(result.externalInputs.tiv).toBe("1247438");
  });
});

// ─────────────────────────────────────────────────────────────────
// Multi-row projection
// ─────────────────────────────────────────────────────────────────

describe("projectRows + projectRowsToExternalInputs", () => {
  const rows = [
    { CLASS_CODE: "09011", TIV: "1,247,438" },
    { CLASS_CODE: "07712", TIV: "8,900,000" },
    { CLASS_CODE: "06811", TIV: "2,100,000" },
  ];
  const columnMap = { class_code: "CLASS_CODE", tiv: "TIV" };
  const options = {
    columnDtypes: { CLASS_CODE: "string" as const, TIV: "number" as const },
  };

  it("projects N rows into N projected rows", () => {
    const projected = projectRows(rows, columnMap, options);
    expect(projected).toHaveLength(3);
    expect(projected[0]?.externalInputs).toEqual({
      class_code: "09011",
      tiv: 1247438,
    });
    expect(projected[2]?.externalInputs.tiv).toBe(2100000);
  });

  it("isolates per-row errors", () => {
    const mixedRows = [
      { CLASS_CODE: "09011", TIV: "1,247,438" },
      { CLASS_CODE: "07712", TIV: "abc" }, // bad number
      { CLASS_CODE: "06811", TIV: "2,100,000" },
    ];
    const projected = projectRows(mixedRows, columnMap, options);
    expect(projected[0]?.errors).toEqual([]);
    expect(projected[1]?.errors).toHaveLength(1);
    expect(projected[2]?.errors).toEqual([]);
  });

  it("projectRowsToExternalInputs returns flat array of inputs", () => {
    const inputs = projectRowsToExternalInputs(rows, columnMap, options);
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toEqual({ class_code: "09011", tiv: 1247438 });
  });
});

// ─────────────────────────────────────────────────────────────────
// Brief 38 fixture-shape regression
// ─────────────────────────────────────────────────────────────────

describe("Brief 38 — realistic BOP submission projection", () => {
  it("projects a typical row with mixed dtypes + alias override", () => {
    const row = {
      CLASS_CODE: "09011",
      CONSTR: "WOOD",
      PROT_CLASS: "4",
      BUILT: "1987",
      TIV_USD: "1,247,438",
      SPRINK_Y: "Y",
      EFF_DATE: "2026-07-01",
    };
    const columnMap = {
      class_code: "CLASS_CODE",
      construction: "CONSTR",
      protection_class: "PROT_CLASS",
      year_built: "BUILT",
      tiv: "TIV_USD",
      sprinklered: "SPRINK_Y",
      policy_date: "EFF_DATE",
    };
    const result = projectRow(row, columnMap, {
      inputDimMap: { construction: "construction" },
      aliasOverrides: { construction: { WOOD: "frame" } },
      columnDtypes: {
        CLASS_CODE: "string",
        CONSTR: "string",
        PROT_CLASS: "string",
        BUILT: "number",
        TIV_USD: "number",
        SPRINK_Y: "boolean",
        EFF_DATE: "date",
      },
    });
    expect(result.externalInputs).toEqual({
      class_code: "09011",
      construction: "frame", // alias-resolved
      protection_class: "4",
      year_built: 1987,
      tiv: 1247438,
      sprinklered: true,
      policy_date: "2026-07-01",
    });
    expect(result.errors).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Geo transformer path — Brief 44 PR 44.11.e
// ─────────────────────────────────────────────────────────────────

describe("projectRow — geographic transformers", () => {
  it("applies zip5_to_state when configured for an input", () => {
    const result = projectRow(
      { zip_code: "53201" },
      { state: "zip_code" },
      { geoTransformers: { state: "zip5_to_state" } },
    );
    expect(result.externalInputs).toEqual({ state: "WI" });
    expect(result.errors).toEqual([]);
  });

  it("applies fips5_to_state when configured", () => {
    const result = projectRow(
      { fips: "55079" }, // Milwaukee County, WI
      { state: "fips" },
      { geoTransformers: { state: "fips5_to_state" } },
    );
    expect(result.externalInputs).toEqual({ state: "WI" });
    expect(result.errors).toEqual([]);
  });

  it("applies state_name_to_usps when configured", () => {
    const result = projectRow(
      { state_full: "Wisconsin" },
      { state: "state_full" },
      { geoTransformers: { state: "state_name_to_usps" } },
    );
    expect(result.externalInputs).toEqual({ state: "WI" });
    expect(result.errors).toEqual([]);
  });

  it("identity transformer is a no-op pass-through (raw value flows)", () => {
    const result = projectRow(
      { state: "WI" },
      { state: "state" },
      { geoTransformers: { state: "identity" } },
    );
    expect(result.externalInputs).toEqual({ state: "WI" });
    expect(result.errors).toEqual([]);
  });

  it("missing transformer for the input — raw value flows through (no transform)", () => {
    const result = projectRow(
      { state: "Wisconsin" },
      { state: "state" },
      { geoTransformers: {} }, // no entry for `state`
    );
    expect(result.externalInputs).toEqual({ state: "Wisconsin" });
    expect(result.errors).toEqual([]);
  });

  it("logs an error + falls through when the transformer returns null", () => {
    const result = projectRow(
      // Non-numeric input fails zip5_to_state's `/^\d{5}$/` check and
      // returns null. Used here as the cleanest forced-null path —
      // all valid 5-digit ZIPs land in some state by design.
      { zip_code: "BADZIP" },
      { state: "zip_code" },
      { geoTransformers: { state: "zip5_to_state" } },
    );
    // Raw value flows through so downstream lookup can surface the miss.
    expect(result.externalInputs).toEqual({ state: "BADZIP" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/zip5_to_state/);
    expect(result.errors[0]?.message).toMatch(/BADZIP/);
  });

  it("alias-override wins over transformer (user intent first)", () => {
    // Even with a transformer configured, an explicit alias override
    // wins — actuaries who hand-mapped values shouldn't have their
    // overrides silently overwritten by an algorithmic transformer.
    const result = projectRow(
      { zip_code: "53201" },
      { state: "zip_code" },
      {
        inputDimMap: { state: "state" },
        aliasOverrides: { state: { "53201": "WI_OVERRIDE" } },
        geoTransformers: { state: "zip5_to_state" },
      },
    );
    expect(result.externalInputs).toEqual({ state: "WI_OVERRIDE" });
  });

  it("non-geographic inputs are unaffected by the geoTransformers option", () => {
    const result = projectRow(
      { policy_id: "POL-001", zip_code: "53201" },
      { policy_id: "policy_id", state: "zip_code" },
      { geoTransformers: { state: "zip5_to_state" } },
    );
    expect(result.externalInputs).toEqual({
      policy_id: "POL-001",
      state: "WI",
    });
  });
});
