/**
 * <InputsPanelV2> — P2.2 policy grouping + roll-up tests.
 *
 * When a connected book carries a policy_id column, the preview offers to
 * "Group by policy". Active grouping swaps the per-row strip for a per-policy
 * list: each policy shows its FILED premium (composed post-tail final when a
 * policy tail is authored, else the rolled subtotal — V4 G10) + appetite
 * verdict (canonical <TierVerdictChip>), expandable to the per-location
 * breakdown + the subtotal → adjustments → filed build-up — reusing the
 * same click-to-expand language as the per-row factor trace.
 *
 * The mount computes `policyRollupResults` (via evaluatePolicyBook); the view
 * just renders them, so these tests hand it a PolicyBookResult fixture.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  _clearRegistryForTests,
  registerBuiltinKinds,
} from "@openrater/contracts";
import type { Plan, PolicyBookResult } from "@openrater/contracts";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

/** base_rate × 1.0 → premium (per-location scoring keeps canScore true). */
const PLAN: Plan = {
  id: "test.inputs-v2-policy",
  version: "1.0.0",
  name: "Inputs v2 policy test",
  line: "bop",
  effective: "2026-01-01",
  nodes: [
    { id: "in_base", kind: "input", params: { fieldName: "base_rate", fieldType: "money" } },
    { id: "k", kind: "constant", params: { value: 1.0, type: "factor" } },
    { id: "mul", kind: "chain.mult", params: { stopOnZero: false } },
    { id: "out_p", kind: "output", params: { fieldName: "premium", fieldType: "money" } },
  ],
  edges: [
    { from: { node: "in_base", port: "value" }, to: { node: "mul", port: "base" } },
    { from: { node: "k", port: "value" }, to: { node: "mul", port: "factors" } },
    { from: { node: "mul", port: "result" }, to: { node: "out_p", port: "value" } },
  ],
};

const BASE_MAPPING: PlanInputMapping = {
  source: {
    kind: "csv",
    columns: ["base_rate", "policy_id", "location_id"],
    sample_rows: [
      { base_rate: "750", policy_id: "P-001", location_id: "L1" },
      { base_rate: "750", policy_id: "P-001", location_id: "L2" },
      { base_rate: "2000", policy_id: "P-002", location_id: "L3" },
    ],
  },
  column_map: { base_rate: "base_rate" },
};

const REQUIRED: readonly RequiredInputEntry[] = [
  { id: "base_rate", name: "Base rate", dtype: "number", category: "inputs" },
];

const POLICY_RESULTS: readonly PolicyBookResult[] = [
  {
    policy_id: "P-001",
    rollup: {
      policy_id: "P-001",
      location_count: 2,
      location_ids: ["L1", "L2"],
      rolled: { premium: 1500 },
      breakdown: {
        premium: [
          { location_id: "L1", value: 750 },
          { location_id: "L2", value: 750 },
        ],
      },
    },
    appetite: {
      tier: "standard",
      deciding: {
        scope: "policy",
        tier: "standard",
        matched_rule_id: null,
        reasoning: "Policy in appetite.",
      },
      verdicts: [],
    },
  },
  {
    policy_id: "P-002",
    rollup: {
      policy_id: "P-002",
      location_count: 1,
      location_ids: ["L3"],
      rolled: { premium: 2000 },
      breakdown: { premium: [{ location_id: "L3", value: 2000 }] },
    },
    appetite: {
      tier: "decline",
      deciding: {
        scope: "policy",
        tier: "decline",
        matched_rule_id: "tiv_cap",
        reasoning: "Policy TIV over the line.",
      },
      verdicts: [],
    },
  },
];

// ── Total-less fixtures (93.4 follow-through) ───────────────────────
// Two coverage towers, NO round stage and no total output — the legal
// transcription the workbook spec produces when a filing has no total
// row. `resolvePremiumColumn` names the LAST tower here
// (`contents_premium`), which is exactly what must NOT reach the
// mapping: every composer reads a premium-named roll-up as the
// author's explicit basis and skips the dec-page sum.
const TOTAL_LESS_PLAN: Plan = {
  id: "test.inputs-v2-policy-totalless",
  version: "1.0.0",
  name: "Two towers, no total",
  line: "bop",
  effective: "2026-01-01",
  nodes: [
    { id: "in_b", kind: "input", params: { fieldName: "bldg_rate", fieldType: "money" } },
    { id: "in_c", kind: "input", params: { fieldName: "cont_rate", fieldType: "money" } },
    { id: "kb", kind: "constant", params: { value: 1.0, type: "factor" } },
    { id: "kc", kind: "constant", params: { value: 1.0, type: "factor" } },
    { id: "mul_b", kind: "chain.mult", params: { stopOnZero: false } },
    { id: "mul_c", kind: "chain.mult", params: { stopOnZero: false } },
    { id: "out_b", kind: "output", params: { fieldName: "building_premium", fieldType: "money" } },
    { id: "out_c", kind: "output", params: { fieldName: "contents_premium", fieldType: "money" } },
  ],
  edges: [
    { from: { node: "in_b", port: "value" }, to: { node: "mul_b", port: "base" } },
    { from: { node: "kb", port: "value" }, to: { node: "mul_b", port: "factors" } },
    { from: { node: "mul_b", port: "result" }, to: { node: "out_b", port: "value" } },
    { from: { node: "in_c", port: "value" }, to: { node: "mul_c", port: "base" } },
    { from: { node: "kc", port: "value" }, to: { node: "mul_c", port: "factors" } },
    { from: { node: "mul_c", port: "result" }, to: { node: "out_c", port: "value" } },
  ],
};

const TOTAL_LESS_COLUMNS = [
  "bldg_rate",
  "cont_rate",
  "tiv",
  "policy_id",
  "location_id",
];
const TOTAL_LESS_ROWS = [
  { bldg_rate: "195", cont_rate: "72", tiv: "500000", policy_id: "P-001", location_id: "L1" },
  { bldg_rate: "195", cont_rate: "72", tiv: "500000", policy_id: "P-001", location_id: "L2" },
  { bldg_rate: "300", cont_rate: "100", tiv: "900000", policy_id: "P-002", location_id: "L3" },
];

const TOTAL_LESS_MAPPING: PlanInputMapping = {
  source: { kind: "csv", columns: TOTAL_LESS_COLUMNS, sample_rows: TOTAL_LESS_ROWS },
  column_map: { bldg_rate: "bldg_rate", cont_rate: "cont_rate" },
};

const TOTAL_LESS_REQUIRED: readonly RequiredInputEntry[] = [
  { id: "bldg_rate", name: "Building rate", dtype: "number", category: "inputs" },
  { id: "cont_rate", name: "Contents rate", dtype: "number", category: "inputs" },
];

/** Every /premium/i field name the mapping would DECLARE. */
function declaredPremiumNames(mapping: PlanInputMapping): string[] {
  return (mapping.rollup_fields ?? [])
    .map((f) => f.fieldName)
    .filter((n) => /premium/i.test(n));
}

describe("<InputsPanelV2> — total-less plans declare no premium basis", () => {
  it("⭐ enabling grouping declares NO premium-named roll-up", () => {
    const onMappingChange = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={TOTAL_LESS_MAPPING}
        onMappingChange={onMappingChange}
        requiredInputs={TOTAL_LESS_REQUIRED}
        dimensions={[]}
        plan={TOTAL_LESS_PLAN}
        inputDtypes={{ bldg_rate: "number", cont_rate: "number" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group by policy" }));

    const next = onMappingChange.mock.calls[0]![0] as PlanInputMapping;
    // THE regression: `contents_premium` (the last tower) used to land
    // here and read to bookRun as "the author chose contents", so each
    // policy filed one coverage of its dec page instead of the sum.
    expect(declaredPremiumNames(next)).toEqual([]);
    // Grouping still turns on, and the non-premium suggestion survives.
    expect(next.grouping_config).toEqual(
      expect.objectContaining({ policy_id_column: "policy_id" }),
    );
    expect(next.rollup_fields).toEqual([
      expect.objectContaining({ fieldName: "tiv", reducer: "sum" }),
    ]);
  });

  it("never auto-declares a book's own premium-named COLUMN", () => {
    // The suggester name-matches book columns, so a book carrying an
    // `expected_premium` column would otherwise declare the basis by
    // the back door — same bug, different source.
    const onMappingChange = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...TOTAL_LESS_MAPPING,
          source: {
            kind: "csv",
            columns: [...TOTAL_LESS_COLUMNS, "expected_premium"],
            sample_rows: TOTAL_LESS_ROWS,
          },
        }}
        onMappingChange={onMappingChange}
        requiredInputs={TOTAL_LESS_REQUIRED}
        dimensions={[]}
        plan={TOTAL_LESS_PLAN}
        inputDtypes={{ bldg_rate: "number", cont_rate: "number" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group by policy" }));

    const next = onMappingChange.mock.calls[0]![0] as PlanInputMapping;
    expect(declaredPremiumNames(next)).toEqual([]);
  });

  it("editing the roll-ups never re-asserts a premium leg", () => {
    // The D-C invariant rides every write; on a total-less plan it must
    // stand down, or the wrong basis comes back on the next edit.
    const onMappingChange = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...TOTAL_LESS_MAPPING,
          grouping_config: { policy_id_column: "policy_id" },
          rollup_fields: [{ fieldName: "tiv", reducer: "sum" }],
        }}
        onMappingChange={onMappingChange}
        requiredInputs={TOTAL_LESS_REQUIRED}
        dimensions={[]}
        plan={TOTAL_LESS_PLAN}
        inputDtypes={{ bldg_rate: "number", cont_rate: "number" }}
      />,
    );
    // Drop the one extra roll-up → the write must be genuinely empty.
    fireEvent.click(screen.getByRole("button", { name: "Stop rolling up tiv" }));

    const next = onMappingChange.mock.calls[0]![0] as PlanInputMapping;
    expect(declaredPremiumNames(next)).toEqual([]);
    expect(next.rollup_fields).toEqual([]);
  });

  it("the card states the coverage sum instead of naming a total", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...TOTAL_LESS_MAPPING,
          grouping_config: { policy_id_column: "policy_id" },
          rollup_fields: [{ fieldName: "tiv", reducer: "sum" }],
        }}
        onMappingChange={() => {}}
        requiredInputs={TOTAL_LESS_REQUIRED}
        dimensions={[]}
        plan={TOTAL_LESS_PLAN}
        inputDtypes={{ bldg_rate: "number", cont_rate: "number" }}
      />,
    );
    // No "the plan's total" claim — the plan has none.
    expect(
      screen.queryByTestId("rater-polgroup-rollup-total"),
    ).not.toBeInTheDocument();
    const row = screen.getByTestId("rater-polgroup-rollup-coverage-sum");
    expect(row).toHaveTextContent("building_premium + contents_premium");
    expect(row).toHaveTextContent(/declares no total/);
    expect(row).toHaveTextContent(/sum of its 2 coverages/);
  });

  it("a plan WITH a round total still declares it — D-C intact", () => {
    // The load-bearing path (Brief 80 D-C + the G9 per-policy minimum)
    // must be untouched: a round stage names the total and it is
    // always rolled.
    const onMappingChange = vi.fn();
    render(
      <InputsPanelV2
        stages={[
          {
            stage_id: "s_round",
            stage_kind: "round",
            config_json: { output_field: "final_premium_usd" },
          },
        ]}
        inputMapping={TOTAL_LESS_MAPPING}
        onMappingChange={onMappingChange}
        requiredInputs={TOTAL_LESS_REQUIRED}
        dimensions={[]}
        plan={TOTAL_LESS_PLAN}
        inputDtypes={{ bldg_rate: "number", cont_rate: "number" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group by policy" }));

    const next = onMappingChange.mock.calls[0]![0] as PlanInputMapping;
    expect(next.rollup_fields).toEqual([
      expect.objectContaining({ fieldName: "final_premium_usd", reducer: "sum" }),
      expect.objectContaining({ fieldName: "tiv", reducer: "sum" }),
    ]);
  });

  it("headlines the materialized dec-page sum, never a TIV column", () => {
    // With no premium leg declared, `rolled[0]` is `tiv` — the headline
    // must resolve through COVERAGE_SUM_COLUMN, which the producer
    // materializes onto each policy (mirrors the run summary's
    // `premium_field`).
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...TOTAL_LESS_MAPPING,
          grouping_config: { policy_id_column: "policy_id" },
          rollup_fields: [{ fieldName: "tiv", reducer: "sum" }],
        }}
        onMappingChange={() => {}}
        requiredInputs={TOTAL_LESS_REQUIRED}
        dimensions={[]}
        plan={TOTAL_LESS_PLAN}
        inputDtypes={{ bldg_rate: "number", cont_rate: "number" }}
        policyRollupResults={[
          {
            policy_id: "P-001",
            rollup: {
              policy_id: "P-001",
              location_count: 2,
              location_ids: ["L1", "L2"],
              rolled: {
                tiv: 1_000_000,
                building_premium: 390,
                contents_premium: 144,
                coverage_sum_premium: 534,
              },
              breakdown: {
                coverage_sum_premium: [
                  { location_id: "L1", value: 267 },
                  { location_id: "L2", value: 267 },
                ],
              },
            },
            appetite: {
              tier: "standard",
              deciding: {
                scope: "policy",
                tier: "standard",
                matched_rule_id: null,
                reasoning: "Policy in appetite.",
              },
              verdicts: [],
            },
          },
        ]}
      />,
    );
    // $534 = the dec-page sum. $1,000,000 (tiv) must NOT be a premium.
    expect(screen.getAllByText("$534").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("$1,000,000")).not.toBeInTheDocument();
    // The summary line states the sum rather than "nothing yet".
    expect(
      screen.getByText(/building_premium \+ contents_premium \(sum\)/),
    ).toBeInTheDocument();
  });
});

describe("<InputsPanelV2> — P2.2 policy roll-up", () => {
  it("offers 'Group by policy' when the book has a policy_id column", () => {
    const onMappingChange = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={BASE_MAPPING}
        onMappingChange={onMappingChange}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base_rate: "number" }}
      />,
    );

    // F05 — the grouping offer is now a VISIBLE toolbar button (was buried in
    // the "⋯" options menu, where an un-briefed actuary couldn't find it).
    fireEvent.click(screen.getByRole("button", { name: "Group by policy" }));

    // Enabling grouping writes grouping_config (the detected policy column)
    // + suggested roll-up fields onto the mapping.
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        grouping_config: expect.objectContaining({ policy_id_column: "policy_id" }),
        rollup_fields: expect.arrayContaining([
          expect.objectContaining({ fieldName: "premium", reducer: "sum" }),
        ]),
      }),
    );
  });

  it("renders the per-policy list when grouping is active", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...BASE_MAPPING,
          grouping_config: { policy_id_column: "policy_id", location_id_column: "location_id" },
          rollup_fields: [{ fieldName: "premium", reducer: "sum" }],
        }}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base_rate: "number" }}
        policyRollupResults={POLICY_RESULTS}
      />,
    );

    // The eyebrow flips to "Policy preview"; both policies render with their
    // rolled premiums + verdict chips. ($1,500 appears twice since G11: the
    // book headline is now WRITTEN premium — which here equals P-001's row.)
    expect(screen.getByText("Policy preview")).toBeInTheDocument();
    expect(screen.getByText("P-001")).toBeInTheDocument();
    expect(screen.getAllByText("$1,500").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2 locations")).toBeInTheDocument();
    expect(screen.getByText("P-002")).toBeInTheDocument();
    expect(screen.getByText("$2,000")).toBeInTheDocument();
    // The verdicts (canonical TierVerdictChip).
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Decline")).toBeInTheDocument();
  });

  it("expands a policy to its per-location breakdown + deciding reason", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...BASE_MAPPING,
          grouping_config: { policy_id_column: "policy_id" },
          rollup_fields: [{ fieldName: "premium", reducer: "sum" }],
        }}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base_rate: "number" }}
        policyRollupResults={POLICY_RESULTS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /P-001/ }));
    expect(screen.getByText("Policy in appetite.")).toBeInTheDocument();
    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("L2")).toBeInTheDocument();
  });

  it("headlines the composed post-tail final + shows the build-up on expand (V4 G10)", () => {
    // P-001 carries a composed tail (GLM IRPM × 0.93): the DISPLAYED premium
    // must be the post-tail final ($1,395), never the pre-tail rolled
    // subtotal ($1,500) — the G10 regression dropped `composed` at display.
    const composedResults: readonly PolicyBookResult[] = [
      {
        ...POLICY_RESULTS[0]!,
        composed: {
          subtotal: 1500,
          final: 1395,
          adjustments: [
            {
              id: "irpm",
              kind: "schedule_rating",
              applied: true,
              before: 1500,
              factor_or_delta: 0.93,
              after: 1395,
              detail: "× 0.930 (GLM IRPM)",
            },
          ],
        },
      },
      POLICY_RESULTS[1]!,
    ];
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...BASE_MAPPING,
          grouping_config: { policy_id_column: "policy_id", location_id_column: "location_id" },
          rollup_fields: [{ fieldName: "premium", reducer: "sum" }],
        }}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base_rate: "number" }}
        policyRollupResults={composedResults}
      />,
    );

    // P-001 headline = the composed final; the pre-tail subtotal is not
    // shown until the build-up expands. P-002 (no tail) still falls back
    // to its rolled premium — but P-002 is DECLINED, so its $2,000 is
    // indicative and the book headline is the WRITTEN $1,395 alone (G11);
    // the old blended $3,395 must be gone.
    expect(screen.getAllByText("$1,395").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("$1,500")).not.toBeInTheDocument();
    expect(screen.getByText("$2,000")).toBeInTheDocument();
    expect(screen.queryByText("$3,395")).not.toBeInTheDocument();
    expect(
      screen.getByText(/1 declined \(\$2,000 indicative\)/),
    ).toBeInTheDocument();

    // Expand P-001 → the subtotal → adjustment → filed build-up appears.
    fireEvent.click(screen.getByRole("button", { name: /P-001/ }));
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(screen.getByText("$1,500")).toBeInTheDocument();
    expect(screen.getByText("× 0.930 (GLM IRPM)")).toBeInTheDocument();
    expect(screen.getByText("Filed premium")).toBeInTheDocument();
  });

  it("adjusts the roll-up in the Policies card — reducer + add + remove (Brief 80 D-A)", () => {
    const onMappingChange = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...BASE_MAPPING,
          grouping_config: { policy_id_column: "policy_id" },
          rollup_fields: [
            { fieldName: "premium", reducer: "sum" },
            { fieldName: "base_rate", reducer: "sum" },
          ],
        }}
        onMappingChange={onMappingChange}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base_rate: "number" }}
        policyRollupResults={POLICY_RESULTS}
      />,
    );

    // Brief 80 D-C — the plan total (premium here) is the always-rolled
    // first row: no reducer select, no remove.
    expect(screen.getByTestId("rater-polgroup-rollup-total")).toHaveTextContent(
      "premium",
    );
    expect(
      screen.queryByLabelText("Reducer for premium"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Stop rolling up premium"),
    ).not.toBeInTheDocument();

    // Change base_rate's reducer sum → avg (an EXTRA field edits freely).
    fireEvent.change(screen.getByLabelText("Reducer for base_rate"), {
      target: { value: "avg" },
    });
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rollup_fields: [
          { fieldName: "premium", reducer: "sum" },
          { fieldName: "base_rate", reducer: "avg" },
        ],
      }),
    );

    // Add another rolled field via the card's add flow.
    fireEvent.click(screen.getByTestId("rater-polgroup-add-rollup-open"));
    fireEvent.change(screen.getByTestId("rater-polgroup-add-rollup"), {
      target: { value: "location_id" },
    });
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rollup_fields: [
          { fieldName: "premium", reducer: "sum" },
          { fieldName: "base_rate", reducer: "sum" },
          { fieldName: "location_id", reducer: "sum" },
        ],
      }),
    );

    // Remove the extra — the total stays untouchable.
    fireEvent.click(screen.getByLabelText("Stop rolling up base_rate"));
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rollup_fields: [{ fieldName: "premium", reducer: "sum" }],
      }),
    );
  });

  it("the preview's roll-up line is a read-only summary pointing at the card (Brief 80 D-A)", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...BASE_MAPPING,
          grouping_config: { policy_id_column: "policy_id" },
          rollup_fields: [{ fieldName: "premium", reducer: "sum" }],
        }}
        onMappingChange={vi.fn()}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base_rate: "number" }}
        policyRollupResults={POLICY_RESULTS}
      />,
    );
    // The P2.2b "Adjust" reveal retired — one writer (the card).
    expect(
      screen.queryByRole("button", { name: /Adjust/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Rolling up premium \(sum\)/)).toBeInTheDocument();
  });

  it("G11 — the grouped headline is WRITTEN premium; declines split out as indicative", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...BASE_MAPPING,
          grouping_config: { policy_id_column: "policy_id" },
          rollup_fields: [{ fieldName: "premium", reducer: "sum" }],
        }}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base_rate: "number" }}
        policyRollupResults={POLICY_RESULTS}
      />,
    );

    // Pre-G11 the headline summed EVERY policy ($3,500), silently blending
    // P-002's declined-indicative $2,000 into "total premium". The headline
    // is now written-only, and the declined figure is its own labelled part.
    const headline = document.querySelector(".rater-inputs2__prem-avg");
    expect(headline?.textContent).toBe("$1,500");
    expect(
      screen.getByText(/written premium · 2 policies · 3 locations/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 declined \(\$2,000 indicative\)/),
    ).toBeInTheDocument();
    // The declined policy's row premium is visibly indicative, not written.
    const indicative = screen.getByTitle(
      /Indicative — the plan declines this policy/,
    );
    expect(indicative).toHaveTextContent("$2,000");
    expect(indicative.className).toContain("is-indicative");
  });
});

// ══════════════════════════════════════════════════════════════════
// ADR-0056 — the grouped view's ERROR facet (error ≠ decline ≠ $0)
// ══════════════════════════════════════════════════════════════════

describe("<InputsPanelV2> — ADR-0056 policy error facet", () => {
  const WITH_ERROR: readonly PolicyBookResult[] = [
    POLICY_RESULTS[0]!,
    {
      policy_id: "P-ERR",
      rollup: {
        policy_id: "P-ERR",
        location_count: 1,
        location_ids: ["L9"],
        // The engine withheld the errored location's premium, so the
        // rolled sum is a misleading 0 — the view must NOT render it.
        rolled: { premium: 0 },
        breakdown: { premium: [{ location_id: "L9", value: null }] },
      },
      appetite: {
        tier: "decline",
        deciding: {
          scope: "row",
          tier: "decline",
          matched_rule_id: null,
          reasoning: "Location gate verdict.",
        },
        verdicts: [],
      },
      row_errors: 1,
    },
  ];

  it("renders Error + no premium for an unrateable policy — never 'Decline $0'", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          ...BASE_MAPPING,
          grouping_config: {
            policy_id_column: "policy_id",
            location_id_column: "location_id",
          },
          rollup_fields: [{ fieldName: "premium", reducer: "sum" }],
        }}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        plan={PLAN}
        inputDtypes={{ base_rate: "number" }}
        policyRollupResults={WITH_ERROR}
      />,
    );

    // The error facet takes the tier chip's place; the premium is "—",
    // never the partial rollup's $0.
    const errPill = screen.getByText("Error");
    expect(errPill.className).toContain("rater-inputs2__policy-err");
    const errRow = errPill.closest(".rater-inputs2__policy")!;
    expect(errRow.textContent).toContain("P-ERR");
    expect(errRow.textContent).not.toContain("$0");
    expect(errRow.querySelector(".rater-inputs2__policy-prem")?.textContent).toBe(
      "—",
    );

    // The caption names the facet; written premium excludes the policy.
    expect(screen.getByText(/1 cannot be rated/)).toBeInTheDocument();
    const headline = document.querySelector(".rater-inputs2__prem-avg");
    expect(headline?.textContent).toBe("$1,500");
  });
});
