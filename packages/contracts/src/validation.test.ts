/**
 * Plan-validation tests — V.22.A5 commit #1
 *
 * The validation pass is pure logic; these tests cover the
 * complete matrix of broken-reference cases the V.22.A5 design
 * brief promises Phase 1 detects.
 */

import { describe, it, expect } from "vitest";
import {
  EMPTY_PLAN_SNAPSHOT,
  validatePlanReferences,
  type ChainSnapshot,
  type DimensionSnapshot,
  type FactorTableSnapshot,
  type PlanEntitiesSnapshot,
  type SourceSnapshot,
} from "./validation";

/* ============================================================
 * Fixtures
 * ============================================================ */

function dimFx(id: string): DimensionSnapshot {
  return { dimension_id: id, display_name: id };
}
function srcFx(field: string): SourceSnapshot {
  return { input_source_id: `s_${field}`, field_name: field };
}
function chainFx(id: string, factors: ChainSnapshot["factors"]): ChainSnapshot {
  return { coverage_chain_id: id, display_name: id, factors };
}
function tableFx(
  id: string,
  keys: FactorTableSnapshot["key_columns"],
): FactorTableSnapshot {
  return { factor_table_id: id, display_name: id, key_columns: keys };
}

/* ============================================================
 * Baseline
 * ============================================================ */

describe("validatePlanReferences · baselines", () => {
  it("returns zero issues for an empty plan", () => {
    const result = validatePlanReferences(EMPTY_PLAN_SNAPSHOT);
    expect(result.issues).toEqual([]);
    expect(result.countsBySeverity).toEqual({ error: 0, warning: 0 });
  });

  it("returns zero issues for a fully-resolved plan", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      dimensions: [dimFx("construction_class"), dimFx("territory")],
      sources: [srcFx("tiv"), srcFx("class_code")],
      factorTables: [tableFx("iso_base", [])],
      chains: [
        chainFx("property", [
          { name: "Base", type: "constant", ref: null },
          { name: "Construction", type: "dimension", ref: "construction_class" },
          { name: "ISO base", type: "factor_table", ref: "iso_base" },
          { name: "TIV", type: "input", ref: "tiv" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toEqual([]);
  });

  it("ignores null and empty-string refs (constant factors)", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      chains: [
        chainFx("c1", [
          { name: "BaseRate", type: "constant", ref: null },
          { name: "Bogus type that doesn't reference anything", type: "constant", ref: "" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toEqual([]);
  });
});

/* ============================================================
 * Chain factor references
 * ============================================================ */

describe("validatePlanReferences · chain factor references", () => {
  it("flags a chain factor referencing an unknown dimension", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      chains: [
        chainFx("property", [
          { name: "Construction", type: "dimension", ref: "construction_clas" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      severity: "error",
      sectionId: "rating-chains",
      sectionLabel: "Rating Chains",
      brokenRef: { kind: "dimension", id: "construction_clas" },
    });
    expect(result.issues[0]?.message).toContain("construction_clas");
  });

  it("flags a chain factor referencing an unknown factor table", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      chains: [
        chainFx("property", [
          { name: "ISO base", type: "factor_table", ref: "iso_base_v2" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.brokenRef).toEqual({
      kind: "factor_table",
      id: "iso_base_v2",
    });
  });

  // Brief 34 PR 34.7 removed the "curve" factor type. Plans
  // authored before the supersession that still carry `curve` refs
  // surface no issue here today (the validator's switch falls
  // through); plan-format-v2 will reject the type at parse time.

  it("flags a chain factor referencing an unknown subchain", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      chains: [
        chainFx("liability", [
          { name: "Property tie-in", type: "coverage_chain", ref: "property_v2" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.brokenRef).toEqual({
      kind: "coverage_chain",
      id: "property_v2",
    });
  });

  it("flags a chain factor reading an undeclared input field", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      chains: [
        chainFx("property", [
          { name: "TIV", type: "input", ref: "tiv_amt" }, // typo
        ]),
      ],
      sources: [srcFx("tiv")], // correct name
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.brokenRef).toEqual({
      kind: "input_source",
      id: "tiv_amt",
    });
  });

  it("resolves a chain factor referencing a coverage_chain that does exist", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      chains: [
        chainFx("property", []),
        chainFx("liability", [
          { name: "Property tie-in", type: "coverage_chain", ref: "property" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toEqual([]);
  });
});

// Brief 34 PR 34.7: the legacy `curve input bindings` section is
// gone — curves no longer exist as a first-class concept.

/* ============================================================
 * Factor table key bindings
 * ============================================================ */

describe("validatePlanReferences · factor table key bindings", () => {
  it("flags a key column binding to an unknown dimension", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      factorTables: [
        tableFx("iso_base", [
          { name: "construction", binding_source: "dimension", binding_name: "construction_clas" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      sectionId: "factor-tables",
      sectionLabel: "Factor Tables",
      brokenRef: { kind: "dimension", id: "construction_clas" },
    });
  });

  it("flags a key column binding to an undeclared input field", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      factorTables: [
        tableFx("region_factors", [
          { name: "region", binding_source: "input", binding_name: "region_code" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.brokenRef).toEqual({
      kind: "input_source",
      id: "region_code",
    });
  });

  it("flags multiple broken key bindings in the same table", () => {
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      factorTables: [
        tableFx("multi", [
          { name: "k1", binding_source: "dimension", binding_name: "missing_dim" },
          { name: "k2", binding_source: "input", binding_name: "missing_field" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toHaveLength(2);
  });
});

/* ============================================================
 * Aggregation
 * ============================================================ */

describe("validatePlanReferences · counts", () => {
  it("counts errors and warnings by severity", () => {
    // Today every issue is an error; once warnings are introduced
    // (e.g., stale-reference detection in Phase 2), this test will
    // need to flex.
    // Brief 34 PR 34.7 removed the "curve" factor type from the
    // validator; the prior 3-issue case dropped to 2.
    const plan: PlanEntitiesSnapshot = {
      ...EMPTY_PLAN_SNAPSHOT,
      chains: [
        chainFx("c1", [
          { name: "f1", type: "dimension", ref: "missing_d1" },
          { name: "f2", type: "factor_table", ref: "missing_t1" },
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toHaveLength(2);
    expect(result.countsBySeverity).toEqual({ error: 2, warning: 0 });
  });
});

/* ============================================================
 * End-to-end: realistic plan with mixed valid + broken refs
 * ============================================================ */

describe("validatePlanReferences · realistic plan", () => {
  it("surfaces only the broken references in a mixed plan", () => {
    const plan: PlanEntitiesSnapshot = {
      dimensions: [dimFx("construction_class"), dimFx("territory")],
      sources: [srcFx("tiv"), srcFx("class_code")],
      factorTables: [
        tableFx("iso_base", [
          { name: "construction", binding_source: "dimension", binding_name: "construction_class" },
        ]),
      ],
      chains: [
        chainFx("property", [
          { name: "Base", type: "constant", ref: null },
          { name: "Construction", type: "dimension", ref: "construction_class" }, // OK
          { name: "Bad-class", type: "dimension", ref: "construction_clas" }, // typo
          { name: "ISO base", type: "factor_table", ref: "iso_base" }, // OK
          { name: "Missing-table", type: "factor_table", ref: "iso_v2" }, // missing
        ]),
      ],
    };
    const result = validatePlanReferences(plan);
    expect(result.issues).toHaveLength(2);
    const refs = result.issues.map((i) => i.brokenRef);
    expect(refs).toEqual([
      { kind: "dimension", id: "construction_clas" },
      { kind: "factor_table", id: "iso_v2" },
    ]);
  });
});
