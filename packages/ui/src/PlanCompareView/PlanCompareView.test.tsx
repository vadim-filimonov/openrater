/**
 * <PlanCompareView> + <CompareTree> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CompareTree, PlanCompareView } from "./PlanCompareView";
import type {
  DiffNode,
  PlanDiff,
  RunDiff,
  TraceDiff,
} from "@openrater/contracts";

const MAKE_NODE = (overrides: Partial<DiffNode>): DiffNode => ({
  path: "x",
  label: "x",
  state: "unchanged",
  ...overrides,
});

const PLAN_DIFF: PlanDiff = {
  a: { id: "plan_a", version: 1, label: "v1 filed" },
  b: { id: "plan_b", version: 2, label: "v2 draft" },
  tree: MAKE_NODE({
    label: "Plan",
    state: "changed",
    children: [
      MAKE_NODE({
        path: "name",
        label: "name",
        state: "changed",
        a_value: "Old name",
        b_value: "New name",
      }),
      MAKE_NODE({
        path: "lines",
        label: "lines",
        state: "unchanged",
        children: [
          MAKE_NODE({ path: "lines[0]", label: "[0]", state: "unchanged" }),
          MAKE_NODE({ path: "lines[1]", label: "[1]", state: "unchanged" }),
        ],
      }),
    ],
  }),
  summary: { changed: 1, added: 0, removed: 0, inspected: 3 },
};

const RUN_DIFF: RunDiff = {
  a: { id: "run_a" },
  b: { id: "run_b" },
  outputs: MAKE_NODE({
    path: "outputs",
    label: "Outputs",
    state: "changed",
    children: [
      MAKE_NODE({
        path: "outputs.total_premium",
        label: "total_premium",
        state: "changed",
        a_value: 5000,
        b_value: 5500,
        rate_impact: { dollars: 500, pct: 10 },
      }),
    ],
  }),
  trace: {
    a: { id: "a" },
    b: { id: "b" },
    tree: MAKE_NODE({
      path: "trace",
      label: "Trace",
      state: "changed",
      children: [
        MAKE_NODE({
          path: "trace.step_x",
          label: "Step 'step_x'",
          state: "changed",
        }),
      ],
    }),
    summary: { changed: 1, added: 0, removed: 0, inspected: 1 },
    firstDivergingNodeId: "step_x",
  },
  summary: { changed: 2, added: 0, removed: 0, inspected: 4 },
  total_impact: { dollars: 500, pct: 10 },
};

const TRACE_DIFF: TraceDiff = {
  a: { id: "ta" },
  b: { id: "tb" },
  tree: MAKE_NODE({
    path: "trace",
    label: "Trace",
    state: "changed",
    children: [
      MAKE_NODE({
        path: "trace.step1",
        label: "Step 'step1'",
        state: "changed",
      }),
    ],
  }),
  summary: { changed: 1, added: 0, removed: 0, inspected: 1 },
  firstDivergingNodeId: "step1",
};

describe("<PlanCompareView>", () => {
  it("renders empty message when no diff supplied", () => {
    render(<PlanCompareView />);
    expect(screen.getByText(/No diff supplied/)).toBeInTheDocument();
  });

  it("renders sides metadata + mode tag for planDiff", () => {
    render(<PlanCompareView planDiff={PLAN_DIFF} />);
    expect(screen.getByText("v1 filed")).toBeInTheDocument();
    expect(screen.getByText("v2 draft")).toBeInTheDocument();
    expect(screen.getByText(/mode: plan-vs-plan/i)).toBeInTheDocument();
  });

  it("renders DiffSummaryChip with counts", () => {
    render(<PlanCompareView planDiff={PLAN_DIFF} />);
    expect(screen.getByText("changed")).toBeInTheDocument();
  });

  it("renders total_impact for runDiff", () => {
    const { container } = render(<PlanCompareView runDiff={RUN_DIFF} />);
    // total_impact appears both in the summary chip AND on the
    // total_premium node's rate_impact decoration. Verify at least one
    // RateImpactBadge with the dollars exists in the summary slot.
    const summary = container.querySelector(".rater-plan-compare-view__summary");
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toMatch(/\+\$500/);
    expect(summary?.textContent).toMatch(/\+10\.0%/);
  });

  it("renders divergence callout for traceDiff", () => {
    render(<PlanCompareView traceDiff={TRACE_DIFF} />);
    expect(screen.getByText(/Diverges at step/)).toBeInTheDocument();
    expect(screen.getByText("step1")).toBeInTheDocument();
  });

  it("renders divergence callout for runDiff (via nested trace)", () => {
    render(<PlanCompareView runDiff={RUN_DIFF} />);
    expect(screen.getByText("step_x")).toBeInTheDocument();
  });

  it("does NOT render divergence callout when null", () => {
    const noDiv: TraceDiff = { ...TRACE_DIFF, firstDivergingNodeId: null };
    render(<PlanCompareView traceDiff={noDiv} />);
    expect(screen.queryByText(/Diverges at step/)).toBeNull();
  });

  it("renders sample label when provided", () => {
    render(
      <PlanCompareView
        runDiff={RUN_DIFF}
        sampleLabel="ABC Restaurant LLC"
      />,
    );
    expect(screen.getByText(/ABC Restaurant LLC/)).toBeInTheDocument();
  });

  it("renders both Outputs + Trace trees for runDiff", () => {
    const { container } = render(<PlanCompareView runDiff={RUN_DIFF} />);
    // Tree section titles live in .rater-compare-tree__group-title; the
    // labels "Outputs" / "Trace" also appear as DiffNode labels in the
    // rendered tree contents, so target the titles specifically.
    const titles = Array.from(
      container.querySelectorAll(".rater-compare-tree__group-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Outputs", "Trace"]);
  });
});

describe("<CompareTree>", () => {
  it("renders the title", () => {
    const { container } = render(
      <CompareTree title="Plan" root={PLAN_DIFF.tree} />,
    );
    const title = container.querySelector(".rater-compare-tree__group-title");
    expect(title?.textContent).toBe("Plan");
  });

  it("collapses unchanged subtrees", () => {
    render(<CompareTree title="Plan" root={PLAN_DIFF.tree} />);
    // 'lines' subtree has 2 unchanged children — should collapse
    expect(screen.getByText(/= unchanged \(2 fields\)/)).toBeInTheDocument();
  });

  it("expanding a collapsed row toggles to full render", () => {
    render(<CompareTree title="Plan" root={PLAN_DIFF.tree} />);
    fireEvent.click(screen.getByText(/= unchanged \(2 fields\)/));
    // After expansion the two child rows render
    expect(screen.getByText("[0]")).toBeInTheDocument();
    expect(screen.getByText("[1]")).toBeInTheDocument();
  });

  it("changed children stay visible (not collapsed)", () => {
    render(<CompareTree title="Plan" root={PLAN_DIFF.tree} />);
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("Old name")).toBeInTheDocument();
    expect(screen.getByText("New name")).toBeInTheDocument();
  });

  it("deep-link handler is forwarded to CompareNodes", () => {
    const onDeepLink = vi.fn();
    const treeWithLink: DiffNode = MAKE_NODE({
      label: "root",
      state: "changed",
      children: [
        MAKE_NODE({
          path: "child",
          label: "Child",
          state: "changed",
          a_value: 1,
          b_value: 2,
          deeplink: { section: "dimensions" },
        }),
      ],
    });
    render(
      <CompareTree
        title="Test"
        root={treeWithLink}
        onDeepLink={onDeepLink}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Go to Child/i }));
    expect(onDeepLink).toHaveBeenCalledWith({ section: "dimensions" });
  });
});
