/**
 * ADR-0063 / Brief 95 C5 — 1-D banded curve interpolation through the
 * projector + runtime (the remaining half of engine gap F14).
 *
 * A 1-D table flagged `interpolation=linear` on its banded row dim
 * reads the RAW value and interpolates between breakpoints = band
 * LOWER bounds (clamped ends) — the same anchors the 2-D
 * `interpolateOn` uses. Unflagged tables keep stepping, byte-stable.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  compilePlan,
  registerBuiltinKinds,
  runPlan,
  type Plan,
  type Dimension,
} from "@openrater/contracts";
import {
  stagesToRuntimePlan,
  type FactorTableCellsMap,
} from "./stagesToRuntimePlan";
import type { StageLike, FactorTableLike } from "./deriveRequiredInputs";

// A BPP-LOI-shaped curve: relativity falls as the limit grows.
//   b1@10k=1.00 · b2@50k=0.85 · b3@100k=0.75 · b4@250k=0.60
const BPP_BAND_DIM = {
  id: "bpp_band",
  slug: "bpp_band",
  display_name: "BPP limit band",
  data_type: "string",
  role: "rating-input",
  shape: "banded",
  levels: [
    { id: "b1", kind: "banded", lo: 10_000, hi: 50_000 },
    { id: "b2", kind: "banded", lo: 50_000, hi: 100_000 },
    { id: "b3", kind: "banded", lo: 100_000, hi: 250_000 },
    { id: "b4", kind: "banded", lo: 250_000, hi: null },
  ],
} as unknown as Dimension;

const CELLS: FactorTableCellsMap = new Map([
  [
    "ft_bpp",
    new Map([
      ["b1", 1.0],
      ["b2", 0.85],
      ["b3", 0.75],
      ["b4", 0.6],
    ]),
  ],
]);

function fts(flagged: boolean): FactorTableLike[] {
  return [
    {
      id: "ft_bpp",
      display_name: "BPP LOI relativity",
      key_dimension: "bpp_band",
      slug: "bpp_loi_rel",
      ...(flagged
        ? { interpolation: { mode: "linear", axis: "bpp_band" } }
        : {}),
    } as unknown as FactorTableLike,
  ];
}

const STAGES: StageLike[] = [
  {
    stage_id: "towers",
    stage_kind: "multiplicative_chain",
    config_json: {
      chains: [
        {
          name: "bpp",
          base_value: 100,
          factor_lookups: [
            {
              name: "BPP LOI relativity",
              factor_kind: "bpp_loi_rel",
              lookup_method: "binned",
              dimensions: {
                bpp_band: { source: "form_input", path: "form_input.bpp_limit" },
              },
            },
          ],
          lcm: { value: 1.0 },
          output_field: "bpp_premium",
        },
      ],
    },
  },
];

function premiumAt(limit: number, flagged: boolean): number {
  const { plan, issues } = stagesToRuntimePlan(
    STAGES,
    [BPP_BAND_DIM],
    fts(flagged),
    CELLS,
    {},
  );
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  const res = runPlan(compilePlan(plan as unknown as Plan), {
    bpp_limit: limit,
  });
  expect(res.row_status).toBe("ok");
  return res.outputs.bpp_premium as number;
}

describe("1-D banded curve interpolation (ADR-0063 / Brief 95 C5)", () => {
  beforeAll(() => registerBuiltinKinds());

  it("emits an `interpolate` node with lo-anchored, sorted points", () => {
    const { plan } = stagesToRuntimePlan(
      STAGES,
      [BPP_BAND_DIM],
      fts(true),
      CELLS,
      {},
    );
    const node = plan.nodes.find((n) => n.kind === "interpolate");
    expect(node).toBeDefined();
    expect(
      (node!.params as { points: ReadonlyArray<{ x: number; y: number }> })
        .points,
    ).toEqual([
      { x: 10_000, y: 1.0 },
      { x: 50_000, y: 0.85 },
      { x: 100_000, y: 0.75 },
      { x: 250_000, y: 0.6 },
    ]);
    expect(plan.nodes.some((n) => n.kind === "lookup.range")).toBe(false);
  });

  it("on a breakpoint → the band's factor, byte-exact", () => {
    expect(premiumAt(50_000, true)).toBeCloseTo(100 * 0.85, 10);
  });

  it("mid-band → the interpolated factor (the §5 golden)", () => {
    // 75k sits halfway through [50k,100k): 0.85 + 0.5 × (0.75−0.85) = 0.80
    expect(premiumAt(75_000, true)).toBeCloseTo(100 * 0.8, 10);
  });

  it("clamps at both ends (never extrapolates a factor table)", () => {
    expect(premiumAt(5_000, true)).toBeCloseTo(100 * 1.0, 10);
    expect(premiumAt(2_000_000, true)).toBeCloseTo(100 * 0.6, 10);
  });

  it("UNFLAGGED: the same table still steps (byte-stable legacy)", () => {
    const { plan } = stagesToRuntimePlan(
      STAGES,
      [BPP_BAND_DIM],
      fts(false),
      CELLS,
      {},
    );
    expect(plan.nodes.some((n) => n.kind === "interpolate")).toBe(false);
    // 75k steps onto band b2's factor, not the interpolated 0.80.
    expect(premiumAt(75_000, false)).toBeCloseTo(100 * 0.85, 10);
  });
});
