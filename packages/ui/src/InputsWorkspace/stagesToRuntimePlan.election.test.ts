/**
 * Brief 95 C4 — coverage election through the REAL projector + runtime.
 *
 * A two-tower plan (building electable, liability required) runs the
 * election matrix end-to-end: elected / elected out (explicit 0, axis
 * inputs absent) / absent (withholds) / required-zero (refuses).
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  compilePlan,
  registerBuiltinKinds,
  runPlan,
  type Plan,
} from "@openrater/contracts";
import {
  stagesToRuntimePlan,
  type FactorTableCellsMap,
} from "./stagesToRuntimePlan";
import type { StageLike, FactorTableLike } from "./deriveRequiredInputs";

const STAGES: StageLike[] = [
  {
    stage_id: "towers",
    stage_kind: "multiplicative_chain",
    config_json: {
      output_total_field: "total_premium",
      chains: [
        {
          name: "building",
          base_value: 0.15,
          factor_lookups: [
            {
              name: "LOI group",
              factor_kind: "loi_group_factor",
              dimensions: {
                loi_group: {
                  source: "form_input",
                  path: "form_input.loi_group",
                },
              },
            },
          ],
          lcm: { value: 1.3 },
          exposure_input: "form_input.building_limit",
          exposure_unit_divisor: 100,
          apply_exposure: true,
          coverage_value: "building",
          output_field: "building_premium",
          elective: true,
        },
        {
          name: "liability",
          base_value: 2.0,
          factor_lookups: [],
          lcm: { value: 1.3 },
          exposure_input: "form_input.units",
          exposure_unit_divisor: 1,
          apply_exposure: true,
          coverage_value: "liability",
          output_field: "liability_premium",
        },
      ],
    },
  },
];

const DIMS = [
  {
    id: "loi_group",
    slug: "loi_group",
    display_name: "LOI group",
    levels: [{ id: "c", label: "Group C" }],
  },
] as unknown as Parameters<typeof stagesToRuntimePlan>[1];

const FTS: FactorTableLike[] = [
  {
    id: "ft_loi",
    display_name: "LOI group factor",
    key_dimension: "loi_group",
    slug: "loi_group_factor",
  } as unknown as FactorTableLike,
];
const CELLS: FactorTableCellsMap = new Map([
  ["ft_loi", new Map([["c", 1.5]])],
]);

function project(): Plan {
  const { plan, issues } = stagesToRuntimePlan(STAGES, DIMS, FTS, CELLS, {});
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  return plan as unknown as Plan;
}

describe("coverage election through the projector (Brief 95 C4)", () => {
  beforeAll(() => registerBuiltinKinds());

  const FULL = { building_limit: 200000, loi_group: "c", units: 800 };

  it("elected: both towers price exactly as before", () => {
    const res = runPlan(compilePlan(project()), FULL);
    expect(res.row_status).toBe("ok");
    // round(round(0.15 × 1.5, 3) × (200000 ÷ 100) × 1.3) = 585
    expect(res.outputs.building_premium).toBe(585);
    // round(2.0 × 800 × 1.3) = 2080
    expect(res.outputs.liability_premium).toBe(2080);
  });

  it("elected OUT: explicit 0 + ABSENT axis input → $0, ok, trace says why", () => {
    const res = runPlan(compilePlan(project()), {
      building_limit: 0,
      units: 800,
      // loi_group ABSENT — a tenant risk doesn't carry building axes.
    });
    expect(res.row_status).toBe("ok");
    expect(res.outputs.building_premium).toBe(0);
    expect(res.outputs.liability_premium).toBe(2080);
    // The election explains the $0 (the acceptance's trace line) and
    // the tower's lookup is SKIPPED, not errored.
    expect(res.trace.elect_building?.explanation).toMatch(/not elected/);
    const lookupEntries = Object.entries(res.trace).filter(([id]) =>
      id.startsWith("lk_building"),
    );
    expect(lookupEntries.length).toBeGreaterThan(0);
    for (const [, entry] of lookupEntries) {
      expect(entry.skipped).toBe(true);
      expect(entry.error).toBeUndefined();
    }
  });

  it("ABSENT exposure on the electable tower: withholds (absence ≠ election)", () => {
    const res = runPlan(compilePlan(project()), {
      loi_group: "c",
      units: 800,
    });
    expect(res.row_status).toBe("error");
    expect(res.outputs.building_premium).toBeUndefined();
    // The liability tower still priced — refusal is per-output.
    expect(res.outputs.liability_premium).toBe(2080);
  });

  it("explicit 0 on the REQUIRED tower: prices $0 and warns (never refuses — the KS TV-28 law)", () => {
    const res = runPlan(compilePlan(project()), {
      ...FULL,
      units: 0,
    });
    expect(res.row_status).toBe("ok");
    expect(res.outputs.liability_premium).toBe(0);
    const warn = res.issues?.find((i) => i.code === "zero_exposure_required");
    expect(warn?.severity).toBe("warning");
    expect(warn?.message).toMatch(/liability/);
    expect(warn?.message).toMatch(/mark the coverage/i);
  });
});
