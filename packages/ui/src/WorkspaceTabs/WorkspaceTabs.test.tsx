/**
 * <WorkspaceTabs> tests — sub-brief 24.F2.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceTabs } from "./WorkspaceTabs";

const TABS = [
  { id: "inputs", label: "Inputs" },
  { id: "dimensions", label: "Dimensions" },
  { id: "parametrize", label: "Parametrize" },
  { id: "gate", label: "Gate" },
  { id: "assemble", label: "Assemble" },
  { id: "verify", label: "Verify", isSibling: true },
];

describe("<WorkspaceTabs>", () => {
  it("renders every supplied tab as a tab role", () => {
    render(
      <WorkspaceTabs tabs={TABS} active="inputs" onSelect={() => {}} />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(TABS.length);
    for (const t of TABS) {
      expect(screen.getByRole("tab", { name: t.label })).toBeInTheDocument();
    }
  });

  it("marks the active tab via aria-selected", () => {
    render(
      <WorkspaceTabs tabs={TABS} active="dimensions" onSelect={() => {}} />,
    );
    const dims = screen.getByRole("tab", { name: "Dimensions" });
    const inputs = screen.getByRole("tab", { name: "Inputs" });
    expect(dims).toHaveAttribute("aria-selected", "true");
    expect(inputs).toHaveAttribute("aria-selected", "false");
  });

  it("fires onSelect with the tab id on click", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceTabs tabs={TABS} active="inputs" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Gate" }));
    expect(onSelect).toHaveBeenCalledWith("gate");
  });

  it("ArrowRight moves to the next tab + fires onSelect", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceTabs tabs={TABS} active="inputs" onSelect={onSelect} />,
    );
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("dimensions");
  });

  it("ArrowLeft moves to the previous tab", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceTabs tabs={TABS} active="gate" onSelect={onSelect} />,
    );
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenCalledWith("parametrize");
  });

  it("Home jumps to the first tab", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceTabs tabs={TABS} active="gate" onSelect={onSelect} />,
    );
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "Home" });
    expect(onSelect).toHaveBeenCalledWith("inputs");
  });

  it("End jumps to the last tab", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceTabs tabs={TABS} active="inputs" onSelect={onSelect} />,
    );
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(onSelect).toHaveBeenCalledWith("verify");
  });

  it("ArrowRight wraps from the last tab back to the first", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceTabs tabs={TABS} active="verify" onSelect={onSelect} />,
    );
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("inputs");
  });

  it("uses tabindex=0 only on the active tab", () => {
    render(
      <WorkspaceTabs tabs={TABS} active="dimensions" onSelect={() => {}} />,
    );
    const dims = screen.getByRole("tab", { name: "Dimensions" });
    const inputs = screen.getByRole("tab", { name: "Inputs" });
    expect(dims).toHaveAttribute("tabindex", "0");
    expect(inputs).toHaveAttribute("tabindex", "-1");
  });

  it("renders a status dot when supplied", () => {
    const tabs = [
      { id: "inputs", label: "Inputs", status: "required-empty" as const },
      { id: "dimensions", label: "Dimensions" },
    ];
    const { container } = render(
      <WorkspaceTabs tabs={tabs} active="inputs" onSelect={() => {}} />,
    );
    expect(
      container.querySelector(".rater-workspace-tabs__tab-status--required-empty"),
    ).toBeTruthy();
  });

  it("places sibling tabs after a spacer (visually on the right)", () => {
    const { container } = render(
      <WorkspaceTabs tabs={TABS} active="inputs" onSelect={() => {}} />,
    );
    // Spacer exists when at least one sibling tab is supplied.
    expect(
      container.querySelector(".rater-workspace-tabs__spacer"),
    ).toBeTruthy();
  });
});
