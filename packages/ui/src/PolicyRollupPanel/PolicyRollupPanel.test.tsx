/**
 * <PolicyRollupPanel> tests (E08/E03 brief D6) — the grouped scoring result.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PolicyRollupPanel } from "./PolicyRollupPanel";
import type { PolicyBookResult } from "@openrater/contracts";

// The stress-test oracle, as evaluatePolicyBook would return it.
const RESULTS: PolicyBookResult[] = [
  {
    policy_id: "P1",
    rollup: {
      policy_id: "P1",
      location_count: 2,
      location_ids: ["L1", "L2"],
      rolled: { tiv: 1_060_000, premium: 1060 },
      breakdown: {
        tiv: [
          { location_id: "L1", value: 850_000 },
          { location_id: "L2", value: 210_000 },
        ],
        premium: [
          { location_id: "L1", value: 850 },
          { location_id: "L2", value: 210 },
        ],
      },
    },
    appetite: {
      tier: "standard",
      deciding: { scope: "policy", tier: "standard", matched_rule_id: null, reasoning: "In appetite." },
      verdicts: [],
    },
  },
  {
    policy_id: "P2",
    rollup: {
      policy_id: "P2",
      location_count: 1,
      location_ids: ["L1"],
      rolled: { tiv: 260_000, premium: 260 },
      breakdown: {
        tiv: [{ location_id: "L1", value: 260_000 }],
        premium: [{ location_id: "L1", value: 260 }],
      },
    },
    appetite: {
      tier: "decline",
      deciding: { scope: "policy", tier: "decline", matched_rule_id: "min_tiv", reasoning: "Below $1M." },
      verdicts: [],
    },
  },
];

describe("<PolicyRollupPanel>", () => {
  it("renders one row per policy with its verdict + rolled fields", () => {
    render(<PolicyRollupPanel results={RESULTS} />);
    expect(screen.getByText("2")).toBeInTheDocument(); // policy count
    // P1 IN appetite at $1.06M tiv; P2 declines at $260k.
    expect(screen.getByTestId("rater-prp-P1-tiv").textContent).toBe("1,060,000");
    expect(screen.getByTestId("rater-prp-P2-tiv").textContent).toBe("260,000");
    expect(screen.getByTestId("rater-prp-P1-premium").textContent).toBe("1,060");
  });

  it("expands a policy to its per-location contributions", () => {
    render(<PolicyRollupPanel results={RESULTS} />);
    // Collapsed: no location rows.
    expect(screen.queryByText("L2")).toBeNull();
    fireEvent.click(screen.getByTestId("rater-prp-policy-P1"));
    // L1 + L2 contributions appear.
    expect(screen.getByText("L2")).toBeInTheDocument();
    expect(screen.getByText("850,000")).toBeInTheDocument();
    expect(screen.getByText("210,000")).toBeInTheDocument();
  });

  it("honors an explicit field order + a custom formatter", () => {
    render(
      <PolicyRollupPanel
        results={RESULTS}
        fields={["premium"]}
        formatValue={(_f, v) => `$${v.toLocaleString("en-US")}`}
      />,
    );
    expect(screen.getByTestId("rater-prp-P1-premium").textContent).toBe("$1,060");
    // tiv column omitted when fields=["premium"].
    expect(screen.queryByTestId("rater-prp-P1-tiv")).toBeNull();
  });

  it("renders an empty state with no results", () => {
    render(<PolicyRollupPanel results={[]} />);
    expect(screen.getByText(/no policies yet/i)).toBeInTheDocument();
  });

  it("shows the IRPM-composed final premium + build-up when a tail is composed", () => {
    const withTail: PolicyBookResult[] = [
      {
        ...RESULTS[0]!,
        composed: {
          subtotal: 5085,
          final: 4731,
          adjustments: [
            {
              id: "irpm",
              kind: "schedule_rating",
              applied: true,
              before: 5085,
              factor_or_delta: 0.93038,
              after: 4731,
              detail: "−7.0% (cap ±25%)",
              provenance: { source: "column" },
            },
          ],
        },
      },
    ];
    render(<PolicyRollupPanel results={withTail} />);
    // The Final cell shows the composed premium (whole-dollar USD) — $4,731,
    // distinct from the rolled Σ premium ($1,060 here / $5,085 in the oracle).
    expect(screen.getByTestId("rater-prp-P1-final").textContent).toBe("$4,731");
    // Expand → the IRPM build-up appears (over a "2 locations" subtotal).
    fireEvent.click(screen.getByTestId("rater-prp-policy-P1"));
    expect(screen.getByText("Filed premium")).toBeInTheDocument();
    expect(screen.getByText("Schedule rating")).toBeInTheDocument();
    // "2 locations" appears on both the policy row + the build-up subtotal tag.
    expect(screen.getAllByText("2 locations").length).toBeGreaterThanOrEqual(2);
  });

  it("omits the final cell when a policy has no composed tail (back-compat)", () => {
    render(<PolicyRollupPanel results={RESULTS} />);
    expect(screen.queryByTestId("rater-prp-P1-final")).toBeNull();
  });
});
