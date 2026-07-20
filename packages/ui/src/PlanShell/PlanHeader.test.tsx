/**
 * PlanHeader + PlanStatusChip — V2_INTERFACE_SPEC §2.1 / Brief 84 tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "@openrater/design-system";
import { PlanHeader } from "./PlanHeader";
import { PlanStatusChip } from "./PlanStatusChip";

describe("<PlanHeader>", () => {
  it("renders identity: title, meta, health", () => {
    render(
      <PlanHeader
        title="Meridian BOP — Kansas — 2025"
        meta="Businessowners · KS · 2025-10-01"
        health="Ready to rate"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Meridian BOP — Kansas — 2025" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Businessowners · KS · 2025-10-01"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ready to rate")).toBeInTheDocument();
  });

  it("renders the actions slot", () => {
    render(
      <PlanHeader
        title="T"
        meta="M"
        health="H"
        actions={<Button variant="primary">Rate sample</Button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Rate sample" }),
    ).toBeInTheDocument();
  });
});

describe("<PlanStatusChip> (Brief 84 D-C)", () => {
  it("draft: the one word, dot rides the status", () => {
    render(<PlanStatusChip status={{ kind: "draft" }} />);
    const chip = screen.getByText("Draft");
    expect(chip.className).toContain("rater-plan-status--draft");
  });

  it("live: shows the version name", () => {
    render(
      <PlanStatusChip
        status={{
          kind: "live",
          versionName: "v1",
          diverged: false,
          liveIntegrationCount: 0,
        }}
      />,
    );
    const chip = screen.getByTitle(/the quote API serves v1/i);
    expect(chip.className).toContain("rater-plan-status--live");
    expect(chip.textContent).toContain("Live");
    expect(chip.textContent).toContain("v1");
    expect(chip.textContent).not.toContain("+ edits");
  });

  it("live + diverged: the warn-tinted drift suffix appears", () => {
    render(
      <PlanStatusChip
        status={{
          kind: "live",
          versionName: "v2",
          diverged: true,
          liveIntegrationCount: 1,
        }}
      />,
    );
    expect(screen.getByText("+ edits").className).toContain(
      "rater-plan-status__drift",
    );
  });

  it("archived: reads archived, never live", () => {
    render(<PlanStatusChip status={{ kind: "archived" }} />);
    const chip = screen.getByText("Archived");
    expect(chip.className).toContain("rater-plan-status--archived");
  });

  it("is a BUTTON that navigates when onOpenShip is provided…", () => {
    const onOpenShip = vi.fn();
    render(
      <PlanStatusChip status={{ kind: "draft" }} onOpenShip={onOpenShip} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenShip).toHaveBeenCalledTimes(1);
  });

  it("…and a plain SPAN inside list rows (no nested interactives)", () => {
    render(<PlanStatusChip status={{ kind: "draft" }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
