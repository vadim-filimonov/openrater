/**
 * <Tabs> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";

function setup(initial = "all", onChange?: (v: string) => void) {
  function TestHarness() {
    return (
      <Tabs value={initial} onValueChange={onChange ?? (() => {})}>
        <Tabs.List aria-label="Test filter">
          <Tabs.Trigger value="all">All</Tabs.Trigger>
          <Tabs.Trigger value="errors">Errors</Tabs.Trigger>
          <Tabs.Trigger value="warnings">Warnings</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Panel value="all">All content</Tabs.Panel>
        <Tabs.Panel value="errors">Errors content</Tabs.Panel>
        <Tabs.Panel value="warnings">Warnings content</Tabs.Panel>
      </Tabs>
    );
  }
  return render(<TestHarness />);
}

describe("<Tabs>", () => {
  it("renders the tablist with aria-label", () => {
    setup();
    const list = screen.getByRole("tablist");
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute("aria-label", "Test filter");
  });

  it("renders triggers as role=tab", () => {
    setup();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("shows only the selected panel", () => {
    setup("errors");
    expect(screen.queryByText("All content")).toBeNull();
    expect(screen.getByText("Errors content")).toBeInTheDocument();
    expect(screen.queryByText("Warnings content")).toBeNull();
  });

  it("sets aria-selected correctly on triggers", () => {
    setup("errors");
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: "Errors" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("pairs aria-controls + id between trigger and panel", () => {
    setup("all");
    const trigger = screen.getByRole("tab", { name: "All" });
    const panel = screen.getByRole("tabpanel");
    const panelId = trigger.getAttribute("aria-controls");
    expect(panel.id).toBe(panelId);
    const triggerId = panel.getAttribute("aria-labelledby");
    expect(trigger.id).toBe(triggerId);
  });

  it("fires onValueChange when a trigger is clicked", () => {
    const onChange = vi.fn();
    setup("all", onChange);
    fireEvent.click(screen.getByRole("tab", { name: "Errors" }));
    expect(onChange).toHaveBeenCalledWith("errors");
  });

  it("ArrowRight moves focus + selection to the next trigger", () => {
    const onChange = vi.fn();
    setup("all", onChange);
    const first = screen.getByRole("tab", { name: "All" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("errors");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Errors" }),
    );
  });

  it("ArrowLeft moves to the previous trigger", () => {
    const onChange = vi.fn();
    setup("warnings", onChange);
    const last = screen.getByRole("tab", { name: "Warnings" });
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("errors");
  });

  it("ArrowRight from last trigger wraps to first", () => {
    const onChange = vi.fn();
    setup("warnings", onChange);
    const last = screen.getByRole("tab", { name: "Warnings" });
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("ArrowLeft from first trigger wraps to last", () => {
    const onChange = vi.fn();
    setup("all", onChange);
    const first = screen.getByRole("tab", { name: "All" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("warnings");
  });

  it("Home key jumps to first trigger", () => {
    const onChange = vi.fn();
    setup("warnings", onChange);
    const last = screen.getByRole("tab", { name: "Warnings" });
    last.focus();
    fireEvent.keyDown(last, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("End key jumps to last trigger", () => {
    const onChange = vi.fn();
    setup("all", onChange);
    const first = screen.getByRole("tab", { name: "All" });
    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    expect(onChange).toHaveBeenCalledWith("warnings");
  });

  it("only the selected trigger is in the tab order (tabIndex=0)", () => {
    setup("errors");
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByRole("tab", { name: "Errors" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Warnings" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("throws when Tabs subcomponents are used without <Tabs> wrapper", () => {
    // Suppress console.error from React during the throw
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(<Tabs.Trigger value="x">Orphan</Tabs.Trigger>),
    ).toThrow(/must be used inside <Tabs>/);
    spy.mockRestore();
  });
});
