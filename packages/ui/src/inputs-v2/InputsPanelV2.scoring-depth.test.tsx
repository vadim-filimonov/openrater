/**
 * <InputsPanelV2> — P1.3 scoring-depth tests (audit + verdict).
 *
 * The Phase C preview showed only the average + a flat premium strip. P1.3
 * restores the audit depth the v1 ScoringPreviewPane had, the calm v2 way:
 *   · an eligibility verdict resolved per row (decline/submit/standard) —
 *     surfaced as an attention DOT that appears ONLY on rows that need a
 *     second look (submit/decline), so a clean standard book stays quiet;
 *   · a click-to-expand factor TRACE per row (the "why" behind a premium).
 *
 * Fixture: the Phase C `base × 1.3794 → premium` chain PLUS a per-row
 * eligibility gate `base > 1500 → decline` (default standard). Row 1
 * (base=1000) is standard; row 2 (base=2000) declines. resolveEligibilityTier
 * (the canonical contract helper) reads the verdict from each row's trace.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { _clearRegistryForTests, registerBuiltinKinds } from "@openrater/contracts";
import type { Plan } from "@openrater/contracts";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** base × 1.10 × 0.95 × 1.32 → premium, AND a row gate base>1500 → decline. */
const PLAN: Plan = {
  id: "test.inputs-v2-scoring-depth",
  version: "1.0.0",
  name: "Inputs v2 scoring-depth test",
  line: "bop",
  effective: "2026-01-01",
  nodes: [
    { id: "in_base", kind: "input", params: { fieldName: "base", fieldType: "money" } },
    { id: "k_lcm", kind: "constant", params: { value: 1.1, type: "factor" } },
    { id: "k_disc", kind: "constant", params: { value: 0.95, type: "factor" } },
    { id: "k_load", kind: "constant", params: { value: 1.32, type: "factor" } },
    { id: "mul", kind: "chain.mult", params: { stopOnZero: false } },
    { id: "out_p", kind: "output", params: { fieldName: "premium", fieldType: "money" } },
    {
      id: "gate",
      kind: "eligibility.gate",
      params: {
        rules: [
          {
            rule_id: "too_big",
            variable: "base",
            op: "gt",
            value: 1500,
            tier: "decline",
            reasoning: "Base rate above the $1,500 line.",
          },
        ],
        default_tier: "standard",
        default_reasoning: "In appetite.",
        scope: "row",
      },
    },
    { id: "out_tier", kind: "output", params: { fieldName: "row_tier", fieldType: "string" } },
  ],
  edges: [
    { from: { node: "in_base", port: "value" }, to: { node: "mul", port: "base" } },
    { from: { node: "k_lcm", port: "value" }, to: { node: "mul", port: "factors" } },
    { from: { node: "k_disc", port: "value" }, to: { node: "mul", port: "factors" } },
    { from: { node: "k_load", port: "value" }, to: { node: "mul", port: "factors" } },
    { from: { node: "mul", port: "result" }, to: { node: "out_p", port: "value" } },
    { from: { node: "gate", port: "tier" }, to: { node: "out_tier", port: "value" } },
  ],
};

const MAPPING: PlanInputMapping = {
  source: {
    kind: "csv",
    columns: ["base"],
    sample_rows: [{ base: "1000" }, { base: "2000" }],
  },
  column_map: { base: "base" },
};

const REQUIRED: readonly RequiredInputEntry[] = [
  { id: "base", name: "Base rate", dtype: "number", category: "inputs" },
];

function renderPanel() {
  return render(
    <InputsPanelV2
      stages={[]}
      inputMapping={MAPPING}
      onMappingChange={() => {}}
      requiredInputs={REQUIRED}
      dimensions={[]}
      plan={PLAN}
      inputDtypes={{ base: "number" }}
    />,
  );
}

describe("<InputsPanelV2> — P1.3 scoring depth", () => {
  it("shows an attention dot ONLY on the row that needs a second look", () => {
    const { container } = renderPanel();
    const dots = container.querySelectorAll(".rater-inputs2__prem-dot");
    // Row 1 (standard) has no dot; row 2 (decline) has one. Calm by default.
    expect(dots).toHaveLength(1);
    expect(dots[0]!.getAttribute("data-tier")).toBe("decline");
  });

  it("expands the row's factor trace + verdict on chip click", () => {
    const { container } = renderPanel();
    const chips = container.querySelectorAll<HTMLButtonElement>(
      ".rater-inputs2__prem-chip",
    );
    expect(chips).toHaveLength(2);

    // No trace open initially.
    expect(
      container.querySelector(".rater-inputs2__trace"),
    ).not.toBeInTheDocument();

    // Click the declined row (row 2) — its trace + "Decline" verdict appear.
    fireEvent.click(chips[1]!);
    const trace = container.querySelector(".rater-inputs2__trace");
    expect(trace).toBeInTheDocument();
    expect(trace!.textContent).toContain("Decline");
    // The gate node fired — labeled in plain language (Brief 65 §3.5).
    expect(trace!.textContent).toContain("Eligibility rule");

    // Clicking the same chip again collapses it (toggle).
    fireEvent.click(chips[1]!);
    expect(
      container.querySelector(".rater-inputs2__trace"),
    ).not.toBeInTheDocument();
  });

  it("the standard row carries the verdict in its trace too", () => {
    const { container } = renderPanel();
    const chips = container.querySelectorAll<HTMLButtonElement>(
      ".rater-inputs2__prem-chip",
    );
    fireEvent.click(chips[0]!); // row 1 — standard
    const trace = container.querySelector(".rater-inputs2__trace");
    expect(trace).toBeInTheDocument();
    expect(trace!.textContent).toContain("Standard");
  });
});
