/**
 * Tests for findDimensionReferences — Brief 30 PR 30.4.
 *
 * The resolver walks each source independently; each test exercises
 * one source kind in isolation, plus a combined "kitchen sink" case.
 */

import { describe, expect, it } from "vitest";
import {
  findDimensionReferences,
  type ChainStageSummary,
  type FactorTableReference,
  type ModifierScheduleReference,
} from "./dimension-references";

function chainStage(opts: {
  readonly stage_id: string;
  readonly display_name: string;
  readonly chains: ReadonlyArray<{
    readonly name: string;
    readonly factor_lookups: ReadonlyArray<{
      readonly name: string;
      readonly dimensions: Record<
        string,
        { readonly source: string; readonly path: string }
      >;
    }>;
  }>;
}): ChainStageSummary {
  return {
    stage_id: opts.stage_id,
    stage_kind: "multiplicative_chain",
    display_name: opts.display_name,
    config_json: { chains: opts.chains },
  };
}

// ──────────────────────────────────────────────────────────────────
// Empty
// ──────────────────────────────────────────────────────────────────

describe("findDimensionReferences — empty inputs", () => {
  it("returns [] when no sources are provided", () => {
    expect(
      findDimensionReferences({ dimSlug: "construction" }),
    ).toEqual([]);
  });

  it("returns [] when sources are present but the dim isn't referenced", () => {
    const stages: readonly ChainStageSummary[] = [
      chainStage({
        stage_id: "s1",
        display_name: "Premium chain",
        chains: [
          {
            name: "Building premium",
            factor_lookups: [
              {
                name: "Class factor",
                dimensions: {
                  class_code: { source: "form_input", path: "class_code" },
                },
              },
            ],
          },
        ],
      }),
    ];
    expect(
      findDimensionReferences({ dimSlug: "construction", stages }),
    ).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Chain stages
// ──────────────────────────────────────────────────────────────────

describe("findDimensionReferences — chain stages", () => {
  it("matches a dim referenced as a factor's dimension key", () => {
    const stages: readonly ChainStageSummary[] = [
      chainStage({
        stage_id: "stage_1",
        display_name: "Premium chain",
        chains: [
          {
            name: "Building premium",
            factor_lookups: [
              {
                name: "Construction factor",
                dimensions: {
                  construction_class: {
                    source: "form_input",
                    path: "construction_class",
                  },
                },
              },
            ],
          },
        ],
      }),
    ];
    const refs = findDimensionReferences({
      dimSlug: "construction_class",
      stages,
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "chain",
      id: "stage_1::0::0",
      label: "Building premium",
      context: "Premium chain · Construction factor",
    });
  });

  it("matches a dim referenced via the binding's form_input path", () => {
    const stages: readonly ChainStageSummary[] = [
      chainStage({
        stage_id: "stage_1",
        display_name: "Premium chain",
        chains: [
          {
            name: "Building premium",
            factor_lookups: [
              {
                name: "Class factor",
                dimensions: {
                  // Key is class_code; binding.path is also class_code.
                  class_code: { source: "form_input", path: "class_code" },
                },
              },
            ],
          },
        ],
      }),
    ];
    expect(
      findDimensionReferences({ dimSlug: "class_code", stages }),
    ).toHaveLength(1);
  });

  it("matches multiple factors in the same chain", () => {
    const stages: readonly ChainStageSummary[] = [
      chainStage({
        stage_id: "stage_1",
        display_name: "Premium chain",
        chains: [
          {
            name: "Building premium",
            factor_lookups: [
              {
                name: "Construction factor",
                dimensions: {
                  construction_class: {
                    source: "form_input",
                    path: "construction_class",
                  },
                },
              },
              {
                name: "Construction × Protection",
                dimensions: {
                  construction_class: {
                    source: "form_input",
                    path: "construction_class",
                  },
                  protection_class: {
                    source: "form_input",
                    path: "protection_class",
                  },
                },
              },
            ],
          },
        ],
      }),
    ];
    const refs = findDimensionReferences({
      dimSlug: "construction_class",
      stages,
    });
    expect(refs).toHaveLength(2);
    expect(refs[0]!.id).toBe("stage_1::0::0");
    expect(refs[1]!.id).toBe("stage_1::0::1");
  });

  it("ignores non-multiplicative-chain stages", () => {
    const stages: readonly ChainStageSummary[] = [
      {
        stage_id: "loading_1",
        stage_kind: "flat_factor",
        display_name: "Expense loading",
        config_json: { factor: 1.25 },
      },
    ];
    expect(
      findDimensionReferences({ dimSlug: "anything", stages }),
    ).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Factor tables
// ──────────────────────────────────────────────────────────────────

describe("findDimensionReferences — factor tables", () => {
  it("matches a 1-D table via key_dimension and labels it by display name (B6)", () => {
    const factorTables: readonly FactorTableReference[] = [
      {
        id: "construction_factor",
        display_name: "Construction rel",
        slug: "construction_factor",
        key_dimension: "construction_class",
      },
    ];
    const refs = findDimensionReferences({
      dimSlug: "construction_class",
      factorTables,
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "factor-table",
      id: "construction_factor",
      // B6 — the human display name, not the raw `factor_table:<slug>` id.
      label: "Construction rel",
      context: "key column",
    });
  });

  it("falls back to the slug when a table has no display name", () => {
    const refs = findDimensionReferences({
      dimSlug: "construction_class",
      factorTables: [
        {
          id: "construction_factor",
          slug: "construction_factor",
          key_dimension: "construction_class",
        },
      ],
    });
    expect(refs[0]?.label).toBe("construction_factor");
  });

  it("matches a 2-D table via key_dimensions[0]", () => {
    const factorTables: readonly FactorTableReference[] = [
      {
        id: "age_x_class",
        slug: "age_x_class",
        key_dimensions: ["building_age", "class_code"],
      },
    ];
    const refs = findDimensionReferences({
      dimSlug: "building_age",
      factorTables,
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.context).toContain("1st of 2 key columns");
  });

  it("uses ordinal context for 2nd+ key positions", () => {
    const factorTables: readonly FactorTableReference[] = [
      {
        id: "age_x_class",
        slug: "age_x_class",
        key_dimensions: ["building_age", "class_code"],
      },
    ];
    const refs = findDimensionReferences({
      dimSlug: "class_code",
      factorTables,
    });
    expect(refs[0]!.context).toContain("2nd of 2 key columns");
  });

  it("ignores tables that don't reference the dim", () => {
    const factorTables: readonly FactorTableReference[] = [
      { id: "x", slug: "x", key_dimension: "other" },
    ];
    expect(
      findDimensionReferences({ dimSlug: "construction", factorTables }),
    ).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Modifier schedules
// (Brief 34 PR 34.7 removed curves — only modifiers remain.)
// ──────────────────────────────────────────────────────────────────

describe("findDimensionReferences — modifiers", () => {
  it("matches modifiers via key_dimension", () => {
    const modifiers: readonly ModifierScheduleReference[] = [
      { id: "schedule_mod", slug: "schedule_mod", key_dimension: "deductible" },
    ];
    const refs = findDimensionReferences({
      dimSlug: "deductible",
      modifiers,
    });
    expect(refs[0]).toMatchObject({
      kind: "modifier",
      label: "modifier:schedule_mod",
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// Combined / ordering
// ──────────────────────────────────────────────────────────────────

describe("findDimensionReferences — combined sources", () => {
  it("returns chains first, then factor tables, then modifiers (curves removed in Brief 34 PR 34.7)", () => {
    const stages: readonly ChainStageSummary[] = [
      chainStage({
        stage_id: "s1",
        display_name: "Premium chain",
        chains: [
          {
            name: "Building premium",
            factor_lookups: [
              {
                name: "Age factor",
                dimensions: {
                  building_age: {
                    source: "form_input",
                    path: "building_age",
                  },
                },
              },
            ],
          },
        ],
      }),
    ];
    const factorTables: readonly FactorTableReference[] = [
      { id: "ft", slug: "ft", key_dimension: "building_age" },
    ];
    const modifiers: readonly ModifierScheduleReference[] = [
      { id: "mod", slug: "mod", key_dimension: "building_age" },
    ];
    const refs = findDimensionReferences({
      dimSlug: "building_age",
      stages,
      factorTables,
      modifiers,
    });
    expect(refs.map((r) => r.kind)).toEqual([
      "chain",
      "factor-table",
      "modifier",
    ]);
  });

  it("dimId is treated as an alias alongside dimSlug", () => {
    const factorTables: readonly FactorTableReference[] = [
      { id: "ft", slug: "ft", key_dimension: "dim_42" },
    ];
    const refs = findDimensionReferences({
      dimSlug: "construction_class",
      dimId: "dim_42",
      factorTables,
    });
    expect(refs).toHaveLength(1);
  });
});
