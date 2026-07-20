/**
 * <InputsPanelV2> · total-less multi-coverage plans (93.4).
 *
 * The live preview is the author's answer to "what will Score-all
 * produce?". A filing with ≥2 coverage towers and no total row declares
 * no premium output, so binding the preview to `resolvePremiumColumn`
 * showed the LAST tower as the risk's price — the same drift that
 * headlined "$72" for a $267 risk on the plan report.
 *
 * The preview now reads the plan's own declarations (from the authored
 * STAGES) and shows the dec-page sum, matching `views.premium`
 * (basis "coverage_sum"). A tail over such a plan is the same named
 * Law-2 refusal the scoring service raises — never a tax on one tower.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { _clearRegistryForTests, registerBuiltinKinds } from "@openrater/contracts";
import type { Plan } from "@openrater/contracts";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** Two towers off one base: building × 1.5 = $195, contents × 0.6 = $78.
 *  The risk costs $273; the LAST tower alone reads $78. No total row. */
function twoTowerPlan(over: Partial<Plan> = {}): Plan {
  return {
    id: "test.inputs-v2-total-less",
    version: "1.0.0",
    name: "Two towers, no total",
    line: "bop",
    effective: "2026-01-01",
    nodes: [
      { id: "in_base", kind: "input", params: { fieldName: "base", fieldType: "money" } },
      { id: "k_b", kind: "constant", params: { value: 1.5, type: "factor" } },
      { id: "b_mul", kind: "chain.mult", params: { stopOnZero: false } },
      {
        id: "b_out",
        kind: "output",
        params: { fieldName: "building_premium", fieldType: "money" },
      },
      { id: "k_c", kind: "constant", params: { value: 0.6, type: "factor" } },
      { id: "c_mul", kind: "chain.mult", params: { stopOnZero: false } },
      {
        id: "c_out",
        kind: "output",
        params: { fieldName: "contents_premium", fieldType: "money" },
      },
    ],
    edges: [
      { from: { node: "in_base", port: "value" }, to: { node: "b_mul", port: "base" } },
      { from: { node: "k_b", port: "value" }, to: { node: "b_mul", port: "factors" } },
      { from: { node: "b_mul", port: "result" }, to: { node: "b_out", port: "value" } },
      { from: { node: "in_base", port: "value" }, to: { node: "c_mul", port: "base" } },
      { from: { node: "k_c", port: "value" }, to: { node: "c_mul", port: "factors" } },
      { from: { node: "c_mul", port: "result" }, to: { node: "c_out", port: "value" } },
    ],
    ...over,
  } as Plan;
}

/** Two chains, NO round stage — this is what makes the plan total-less. */
const STAGES = [
  {
    stage_id: "chain_1",
    stage_kind: "multiplicative_chain",
    config_json: {
      chains: [
        { name: "building", output_field: "building_premium" },
        { name: "contents", output_field: "contents_premium" },
      ],
    },
  },
];

const MAPPING: PlanInputMapping = {
  source: { kind: "csv", columns: ["base"], sample_rows: [{ base: "130" }] },
  column_map: { base: "base" },
};

const REQUIRED: readonly RequiredInputEntry[] = [
  { id: "base", name: "Base rate", dtype: "number", category: "inputs" },
];

function renderPanel(plan: Plan): void {
  render(
    <InputsPanelV2
      stages={STAGES}
      inputMapping={MAPPING}
      onMappingChange={() => {}}
      requiredInputs={REQUIRED}
      dimensions={[]}
      plan={plan}
      inputDtypes={{ base: "number" }}
    />,
  );
}

describe("<InputsPanelV2> · total-less multi-coverage (93.4)", () => {
  it("⭐ previews the dec-page SUM of the towers, never the last tower", () => {
    renderPanel(twoTowerPlan());
    // 130×1.5 + 130×0.6 = 195 + 78 = $273.
    expect(screen.getAllByText("$273").length).toBeGreaterThan(0);
    // The last tower ($78) and the first ($195) are parts, not prices.
    expect(screen.queryAllByText("$78")).toHaveLength(0);
    expect(screen.queryAllByText("$195")).toHaveLength(0);
  });

  it("⭐ refuses a tail over a total-less plan by name — no silent tax on one tower", () => {
    const plan = twoTowerPlan({
      policy_tail: [
        {
          kind: "schedule_rating",
          id: "irpm",
          display_name: "IRPM",
          cap_pct: 25,
          source: { from: "literal", total: 10 },
        },
      ],
    } as Partial<Plan>);
    renderPanel(plan);

    // The reason is stated, once, in the author's own terms — and NOT
    // as "open a row's audit trace (unknown key, missing input)", which
    // misdirects twice: the rows rated fine, and the fix is in the plan.
    expect(
      screen.getByText(/declares no total output for the tail\/minimum/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/unknown key, missing input/)).toBeNull();
    // Not the last tower taxed ($78 × 1.1 = $85.80), and not the
    // untailed sum passed off as filed.
    expect(screen.queryAllByText("$85.80")).toHaveLength(0);
    expect(screen.queryAllByText("$273")).toHaveLength(0);
  });
});
