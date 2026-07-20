/**
 * <CompareNode> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CompareNode } from "./CompareNode";
import type { DiffNode } from "@openrater/contracts";

const CHANGED_LEAF: DiffNode = {
  path: "nodes.cls_factor.params.value",
  label: "Factor value",
  state: "changed",
  a_value: 1.2,
  b_value: 1.35,
};

const ADDED_LEAF: DiffNode = {
  path: "nodes.new_factor",
  label: "Node 'new_factor'",
  state: "added",
  b_value: { id: "new_factor", kind: "constant", params: { value: 1 } },
};

const REMOVED_LEAF: DiffNode = {
  path: "nodes.gone",
  label: "Node 'gone'",
  state: "removed",
  a_value: { id: "gone", kind: "constant", params: { value: 0 } },
};

const UNCHANGED_LEAF: DiffNode = {
  path: "version",
  label: "version",
  state: "unchanged",
};

describe("<CompareNode>", () => {
  it("renders changed leaf with → arrow", () => {
    render(<CompareNode node={CHANGED_LEAF} depth={0} />);
    expect(screen.getByText("Factor value")).toBeInTheDocument();
    // 1.2 and 1.35 both render
    expect(screen.getByText(/1\.2/)).toBeInTheDocument();
    expect(screen.getByText(/1\.35/)).toBeInTheDocument();
  });

  it("renders added leaf with b_value only", () => {
    const { container } = render(<CompareNode node={ADDED_LEAF} depth={0} />);
    expect(container.firstChild).toHaveClass("rater-compare-node--added");
  });

  it("renders removed leaf with a_value only", () => {
    const { container } = render(<CompareNode node={REMOVED_LEAF} depth={0} />);
    expect(container.firstChild).toHaveClass("rater-compare-node--removed");
  });

  it("renders unchanged leaf muted", () => {
    const { container } = render(<CompareNode node={UNCHANGED_LEAF} depth={0} />);
    expect(container.firstChild).toHaveClass("rater-compare-node--unchanged");
  });

  it("applies indentation via padding based on depth", () => {
    const { container } = render(<CompareNode node={CHANGED_LEAF} depth={3} />);
    expect((container.firstChild as HTMLElement).style.paddingLeft).toBe("48px");
  });

  it("renders rate impact badge when present", () => {
    const withImpact: DiffNode = {
      ...CHANGED_LEAF,
      rate_impact: { dollars: 235, pct: 4.5 },
    };
    render(<CompareNode node={withImpact} depth={0} />);
    expect(screen.getByText("+$235")).toBeInTheDocument();
  });

  it("renders deep-link icon button when deeplink + handler present", () => {
    const onDeepLink = vi.fn();
    const node: DiffNode = {
      ...CHANGED_LEAF,
      deeplink: { section: "dimensions", entity: "class_factor" },
    };
    render(<CompareNode node={node} depth={0} onDeepLink={onDeepLink} />);
    const btn = screen.getByRole("button", { name: /Go to Factor value/i });
    fireEvent.click(btn);
    expect(onDeepLink).toHaveBeenCalledWith({
      section: "dimensions",
      entity: "class_factor",
    });
  });

  it("does NOT render deep-link button without handler", () => {
    const node: DiffNode = {
      ...CHANGED_LEAF,
      deeplink: { section: "dimensions" },
    };
    render(<CompareNode node={node} depth={0} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
