/**
 * Unit tests for stagesToRuntimePlan (PR D2a).
 *
 * Each test compiles + executes the projected Plan via the same
 * pipeline the Inputs workspace uses (compilePlan → executePlanBatch
 * via the registered builtin kinds), so a test failure points at a
 * real cold-test regression.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  compilePlan,
  runPlan,
  registerBuiltinKinds,
} from "@openrater/contracts";
import type { Dimension } from "@openrater/contracts";

import {
  stagesToRuntimePlan,
  PROJECTOR_EXECUTED_STAGE_KINDS,
} from "./stagesToRuntimePlan";
import type { StageLike, FactorTableLike } from "./deriveRequiredInputs";

beforeAll(() => {
  registerBuiltinKinds();
});

// Minimal stage builder — keeps the test setup readable.
function chainStage(
  stage_id: string,
  chains: Array<{
    name: string;
    base_input: string;
    factor_lookups: Array<{
      name: string;
      factor_kind: string;
      dimensions: Record<string, { source: string; path: string }>;
      unknown_key_policy?: { mode: string; value?: number };
    }>;
    lcm: { input_path?: string; value?: number; overridable?: boolean };
    output_field: string;
  }>,
): StageLike {
  return {
    stage_id,
    stage_kind: "multiplicative_chain",
    config_json: {
      chains,
      output_total_field: "premium",
    },
  };
}

// The projector doesn't read .levels at all (it gets the cells from
// the factor table sidecar), so we can keep this dim shape minimal.
const NTEE_DIM: Dimension = {
  id: "ntee_major",
  slug: "ntee_major",
  display_name: "NTEE major",
  data_type: "string",
  role: "rating-input",
} as Dimension;

describe("stagesToRuntimePlan", () => {
  it("returns an empty plan when no stages exist", () => {
    const { plan } = stagesToRuntimePlan([], [], [], new Map());
    expect(plan.nodes).toHaveLength(0);
    expect(plan.edges).toHaveLength(0);
  });

  it("ignores non-chain stages (v1 scope)", () => {
    const { plan } = stagesToRuntimePlan(
      [
        { stage_id: "x", stage_kind: "flat_factor", config_json: {} },
        { stage_id: "y", stage_kind: "modifier_schedule", config_json: {} },
      ],
      [],
      [],
      new Map(),
    );
    expect(plan.nodes).toHaveLength(0);
  });

  it("projects a single chain into runtime nodes that score correctly", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
    const factorTables: FactorTableLike[] = [
      // slug is needed by the matcher; FactorTableLike doesn't list it
      // so we attach it with `as` (mirrors the in-repo summary).
      { id: "ft1", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.20], ["philanthropy", 0.85]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells);

    // Sanity-check shape
    expect(plan.nodes.length).toBeGreaterThan(0);
    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).toContain("input");
    expect(kinds).toContain("lookup.direct");
    expect(kinds).toContain("chain.mult");
    expect(kinds).toContain("output");

    // Compile + run with concrete inputs (religion + base $600 + lcm 1.35)
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      do_base_rate: 600,
      ntee_major: "religion",
      lcm: 1.35,
    });
    // 600 × 1.20 × 1.35 = 972
    expect(result.outputs.do_premium).toBeCloseTo(972, 6);
  });

  it("honors lcmOverride (no need to map an LCM column)", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" }, // ignored when override set
          output_field: "do_premium",
        },
      ]),
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft1", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["philanthropy", 0.85]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
    });

    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      do_base_rate: 600,
      ntee_major: "philanthropy",
      // No lcm key — the constant node supplies it
    });
    // 600 × 0.85 × 1.35 = 688.5
    expect(result.outputs.do_premium).toBeCloseTo(688.5, 6);
  });

  // ── ADR-0047 — authored carrier LCM (`lcm.value`) ──

  it("honors an authored lcm.value (no override, no column)", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: {
                  source: "form_input",
                  path: "form_input.ntee_major",
                },
              },
            },
          ],
          lcm: { value: 1.4 }, // authored carrier constant
          output_field: "do_premium",
        },
      ]),
    ];
    const factorTables: FactorTableLike[] = [
      {
        id: "ft1",
        display_name: "NTEE D&O",
        key_dimension: "ntee_major",
        slug: "ntee_factor_do",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["philanthropy", 0.85]])],
    ]);
    // No lcmOverride, no `lcm` input column — the authored value supplies it.
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {});
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      do_base_rate: 600,
      ntee_major: "philanthropy",
    });
    // 600 × 0.85 × 1.4 = 714
    expect(result.outputs.do_premium).toBeCloseTo(714, 6);
  });

  it("lcm.value wins over lcmOverride (precedence)", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [],
          lcm: { value: 1.4 }, // wins over the 1.35 override below
          output_field: "do_premium",
        },
      ]),
    ];
    const { plan } = stagesToRuntimePlan(stages, [], [], new Map(), {
      lcmOverride: 1.35,
    });
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, { do_base_rate: 600 });
    // 600 × 1.4 = 840 (NOT 600 × 1.35 = 810)
    expect(result.outputs.do_premium).toBeCloseTo(840, 6);
  });

  // ── Cold-test L30 — literal base_value (no template_id, no defaults) ──

  it("scores from a literal base_value with NO defaults + NO template", () => {
    // This is the cold-test L30 happy path: a from-scratch chain that
    // carries its OWN base rate (`base_value: 600`). No `options.defaults`
    // (the retired template hack), no `do_base_rate` input column.
    const stages: StageLike[] = [
      {
        stage_id: "do_chain_stage",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "do_premium",
              base_input: "literal.base_value", // ignored when base_value set
              base_value: 600,
              factor_lookups: [
                {
                  name: "ntee_factor_do",
                  factor_kind: "ntee_factor_do",
                  dimensions: {
                    ntee_major: {
                      source: "form_input",
                      path: "form_input.ntee_major",
                    },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              output_field: "do_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      {
        id: "ft1",
        display_name: "NTEE D&O",
        key_dimension: "ntee_major",
        slug: "ntee_factor_do",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.2]])],
    ]);
    // No `defaults`, no `lcmOverride` for the base — only the LCM column.
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells);

    // The base is a `constant` node (the literal), NOT an `input` node.
    const baseConst = plan.nodes.find(
      (n) =>
        n.kind === "constant" &&
        (n.params as { value?: number }).value === 600,
    );
    expect(baseConst).toBeDefined();
    expect((baseConst!.params as { type?: string }).type).toBe("money");
    // No input node named for a base-rate field — the literal replaced it.
    const baseInputNode = plan.nodes.find(
      (n) => n.kind === "input" && n.id.includes("base"),
    );
    expect(baseInputNode).toBeUndefined();

    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      ntee_major: "religion",
      lcm: 1.35,
      // NO do_base_rate column — the literal supplies the base.
    });
    // 600 (literal) × 1.20 × 1.35 = 972
    expect(result.outputs.do_premium).toBeCloseTo(972, 6);
  });

  it("prefers base_value over a base_input column when both exist", () => {
    // base_value wins; the do_base_rate column (5) is ignored entirely.
    const stages: StageLike[] = [
      {
        stage_id: "gl_chain_stage",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "gl_premium",
              base_input: "form_input.gl_base_rate",
              base_value: 300,
              factor_lookups: [],
              lcm: { input_path: "form_input.lcm" },
              output_field: "gl_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const { plan } = stagesToRuntimePlan(stages, [], [], new Map(), {
      lcmOverride: 1.35,
    });
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      gl_base_rate: 5, // a wrong column value — must be ignored
    });
    // 300 (literal) × 1.35 = 405 — NOT 5 × 1.35.
    expect(result.outputs.gl_premium).toBeCloseTo(405, 6);
  });

  it("falls back to base_input when base_value is absent (back-compat)", () => {
    // A chain with NO base_value behaves exactly as before: the base
    // resolves from the do_base_rate input column.
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
    const { plan } = stagesToRuntimePlan(stages, [], [], new Map(), {
      lcmOverride: 1.35,
    });
    // The base is an `input` node (no literal constant base).
    expect(
      plan.nodes.some((n) => n.kind === "input"),
    ).toBe(true);
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, { do_base_rate: 600 });
    // 600 × 1.35 = 810
    expect(result.outputs.do_premium).toBeCloseTo(810, 6);
  });

  it("REFUSES the row when the factor table is missing (ADR-0056 — no silent 1.0)", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "missing_table",
              factor_kind: "missing_table",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
    const { plan, issues } = stagesToRuntimePlan(
      stages,
      [NTEE_DIM],
      [],
      new Map(),
      { lcmOverride: 1.35 },
    );
    // Projection names the authoring cause…
    expect(issues.some((i) => i.code === "factor_table_missing")).toBe(true);

    // …and the row REFUSES at run time (error default): the premium is
    // withheld — never a plausible 600 × 1.0 × 1.35.
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      do_base_rate: 600,
      ntee_major: "religion",
    });
    expect(result.row_status).toBe("error");
    expect(result.outputs).not.toHaveProperty("do_premium");
    expect(result.issues?.some((i) => i.code === "unknown_key")).toBe(true);
  });

  it("an AUTHORED default(1.0) policy restores the neutral factor — visibly (ADR-0056)", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "missing_table",
              factor_kind: "missing_table",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
              unknown_key_policy: { mode: "default", value: 1.0 },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], [], new Map(), {
      lcmOverride: 1.35,
    });
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      do_base_rate: 600,
      ntee_major: "religion",
    });
    // The authored resolution applies (600 × 1.0 × 1.35)…
    expect(result.outputs.do_premium).toBeCloseTo(810, 6);
    expect(result.row_status).toBe("ok");
    // …and it is VISIBLE, not silent.
    expect(
      result.issues?.some((i) => i.code === "unknown_key_defaulted"),
    ).toBe(true);
  });

  it("falls back to defaults when the row doesn't supply a field (PR D2b)", () => {
    // The template seeder uses this to bake base rates ($600 D&O,
    // $300 GL) without requiring the user's CSV to ship those columns.
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft_do", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft_do", new Map([["religion", 1.20]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
      defaults: { do_base_rate: 600 },
    });

    const compiled = compilePlan(plan);
    // Row has no do_base_rate column — default kicks in
    const result = runPlan(compiled, { ntee_major: "religion" });
    // 600 (default) × 1.20 × 1.35 = 972
    expect(result.outputs.do_premium).toBeCloseTo(972, 6);

    // Sanity: the input node carries the defaultValue
    const baseInputNode = plan.nodes.find(
      (n) => n.kind === "input" && (n.params as { fieldName?: string }).fieldName === "do_base_rate",
    );
    expect(baseInputNode).toBeDefined();
    expect((baseInputNode!.params as { defaultValue?: unknown }).defaultValue).toBe(600);
  });

  it("inserts derive.band when the bound dim is banded + binding uses raw field name (PR D3.3 — ADR-0026)", () => {
    // The chain references `revenue_band` (the dim slug) but the
    // binding path supplies `revenue` (the raw column). The projector
    // should detect dim.shape === "banded" + dimField !== dimSlug
    // and insert a derive.band node between input and lookup.
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "revenue_factor_do",
              factor_kind: "revenue_factor_do",
              dimensions: {
                revenue_band: { source: "form_input", path: "form_input.revenue" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft_rev_do", display_name: "Revenue D&O", key_dimension: "revenue_band", slug: "revenue_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft_rev_do", new Map([
        ["01_under_25k", 0.65],
        ["02_25k_50k",   0.75],
        ["03_50k_100k",  0.85],
      ])],
    ]);
    // Banded dim with three levels — half-open [lo, hi) per substrate
    const REVENUE_DIM = {
      id: "revenue_band",
      slug: "revenue_band",
      display_name: "Revenue band",
      data_type: "string",
      role: "rating-input",
      shape: "banded",
      levels: [
        { kind: "banded", id: "01_under_25k", label: "<$25K",       lo: Number.NEGATIVE_INFINITY, hi: 25000 },
        { kind: "banded", id: "02_25k_50k",   label: "$25K-$50K",   lo: 25000, hi: 50000 },
        { kind: "banded", id: "03_50k_100k",  label: "$50K-$100K",  lo: 50000, hi: Number.POSITIVE_INFINITY },
      ],
    } as unknown as Dimension;

    const { plan } = stagesToRuntimePlan(
      stages,
      [REVENUE_DIM],
      factorTables,
      cells,
      { lcmOverride: 1.35, defaults: { do_base_rate: 600 } },
    );

    // The plan now has a derive.band node between input and lookup
    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).toContain("derive.band");
    expect(kinds).toContain("lookup.direct");

    // Cold-test L22 — the emitted derive.band must request clamp-to-
    // nearest so out-of-range values never silently price at 1.0.
    const bandNode = plan.nodes.find((n) => n.kind === "derive.band");
    expect((bandNode?.params as { clampToNearest?: boolean }).clampToNearest).toBe(true);

    const compiled = compilePlan(plan);

    // Row supplies RAW revenue (45000) — chain auto-bins to 02_25k_50k
    const r1 = runPlan(compiled, { revenue: 45000 });
    // 600 (default) × 0.75 (02_25k_50k) × 1.35 = 607.5
    expect(r1.outputs.do_premium).toBeCloseTo(607.5, 4);

    // Row supplies 75000 → bins to 03_50k_100k (factor 0.85)
    const r2 = runPlan(compiled, { revenue: 75000 });
    expect(r2.outputs.do_premium).toBeCloseTo(600 * 0.85 * 1.35, 4); // 688.5

    // Boundary: 50000 lands in 03_50k_100k (half-open [50000, +inf))
    const r3 = runPlan(compiled, { revenue: 50000 });
    expect(r3.outputs.do_premium).toBeCloseTo(600 * 0.85 * 1.35, 4);
  });

  it("clamps an out-of-range value onto the top band instead of silent 1.0 (cold-test L22)", () => {
    // The cold-test shape: a FINITE-tailed revenue band (top band stops
    // at 5M). A $7.4M row falls past every band. Before L22 it resolved to
    // derive.band → "" → lookup default 1.0 (under-pricing). Now the
    // projector's clampToNearest pins it to the top band's factor.
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "revenue_factor_do",
              factor_kind: "revenue_factor_do",
              dimensions: {
                revenue_band: { source: "form_input", path: "form_input.revenue" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft_rev_do", display_name: "Revenue D&O", key_dimension: "revenue_band", slug: "revenue_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft_rev_do", new Map([
        ["01_under_1m", 1.0],
        ["02_1m_5m",    1.75], // top band — the out-of-range row must get it
      ])],
    ]);
    const REVENUE_DIM = {
      id: "revenue_band",
      slug: "revenue_band",
      display_name: "Revenue band",
      data_type: "string",
      role: "rating-input",
      shape: "banded",
      levels: [
        { kind: "banded", id: "01_under_1m", label: "<$1M",    lo: 0,         hi: 1_000_000 },
        { kind: "banded", id: "02_1m_5m",    label: "$1M-$5M", lo: 1_000_000, hi: 5_000_000 },
      ],
    } as unknown as Dimension;

    const { plan } = stagesToRuntimePlan(stages, [REVENUE_DIM], factorTables, cells, {
      lcmOverride: 1.0,
      defaults: { do_base_rate: 1000 },
    });
    const compiled = compilePlan(plan);

    // $7.4M is out of range → clamps to top band (1.75), NOT 1.0.
    const r = runPlan(compiled, { revenue: 7_400_000 });
    expect(r.outputs.do_premium).toBeCloseTo(1000 * 1.75 * 1.0, 4); // 1750, not 1000

    // The derive.band trace flags the clamp so the UI can warn.
    const bandTrace = Object.values(r.trace).find((t) => t.kindId === "derive.band");
    expect(bandTrace?.outputs.out_of_range).toBe(true);
    expect(bandTrace?.outputs.level_id).toBe("02_1m_5m");
  });

  it("bands a dim bound by its OWN field too — prebinned ids pass through (finding E4)", () => {
    // Same banded dim, but the binding path matches the dim slug
    // (`revenue_band`) — the DEFAULT authoring outcome. The old
    // projector skipped derive.band here, so a raw number ("50000")
    // hit lookup.direct as the key and missed every band id (the E4
    // "key `50000` not found" symptom). Now derive.band is ALWAYS
    // inserted for a banded dim; a genuinely prebinned row still
    // resolves via the node's idempotent level-id pass-through.
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "revenue_factor_do",
              factor_kind: "revenue_factor_do",
              dimensions: {
                revenue_band: { source: "form_input", path: "form_input.revenue_band" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft_rev_do", display_name: "Revenue D&O", key_dimension: "revenue_band", slug: "revenue_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft_rev_do", new Map([
        ["02_25k_50k", 0.75],
        ["03_50k_100k", 0.85],
      ])],
    ]);
    const REVENUE_DIM = {
      id: "revenue_band",
      slug: "revenue_band",
      shape: "banded",
      levels: [
        { kind: "banded", id: "02_25k_50k", label: "$25K-$50K", lo: 25000, hi: 50000 },
        { kind: "banded", id: "03_50k_100k", label: "$50K-$100K", lo: 50000, hi: 100000 },
      ],
    } as unknown as Dimension;

    const { plan } = stagesToRuntimePlan(stages, [REVENUE_DIM], factorTables, cells, {
      lcmOverride: 1.35, defaults: { do_base_rate: 600 },
    });

    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).toContain("derive.band"); // E4 — banding is on for every banded dim
    expect(kinds).toContain("lookup.direct");

    const compiled = compilePlan(plan);
    // The E4 symptom: a RAW number in the dim's own field now bins.
    const raw = runPlan(compiled, { revenue_band: 50000 });
    expect(raw.outputs.do_premium).toBeCloseTo(600 * 0.85 * 1.35, 4); // 688.5
    // A prebinned level id keeps working (idempotent pass-through).
    const prebinned = runPlan(compiled, { revenue_band: "02_25k_50k" });
    expect(prebinned.outputs.do_premium).toBeCloseTo(600 * 0.75 * 1.35, 4); // 607.5
  });

  // ── ADR-0028 — geographic territory grouping (cold-test L13) ──────

  // A geographic State dim grouped into 3 tiers, with a 3-row
  // territory-keyed factor table (T1/T2/T3). Mirrors the cold-test
  // CGL plan's State dim + Territories tab output.
  function geoStateDim(): Dimension {
    return {
      id: "state",
      slug: "state",
      display_name: "State",
      data_type: "string",
      role: "rating-input",
      dimension_type: "geographic",
      shape: "geographic",
      geo_granularity: "state",
      geo_scope: { kind: "national" },
      // 50+DC collapse to 3 tiers (subset shown — enough to exercise
      // the contract). `members` are the geo level ids (USPS codes).
      geo_territories: [
        { id: "T1", label: "Tier 1", members: ["CA", "FL", "NY"] },
        { id: "T2", label: "Tier 2", members: ["TX", "IL"] },
        { id: "T3", label: "Tier 3", members: ["WI", "MN", "OH"] },
      ],
      levels: [
        { kind: "geographic", id: "CA", label: "California" },
        { kind: "geographic", id: "TX", label: "Texas" },
        { kind: "geographic", id: "WI", label: "Wisconsin" },
      ],
    } as unknown as Dimension;
  }

  function geoChainStages(): StageLike[] {
    return [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "state_factor_do",
              factor_kind: "state_factor_do",
              dimensions: {
                state: { source: "form_input", path: "form_input.state" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
  }

  // Factor table keyed by the 3 TERRITORY ids (not 50+DC states).
  function geoFactorTables(): FactorTableLike[] {
    return [
      { id: "ft_state_do", display_name: "State D&O", key_dimension: "state", slug: "state_factor_do" } as unknown as FactorTableLike,
    ];
  }
  function geoCells(): ReadonlyMap<string, ReadonlyMap<string, number>> {
    return new Map<string, ReadonlyMap<string, number>>([
      ["ft_state_do", new Map([
        ["T1", 1.30],
        ["T2", 1.10],
        ["T3", 0.90],
      ])],
    ]);
  }

  it("inserts derive.territory for a geographic dim with a territory grouping (ADR-0028 — L13)", () => {
    const { plan } = stagesToRuntimePlan(
      geoChainStages(),
      [geoStateDim()],
      geoFactorTables(),
      geoCells(),
      { lcmOverride: 1.35, defaults: { do_base_rate: 600 } },
    );

    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).toContain("derive.territory");
    expect(kinds).toContain("lookup.direct");

    // The derive.territory node carries the value→territory map built
    // from geo_territories.members.
    const terrNode = plan.nodes.find((n) => n.kind === "derive.territory");
    const map = (terrNode?.params as { territoryMap: Record<string, string> })
      .territoryMap;
    expect(map.CA).toBe("T1");
    expect(map.TX).toBe("T2");
    expect(map.WI).toBe("T3");
    // Labels ride along for the trace.
    const labels = (terrNode?.params as { territoryLabels: Record<string, string> })
      .territoryLabels;
    expect(labels.T1).toBe("Tier 1");
  });

  it("scores a CA risk THROUGH its territory tier, not the 1.0 default (L13 core)", () => {
    const { plan } = stagesToRuntimePlan(
      geoChainStages(),
      [geoStateDim()],
      geoFactorTables(),
      geoCells(),
      { lcmOverride: 1.35, defaults: { do_base_rate: 600 } },
    );
    const compiled = compilePlan(plan);

    // CA → T1 → 1.30.  600 × 1.30 × 1.35 = 1053
    const ca = runPlan(compiled, { state: "CA" });
    expect(ca.outputs.do_premium).toBeCloseTo(600 * 1.30 * 1.35, 4);

    // A different state in a different tier picks up a DIFFERENT factor —
    // proving the territory grouping (not a per-state table) is driving it.
    const wi = runPlan(compiled, { state: "WI" });
    expect(wi.outputs.do_premium).toBeCloseTo(600 * 0.90 * 1.35, 4);

    // The trace records the resolution step (state → territory).
    const terrTrace = Object.values(ca.trace).find(
      (t) => t.kindId === "derive.territory",
    );
    expect(terrTrace?.outputs.territory_id).toBe("T1");
    expect(terrTrace?.outputs.unmapped).toBe(false);
  });

  it("REFUSES the row for an unmapped state (ADR-0056) — the trace + issues name the cause", () => {
    const { plan } = stagesToRuntimePlan(
      geoChainStages(),
      [geoStateDim()],
      geoFactorTables(),
      geoCells(),
      { lcmOverride: 1.35, defaults: { do_base_rate: 600 } },
    );
    const compiled = compilePlan(plan);

    // PR (Puerto Rico) is in no tier → derive.territory returns "" with
    // unmapped=true → the lookup misses → the ERROR default refuses the
    // row (pre-ADR-0056 this silently priced at 1.0 → $810).
    const pr = runPlan(compiled, { state: "PR" });
    expect(pr.row_status).toBe("error");
    expect(pr.outputs).not.toHaveProperty("do_premium");
    // Root cause named by the derive enricher…
    expect(pr.issues?.some((i) => i.code === "territory_unmapped")).toBe(true);
    // …and the refusal by the lookup's policy.
    expect(pr.issues?.some((i) => i.code === "unknown_key")).toBe(true);

    const terrTrace = Object.values(pr.trace).find(
      (t) => t.kindId === "derive.territory",
    );
    // The diagnostic the score-time surface counts on — the state is
    // VISIBLY unmapped, not silently priced at 1.0.
    expect(terrTrace?.outputs.unmapped).toBe(true);
    expect(terrTrace?.outputs.territory_id).toBe("");
  });

  it("does NOT insert derive.territory for a geographic dim WITHOUT territories (V21 path preserved)", () => {
    // A geographic dim with an empty territory grouping rates directly
    // on the state levels — the pre-L13 behavior. No derive.territory;
    // the state code hits lookup.direct keyed by state.
    const dimNoTerr = {
      ...geoStateDim(),
      geo_territories: [],
    } as unknown as Dimension;
    // Table now keyed by state codes (the rate-directly-on-states model).
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft_state_do", new Map([["CA", 1.30], ["WI", 0.90]])],
    ]);

    const { plan } = stagesToRuntimePlan(
      geoChainStages(),
      [dimNoTerr],
      geoFactorTables(),
      cells,
      { lcmOverride: 1.35, defaults: { do_base_rate: 600 } },
    );

    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).not.toContain("derive.territory");
    expect(kinds).toContain("lookup.direct");

    const compiled = compilePlan(plan);
    // Raw state key hits the per-state table directly.
    const ca = runPlan(compiled, { state: "CA" });
    expect(ca.outputs.do_premium).toBeCloseTo(600 * 1.30 * 1.35, 4);
  });

  // ── ADR-0035 (Brief 51) — class-derived structural dimension ─────
  function classCodeDim(): Dimension {
    return {
      id: "class_code",
      slug: "class_code",
      display_name: "Class code",
      data_type: "string",
      role: "rating-input",
      dimension_type: "classification",
      shape: "categorical",
      // Each level snapshots the class's derived attributes — the
      // projector builds the derive.class_attribute table from these.
      levels: [
        { kind: "categorical", id: "c101", label: "Meridian Neighborhood Bakery", aliases: [], attributes: { prop_rate_number: "07" } },
        { kind: "categorical", id: "c102", label: "Meridian General Merchandise", aliases: [], attributes: { prop_rate_number: "11" } },
      ],
    } as unknown as Dimension;
  }
  function rateNumberDim(): Dimension {
    return {
      id: "prop_rate_number",
      slug: "prop_rate_number",
      display_name: "Property rate number",
      data_type: "string",
      role: "structural",
      dimension_type: "standard",
      shape: "categorical",
      derived_from: { source_dim: "class_code", attribute: "prop_rate_number" },
      levels: [
        { kind: "categorical", id: "07", label: "07" },
        { kind: "categorical", id: "11", label: "11" },
      ],
    } as unknown as Dimension;
  }
  function classChainStages(): StageLike[] {
    return [
      chainStage("bld_chain", [
        {
          name: "building",
          base_input: "form_input.base_rate",
          factor_lookups: [
            {
              name: "rate_no_rel",
              factor_kind: "rate_number_rel",
              dimensions: {
                prop_rate_number: {
                  source: "form_input",
                  path: "form_input.prop_rate_number",
                },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "building_premium",
        },
      ]),
    ];
  }
  const classFactorTables: FactorTableLike[] = [
    {
      id: "ft_rate_no",
      display_name: "Rate Number relativity",
      key_dimension: "prop_rate_number",
      slug: "rate_number_rel",
    } as unknown as FactorTableLike,
  ];
  const classCells = new Map<string, ReadonlyMap<string, number>>([
    ["ft_rate_no", new Map([["07", 1.25], ["11", 1.0]])],
  ]);

  it("inserts derive.class_attribute for a class-derived structural dim (ADR-0035 / Brief 51)", () => {
    const { plan } = stagesToRuntimePlan(
      classChainStages(),
      [classCodeDim(), rateNumberDim()],
      classFactorTables,
      classCells,
      { lcmOverride: 1.4, defaults: { base_rate: 0.4 } },
    );
    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).toContain("derive.class_attribute");
    expect(kinds).toContain("lookup.direct");

    const node = plan.nodes.find((n) => n.kind === "derive.class_attribute");
    const params = node?.params as {
      attributeKey: string;
      table: Record<string, string>;
    };
    expect(params.attributeKey).toBe("prop_rate_number");
    // The class→attribute table is snapshotted from class_code's levels.
    expect(params.table["c101"]).toBe("07");
    expect(params.table["c102"]).toBe("11");
  });

  it("scores a risk through a fictional class-derived rate number (c101 → 07 → 1.25)", () => {
    const { plan } = stagesToRuntimePlan(
      classChainStages(),
      [classCodeDim(), rateNumberDim()],
      classFactorTables,
      classCells,
      { lcmOverride: 1.4, defaults: { base_rate: 0.4 } },
    );
    const compiled = compilePlan(plan);
    const out = runPlan(compiled, { class_code: "c101" });
    // Fictional values: base 0.4 × rate-number relativity 1.25 × LCM 1.4.
    expect(out.outputs.building_premium).toBeCloseTo(0.4 * 1.25 * 1.4, 4);
  });

  it("honors derived_from.override_field — a declared value supersedes the class derivation (Brief 83 / TV-19)", () => {
    // The rate-number dim authors an override field. A row that carries a
    // non-empty value rates on IT; a row without one (the quote flow)
    // rates on the class derivation — same plan, same graph.
    const dimWithOverride = {
      ...rateNumberDim(),
      derived_from: {
        source_dim: "class_code",
        attribute: "prop_rate_number",
        override_field: "rate_number_override",
      },
    } as unknown as Dimension;
    const { plan } = stagesToRuntimePlan(
      classChainStages(),
      [classCodeDim(), dimWithOverride],
      classFactorTables,
      classCells,
      { lcmOverride: 1.4, defaults: { base_rate: 0.4 } },
    );
    // The override input node exists and feeds the derive's override port.
    const derive = plan.nodes.find((n) => n.kind === "derive.class_attribute");
    const ovEdge = plan.edges.find(
      (e) => e.to.node === derive?.id && e.to.port === "override",
    );
    expect(ovEdge).toBeDefined();

    const compiled = compilePlan(plan);
    // No override supplied → class-derived (c101 → 07 → 1.25).
    const derived = runPlan(compiled, { class_code: "c101" });
    expect(derived.outputs.building_premium).toBeCloseTo(
      0.4 * 1.25 * 1.4,
      4,
    );
    // Declared override → supersedes (→ 11 → 1.0).
    const overridden = runPlan(compiled, {
      class_code: "c101",
      rate_number_override: "11",
    });
    expect(overridden.outputs.building_premium).toBeCloseTo(
      0.4 * 1.0 * 1.4,
      4,
    );
    // Blank override (the book's empty CSV cell) → class-derived again.
    const blank = runPlan(compiled, {
      class_code: "c101",
      rate_number_override: "",
    });
    expect(blank.outputs.building_premium).toBeCloseTo(
      0.4 * 1.25 * 1.4,
      4,
    );
  });

  it("level ALIASES widen lookups — the integrator's raw vocabulary rates exactly (Brief 83.2)", () => {
    // q1 authors alias "1": a quote sending the raw "1" must resolve
    // the same factor as the level id, with zero wire transforms.
    const qualityGradeDim = {
      id: "quality_grade",
      slug: "quality_grade",
      display_name: "Meridian quality grade",
      data_type: "string",
      role: "rating-input",
      dimension_type: "standard",
      shape: "categorical",
      levels: [
        { kind: "categorical", id: "q1", label: "Quality grade 1", aliases: ["1"] },
        { kind: "categorical", id: "q2", label: "Quality grade 2", aliases: ["2"] },
      ],
    } as unknown as Dimension;
    const stages: StageLike[] = [
      chainStage("alias_chain", [
        {
          name: "building",
          base_input: "form_input.base_rate",
          factor_lookups: [
            {
              name: "quality_grade_rel",
              factor_kind: "quality_grade_rel",
              dimensions: {
                quality_grade: {
                  source: "form_input",
                  path: "form_input.quality_grade",
                },
              },
            },
          ],
          lcm: { value: 1.0 },
          output_field: "building_premium",
        },
      ]),
    ];
    const fts: FactorTableLike[] = [
      {
        id: "ft_quality_grade",
        display_name: "Meridian quality-grade factor",
        key_dimension: "quality_grade",
        slug: "quality_grade_rel",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft_quality_grade", new Map([["q1", 0.9], ["q2", 1.1]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [qualityGradeDim], fts, cells, {
      defaults: { base_rate: 100 },
    });
    const compiled = compilePlan(plan);
    // The level id and its alias resolve identically.
    const byId = runPlan(compiled, { quality_grade: "q1" });
    const byAlias = runPlan(compiled, { quality_grade: "1" });
    expect(byId.outputs.building_premium).toBeCloseTo(90, 6);
    expect(byAlias.outputs.building_premium).toBeCloseTo(90, 6);
    // An alias never shadows a real id from another level.
    const other = runPlan(compiled, { quality_grade: "2" });
    expect(other.outputs.building_premium).toBeCloseTo(110, 6);
  });

  it("aliases widen 2-D composite keys too (deductible × banded limit — Brief 83.2)", () => {
    // ded_1500 aliases "1500"; the limit axis is banded (numeric, no
    // aliases). The raw pair (1500, 100000) must resolve the same cell
    // as (ded_1500, band).
    const dedDim = {
      id: "property_deductible",
      slug: "property_deductible",
      display_name: "Property deductible",
      data_type: "string",
      role: "rating-input",
      dimension_type: "standard",
      shape: "categorical",
      levels: [
        { kind: "categorical", id: "ded_500", label: "$500", aliases: ["500"] },
        { kind: "categorical", id: "ded_1500", label: "$1500", aliases: ["1500"] },
      ],
    } as unknown as Dimension;
    const bandDim = {
      id: "limit_band",
      slug: "limit_band",
      display_name: "Limit band",
      data_type: "number",
      role: "rating-input",
      dimension_type: "standard",
      shape: "banded",
      levels: [
        { kind: "banded", id: "band_lo", label: "to 250k", lo: 0, hi: 250001 },
        { kind: "banded", id: "band_hi", label: "250k up", lo: 250001, hi: null },
      ],
    } as unknown as Dimension;
    const stages: StageLike[] = [
      chainStage("ded_chain", [
        {
          name: "building",
          base_input: "form_input.base_rate",
          factor_lookups: [
            {
              name: "ded_rel",
              factor_kind: "ded_rel",
              dimensions: {
                property_deductible: {
                  source: "form_input",
                  path: "form_input.property_deductible",
                },
                limit_band: {
                  // Live shape (83.1): the band axis is a computed SUM,
                  // then banded — the alias widening must be orthogonal.
                  source: "computed",
                  op: "sum",
                  fields: ["building_limit", "bpp_limit"],
                } as unknown as { source: string; path: string },
              },
            },
          ],
          lcm: { value: 1.0 },
          output_field: "building_premium",
        },
      ]),
    ];
    const fts: FactorTableLike[] = [
      {
        id: "ft_ded",
        display_name: "Deductible factors",
        key_dimensions: ["property_deductible", "limit_band"],
        slug: "ded_rel",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      [
        "ft_ded",
        new Map([
          ["ded_500::band_lo", 1.05],
          ["ded_1500::band_lo", 0.95],
          ["ded_1500::band_hi", 0.9],
        ]),
      ],
    ]);
    const { plan } = stagesToRuntimePlan(
      stages,
      [dedDim, bandDim],
      fts,
      cells,
      { defaults: { base_rate: 100 } },
    );
    const compiled = compilePlan(plan);
    // The band axis SUMS building+bpp (60k+40k=100k → band_lo).
    const byId = runPlan(compiled, {
      property_deductible: "ded_1500",
      building_limit: 60000,
      bpp_limit: 40000,
    });
    const byAlias = runPlan(compiled, {
      property_deductible: "1500",
      building_limit: 60000,
      bpp_limit: 40000,
    });
    expect(byId.outputs.building_premium).toBeCloseTo(95, 6);
    expect(byAlias.outputs.building_premium).toBeCloseTo(95, 6);
  });

  it("a class-derived axis leaks NO orphan raw input node; the override input is optional (Brief 83.2)", () => {
    const dimWithOverride = {
      ...rateNumberDim(),
      derived_from: {
        source_dim: "class_code",
        attribute: "prop_rate_number",
        override_field: "rate_number_override",
      },
    } as unknown as Dimension;
    const { plan } = stagesToRuntimePlan(
      classChainStages(),
      [classCodeDim(), dimWithOverride],
      classFactorTables,
      classCells,
      { lcmOverride: 1.4, defaults: { base_rate: 0.4 } },
    );
    const inputFields = plan.nodes
      .filter((n) => n.kind === "input")
      .map((n) => (n.params as { fieldName: string }).fieldName);
    // The derived slug never becomes an input — only its source + override.
    expect(inputFields).not.toContain("prop_rate_number");
    expect(inputFields).toContain("class_code");
    expect(inputFields).toContain("rate_number_override");
    // The override is structurally optional (preflight must not demand it).
    const ov = plan.nodes.find(
      (n) =>
        n.kind === "input" &&
        (n.params as { fieldName: string }).fieldName === "rate_number_override",
    );
    expect((ov?.params as { optional?: boolean }).optional).toBe(true);
  });

  it("projects multiple chains into independent subtrees with separate outputs", () => {
    const stages: StageLike[] = [
      chainStage("do_gl_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
        {
          name: "gl_premium",
          base_input: "form_input.gl_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_gl",
              factor_kind: "ntee_factor_gl",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "gl_premium",
        },
      ]),
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft_do", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
      { id: "ft_gl", display_name: "NTEE GL", key_dimension: "ntee_major", slug: "ntee_factor_gl" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft_do", new Map([["religion", 1.20]])],
      ["ft_gl", new Map([["religion", 1.15]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
    });

    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      do_base_rate: 600,
      gl_base_rate: 300,
      ntee_major: "religion",
    });
    expect(result.outputs.do_premium).toBeCloseTo(600 * 1.2 * 1.35, 4); // 972
    expect(result.outputs.gl_premium).toBeCloseTo(300 * 1.15 * 1.35, 4); // 465.75

    // The NTEE input node is shared (not duplicated) — only one
    // input node with fieldName "ntee_major" should exist.
    const ntee_inputs = plan.nodes.filter(
      (n) => n.kind === "input" && (n.params as { fieldName?: string }).fieldName === "ntee_major",
    );
    expect(ntee_inputs).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────
  // H.3.1 — modifier.schedule layering (Brief 42 §−1 Q1 + Q2 + Q7)
  // ─────────────────────────────────────────────────────────────────
  it("layers a modifier.schedule stage between the chain tip and the output", () => {
    // Chain produces do_premium = base × ntee × lcm = 600 × 1.20 × 1.35 = 972
    // Schedule layers +5% mgmt → final = 972 × 1.05 = 1020.6
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
      {
        stage_id: "sched_irpm",
        stage_kind: "modifier.schedule",
        config_json: {
          schedule: {
            schedule_id: "test_irpm",
            display_name: "Test IRPM",
            scope: "per_coverage",
            total_cap_pct: 25,
            categories: [
              {
                category_id: "mgmt",
                name: "Management",
                range_pct: 10,
                reasoning_required: true,
              },
            ],
          },
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft1", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.20]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
      defaults: { do_base_rate: 600 },
    });

    // Sanity: plan includes the modifier.schedule node + an applying chain.mult
    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).toContain("modifier.schedule");

    // The chain.mult count should be 2: one for the chain itself + one
    // for the modifier layer.
    const chainMults = plan.nodes.filter((n) => n.kind === "chain.mult");
    expect(chainMults.length).toBe(2);

    // Exactly one schedule application input was emitted
    const appInputs = plan.nodes.filter(
      (n) =>
        n.kind === "input" &&
        (n.params as { fieldName?: string }).fieldName === "schedule_app_test_irpm",
    );
    expect(appInputs).toHaveLength(1);

    // Compile + execute end-to-end. The schedule application supplies
    // +5% for the management category.
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      ntee_major: "religion",
      schedule_app_test_irpm: {
        schedule_id: "test_irpm",
        values: {
          mgmt: {
            value_pct: 5,
            reasoning: "Strong owner involvement.",
            source: "underwriter",
          },
        },
      },
    });
    // 600 × 1.20 × 1.35 × 1.05 = 1020.6
    expect(result.outputs.do_premium).toBeCloseTo(1020.6, 4);
  });

  it("scope=package projects EXACTLY on a multi-coverage plan — no fallback warning (finding E9)", () => {
    // The kind's ONLY output is one multiplicative factor, so
    //   (Σ coverageᵢ) × factor ≡ Σ (coverageᵢ × factor)
    // — the per-tip application IS the pro-rata split of one package
    // application. This test is the TRIPWIRE: if modifier.schedule
    // ever grows a non-multiplicative mode, the identity breaks and
    // package scope needs a real sum→apply graph.
    const stages: StageLike[] = [
      chainStage("chains", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
        {
          name: "gl_premium",
          base_input: "form_input.gl_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "gl_premium",
        },
      ]),
      {
        stage_id: "sched_irpm",
        stage_kind: "modifier.schedule",
        config_json: {
          schedule: {
            schedule_id: "test_irpm",
            display_name: "Test IRPM",
            scope: "package",
            total_cap_pct: 25,
            categories: [
              {
                category_id: "mgmt",
                name: "Management",
                range_pct: 10,
                reasoning_required: true,
              },
            ],
          },
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft1", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.2]])],
    ]);
    const { plan, issues } = stagesToRuntimePlan(
      stages,
      [NTEE_DIM],
      factorTables,
      cells,
      { lcmOverride: 1.35, defaults: { do_base_rate: 600, gl_base_rate: 400 } },
    );

    // E9 — no degradation warning: nothing degrades.
    expect(issues.map((i) => i.code)).not.toContain("package_scope_fallback");

    // The application nodes' trace label names the FILED application.
    const applyMults = plan.nodes.filter(
      (n) =>
        n.kind === "chain.mult" &&
        Array.isArray((n.params as { factorNames?: string[] }).factorNames) &&
        (n.params as { factorNames: string[] }).factorNames[0]?.includes(
          "package",
        ),
    );
    expect(applyMults.length).toBe(2);
    expect(
      (applyMults[0]!.params as { factorNames: string[] }).factorNames[0],
    ).toBe("mod_factor (package · pro-rata)");

    // The identity, end-to-end: +5% package application.
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      ntee_major: "religion",
      schedule_app_test_irpm: {
        schedule_id: "test_irpm",
        values: {
          mgmt: { value_pct: 5, reasoning: "Owner involvement.", source: "underwriter" },
        },
      },
    });
    // do = 600×1.2×1.35 = 972 → ×1.05 = 1020.6
    // gl = 400×1.2×1.35 = 648 → ×1.05 = 680.4
    expect(result.outputs.do_premium).toBeCloseTo(1020.6, 4);
    expect(result.outputs.gl_premium).toBeCloseTo(680.4, 4);
    // Σ(coverageᵢ × f) === (Σ coverageᵢ) × f — the package identity.
    const summed =
      (result.outputs.do_premium as number) +
      (result.outputs.gl_premium as number);
    expect(summed).toBeCloseTo((972 + 648) * 1.05, 6);
  });

  it("treats a missing schedule application as zero modifier (factor 1.0)", () => {
    // No schedule_app input → modifier.schedule defaults values to 0 →
    // factor = 1.0 → premium unchanged from base chain output.
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
      {
        stage_id: "sched_irpm",
        stage_kind: "modifier.schedule",
        config_json: {
          schedule: {
            schedule_id: "test_irpm",
            display_name: "Test IRPM",
            scope: "per_coverage",
            total_cap_pct: 25,
            categories: [
              { category_id: "mgmt", name: "Management", range_pct: 10, reasoning_required: true },
            ],
          },
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft1", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.20]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
      defaults: { do_base_rate: 600 },
    });
    const compiled = compilePlan(plan);
    // schedule_app_test_irpm absent — modifier.schedule defaults to 1.0
    const result = runPlan(compiled, {
      ntee_major: "religion",
      schedule_app_test_irpm: { schedule_id: "test_irpm", values: {} },
    });
    expect(result.outputs.do_premium).toBeCloseTo(972, 4);
  });

  it("applies modifier.schedule independently to each chain output (per_coverage default)", () => {
    // Brief 42 §−1 Q7 lock: scope=per_coverage applies the modifier
    // independently to every chain tip. D&O + GL both get +5%.
    const stages: StageLike[] = [
      chainStage("multi_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
        {
          name: "gl_premium",
          base_input: "form_input.gl_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_gl",
              factor_kind: "ntee_factor_gl",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "gl_premium",
        },
      ]),
      {
        stage_id: "sched_irpm",
        stage_kind: "modifier.schedule",
        config_json: {
          schedule: {
            schedule_id: "test_irpm",
            display_name: "Test IRPM",
            scope: "per_coverage",
            total_cap_pct: 25,
            categories: [
              { category_id: "mgmt", name: "Management", range_pct: 10, reasoning_required: true },
            ],
          },
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft_do", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
      { id: "ft_gl", display_name: "NTEE GL", key_dimension: "ntee_major", slug: "ntee_factor_gl" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft_do", new Map([["religion", 1.20]])],
      ["ft_gl", new Map([["religion", 1.15]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
    });

    // Expect 4 chain.mult nodes: 2 for the two chains + 2 for the
    // per-coverage modifier layers
    const chainMults = plan.nodes.filter((n) => n.kind === "chain.mult");
    expect(chainMults.length).toBe(4);

    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      do_base_rate: 600,
      gl_base_rate: 300,
      ntee_major: "religion",
      schedule_app_test_irpm: {
        schedule_id: "test_irpm",
        values: {
          mgmt: { value_pct: 5, reasoning: "Test.", source: "underwriter" },
        },
      },
    });
    // 600 × 1.20 × 1.35 × 1.05 = 1020.6
    expect(result.outputs.do_premium).toBeCloseTo(1020.6, 4);
    // 300 × 1.15 × 1.35 × 1.05 = 489.0375
    expect(result.outputs.gl_premium).toBeCloseTo(489.0375, 4);
  });

  // ─────────────────────────────────────────────────────────────────
  // H.3.2 — endorsement.{factor,additive,sublimit} layering
  // (Brief 42 §−1 Q1 + Q3)
  // ─────────────────────────────────────────────────────────────────
  // 92.5 live finding — one endorsement node shared across N tower tips
  // fed EVERY tip from the first tower's premium (all coverages came
  // back identical). The fix instantiates the endorsement per tip
  // (distributive for factors); once-per-policy kinds (additive /
  // rate_branch) REFUSE on multi-tower plans instead of applying N×.
  it("applies endorsement.factor per tower tip — never a shared node (92.5)", () => {
    const stages: StageLike[] = [
      chainStage("two_towers", [
        {
          name: "alpha",
          base_input: "form_input.alpha_base",
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "alpha_premium",
        },
        {
          name: "beta",
          base_input: "form_input.beta_base",
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "beta_premium",
        },
      ]),
      {
        stage_id: "end_surcharge",
        stage_kind: "endorsement.factor",
        config_json: {
          form_number: "TEST-92",
          display_name: "Surcharge",
          trigger: { variable: "surcharged", op: "eq", value: true },
          factor: 1.1,
        },
      },
    ];
    const { plan, issues } = stagesToRuntimePlan(stages, [], [], new Map(), {
      defaults: { alpha_base: 100, beta_base: 300 },
    });
    expect(
      plan.nodes.filter((n) => n.kind === "endorsement.factor"),
    ).toHaveLength(2);
    expect(issues.map((i) => i.code)).not.toContain(
      "endorsement_additive_multi_tower",
    );
    const result = runPlan(compilePlan(plan), { surcharged: true });
    // Each tower surcharged INDEPENDENTLY — the pre-fix bug returned
    // the first tower's value (110) for BOTH outputs.
    expect(result.outputs.alpha_premium).toBeCloseTo(110, 4);
    expect(result.outputs.beta_premium).toBeCloseTo(330, 4);
  });

  it("refuses a once-per-policy additive on a multi-tower plan (92.5)", () => {
    const stages: StageLike[] = [
      chainStage("two_towers", [
        {
          name: "alpha",
          base_input: "form_input.alpha_base",
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "alpha_premium",
        },
        {
          name: "beta",
          base_input: "form_input.beta_base",
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "beta_premium",
        },
      ]),
      {
        stage_id: "end_flat_fee",
        stage_kind: "endorsement.additive",
        config_json: {
          form_number: "TEST-93",
          display_name: "Flat fee",
          trigger: null,
          amount: 125,
        },
      },
    ];
    const { plan, issues } = stagesToRuntimePlan(stages, [], [], new Map(), {
      defaults: { alpha_base: 100, beta_base: 300 },
    });
    expect(
      issues.filter((i) => i.code === "endorsement_additive_multi_tower"),
    ).toHaveLength(1);
    const result = runPlan(compilePlan(plan), {});
    // NOT applied (neither once, nor N times, nor via a shared node).
    expect(result.outputs.alpha_premium).toBeCloseTo(100, 4);
    expect(result.outputs.beta_premium).toBeCloseTo(300, 4);
  });

  it("layers endorsement.factor onto the chain tip when trigger fires", () => {
    // Chain: 600 × 1.20 × 1.35 = 972
    // Endorsement.factor (×1.10) fires when has_liquor === true
    // Final: 972 × 1.10 = 1069.2
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
      {
        stage_id: "end_liquor",
        stage_kind: "endorsement.factor",
        config_json: {
          form_number: "TEST-LIQ",
          display_name: "Test liquor surcharge",
          trigger: { variable: "has_liquor", op: "eq", value: true },
          factor: 1.10,
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft1", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.20]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
      defaults: { do_base_rate: 600 },
    });

    // Verify the endorsement node was emitted
    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).toContain("endorsement.factor");

    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      ntee_major: "religion",
      has_liquor: true,
    });
    // 600 × 1.20 × 1.35 × 1.10 = 1069.2
    expect(result.outputs.do_premium).toBeCloseTo(1069.2, 4);
  });

  it("leaves premium unchanged when endorsement.factor trigger misses", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
      {
        stage_id: "end_liquor",
        stage_kind: "endorsement.factor",
        config_json: {
          form_number: "TEST-LIQ",
          display_name: "Test liquor surcharge",
          trigger: { variable: "has_liquor", op: "eq", value: true },
          factor: 1.10,
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft1", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.20]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
      defaults: { do_base_rate: 600 },
    });
    const compiled = compilePlan(plan);
    // has_liquor=false → endorsement doesn't attach
    const result = runPlan(compiled, {
      ntee_major: "religion",
      has_liquor: false,
    });
    // Premium unchanged: 600 × 1.20 × 1.35 = 972
    expect(result.outputs.do_premium).toBeCloseTo(972, 4);
  });

  it("adds endorsement.additive amount when trigger fires", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
      {
        stage_id: "end_ca_surcharge",
        stage_kind: "endorsement.additive",
        config_json: {
          form_number: "TEST-CA",
          display_name: "Test CA surcharge",
          trigger: { variable: "state", op: "eq", value: "CA" },
          amount: 50,
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft1", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.20]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
      defaults: { do_base_rate: 600 },
    });
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      ntee_major: "religion",
      state: "CA",
    });
    // 600 × 1.20 × 1.35 + 50 = 972 + 50 = 1022
    expect(result.outputs.do_premium).toBeCloseTo(1022, 4);
  });

  it("emits a sublimit output for endorsement.sublimit; premium passes through", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: { source: "form_input", path: "form_input.ntee_major" },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
      {
        stage_id: "end_peak_sub",
        stage_kind: "endorsement.sublimit",
        config_json: {
          form_number: "TEST-SUB",
          display_name: "Test peak sublimit",
          trigger: { variable: "tiv", op: "gt", value: 500000 },
          coverage: "peak_items",
          sublimit: 100000,
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      { id: "ft1", display_name: "NTEE D&O", key_dimension: "ntee_major", slug: "ntee_factor_do" } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.20]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells, {
      lcmOverride: 1.35,
      defaults: { do_base_rate: 600 },
    });

    // Confirm the projector emitted the sublimit output node
    const sublimitOutput = plan.nodes.find(
      (n) =>
        n.kind === "output" &&
        (n.params as { fieldName?: string }).fieldName === "sublimit_peak_items",
    );
    expect(sublimitOutput).toBeDefined();

    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      ntee_major: "religion",
      tiv: 750000,
    });
    // Premium unchanged by sublimit endorsement: 600 × 1.20 × 1.35 = 972
    expect(result.outputs.do_premium).toBeCloseTo(972, 4);
    // Sublimit metadata exposed on the secondary output
    expect(result.outputs.sublimit_peak_items).toEqual({
      coverage: "peak_items",
      value: 100000,
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Brief 70.1 / ADR-016 — policy-scope gates stay OUT of the per-row
  // projection (they run post-rollup via evaluatePolicyBook). The leak
  // let a scope:'policy' gate evaluate per-row against same-named
  // fields AND wire its tier into per-row modifiers when it sorted
  // first.
  it("skips scope:'policy' eligibility gates in the per-row projection", () => {
    const stages: StageLike[] = [
      {
        stage_id: "policy_gate",
        stage_kind: "eligibility.gate",
        config_json: {
          scope: "policy",
          rules: [
            {
              rule_id: "tiv_cap",
              variable: "tiv",
              op: "ge",
              value: 1000000,
              tier: "decline",
              reasoning: "Policy TIV cap.",
            },
          ],
          default_tier: "standard",
          default_reasoning: "Within appetite.",
        },
      },
      {
        stage_id: "row_gate",
        stage_kind: "eligibility.gate",
        config_json: {
          scope: "row",
          rules: [
            {
              rule_id: "quality_decline",
              variable: "quality_grade",
              op: "eq",
              value: "q10",
              tier: "decline",
              reasoning: "Outside Meridian appetite.",
            },
          ],
          default_tier: "standard",
          default_reasoning: "Within appetite.",
        },
      },
    ];
    const { plan } = stagesToRuntimePlan(stages, [], [], new Map());
    const gateNodes = plan.nodes.filter(
      (n) => n.kind === "eligibility.gate",
    );
    expect(gateNodes).toHaveLength(1);
    expect(gateNodes[0]!.id).toBe("gate_row_gate");
  });

  // H.3.3 — eligibility.gate → modifier.schedule tier wiring
  // (Brief 42 §−1 Q9; Brief 15 P-M9 tier-conditional categories)
  // ─────────────────────────────────────────────────────────────────
  it("wires eligibility.gate's tier output to modifier.schedule's tier port", () => {
    const stages: StageLike[] = [
      {
        stage_id: "gate",
        stage_kind: "eligibility.gate",
        config_json: {
          rules: [
            {
              rule_id: "ca_preferred",
              variable: "state",
              op: "eq",
              value: "CA",
              tier: "preferred",
              reasoning: "California is core market.",
            },
          ],
          default_tier: "standard",
          default_reasoning: "Non-core market.",
        },
      },
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
      {
        stage_id: "sched_irpm",
        stage_kind: "modifier.schedule",
        config_json: {
          schedule: {
            schedule_id: "test_irpm",
            display_name: "Test IRPM",
            scope: "per_coverage",
            total_cap_pct: 25,
            categories: [
              { category_id: "mgmt", name: "Management", range_pct: 10, reasoning_required: true },
            ],
          },
        },
      },
    ];
    const { plan } = stagesToRuntimePlan(stages, [], [], new Map(), {
      lcmOverride: 1.0,
      defaults: { do_base_rate: 1000 },
    });

    // Find the gate node + modifier node
    const gateNode = plan.nodes.find((n) => n.kind === "eligibility.gate");
    const modNode = plan.nodes.find((n) => n.kind === "modifier.schedule");
    expect(gateNode).toBeDefined();
    expect(modNode).toBeDefined();

    // The projector should have wired gate.tier → modifier.tier
    const tierEdge = plan.edges.find(
      (e) =>
        e.from.node === gateNode!.id &&
        e.from.port === "tier" &&
        e.to.node === modNode!.id &&
        e.to.port === "tier",
    );
    expect(tierEdge).toBeDefined();

    // End-to-end run: gate fires (state=CA → preferred), modifier
    // applies +5%, premium = 1000 × 1.05 = 1050
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      state: "CA",
      schedule_app_test_irpm: {
        schedule_id: "test_irpm",
        values: {
          mgmt: { value_pct: 5, reasoning: "Strong.", source: "underwriter" },
        },
      },
    });
    expect(result.outputs.do_premium).toBeCloseTo(1050, 4);
  });

  // ─────────────────────────────────────────────────────────────────
  // H.7 — modifier.model projection (Brief 41 + Brief 42 §−1 Q6)
  // ─────────────────────────────────────────────────────────────────
  it("projects modifier.model + fires fallback when declared_input is missing", () => {
    // V19-shape integration test through the projector. Chain emits
    // base premium 1000; model fallback fires (credit_score missing);
    // final = 1000 × 0.95 = 950.
    const stages: StageLike[] = [
      chainStage("base_chain", [
        {
          name: "premium",
          base_input: "form_input.base",
          factor_lookups: [],
          lcm: { input_path: "form_input.lcm" },
          output_field: "final_premium",
        },
      ]),
      {
        stage_id: "mod_credit_model",
        stage_kind: "modifier.model",
        config_json: {
          model_id: "test_pricing_v1",
          version: "2026.05",
          declared_inputs: [{ variable: "credit_score", source: "input" }],
          clamp: { min_factor: 0.85, max_factor: 1.25 },
          rationale: "Filed cap.",
          fallback_factor: 0.95,
        },
      },
    ];
    const { plan } = stagesToRuntimePlan(stages, [], [], new Map(), {
      lcmOverride: 1.0,
      defaults: { base: 1000 },
    });

    // The modifier.model node + 3 ancillary outputs exist
    expect(plan.nodes.some((n) => n.kind === "modifier.model")).toBe(true);
    const factorOut = plan.nodes.find(
      (n) =>
        n.kind === "output" &&
        (n.params as { fieldName?: string }).fieldName === "test_pricing_v1_factor_used",
    );
    expect(factorOut).toBeDefined();
    const firedOut = plan.nodes.find(
      (n) =>
        n.kind === "output" &&
        (n.params as { fieldName?: string }).fieldName === "test_pricing_v1_fallback_fired",
    );
    expect(firedOut).toBeDefined();
    const reasonOut = plan.nodes.find(
      (n) =>
        n.kind === "output" &&
        (n.params as { fieldName?: string }).fieldName === "test_pricing_v1_fallback_reason",
    );
    expect(reasonOut).toBeDefined();

    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {}); // credit_score missing → fallback
    expect(result.outputs.final_premium).toBeCloseTo(950, 4);
    expect(result.outputs.test_pricing_v1_factor_used).toBeCloseTo(0.95, 4);
    expect(result.outputs.test_pricing_v1_fallback_fired).toBe(true);
    expect(result.outputs.test_pricing_v1_fallback_reason).toBe(
      "missing_input:credit_score",
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // H.4 — endorsement.rate_branch projection (Brief 40 §−1 + Brief 42
  // §−1 Q5)
  // ─────────────────────────────────────────────────────────────────
  it("projects endorsement.rate_branch into runtime + adds branch contribution to premium", () => {
    // V18-shape integration test through the projector. Chain emits
    // base premium 1000; branch fires (has_liquor_sales=true);
    // contributes 500; final = 1500.
    const stages: StageLike[] = [
      chainStage("base_chain", [
        {
          name: "premium",
          base_input: "form_input.base",
          factor_lookups: [],
          lcm: { input_path: "form_input.lcm" },
          output_field: "final_premium",
        },
      ]),
      {
        stage_id: "end_liquor_branch",
        stage_kind: "endorsement.rate_branch",
        config_json: {
          form_number: "CG-2147",
          display_name: "Liquor Liability",
          trigger: {
            variable: "has_liquor_sales",
            op: "eq",
            value: true,
          },
          branch_chain: {
            name: "liquor_premium",
            base_input: "form_input.liquor_receipts",
            factor_lookups: [],
            lcm: { factor_kind: "lcm", input_path: "form_input.lcm" },
            exposure_input: "form_input.liquor_receipts",
            exposure_unit_divisor: 1,
            output_field: "liquor_premium",
          },
        },
      },
    ];
    const { plan } = stagesToRuntimePlan(stages, [], [], new Map(), {
      lcmOverride: 1.0,
      defaults: { base: 1000 },
    });

    // The rate_branch node + contribution output should exist
    const branchNode = plan.nodes.find(
      (n) => n.kind === "endorsement.rate_branch",
    );
    expect(branchNode).toBeDefined();
    const contributionOutput = plan.nodes.find(
      (n) =>
        n.kind === "output" &&
        (n.params as { fieldName?: string }).fieldName === "liquor_premium_contribution",
    );
    expect(contributionOutput).toBeDefined();

    const compiled = compilePlan(plan);
    // Note: branch LCM is INDEPENDENT (Brief 42 §−1 Q5) — the rate_branch
    // kind reads its own lcm from externalInputs.lcm, NOT from the
    // projector's lcmOverride (which only applies to the main chain's
    // LCM constant).
    const result = runPlan(compiled, {
      has_liquor_sales: true,
      liquor_receipts: 500,
      lcm: 1.0,
    });
    // 1000 + (500 × 1.0 / 1) = 1500
    expect(result.outputs.final_premium).toBeCloseTo(1500, 4);
    expect(result.outputs.liquor_premium_contribution).toBeCloseTo(500, 4);
  });

  it("composes endorsements in authored order (Brief 42 §−1 Q3)", () => {
    // V20-shape sanity check (single-coverage). The cascade composes:
    //   base 1000 × sched +5% × factor 1.10 + additive 50 = 1205
    const stages: StageLike[] = [
      chainStage("base_chain", [
        {
          name: "premium",
          base_input: "form_input.base",
          factor_lookups: [],
          lcm: { input_path: "form_input.lcm" },
          output_field: "final_premium",
        },
      ]),
      {
        stage_id: "sched",
        stage_kind: "modifier.schedule",
        config_json: {
          schedule: {
            schedule_id: "v20_irpm",
            display_name: "v20 IRPM",
            scope: "per_coverage",
            total_cap_pct: 25,
            categories: [
              { category_id: "mgmt", name: "Management", range_pct: 10, reasoning_required: true },
            ],
          },
        },
      },
      {
        stage_id: "end_factor",
        stage_kind: "endorsement.factor",
        config_json: {
          form_number: "V20-A",
          display_name: "Test factor",
          trigger: { variable: "has_liquor", op: "eq", value: true },
          factor: 1.10,
        },
      },
      {
        stage_id: "end_add",
        stage_kind: "endorsement.additive",
        config_json: {
          form_number: "V20-B",
          display_name: "Test additive",
          trigger: { variable: "state", op: "eq", value: "CA" },
          amount: 50,
        },
      },
    ];
    const { plan } = stagesToRuntimePlan(stages, [], [], new Map(), {
      lcmOverride: 1.0,
      defaults: { base: 1000 },
    });
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      state: "CA",
      has_liquor: true,
      schedule_app_v20_irpm: {
        schedule_id: "v20_irpm",
        values: {
          mgmt: { value_pct: 5, reasoning: "Strong management.", source: "underwriter" },
        },
      },
    });
    // 1000 × 1.05 × 1.10 + 50 = 1205 (matches V20 expected_outputs)
    expect(result.outputs.final_premium).toBeCloseTo(1205, 4);
  });

  // ──────────────────────────────────────────────────────────────────
  // ADR-0039 — 2-D factor table sliced per coverage tower
  //
  // base_lc_property is territory × coverage (Sample BOP 2025). The
  // Building tower (coverage_value:"building") must pull the building
  // column {t1:0.4, t2:0.4}; the BPP tower the bpp column
  // {t1:0.199, t2:0.180}. Before the slice landed, the projector
  // dropped every "rowId::colId" cell → empty table → both towers
  // priced at the neutral 1.0 (these tests were RED).
  // ──────────────────────────────────────────────────────────────────

  const TERRITORY_DIM: Dimension = {
    id: "territory",
    slug: "territory",
    display_name: "Territory",
    data_type: "string",
    role: "rating-input",
  } as Dimension;

  // The factor table the towers share (matched by slug → factor_kind).
  const BASE_LC_TABLE: FactorTableLike[] = [
    {
      id: "ft_base_lc",
      display_name: "Meridian base factor",
      key_dimensions: ["territory", "coverage"],
      slug: "base_lc_property",
    } as unknown as FactorTableLike,
  ];
  // 2-D cells keyed "rowId::colId" — exactly the Brief 33 cellKey shape.
  const BASE_LC_CELLS = new Map<string, ReadonlyMap<string, number>>([
    [
      "ft_base_lc",
      new Map([
        ["t1::building", 0.4],
        ["t1::bpp", 0.199],
        ["t2::building", 0.4],
        ["t2::bpp", 0.18],
      ]),
    ],
  ]);

  function coverageTowerStages(): StageLike[] {
    const lookup = {
      name: "Base loss cost",
      factor_kind: "base_lc_property",
      lookup_method: "direct",
      dimensions: {
        // row axis (the live risk input) + coverage axis (the split)
        territory: { source: "form_input", path: "form_input.territory" },
        coverage: { source: "literal", path: "coverage" },
      },
    };
    return [
      {
        stage_id: "property_towers",
        stage_kind: "multiplicative_chain",
        config_json: {
          rating_dimension: "coverage",
          output_total_field: "total_premium",
          chains: [
            {
              name: "building",
              base_value: 1000,
              base_input: "literal.base_value",
              coverage_value: "building",
              factor_lookups: [lookup],
              lcm: { input_path: "form_input.lcm" },
              output_field: "building_premium",
            },
            {
              name: "bpp",
              base_value: 1000,
              base_input: "literal.base_value",
              coverage_value: "bpp",
              factor_lookups: [lookup],
              lcm: { input_path: "form_input.lcm" },
              output_field: "bpp_premium",
            },
          ],
        },
      },
    ];
  }

  it("ADR-0039 — slices a 2-D territory×coverage table to each tower's column", () => {
    const { plan } = stagesToRuntimePlan(
      coverageTowerStages(),
      [TERRITORY_DIM],
      BASE_LC_TABLE,
      BASE_LC_CELLS,
      { lcmOverride: 1.0 },
    );
    const compiled = compilePlan(plan);

    // territory t1 — building col 0.4, bpp col 0.199 (DIFFERENT cols)
    const rT1 = runPlan(compiled, { territory: "t1" });
    expect(rT1.outputs.building_premium).toBeCloseTo(400, 6); // 1000 × 0.4
    expect(rT1.outputs.bpp_premium).toBeCloseTo(199, 6); // 1000 × 0.199

    // territory t2 — building col 0.4, bpp col 0.180
    const rT2 = runPlan(compiled, { territory: "t2" });
    expect(rT2.outputs.building_premium).toBeCloseTo(400, 6);
    expect(rT2.outputs.bpp_premium).toBeCloseTo(180, 6); // 1000 × 0.180
  });

  it("ADR-0044 D5 — a 2-D table with two LIVE axes (no coverage tower) resolves via lookup.multi", () => {
    // The SAME 2-D table, but with NO coverage-tower context (no
    // coverage_value / rating_dimension) and BOTH axes declared as live
    // inputs. Pre-ADR-0044 the slice couldn't fire and the composite
    // cells were dropped → 1.0 (the gap this test used to reproduce).
    // Now the dual-input path keys lookup.multi on both axes.
    const stages: StageLike[] = [
      {
        stage_id: "dual_input",
        stage_kind: "multiplicative_chain",
        config_json: {
          output_total_field: "premium",
          chains: [
            {
              name: "p",
              base_value: 1000,
              base_input: "literal.base_value",
              factor_lookups: [
                {
                  name: "Base loss cost",
                  factor_kind: "base_lc_property",
                  lookup_method: "direct",
                  dimensions: {
                    territory: {
                      source: "form_input",
                      path: "form_input.territory",
                    },
                    coverage: {
                      source: "form_input",
                      path: "form_input.coverage",
                    },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              output_field: "premium",
            },
          ],
        },
      },
    ];
    const { plan } = stagesToRuntimePlan(stages, [TERRITORY_DIM], BASE_LC_TABLE, BASE_LC_CELLS, {
      lcmOverride: 1.0,
    });
    // The dual-input table is keyed by a lookup.multi (both axes live).
    expect(plan.nodes.map((n) => n.kind)).toContain("lookup.multi");
    const compiled = compilePlan(plan);
    // territory t1 × coverage building → base_lc 0.4 → 1000 × 0.4 = 400.
    const r = runPlan(compiled, { territory: "t1", coverage: "building" });
    expect(r.outputs.premium).toBeCloseTo(400, 6);
    // …and the bpp column resolves through the same multi-key table.
    const rb = runPlan(compiled, { territory: "t1", coverage: "bpp" });
    expect(rb.outputs.premium).toBeCloseTo(199, 6); // 1000 × 0.199
  });

  // ── ADR-0063 — a flagged banded axis of a 2-D table interpolates ──
  // The F14 gap: a Building Limit table (limit-band × group) is authored
  // stepped, but the filing interpolates a raw limit between band lower
  // bounds. When the table carries `interpolation:{mode:"linear", axis}`,
  // the projector emits lookup.multi.interpolateOn keyed on that axis and
  // wires it the RAW value, so the OTHER axis still keys discretely.
  const LIMIT_BAND_DIM: Dimension = {
    id: "limit_band",
    slug: "limit_band",
    display_name: "Building limit band",
    data_type: "string",
    role: "rating-input",
    // Banded levels carry the lower bound the projector reads as the
    // breakpoint x for each band's factor.
    levels: [
      { id: "b1", lo: 100_000 },
      { id: "b2", lo: 250_000 },
      { id: "b3", lo: 500_000 },
      { id: "b4", lo: 1_000_000 },
    ],
  } as unknown as Dimension;
  const GROUP_DIM: Dimension = {
    id: "bl_group",
    slug: "bl_group",
    display_name: "Building limit group",
    data_type: "string",
    role: "rating-input",
  } as unknown as Dimension;

  const INTERP_TABLE: FactorTableLike[] = [
    {
      id: "ft_bl",
      display_name: "Building Limit relativities",
      key_dimensions: ["limit_band", "bl_group"],
      slug: "building_limit_factors",
      interpolation: { mode: "linear", axis: "limit_band" },
    } as unknown as FactorTableLike,
  ];
  // group_c curve: b1@100k=1.0, b2@250k=1.3, b3@500k=1.45, b4@1M=1.6.
  const INTERP_CELLS = new Map<string, ReadonlyMap<string, number>>([
    [
      "ft_bl",
      new Map([
        ["b1::group_c", 1.0],
        ["b2::group_c", 1.3],
        ["b3::group_c", 1.45],
        ["b4::group_c", 1.6],
      ]),
    ],
  ]);
  function interpStages(): StageLike[] {
    return [
      {
        stage_id: "bl_dual",
        stage_kind: "multiplicative_chain",
        config_json: {
          output_total_field: "premium",
          chains: [
            {
              name: "p",
              base_value: 1000,
              base_input: "literal.base_value",
              factor_lookups: [
                {
                  name: "Building limit",
                  factor_kind: "building_limit_factors",
                  lookup_method: "direct",
                  dimensions: {
                    limit_band: {
                      source: "form_input",
                      path: "form_input.building_limit",
                    },
                    bl_group: {
                      source: "form_input",
                      path: "form_input.bl_group",
                    },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              output_field: "premium",
            },
          ],
        },
      },
    ];
  }

  it("ADR-0063 — emits lookup.multi.interpolateOn with lo breakpoints when flagged", () => {
    const { plan } = stagesToRuntimePlan(
      interpStages(),
      [LIMIT_BAND_DIM, GROUP_DIM],
      INTERP_TABLE,
      INTERP_CELLS,
      { lcmOverride: 1.0 },
    );
    const multi = plan.nodes.find((n) => n.kind === "lookup.multi");
    expect(multi).toBeDefined();
    const params = multi!.params as {
      interpolateOn?: { key: string; breakpoints: Record<string, number> };
    };
    expect(params.interpolateOn).toEqual({
      key: "limit_band",
      breakpoints: { b1: 100_000, b2: 250_000, b3: 500_000, b4: 1_000_000 },
    });
  });

  it("ADR-0063 — a raw limit between breakpoints interpolates end-to-end (315k → 1.339)", () => {
    const { plan } = stagesToRuntimePlan(
      interpStages(),
      [LIMIT_BAND_DIM, GROUP_DIM],
      INTERP_TABLE,
      INTERP_CELLS,
      { lcmOverride: 1.0 },
    );
    const compiled = compilePlan(plan);
    // 315000 in group_c → between b2(250k,1.3) and b3(500k,1.45):
    // 1.3 + (65000/250000)*0.15 = 1.339 → 1000 × 1.339 = 1339.
    const mid = runPlan(compiled, {
      building_limit: 315_000,
      bl_group: "group_c",
    });
    expect(mid.outputs.premium).toBeCloseTo(1339, 6);
    // A raw value exactly ON a breakpoint is byte-identical to stepping.
    const exact = runPlan(compiled, {
      building_limit: 250_000,
      bl_group: "group_c",
    });
    expect(exact.outputs.premium).toBeCloseTo(1300, 6);
  });

  it("ADR-0063 — WITHOUT the flag the same table emits NO interpolateOn", () => {
    const stepped: FactorTableLike[] = [
      { ...INTERP_TABLE[0], interpolation: undefined } as FactorTableLike,
    ];
    const { plan } = stagesToRuntimePlan(
      interpStages(),
      [LIMIT_BAND_DIM, GROUP_DIM],
      stepped,
      INTERP_CELLS,
      { lcmOverride: 1.0 },
    );
    const multi = plan.nodes.find((n) => n.kind === "lookup.multi");
    expect(multi).toBeDefined();
    expect(
      (multi!.params as { interpolateOn?: unknown }).interpolateOn,
    ).toBeUndefined();
  });

  it("the 2-D axis order follows the table's key_dimensions, NOT the dimensions map (Brief 80.3)", () => {
    // Found replaying E7: the plan-duplicate endpoint re-serializes
    // config_json with sort_keys, ALPHABETIZING the `dimensions` map.
    // The projector keyed lookup.multi by map order, so every 2-D key
    // flipped (`building::t1` against `t1::building` cells) and the
    // whole book errored. The table's key_dimensions is the contract;
    // JSON object key order is not a semantic carrier.
    const stages: StageLike[] = [
      {
        stage_id: "dual_input_sorted",
        stage_kind: "multiplicative_chain",
        config_json: {
          output_total_field: "premium",
          chains: [
            {
              name: "p",
              base_value: 1000,
              base_input: "literal.base_value",
              factor_lookups: [
                {
                  name: "Base loss cost",
                  factor_kind: "base_lc_property",
                  lookup_method: "direct",
                  // The alphabetized-duplicate shape: coverage BEFORE
                  // territory, while cells are `territory::coverage`.
                  dimensions: {
                    coverage: {
                      source: "form_input",
                      path: "form_input.coverage",
                    },
                    territory: {
                      source: "form_input",
                      path: "form_input.territory",
                    },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              output_field: "premium",
            },
          ],
        },
      },
    ];
    const { plan } = stagesToRuntimePlan(stages, [TERRITORY_DIM], BASE_LC_TABLE, BASE_LC_CELLS, {
      lcmOverride: 1.0,
    });
    const compiled = compilePlan(plan);
    const r = runPlan(compiled, { territory: "t1", coverage: "building" });
    expect(r.outputs.premium).toBeCloseTo(400, 6);
    const rb = runPlan(compiled, { territory: "t1", coverage: "bpp" });
    expect(rb.outputs.premium).toBeCloseTo(199, 6);
  });

  // ──────────────────────────────────────────────────────────────────
  // ADR-0044 D3 — exposure-rated tower mode
  //
  // A coverage tower's premium is rate × (exposure ÷ divisor) × LCM with
  // filed-rate roundings. The projector activates this ONLY when the chainSpec
  // carries a resolvable exposure_input + finite divisor > 0. Chains
  // without an exposure base stay per-account (LCM as a factor, no
  // rounding) — proven byte-stable below.
  // ──────────────────────────────────────────────────────────────────

  const LIAB_TERRITORY_DIM: Dimension = {
    id: "territory",
    slug: "territory",
    display_name: "Territory",
    data_type: "string",
    role: "rating-input",
  } as Dimension;

  it("scores an exposure-rated tower exactly (rate × exposure ÷ divisor × LCM, rounded)", () => {
    const stages: StageLike[] = [
      {
        stage_id: "liab_chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "liability",
              base_value: 1.0,
              factor_lookups: [
                {
                  name: "base_lc",
                  factor_kind: "base_lc_liab",
                  dimensions: {
                    territory: {
                      source: "form_input",
                      path: "form_input.territory",
                    },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              exposure_input: "form_input.annual_gross_sales",
              exposure_unit_divisor: 1000,
              apply_exposure: true,
              output_field: "liability_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      {
        id: "ftL",
        display_name: "base lc liability",
        key_dimension: "territory",
        slug: "base_lc_liab",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ftL", new Map([["t1", 1.37]])],
    ]);

    const { plan } = stagesToRuntimePlan(stages, [LIAB_TERRITORY_DIM], factorTables, cells, {
      lcmOverride: 1.4,
    });

    // The exposure tail nodes are present in the runtime plan (no harness math).
    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).toContain("round");
    expect(kinds).toContain("math.op");

    const compiled = compilePlan(plan);
    const result = runPlan(compiled, {
      territory: "t1",
      annual_gross_sales: 800000,
    });
    // rate 1.37 → round3 1.37 → ×(800000/1000=800) ×1.4
    // = 1534.4 → round0 = 1534. Exact, no harness rounding.
    expect(result.outputs.liability_premium).toBe(1534);
  });

  it("divides by the divisor (per-$100 limit example)", () => {
    // exposure = building_limit ÷ 100, as in the Meridian demo towers.
    const stages: StageLike[] = [
      {
        stage_id: "bld_chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "building",
              base_value: 1.0,
              factor_lookups: [],
              lcm: { input_path: "form_input.lcm" },
              exposure_input: "form_input.building_limit",
              exposure_unit_divisor: 100,
              apply_exposure: true,
              output_field: "building_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const { plan } = stagesToRuntimePlan(stages, [], [], new Map(), {
      lcmOverride: 1.4,
    });
    // No factor lookups → rate = base 1.0. premium = round(1.0 × (200000/100)
    // × 1.4, 0) = round(2000 × 1.4, 0) = round(2800) = 2800.
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, { building_limit: 200000 });
    expect(result.outputs.building_premium).toBe(2800);
  });

  it("a chain WITHOUT exposure_input stays per-account (LCM as factor, no rounding)", () => {
    // Regression guard: the byte-stable legacy path. No exposure_input →
    // no round / math.op nodes; LCM rides as a chain.mult factor.
    const stages: StageLike[] = [
      chainStage("do_chain", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor_do",
              factor_kind: "ntee_factor_do",
              dimensions: {
                ntee_major: {
                  source: "form_input",
                  path: "form_input.ntee_major",
                },
              },
            },
          ],
          lcm: { input_path: "form_input.lcm" },
          output_field: "do_premium",
        },
      ]),
    ];
    const factorTables: FactorTableLike[] = [
      {
        id: "ft1",
        display_name: "NTEE D&O",
        key_dimension: "ntee_major",
        slug: "ntee_factor_do",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ft1", new Map([["religion", 1.2]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [NTEE_DIM], factorTables, cells);
    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).not.toContain("round");
    expect(kinds).not.toContain("math.op");
    expect(kinds).toContain("chain.mult");
    // LCM is still a named factor on the chain.
    const chainNode = plan.nodes.find((n) => n.kind === "chain.mult");
    expect(
      (chainNode?.params as { factorNames?: string[] }).factorNames,
    ).toContain("LCM");
    // …and it still scores base × factor × LCM (unrounded).
    const result = runPlan(compilePlan(plan), {
      do_base_rate: 600,
      ntee_major: "religion",
      lcm: 1.35,
    });
    expect(result.outputs.do_premium).toBeCloseTo(972, 6);
  });

  // ──────────────────────────────────────────────────────────────────
  // ADR-0044 D4 — banded limit relativity → lookup.range
  // ──────────────────────────────────────────────────────────────────

  const BPP_LIMIT_BANDED_DIM: Dimension = {
    id: "bpp_limit",
    slug: "bpp_limit",
    display_name: "BPP limit",
    data_type: "number",
    role: "rating-input",
    shape: "banded",
    levels: [
      { id: "l1", label: "$0–50K", kind: "banded", lo: 0, hi: 50000 },
      { id: "l2", label: "$50–60K", kind: "banded", lo: 50000, hi: 60000 },
      { id: "l3", label: "$60–70K", kind: "banded", lo: 60000, hi: 70000 },
    ],
  } as unknown as Dimension;

  it("projects a binned factor on a banded dim to lookup.range (banded limit relativity)", () => {
    const stages: StageLike[] = [
      {
        stage_id: "bpp_chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "bpp",
              base_value: 1.0,
              factor_lookups: [
                {
                  name: "bpp_limit_rel",
                  factor_kind: "bpp_limit_rel",
                  lookup_method: "binned",
                  dimensions: {
                    bpp_limit: {
                      source: "form_input",
                      path: "form_input.bpp_limit",
                    },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              exposure_input: "form_input.bpp_limit",
              exposure_unit_divisor: 100,
              apply_exposure: true,
              output_field: "bpp_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      {
        id: "ftBPP",
        display_name: "BPP limit relativity",
        key_dimension: "bpp_limit",
        slug: "bpp_limit_rel",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ftBPP", new Map([["l1", 1.0], ["l2", 1.0], ["l3", 0.87]])],
    ]);

    const { plan } = stagesToRuntimePlan(
      stages,
      [BPP_LIMIT_BANDED_DIM],
      factorTables,
      cells,
      { lcmOverride: 1.4 },
    );
    // A lookup.range node carries the joined buckets (no derive.band).
    const rangeNode = plan.nodes.find((n) => n.kind === "lookup.range");
    expect(rangeNode).toBeDefined();
    expect(
      (rangeNode?.params as { buckets: Array<{ lo: number; hi: number; factor: number }> })
        .buckets,
    ).toEqual([
      { lo: 0, hi: 50000, factor: 1.0 },
      { lo: 50000, hi: 60000, factor: 1.0 },
      { lo: 60000, hi: 70000, factor: 0.87 },
    ]);

    // bpp_limit 60000 → band l3 → 0.87 ×(60000/100=600) ×1.4
    // = 730.8 → round0 = 731.
    const result = runPlan(compilePlan(plan), { bpp_limit: 60000 });
    expect(result.outputs.bpp_premium).toBe(731);
  });

  it("keeps open-ended (hi:null) bands in the lookup.range buckets (finding E5)", () => {
    // levels_json can't carry Infinity — an open-topped band persists
    // `hi: null`. The old bucket filter required BOTH bounds to be
    // numbers, silently DROPPING the no-cap band: values past the last
    // bounded band then clamped onto it (TV-14's wrong-band symptom).
    const OPEN_TOP_DIM: Dimension = {
      id: "bpp_limit",
      slug: "bpp_limit",
      display_name: "BPP limit",
      data_type: "number",
      role: "rating-input",
      shape: "banded",
      levels: [
        { id: "l1", label: "$0–50K", kind: "banded", lo: 0, hi: 50000 },
        { id: "l2", label: "$50–250K", kind: "banded", lo: 50000, hi: 250000 },
        { id: "l3", label: "$250K+", kind: "banded", lo: 250000, hi: null },
      ],
    } as unknown as Dimension;
    const stages: StageLike[] = [
      {
        stage_id: "bpp_chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "bpp",
              base_value: 1.0,
              factor_lookups: [
                {
                  name: "bpp_limit_rel",
                  factor_kind: "bpp_limit_rel",
                  lookup_method: "binned",
                  dimensions: {
                    bpp_limit: {
                      source: "form_input",
                      path: "form_input.bpp_limit",
                    },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              output_field: "bpp_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      {
        id: "ftBPP",
        display_name: "BPP limit relativity",
        key_dimension: "bpp_limit",
        slug: "bpp_limit_rel",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ftBPP", new Map([["l1", 1.0], ["l2", 0.95], ["l3", 0.9]])],
    ]);

    const { plan } = stagesToRuntimePlan(
      stages,
      [OPEN_TOP_DIM],
      factorTables,
      cells,
      { lcmOverride: 1.0 },
    );
    const rangeNode = plan.nodes.find((n) => n.kind === "lookup.range");
    expect(
      (rangeNode?.params as { buckets: Array<{ lo: number | null; hi: number | null; factor: number }> })
        .buckets,
    ).toEqual([
      { lo: 0, hi: 50000, factor: 1.0 },
      { lo: 50000, hi: 250000, factor: 0.95 },
      { lo: 250000, hi: null, factor: 0.9 }, // the no-cap band SURVIVES
    ]);

    // TV-14's shape: a value past the last bounded edge hits the open
    // band's factor, not the previous band's.
    const compiled = compilePlan(plan);
    const result = runPlan(compiled, { bpp_limit: 1_000_000 });
    expect(result.outputs.bpp_premium).toBeCloseTo(0.9, 4);
  });

  // ──────────────────────────────────────────────────────────────────
  // ADR-0044 D6 — predicate-gated factor (sprinkler)
  // ──────────────────────────────────────────────────────────────────

  it("gates a predicate factor: applies when equals holds, else identity 1.0", () => {
    const stages: StageLike[] = [
      {
        stage_id: "spr_chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "building",
              base_value: 100,
              factor_lookups: [
                {
                  name: "sprinkler_rel",
                  factor_kind: "sprinkler_rel",
                  lookup_method: "direct",
                  dimensions: {
                    prop_rate_number: {
                      source: "form_input",
                      path: "form_input.prop_rate_number",
                    },
                  },
                  predicate: { path: "form_input.sprinklered", equals: true },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              output_field: "building_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const RATE_NO_DIM: Dimension = {
      id: "prop_rate_number",
      slug: "prop_rate_number",
      display_name: "Rate number",
      data_type: "string",
      role: "rating-input",
    } as Dimension;
    const factorTables: FactorTableLike[] = [
      {
        id: "ftSpr",
        display_name: "Sprinkler relativity",
        key_dimension: "prop_rate_number",
        slug: "sprinkler_rel",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      ["ftSpr", new Map([["01", 0.8]])],
    ]);
    const { plan } = stagesToRuntimePlan(stages, [RATE_NO_DIM], factorTables, cells, {
      lcmOverride: 1.0,
    });
    // The factor is gated through a branch (predicate ? factor : 1.0).
    expect(plan.nodes.map((n) => n.kind)).toContain("branch");

    const compiled = compilePlan(plan);
    // Sprinklered → 100 × 0.8 × 1.0 = 80.
    expect(
      runPlan(compiled, { prop_rate_number: "01", sprinklered: true }).outputs
        .building_premium,
    ).toBeCloseTo(80, 6);
    // Not sprinklered → factor gated off to 1.0 → 100 × 1.0 = 100.
    expect(
      runPlan(compiled, { prop_rate_number: "01", sprinklered: false }).outputs
        .building_premium,
    ).toBeCloseTo(100, 6);
  });

  // ──────────────────────────────────────────────────────────────────
  // ADR-0044 D5 — dual-risk-input 2-D table → lookup.multi
  // ──────────────────────────────────────────────────────────────────

  const TOTAL_BAND_DIM: Dimension = {
    id: "property_total_band",
    slug: "property_total_band",
    display_name: "Total limit band",
    data_type: "number",
    role: "rating-input",
    shape: "banded",
    levels: [
      { id: "b_0_50", label: "≤$50K", kind: "banded", lo: 0, hi: 50000 },
      { id: "b_50_250", label: "$50–250K", kind: "banded", lo: 50000, hi: 250000 },
      { id: "b_250_500", label: "$250–500K", kind: "banded", lo: 250000, hi: 500000 },
    ],
  } as unknown as Dimension;

  const DED_DIM: Dimension = {
    id: "property_deductible",
    slug: "property_deductible",
    display_name: "Deductible",
    data_type: "string",
    role: "rating-input",
  } as Dimension;

  it("projects a deductible (deductible × derived total-limit band) to lookup.multi", () => {
    const stages: StageLike[] = [
      {
        stage_id: "bld_chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "building",
              base_value: 1.0,
              factor_lookups: [
                {
                  name: "ded",
                  factor_kind: "property_deductible",
                  lookup_method: "direct",
                  dimensions: {
                    property_deductible: {
                      source: "form_input",
                      path: "form_input.property_deductible",
                    },
                    // The 2nd axis is DERIVED in-plan: total = building + BPP,
                    // declared in data (no hardcoded BOP), then banded.
                    property_total_band: {
                      source: "computed",
                      op: "sum",
                      fields: ["building_limit", "bpp_limit"],
                    },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              exposure_input: "form_input.building_limit",
              exposure_unit_divisor: 100,
              apply_exposure: true,
              output_field: "building_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      {
        id: "ftDed",
        display_name: "property deductible",
        key_dimensions: ["property_deductible", "property_total_band"],
        slug: "property_deductible",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      [
        "ftDed",
        new Map([
          ["ded_1500::b_50_250", 0.92],
          ["ded_1500::b_250_500", 0.943],
          ["ded_5000::b_50_250", 0.773],
        ]),
      ],
    ]);
    const { plan } = stagesToRuntimePlan(
      stages,
      [DED_DIM, TOTAL_BAND_DIM],
      factorTables,
      cells,
      { lcmOverride: 1.4 },
    );
    const kinds = plan.nodes.map((n) => n.kind);
    expect(kinds).toContain("lookup.multi");
    expect(kinds).toContain("chain.add"); // the building+BPP total
    expect(kinds).toContain("derive.band"); // total → band

    // total = 180000 + 40000 = 220000 → band b_50_250; ded_1500 → 0.92.
    // premium = round(0.92 × (180000/100=1800) × 1.4, 0)
    //         = round(2318.4) = 2318.
    const result = runPlan(compilePlan(plan), {
      property_deductible: "ded_1500",
      building_limit: 180000,
      bpp_limit: 40000,
    });
    expect(result.outputs.building_premium).toBe(2318);
  });

  it("projects a band × constant-group table (literal axis) to lookup.multi", () => {
    const BLD_LIMIT_DIM: Dimension = {
      id: "building_limit",
      slug: "building_limit",
      display_name: "Building limit",
      data_type: "number",
      role: "rating-input",
      shape: "banded",
      levels: [
        { id: "l_175_200", label: "$175–200K", kind: "banded", lo: 175000, hi: 200000 },
        { id: "l_200_225", label: "$200–225K", kind: "banded", lo: 200000, hi: 225000 },
      ],
    } as unknown as Dimension;
    const GROUP_DIM: Dimension = {
      id: "building_limit_group",
      slug: "building_limit_group",
      display_name: "Limit group",
      data_type: "string",
      role: "rating-input",
    } as Dimension;
    const stages: StageLike[] = [
      {
        stage_id: "bld_chain",
        stage_kind: "multiplicative_chain",
        config_json: {
          chains: [
            {
              name: "building",
              base_value: 1.0,
              factor_lookups: [
                {
                  name: "limit",
                  factor_kind: "building_limit_rel",
                  lookup_method: "direct",
                  dimensions: {
                    building_limit: {
                      source: "form_input",
                      path: "form_input.building_limit",
                    },
                    // KS is always Group C — declared as a literal axis.
                    building_limit_group: { source: "literal", value: "group_c" },
                  },
                },
              ],
              lcm: { input_path: "form_input.lcm" },
              exposure_input: "form_input.building_limit",
              exposure_unit_divisor: 100,
              apply_exposure: true,
              output_field: "building_premium",
            },
          ],
          output_total_field: "premium",
        },
      },
    ];
    const factorTables: FactorTableLike[] = [
      {
        id: "ftLim",
        display_name: "building limit rel",
        key_dimensions: ["building_limit", "building_limit_group"],
        slug: "building_limit_rel",
      } as unknown as FactorTableLike,
    ];
    const cells = new Map<string, ReadonlyMap<string, number>>([
      [
        "ftLim",
        new Map([
          ["l_175_200::group_c", 1.06],
          ["l_200_225::group_c", 1.0],
          ["l_175_200::group_a", 1.5],
        ]),
      ],
    ]);
    const { plan } = stagesToRuntimePlan(
      stages,
      [BLD_LIMIT_DIM, GROUP_DIM],
      factorTables,
      cells,
      { lcmOverride: 1.4 },
    );
    expect(plan.nodes.map((n) => n.kind)).toContain("lookup.multi");

    // building_limit 180000 → band l_175_200; group literal group_c → 1.06.
    // premium = round(1.06 × (180000/100=1800) × 1.4, 0)
    //         = round(2671.2) = 2671.
    const result = runPlan(compilePlan(plan), { building_limit: 180000 });
    expect(result.outputs.building_premium).toBe(2671);
  });
});

// ═══════════════════════════════════════════════════════════════════
// v4 audit G6 — authoring/projector parity pins.
//
// Empirically proven 2026-07-05: a ×2.0 flat_factor loading and a $1M
// clamp floor authored from live drawers changed NO premium (the
// projector skips both kinds). These tests pin (a) the skip itself so
// the dead kinds are documented behavior, not a surprise, (b) the
// executed-kind registry the authoring surfaces consult, and (c) the
// round stage's min_value_input literal forms — the floor that DOES
// price and that the Minimum-premium affordance now authors.
// ═══════════════════════════════════════════════════════════════════
describe("authoring/projector parity (v4 G6)", () => {
  const baseChain = (): StageLike => ({
    stage_id: "chain_stage",
    stage_kind: "multiplicative_chain",
    config_json: {
      chains: [
        {
          name: "prem",
          base_input: "ignored",
          base_value: 600,
          factor_lookups: [],
          lcm: { value: 1.0 },
          output_field: "prem_premium",
        },
      ],
      output_total_field: "premium",
    },
  });

  const roundStage = (min_value_input: unknown): StageLike => ({
    stage_id: "final_round",
    stage_kind: "round",
    config_json: {
      input_path: "chain.total_premium",
      increment_input: "literal:1",
      ...(min_value_input === undefined ? {} : { min_value_input }),
      output_field: "total_premium",
    },
  });

  it("PROJECTOR_EXECUTED_STAGE_KINDS matches the kinds the projector dispatches on", () => {
    // The dispatch sites are grep-able: stage_kind checks in
    // stagesToRuntimePlan.ts. If you teach the projector a new kind,
    // this list — and the authoring-parity registry in rate-lab —
    // must move with it.
    expect([...PROJECTOR_EXECUTED_STAGE_KINDS].sort()).toEqual(
      [
        "clamp",
        "eligibility.gate",
        "endorsement.additive",
        "endorsement.factor",
        "endorsement.rate_branch",
        "endorsement.sublimit",
        "flat_factor",
        "modifier.model",
        "modifier.schedule",
        "multiplicative_chain",
        "round",
      ].sort(),
    );
  });

  it("clamp stages PRICE (G6-full): a floor lifts the premium; a cap holds it", () => {
    const clamp: StageLike = {
      stage_id: "clamp_min",
      stage_kind: "clamp",
      config_json: {
        input_path: "stages.chain_stage.prem_premium",
        min_value: 1_000_000,
        factor_kind: "clamp",
        output_field: "value",
      },
    };
    const { plan, issues } = stagesToRuntimePlan(
      [baseChain(), clamp],
      [],
      [],
      new Map(),
    );
    expect(issues).toHaveLength(0);
    const result = runPlan(compilePlan(plan), {});
    // Pre-G6-full this silently stayed 600 (the $1M floor was a no-op).
    expect(result.outputs.prem_premium).toBe(1_000_000);

    const cap: StageLike = {
      stage_id: "clamp_cap",
      stage_kind: "clamp",
      config_json: {
        input_path: "stages.chain_stage.prem_premium",
        max_value: 500,
        factor_kind: "clamp",
        output_field: "value",
      },
    };
    const capped = stagesToRuntimePlan([baseChain(), cap], [], [], new Map());
    expect(runPlan(compilePlan(capped.plan), {}).outputs.prem_premium).toBe(
      500,
    );
  });

  it("flat_factor stages PRICE (G6-full): a ×2.0 loading doubles the target output", () => {
    const loading: StageLike = {
      stage_id: "loading_x2",
      stage_kind: "flat_factor",
      config_json: {
        input_path: "stages.chain_stage.prem_premium",
        factor: 2.0,
        factor_kind: "test_loading",
        output_field: "value",
      },
    };
    const { plan, issues } = stagesToRuntimePlan(
      [baseChain(), loading],
      [],
      [],
      new Map(),
    );
    expect(issues).toHaveLength(0);
    const result = runPlan(compilePlan(plan), {});
    // Pre-G6-full this silently stayed 600 (the loading was a no-op).
    expect(result.outputs.prem_premium).toBe(1200);
  });

  it("a loading on a COVERAGE output flows into the round total (pre-round sweep)", () => {
    const loading: StageLike = {
      stage_id: "loading_x2",
      stage_kind: "flat_factor",
      config_json: {
        input_path: "chain.prem_premium",
        factor: 2.0,
        factor_kind: "test_loading",
        output_field: "value",
      },
    };
    const { plan } = stagesToRuntimePlan(
      [baseChain(), loading, roundStage("literal:0")],
      [],
      [],
      new Map(),
    );
    const result = runPlan(compilePlan(plan), {});
    expect(result.outputs.prem_premium).toBe(1200);
    expect(result.outputs.total_premium).toBe(1200); // total sums the LOADED tip
  });

  it("a clamp targeting the round's aggregate attaches in the POST-round sweep", () => {
    const cap: StageLike = {
      stage_id: "clamp_total",
      stage_kind: "clamp",
      config_json: {
        input_path: "chain.total_premium",
        max_value: 450,
        factor_kind: "clamp",
        output_field: "value",
      },
    };
    const { plan, issues } = stagesToRuntimePlan(
      [baseChain(), roundStage("literal:0"), cap],
      [],
      [],
      new Map(),
    );
    expect(issues).toHaveLength(0);
    const result = runPlan(compilePlan(plan), {});
    expect(result.outputs.prem_premium).toBe(600); // coverage untouched
    expect(result.outputs.total_premium).toBe(450); // total capped
  });

  it("a predicate-gated loading applies only when the flag holds (G7-full)", () => {
    const loading: StageLike = {
      stage_id: "loading_terror",
      stage_kind: "flat_factor",
      config_json: {
        input_path: "stages.chain_stage.prem_premium",
        factor: 2.0,
        factor_kind: "terrorism",
        predicate: { path: "form_input.terrorism_elected", equals: true },
        output_field: "value",
      },
    };
    const { plan } = stagesToRuntimePlan(
      [baseChain(), loading],
      [],
      [],
      new Map(),
    );
    const compiled = compilePlan(plan);
    expect(
      runPlan(compiled, { terrorism_elected: true }).outputs.prem_premium,
    ).toBe(1200);
    expect(
      runPlan(compiled, { terrorism_elected: false }).outputs.prem_premium,
    ).toBe(600);
  });

  it("an unattachable flat_factor/clamp is a structured orphan_stage error — never a silent no-op", () => {
    const loading: StageLike = {
      stage_id: "loading_lost",
      stage_kind: "flat_factor",
      config_json: {
        input_path: "chain.no_such_output",
        factor: 2.0,
        factor_kind: "lost",
        output_field: "value",
      },
    };
    const legacyClamp: StageLike = {
      stage_id: "clamp_pct",
      stage_kind: "clamp",
      config_json: {
        input_path: "chain.prem_premium",
        max_pct_of_input: "0.25",
        factor_kind: "clamp",
        output_field: "value",
      },
    };
    const { issues } = stagesToRuntimePlan(
      [baseChain(), loading, legacyClamp],
      [],
      [],
      new Map(),
    );
    const orphans = issues.filter((i) => i.code === "orphan_stage");
    expect(orphans.map((i) => i.stageId).sort()).toEqual([
      "clamp_pct",
      "loading_lost",
    ]);
    for (const i of orphans) expect(i.severity).toBe("error");
  });

  it.each([
    ["literal:5000", 5000],
    ["5000", 5000],
    [5000, 5000],
  ])(
    "round.min_value_input %j floors the total at %d (the WORKING minimum premium)",
    (raw, floor) => {
      const { plan } = stagesToRuntimePlan(
        [baseChain(), roundStage(raw)],
        [],
        [],
        new Map(),
      );
      const result = runPlan(compilePlan(plan), {});
      // total = max(600, floor) → round = floor.
      expect(result.outputs.total_premium).toBe(floor);
    },
  );

  it("round.min_value_input with a form_input path applies NO floor (not resolved yet)", () => {
    const { plan } = stagesToRuntimePlan(
      [baseChain(), roundStage("form_input.min_premium")],
      [],
      [],
      new Map(),
    );
    const result = runPlan(compilePlan(plan), {});
    expect(result.outputs.total_premium).toBe(600);
  });

  it("round with an empty min_value_input just rounds (no floor)", () => {
    const { plan } = stagesToRuntimePlan(
      [baseChain(), roundStage("")],
      [],
      [],
      new Map(),
    );
    const result = runPlan(compilePlan(plan), {});
    expect(result.outputs.total_premium).toBe(600);
  });

  it("round with literal:0 (the persisted 'no floor') emits no max node", () => {
    // RoundConfig requires min_value_input, so the authoring layer
    // writes literal:0 for "no floor". It must be a true no-op.
    const { plan } = stagesToRuntimePlan(
      [baseChain(), roundStage("literal:0")],
      [],
      [],
      new Map(),
    );
    expect(plan.nodes.filter((n) => n.kind === "math.op")).toHaveLength(0);
    const result = runPlan(compilePlan(plan), {});
    expect(result.outputs.total_premium).toBe(600);
  });
});

// ══════════════════════════════════════════════════════════════════
// ADR-0056 — structured projection issues + onMiss policy stamping
// ══════════════════════════════════════════════════════════════════

describe("ADR-0056 · projection issues", () => {
  it("a non-executed premium-affecting stage kind is a structured error (not a silent skip)", () => {
    // flat_factor + clamp PRICE as of G6-full — `formula` remains the
    // representative unprojected kind (D4 disposition pending).
    const stages: StageLike[] = [
      {
        stage_id: "formula_1",
        stage_kind: "formula",
        config_json: { expression: "x * 2" },
      },
    ];
    const { issues } = stagesToRuntimePlan(stages, [], [], new Map());
    const skipped = issues.filter((i) => i.code === "stage_not_executed");
    expect(skipped.map((i) => i.stageId)).toEqual(["formula_1"]);
    for (const i of skipped) expect(i.severity).toBe("error");
  });

  it("input_node declarations are EXEMPT from stage_not_executed", () => {
    const stages: StageLike[] = [
      {
        stage_id: "decl_tiv",
        stage_kind: "input_node",
        config_json: { source_path: "tiv" },
      },
    ];
    const { issues } = stagesToRuntimePlan(stages, [], [], new Map());
    expect(issues).toHaveLength(0);
  });

  it("a string-equality predicate GATES the factor (G7-full — the drop is dead)", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor",
              factor_kind: "ntee_factor",
              dimensions: {
                ntee_major: {
                  source: "form_input",
                  path: "form_input.ntee_major",
                },
              },
              // String equality — gated via the 1/0 membership lookup.
              predicate: { path: "form_input.segment", equals: "education" },
              unknown_key_policy: { mode: "default", value: 1.0 },
            } as never,
          ],
          lcm: { value: 1.0 },
          output_field: "do_premium",
        },
      ]),
    ];
    const { plan, issues } = stagesToRuntimePlan(
      stages,
      [NTEE_DIM],
      [{ id: "ntee_factor" } as unknown as FactorTableLike],
      new Map([["ntee_factor", new Map([["religion", 1.2]])]]),
    );
    // No drop issue — the predicate is WIRED now.
    expect(issues.find((i) => i.code === "predicate_dropped")).toBeUndefined();
    const compiled = compilePlan(plan);
    const base = { do_base_rate: 600, ntee_major: "religion" };
    // Segment matches → the 1.2 factor applies.
    expect(
      runPlan(compiled, { ...base, segment: "education" }).outputs.do_premium,
    ).toBeCloseTo(720, 6);
    // Segment differs → multiplicative identity.
    expect(
      runPlan(compiled, { ...base, segment: "retail" }).outputs.do_premium,
    ).toBeCloseTo(600, 6);
  });

  it("stamps onMiss error (the default) + keySource onto factor lookups — and NOT onto structural selectors", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor",
              factor_kind: "ntee_factor",
              dimensions: {
                ntee_major: {
                  source: "form_input",
                  path: "form_input.ntee_major",
                },
              },
            },
          ],
          lcm: { value: 1.0 },
          output_field: "do_premium",
        },
      ]),
    ];
    const { plan } = stagesToRuntimePlan(
      stages,
      [NTEE_DIM],
      [{ id: "ntee_factor" } as unknown as FactorTableLike],
      new Map([["ntee_factor", new Map([["religion", 1.2]])]]),
    );
    const lookup = plan.nodes.find((n) => n.kind === "lookup.direct")!;
    const params = lookup.params as {
      onMiss?: { mode: string };
      keySource?: string;
    };
    expect(params.onMiss).toEqual({ mode: "error" });
    expect(params.keySource).toBe("ntee_major");
  });

  it("honors an authored refer policy in the stamped onMiss", () => {
    const stages: StageLike[] = [
      chainStage("do_chain_stage", [
        {
          name: "do_premium",
          base_input: "form_input.do_base_rate",
          factor_lookups: [
            {
              name: "ntee_factor",
              factor_kind: "ntee_factor",
              dimensions: {
                ntee_major: {
                  source: "form_input",
                  path: "form_input.ntee_major",
                },
              },
              unknown_key_policy: { mode: "refer" },
            },
          ],
          lcm: { value: 1.0 },
          output_field: "do_premium",
        },
      ]),
    ];
    const { plan } = stagesToRuntimePlan(
      stages,
      [NTEE_DIM],
      [{ id: "ntee_factor" } as unknown as FactorTableLike],
      new Map([["ntee_factor", new Map([["religion", 1.2]])]]),
    );
    const lookup = plan.nodes.find((n) => n.kind === "lookup.direct")!;
    expect((lookup.params as { onMiss?: unknown }).onMiss).toEqual({
      mode: "refer",
    });

    // Run an unknown key through: 1.0 indicative + tier escalates.
    const result = runPlan(compilePlan(plan), {
      do_base_rate: 600,
      ntee_major: "unlisted",
    });
    expect(result.outputs.do_premium).toBeCloseTo(600, 6);
    expect(result.eligibility_tier).toBe("submit");
    expect(result.row_status).toBe("ok");
  });

  it("a chain with no base is a structured chain_missing_base error", () => {
    const stages: StageLike[] = [
      chainStage("broken_stage", [
        {
          name: "broken",
          base_input: "",
          factor_lookups: [],
          lcm: {},
          output_field: "broken_premium",
        },
      ]),
    ];
    const { plan, issues } = stagesToRuntimePlan(stages, [], [], new Map());
    expect(issues.some((i) => i.code === "chain_missing_base")).toBe(true);
    expect(plan.nodes.filter((n) => n.kind === "chain.mult")).toHaveLength(0);
  });
});
