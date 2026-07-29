/**
 * <OverviewSection> — V2_INTERFACE_SPEC §2.3 tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OverviewSection } from "./OverviewSection";

const CHECKLIST = [
  { id: "inputs", label: "Declare inputs", done: true, detail: "12 inputs" },
  {
    id: "gates",
    label: "Set eligibility",
    done: false,
    detail: "No gates yet",
    onOpen: vi.fn(),
    actionLabel: "Add a gate →",
  },
];

describe("<OverviewSection>", () => {
  it("renders the checklist with completion count and deep-link on undone items", () => {
    render(
      <OverviewSection
        checklist={CHECKLIST}
        lastTest={null}
        versions={[]}
        facts={[]}
      />,
    );
    expect(screen.getByText("1 of 2 complete")).toBeInTheDocument();
    expect(screen.getByText("Declare inputs")).toBeInTheDocument();
    expect(screen.getByText("12 inputs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a gate →" }));
    expect(CHECKLIST[1]!.onOpen).toHaveBeenCalled();
  });

  it("shows the last-test premium when present, honest empty otherwise", () => {
    const onRun = vi.fn();
    const { rerender } = render(
      <OverviewSection
        checklist={[]}
        lastTest={{ premiumLabel: "$4,731", detail: "128 rows · 2h ago", onRun }}
        versions={[]}
        facts={[]}
      />,
    );
    expect(screen.getByText("$4,731")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run again →" }));
    expect(onRun).toHaveBeenCalled();

    rerender(
      <OverviewSection checklist={[]} lastTest={null} versions={[]} facts={[]} />,
    );
    expect(screen.getByText(/Not run yet/)).toBeInTheDocument();
  });

  it("renders version rows with neutral chips + state dots, and plan facts", () => {
    const { container } = render(
      <OverviewSection
        checklist={[]}
        lastTest={null}
        versions={[
          { id: "d", name: "draft_2026-06-09", state: "draft" },
          { id: "v3", name: "v3", date: "2026-06-02", state: "frozen" },
          { id: "v2", name: "v2", date: "2026-05-20", state: "published" },
        ]}
        facts={[
          { label: "Product", value: "Businessowners" },
          { label: "Jurisdiction", value: "Kansas" },
        ]}
      />,
    );
    expect(screen.getByText("Current draft")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(
      container.querySelector(".rater-overview__version-dot--published"),
    ).not.toBeNull();
    expect(screen.getByText("Businessowners")).toBeInTheDocument();
  });

  it("renders the creation note as a stacked row under plan facts; blank/absent omits it", () => {
    const { container, rerender } = render(
      <OverviewSection
        checklist={[]}
        lastTest={null}
        versions={[]}
        facts={[{ label: "Product", value: "Businessowners" }]}
        note="Wisconsin BOP rate revision for H2 2026."
      />,
    );
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(
      screen.getByText("Wisconsin BOP rate revision for H2 2026."),
    ).toBeInTheDocument();
    expect(container.querySelector(".rater-overview__fact--note")).not.toBeNull();

    // whitespace-only reads as no note — the row disappears entirely
    rerender(
      <OverviewSection
        checklist={[]}
        lastTest={null}
        versions={[]}
        facts={[{ label: "Product", value: "Businessowners" }]}
        note="   "
      />,
    );
    expect(screen.queryByText("Note")).toBeNull();
  });

  it("Brief 89 R6 — an undone step can carry a second path with an ·or· separator", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <OverviewSection
        checklist={[
          {
            id: "inputs",
            label: "Bring the plan's variables",
            done: false,
            detail: "No inputs yet",
            onOpen: first,
            actionLabel: "Declare inputs →",
            secondActionLabel: "Add them from a book →",
            onSecondOpen: second,
          },
          {
            id: "done-step",
            label: "Define dimensions",
            done: true,
            detail: "3 dimensions",
            onSecondOpen: vi.fn(),
            secondActionLabel: "never shown",
          },
        ]}
        lastTest={null}
        versions={[]}
        facts={[]}
      />,
    );
    fireEvent.click(screen.getByText("Add them from a book →"));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(screen.getByText("·or·")).toBeInTheDocument();
    // done steps render no second path
    expect(screen.queryByText("never shown")).toBeNull();
  });
});
