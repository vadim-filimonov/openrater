/**
 * <InsightsPanel> tests — Brief 34 PR 34.3.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InsightsPanel } from "./InsightsPanel";
import type { Insight } from "./insights";

const SAMPLE_INSIGHTS: readonly Insight[] = [
  {
    kind: "range",
    severity: "info",
    message: "Range code:0.85–1.18 · spread code:0.33",
  },
  {
    kind: "monotonicity-break",
    severity: "warn",
    message: "Monotonicity break: code:Standard (code:0.88) dips below code:Modern (code:0.92).",
    anchor: { rowId: "band_15_30", colId: null },
  },
  {
    kind: "all-default",
    severity: "info",
    message: "Row code:FR is all at baseline (un-differentiated).",
    anchor: { rowId: "fr", colId: null },
  },
];

describe("<InsightsPanel> mount", () => {
  it("renders the empty state when no insights", () => {
    render(<InsightsPanel insights={[]} />);
    expect(screen.getByTestId("rater-insights-panel-empty")).toBeInTheDocument();
    expect(screen.getByTestId("rater-insights-panel")).toHaveAttribute(
      "data-insight-count",
      "0",
    );
  });

  it("renders one item per insight", () => {
    render(<InsightsPanel insights={SAMPLE_INSIGHTS} />);
    expect(
      screen.getByTestId("rater-insights-panel-item-0"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-insights-panel-item-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-insights-panel-item-2"),
    ).toBeInTheDocument();
  });

  it("data-kind + data-severity reflect the insight", () => {
    render(<InsightsPanel insights={SAMPLE_INSIGHTS} />);
    const warn = screen.getByTestId("rater-insights-panel-item-1");
    expect(warn).toHaveAttribute("data-kind", "monotonicity-break");
    expect(warn).toHaveAttribute("data-severity", "warn");
  });

  it("renders inline code spans for code:VALUE tokens", () => {
    render(<InsightsPanel insights={SAMPLE_INSIGHTS} />);
    const range = screen.getByTestId("rater-insights-panel-item-0");
    const codes = range.querySelectorAll(".rater-insights-panel-code");
    // "Range code:0.85–1.18 · spread code:0.33" → 2 code tokens
    expect(codes.length).toBe(2);
    expect(codes[0]!.textContent).toBe("0.85–1.18");
    expect(codes[1]!.textContent).toBe("0.33");
  });
});

describe("<InsightsPanel> jump-to-cell", () => {
  it("renders clickable insights with role=button when anchor + handler", () => {
    const onJump = vi.fn();
    render(
      <InsightsPanel
        insights={SAMPLE_INSIGHTS}
        onJumpToCell={onJump}
      />,
    );
    const item = screen.getByTestId("rater-insights-panel-item-1");
    expect(item.getAttribute("role")).toBe("button");
    fireEvent.click(item);
    expect(onJump).toHaveBeenCalledWith({
      rowId: "band_15_30",
      colId: null,
    });
  });

  it("does NOT render role=button when no handler is provided", () => {
    render(<InsightsPanel insights={SAMPLE_INSIGHTS} />);
    const item = screen.getByTestId("rater-insights-panel-item-1");
    expect(item.getAttribute("role")).toBeNull();
  });

  it("does NOT render role=button when an insight has no anchor", () => {
    const onJump = vi.fn();
    render(
      <InsightsPanel
        insights={SAMPLE_INSIGHTS}
        onJumpToCell={onJump}
      />,
    );
    // Item 0 (range) has no anchor → not clickable
    const range = screen.getByTestId("rater-insights-panel-item-0");
    expect(range.getAttribute("role")).toBeNull();
  });

  it("Enter / Space on a focused item fires onJumpToCell", () => {
    const onJump = vi.fn();
    render(
      <InsightsPanel
        insights={SAMPLE_INSIGHTS}
        onJumpToCell={onJump}
      />,
    );
    const item = screen.getByTestId("rater-insights-panel-item-1");
    fireEvent.keyDown(item, { key: "Enter" });
    expect(onJump).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(item, { key: " " });
    expect(onJump).toHaveBeenCalledTimes(2);
  });
});

describe("<InsightsPanel> visible limit", () => {
  it("shows all when count ≤ limit", () => {
    render(<InsightsPanel insights={SAMPLE_INSIGHTS} visibleLimit={6} />);
    expect(
      screen.queryByTestId("rater-insights-panel-more"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("rater-insights-panel-item-2"),
    ).toBeInTheDocument();
  });

  it("collapses when count > limit + reveals on click", () => {
    const many: Insight[] = Array.from({ length: 8 }, (_, i) => ({
      kind: "range" as const,
      severity: "info" as const,
      message: `Insight code:${i}`,
    }));
    render(<InsightsPanel insights={many} visibleLimit={3} />);
    // Only items 0..2 visible
    expect(
      screen.getByTestId("rater-insights-panel-item-0"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-insights-panel-item-5"),
    ).not.toBeInTheDocument();
    // "Show N more" appears
    const more = screen.getByTestId("rater-insights-panel-more");
    expect(more).toHaveTextContent("Show 5 more");
    fireEvent.click(more);
    // All items now visible
    expect(
      screen.getByTestId("rater-insights-panel-item-7"),
    ).toBeInTheDocument();
  });
});
