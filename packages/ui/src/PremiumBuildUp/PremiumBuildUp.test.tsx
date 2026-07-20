/**
 * <PremiumBuildUp> tests (Brief 62.4, R1) — the ordered-tail waterfall.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PremiumBuildUp } from "./PremiumBuildUp";
import type { AdjustmentStep, PolicyResult } from "@openrater/contracts";

/** A full sourced + guarded tail: subtotal 1000 → IRPM −10% (column) →
 *  first-term credit ×0.9 → new-biz (guard-skipped) → +$18 terrorism → floor (not
 *  binding) = 828. */
const TAIL: AdjustmentStep[] = [
  { id: "irpm", kind: "schedule_rating", applied: true, before: 1000, factor_or_delta: 0.9, after: 900, detail: "-10.0% (cap ±25%)", provenance: { source: "column" } },
  { id: "first_term_credit", kind: "package_factor", applied: true, before: 900, factor_or_delta: 0.9, after: 810, detail: "× 0.9" },
  { id: "newbiz", kind: "package_factor", applied: false, before: 810, factor_or_delta: 1, after: 810, detail: "not applied — guard is_new_business eq true not met" },
  { id: "terror", kind: "endorsement", applied: true, before: 810, factor_or_delta: 18, after: 828, detail: "+ $18" },
  { id: "min", kind: "minimum_premium", applied: false, before: 828, factor_or_delta: 0, after: 828, detail: "floor $500 not binding" },
];

function result(over: Partial<PolicyResult> = {}): PolicyResult {
  return {
    policy_id: "P",
    lines: [{ product: "bop", plan_id: "plan-bop", outputs: {}, premium: 1000 }],
    subtotal: 1000,
    package_credit: 0.9,
    after_credit: 900,
    minimum_premium: 500,
    minimum_applied: false,
    total: 828,
    adjustments: TAIL,
    ...over,
  };
}

describe("PremiumBuildUp", () => {
  it("renders an empty state before scoring", () => {
    render(<PremiumBuildUp result={null} />);
    expect(screen.getByText(/no premium yet/i)).toBeTruthy();
    expect(screen.getByText(/score a risk/i)).toBeTruthy();
  });

  it("renders the subtotal, every tail step's detail, and the filed total", () => {
    const { container } = render(<PremiumBuildUp result={result()} />);
    expect(screen.getByText("$1,000")).toBeTruthy(); // subtotal
    expect(screen.getByText("-10.0% (cap ±25%)")).toBeTruthy(); // IRPM detail
    expect(screen.getByText("× 0.9")).toBeTruthy(); // first-term credit
    expect(screen.getByText("+ $18")).toBeTruthy(); // terrorism
    expect(screen.getByText("floor $500 not binding")).toBeTruthy(); // min
    expect(screen.getByText(/filed premium/i)).toBeTruthy();
    expect(
      container.querySelector(".rater-premium-buildup__total-amount")?.textContent,
    ).toBe("$828");
    // one row per step
    expect(container.querySelectorAll(".rater-premium-buildup__row--step").length).toBe(5);
  });

  it("falls back to kind labels, or uses the provided display labels", () => {
    const { rerender, container } = render(<PremiumBuildUp result={result()} />);
    expect(screen.getByText("Schedule rating")).toBeTruthy(); // kind label fallback
    expect(screen.getByText("Endorsement")).toBeTruthy();
    rerender(
      <PremiumBuildUp result={result()} labels={{ irpm: "IRPM", first_term_credit: "First-term credit", terror: "Terrorism" }} />,
    );
    expect(screen.getByText("First-term credit")).toBeTruthy();
    expect(screen.getByText("Terrorism")).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("renders a provenance pill per step (column for sourced, filed otherwise)", () => {
    render(<PremiumBuildUp result={result()} />);
    expect(screen.getByText("column")).toBeTruthy(); // the IRPM source
    expect(screen.getAllByText("filed").length).toBeGreaterThan(0); // unsourced steps
  });

  it("marks a guard-skipped step as a visible no-op", () => {
    const { container } = render(<PremiumBuildUp result={result()} />);
    const skipped = container.querySelectorAll(".rater-premium-buildup__row--skipped");
    // the new-business guard-miss + the non-binding floor
    expect(skipped.length).toBe(2);
    expect(screen.getByText(/guard is_new_business eq true not met/)).toBeTruthy();
  });

  it("renders a LEGACY (synthesized 2-step) result via the identical path — back-compat", () => {
    const legacy: AdjustmentStep[] = [
      { id: "__legacy_package_credit", kind: "package_factor", applied: true, before: 1054, factor_or_delta: 0.95, after: 1001, detail: "× 0.95" },
      { id: "__legacy_minimum_premium", kind: "minimum_premium", applied: false, before: 1001, factor_or_delta: 0, after: 1001, detail: "floor $500 not binding" },
    ];
    const { container } = render(
      <PremiumBuildUp result={result({ subtotal: 1054, total: 1001, adjustments: legacy })} />,
    );
    expect(screen.getByText("× 0.95")).toBeTruthy();
    expect(container.querySelectorAll(".rater-premium-buildup__row--step").length).toBe(2);
    expect(
      container.querySelector(".rater-premium-buildup__total-amount")?.textContent,
    ).toBe("$1,001");
  });

  it("labels the line count", () => {
    render(<PremiumBuildUp result={result()} />);
    expect(screen.getByText("1 line")).toBeTruthy();
  });

  it("surfaces a connector step's version + frozen-snapshot affordance (62.6)", () => {
    const onViewSnapshot = vi.fn();
    const connectorTail: AdjustmentStep[] = [
      {
        id: "irpm",
        kind: "schedule_rating",
        applied: true,
        before: 1000,
        factor_or_delta: 0.9,
        after: 900,
        detail: "-10.0% (cap ±25%)",
        provenance: { source: "connector", version: "v2", snapshot_id: "snap_123" },
      },
    ];
    render(
      <PremiumBuildUp
        result={result({ subtotal: 1000, total: 900, adjustments: connectorTail })}
        onViewSnapshot={onViewSnapshot}
      />,
    );
    expect(screen.getByText("connector · v2")).toBeTruthy(); // versioned provenance pill
    const snap = screen.getByRole("button", { name: /snapshot/i });
    expect(snap).toHaveAttribute("title", expect.stringContaining("snap_123"));
    fireEvent.click(snap);
    expect(onViewSnapshot).toHaveBeenCalledWith("snap_123");
  });

  it("marks a connector step that fell back (degraded to net 0) — 62.6 §3", () => {
    const fallbackTail: AdjustmentStep[] = [
      {
        id: "irpm",
        kind: "schedule_rating",
        applied: true,
        before: 1000,
        factor_or_delta: 1,
        after: 1000,
        detail: "0.0% (connector unavailable)",
        provenance: { source: "connector", version: "v2", fallback_reason: "connector call failed" },
      },
    ];
    render(<PremiumBuildUp result={result({ subtotal: 1000, total: 1000, adjustments: fallbackTail })} />);
    expect(screen.getByText("fallback")).toBeTruthy();
    // no snapshot button without onViewSnapshot, even if a snapshot existed
    expect(screen.queryByRole("button", { name: /snapshot/i })).toBeNull();
  });
});
