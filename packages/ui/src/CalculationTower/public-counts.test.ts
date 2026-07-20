/**
 * public-counts tests — pins : THE public counting (chains ·
 * steps) equals what the Rating tab renders — per-chain build-up rows
 * (base + factors + lcm, output rows excluded) plus Final-adjustment
 * stage rows — and never the wire stage count.
 */

import { describe, it, expect } from "vitest";
import { countPublicAlgorithm } from "./public-counts";
import type { StageInput } from "./stages-to-tower-plan";

function input(id: string): StageInput {
  return {
    stage_id: id,
    sequence: 0,
    stage_kind: "input_node",
    display_name: id,
    config_json: { name: id, source_path: id, data_type: "number" },
  };
}

const CHAINS: StageInput = {
  stage_id: "rating_chains",
  sequence: 1,
  stage_kind: "multiplicative_chain",
  display_name: "Rating chains",
  config_json: {
    output_total_field: "premium",
    chains: [
      {
        name: "building premium",
        base_value: 0.45,
        output_field: "building_premium",
        factor_lookups: [
          { name: "class_rate", factor_kind: "class_rate" },
          { name: "territory", factor_kind: "territory" },
        ],
      },
      {
        name: "bpp premium",
        base_value: 0.3,
        output_field: "bpp_premium",
        factor_lookups: [{ name: "class_rate", factor_kind: "class_rate" }],
      },
    ],
  },
};

const TAIL: StageInput[] = [
  {
    stage_id: "liab_min",
    sequence: 2,
    stage_kind: "clamp",
    display_name: "liab_min",
    config_json: { min: 250 },
  },
  {
    stage_id: "round_total",
    sequence: 3,
    stage_kind: "round",
    display_name: "round_total",
    config_json: {},
  },
];

const GATE: StageInput = {
  stage_id: "gates",
  sequence: 4,
  stage_kind: "eligibility.gate",
  display_name: "Eligibility",
  config_json: { rules: [{ rule_id: "r1" }] },
};

describe("countPublicAlgorithm", () => {
  it("chains = premium chains; steps = build-up rows + tail rows", () => {
    const stages = [input("tiv"), input("class_code"), CHAINS, ...TAIL, GATE];
    const counts = countPublicAlgorithm(stages);
    expect(counts.chains).toBe(2);
    // building: base + 2 factors = 3 · bpp: base + 1 factor = 2
    // (output rows are results, not steps) · tail: clamp + round = 2.
    expect(counts.steps).toBe(3 + 2 + 2);
    // Never the wire counting: 6 stages ≠ 7 steps.
    expect(counts.steps).not.toBe(stages.length);
  });

  it("a bare plan counts zero without inventing structure", () => {
    expect(countPublicAlgorithm([input("tiv")])).toEqual({
      chains: 0,
      steps: 0,
    });
  });
});
