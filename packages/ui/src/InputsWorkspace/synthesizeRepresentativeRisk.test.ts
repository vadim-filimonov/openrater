/**
 * synthesizeRepresentativeRisk — Brief 48 §3.4 / phase 3.
 *
 * Unit tests for the deterministic representative-risk synthesizer, plus an
 * INTEGRATION round-trip proving the synthesized inputs actually score a finite
 * premium through the real projector + runtime (the whole point — a risk that
 * resolves REAL factor cells, not 1.0 defaults).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { compilePlan, runPlan, registerBuiltinKinds } from "@openrater/contracts";
import type { Dimension, Plan } from "@openrater/contracts";
import { synthesizeRepresentativeRisk } from "./synthesizeRepresentativeRisk";
import {
  stagesToRuntimePlan,
  type FactorTableCellsMap,
} from "./stagesToRuntimePlan";
import type { StageLike, FactorTableLike } from "./deriveRequiredInputs";

// D&O-like chain: base 600 × NTEE (categorical) × revenue (banded, prebinned).
const CHAIN_SPEC = {
  name: "do_premium",
  base_value: 600,
  factor_lookups: [
    {
      name: "ntee_factor_do",
      factor_kind: "ntee_factor_do",
      dimensions: {
        ntee_major: { source: "form_input", path: "form_input.ntee_major" },
      },
    },
    {
      name: "revenue_factor_do",
      factor_kind: "revenue_factor_do",
      // bound by its OWN slug → "prebinned" direct lookup on the level id
      dimensions: {
        revenue_band: { source: "form_input", path: "form_input.revenue_band" },
      },
    },
  ],
  lcm: { input_path: "form_input.lcm" },
  output_field: "do_premium",
};

const STAGES: StageLike[] = [
  {
    stage_id: "do_chain_stage",
    stage_kind: "multiplicative_chain",
    config_json: { chains: [CHAIN_SPEC] },
  },
];

const DIMS = [
  {
    id: "ntee_major",
    slug: "ntee_major",
    display_name: "NTEE major",
    levels: [
      { id: "religion", label: "Religion" },
      { id: "education", label: "Education" },
    ],
  },
  {
    id: "revenue_band",
    slug: "revenue_band",
    display_name: "Revenue band",
    shape: "banded",
    // `kind: "banded"` mirrors real levels_json rows — derive.band
    // (which every banded dim routes through since finding E4) only
    // considers levels that declare it.
    levels: [
      { kind: "banded", id: "0_1m", label: "$0–1M", lo: 0, hi: 1_000_000 },
      { kind: "banded", id: "1m_5m", label: "$1–5M", lo: 1_000_000, hi: 5_000_000 },
    ],
  },
] as unknown as Dimension[];

describe("synthesizeRepresentativeRisk", () => {
  it("uses the first categorical level id as the lookup key", () => {
    const risk = synthesizeRepresentativeRisk(STAGES, DIMS);
    expect(risk.ntee_major).toBe("religion");
  });

  it("seeds a raw NUMBER for a banded dim bound by its own slug (finding E4)", () => {
    // Since E4 the projector routes EVERY banded dim through
    // derive.band — including path === slug, the default authoring
    // outcome — so the representative seed is the first band's lower
    // bound (0 bins to "0_1m"), not a prebinned level id.
    const risk = synthesizeRepresentativeRisk(STAGES, DIMS);
    expect(risk.revenue_band).toBe(0);
  });

  it("uses an in-range NUMBER for a raw-band-path dim (path ≠ slug)", () => {
    const stages: StageLike[] = [
      {
        stage_id: "s",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "c",
              factor_lookups: [
                {
                  factor_kind: "revenue_factor_do",
                  // raw column "revenue" ≠ slug "revenue_band" → derive.band path
                  dimensions: {
                    revenue_band: { path: "form_input.revenue" },
                  },
                },
              ],
            },
          ],
        },
      },
    ];
    const risk = synthesizeRepresentativeRisk(stages, DIMS);
    // first banded level is [0, 1_000_000) → lo (0) buckets to it
    expect(risk.revenue).toBe(0);
  });

  it("F07 — seeds the exposure-base field with a NUMBER (never a band id → NaN)", () => {
    // building_limit is BOTH a banded factor key AND the chain's exposure base.
    // The factor loop would seed the band id; the exposure needs a number or the
    // premium goes NaN and the Test surface shows "no numeric outputs".
    const dims = [
      {
        id: "building_limit",
        slug: "building_limit",
        display_name: "Building limit",
        shape: "banded",
        levels: [
          { id: "band_0_75000", label: "0–75k", lo: 0, hi: 75_000 },
          { id: "band_75000_100000", label: "75–100k", lo: 75_000, hi: 100_000 },
        ],
      },
    ] as unknown as Dimension[];
    const stages: StageLike[] = [
      {
        stage_id: "s",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "building_premium",
              base_value: 1,
              exposure_input: "form_input.building_limit",
              exposure_unit_divisor: 100,
              factor_lookups: [
                {
                  factor_kind: "building_limit_rel",
                  dimensions: {
                    building_limit: { path: "form_input.building_limit" },
                  },
                },
              ],
            },
          ],
        },
      },
    ];
    const risk = synthesizeRepresentativeRisk(stages, dims);
    // exposure seeding wins → a number, not the "band_0_75000" id
    expect(typeof risk.building_limit).toBe("number");
    expect(risk.building_limit as number).toBeGreaterThan(0);
  });

  it("F07 — seeds a positive sentinel when the exposure field maps to no dim", () => {
    const stages: StageLike[] = [
      {
        stage_id: "s",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "c",
              base_value: 1,
              exposure_input: "form_input.bpp_limit",
              exposure_unit_divisor: 100,
              factor_lookups: [],
            },
          ],
        },
      },
    ];
    const risk = synthesizeRepresentativeRisk(stages, DIMS);
    expect(typeof risk.bpp_limit).toBe("number");
    expect(risk.bpp_limit as number).toBeGreaterThan(0);
  });

  it("omits dims that have no levels (→ projector's neutral 1.0)", () => {
    const dimsNoLevels = [
      { id: "ntee_major", slug: "ntee_major", display_name: "NTEE", levels: [] },
    ] as unknown as Dimension[];
    const risk = synthesizeRepresentativeRisk(STAGES, dimsNoLevels);
    expect("ntee_major" in risk).toBe(false);
  });

  it("returns an empty object for a plan with no chain stages", () => {
    const risk = synthesizeRepresentativeRisk(
      [{ stage_id: "x", stage_kind: "flat_factor", config_json: {} }],
      DIMS,
    );
    expect(risk).toEqual({});
  });

  it("normalizes a stages.* binding path to the runtime field name", () => {
    const stages: StageLike[] = [
      {
        stage_id: "s",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "c",
              factor_lookups: [
                {
                  factor_kind: "k",
                  dimensions: { ntee_major: { path: "stages.ntee_major.value" } },
                },
              ],
            },
          ],
        },
      },
    ];
    const risk = synthesizeRepresentativeRisk(stages, DIMS);
    expect(risk.ntee_major).toBe("religion");
  });
});

describe("synthesizeRepresentativeRisk → real scoring (integration)", () => {
  beforeAll(() => {
    registerBuiltinKinds();
  });

  it("the synthesized risk scores a finite premium with REAL factor cells", () => {
    const factorTables: FactorTableLike[] = [
      { id: "ft_ntee", display_name: "NTEE", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
      { id: "ft_rev", display_name: "Revenue", key_dimension: "revenue_band", slug: "revenue_factor_do" } as unknown as FactorTableLike,
    ];
    const cells: FactorTableCellsMap = new Map([
      ["ft_ntee", new Map([["religion", 1.2]])],
      ["ft_rev", new Map([["0_1m", 1.4]])],
    ]);
    const { plan: runtimePlan } = stagesToRuntimePlan(STAGES, DIMS, factorTables, cells, {
      lcmOverride: 1.35,
    });
    const risk = synthesizeRepresentativeRisk(STAGES, DIMS);
    const result = runPlan(compilePlan(runtimePlan as unknown as Plan), risk);
    // 600 × 1.2 (religion) × 1.4 (0_1m level) × 1.35 (lcm) = 1360.8 — every
    // factor a REAL cell, none the neutral 1.0 default.
    expect(result.outputs.do_premium).toBeCloseTo(600 * 1.2 * 1.4 * 1.35, 4);
  });
});

describe("computed dimension bindings (Brief 95 C2)", () => {
  it("seeds the OPERANDS numerically, never the computed dim's slug", () => {
    const stages: StageLike[] = [
      {
        stage_id: "bld_chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "building",
              base_value: 0.15,
              exposure_input: "form_input.building_limit",
              factor_lookups: [
                {
                  name: "Deductible band",
                  factor_kind: "prop_limit_band",
                  dimensions: {
                    prop_limit_band: {
                      source: "computed",
                      op: "sum",
                      fields: ["building_limit", "bpp_limit"],
                    },
                  },
                },
              ],
              output_field: "building_premium",
            },
          ],
        },
      },
    ];
    const dims = [
      {
        id: "prop_limit_band",
        slug: "prop_limit_band",
        display_name: "Property limit band",
        shape: "banded",
        levels: [
          { id: "band_lo", label: "≤ $500k", kind: "banded", lo: 0, hi: 500_000 },
        ],
      },
    ] as unknown as Dimension[];
    const risk = synthesizeRepresentativeRisk(stages, dims);
    // The band key is built INSIDE the graph (chain.add → derive.band):
    // a form field for the dim slug would be typed into and ignored.
    expect(risk.prop_limit_band).toBeUndefined();
    // The operands ARE the risk's fields — positive numbers so the sum
    // lands in a real band (found live: WI v1.1.0 grew a dead
    // "Total property limit band" field seeded 0).
    expect(typeof risk.building_limit).toBe("number");
    expect(risk.building_limit as number).toBeGreaterThan(0);
    expect(typeof risk.bpp_limit).toBe("number");
    expect(risk.bpp_limit as number).toBeGreaterThan(0);
  });
});
