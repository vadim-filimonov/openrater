/**
 * <WorkspaceFrame> tests — Polish PR 6.
 *
 * Layered:
 *   1. Render contract — rail / stage / inspector slots
 *   2. Variant detection (which combinations of slots are present)
 *   3. Accessibility — aria-label on root, aria-label on rail/inspector
 *   4. Optional slots collapse cleanly when omitted
 *   5. testId + className passthrough
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceFrame } from "./WorkspaceFrame";

describe("<WorkspaceFrame>", () => {
  it("renders all three slots when rail + inspector are provided", () => {
    render(
      <WorkspaceFrame
        ariaLabel="Test workspace"
        rail={<div>RAIL CONTENT</div>}
        inspector={<div>INSPECTOR CONTENT</div>}
      >
        <div>STAGE CONTENT</div>
      </WorkspaceFrame>,
    );
    expect(screen.getByText("RAIL CONTENT")).toBeInTheDocument();
    expect(screen.getByText("STAGE CONTENT")).toBeInTheDocument();
    expect(screen.getByText("INSPECTOR CONTENT")).toBeInTheDocument();
  });

  it("uses the rail-stage-inspector variant when all 3 slots present", () => {
    render(
      <WorkspaceFrame
        ariaLabel="Test"
        rail={<div>R</div>}
        inspector={<div>I</div>}
        testId="frame"
      >
        <div>S</div>
      </WorkspaceFrame>,
    );
    const node = screen.getByTestId("frame");
    expect(node).toHaveAttribute("data-variant", "rail-stage-inspector");
    expect(node).toHaveClass("rater-workspace-frame--rail-stage-inspector");
  });

  it("omits the rail slot + uses the stage-inspector variant when rail not provided", () => {
    render(
      <WorkspaceFrame
        ariaLabel="Test"
        inspector={<div>INSPECTOR</div>}
        testId="frame"
      >
        <div>STAGE</div>
      </WorkspaceFrame>,
    );
    const node = screen.getByTestId("frame");
    expect(node).toHaveAttribute("data-variant", "stage-inspector");
    expect(node).toHaveClass("rater-workspace-frame--stage-inspector");
    // Rail aside should not be rendered
    expect(
      node.querySelector(".rater-workspace-frame__rail"),
    ).toBeNull();
  });

  it("omits the inspector slot + uses the rail-stage variant when inspector not provided", () => {
    render(
      <WorkspaceFrame
        ariaLabel="Test"
        rail={<div>RAIL</div>}
        testId="frame"
      >
        <div>STAGE</div>
      </WorkspaceFrame>,
    );
    const node = screen.getByTestId("frame");
    expect(node).toHaveAttribute("data-variant", "rail-stage");
    expect(node).toHaveClass("rater-workspace-frame--rail-stage");
    expect(
      node.querySelector(".rater-workspace-frame__inspector"),
    ).toBeNull();
  });

  it("renders only the stage when neither rail nor inspector provided", () => {
    render(
      <WorkspaceFrame ariaLabel="Test" testId="frame">
        <div>STAGE</div>
      </WorkspaceFrame>,
    );
    const node = screen.getByTestId("frame");
    expect(node).toHaveAttribute("data-variant", "stage");
    expect(node).toHaveClass("rater-workspace-frame--stage");
    expect(node.querySelector(".rater-workspace-frame__rail")).toBeNull();
    expect(
      node.querySelector(".rater-workspace-frame__inspector"),
    ).toBeNull();
  });

  it("applies the ariaLabel to the root section", () => {
    render(
      <WorkspaceFrame ariaLabel="Dimensions">
        <div>S</div>
      </WorkspaceFrame>,
    );
    expect(
      screen.getByRole("region", { name: "Dimensions" }),
    ).toBeInTheDocument();
  });

  it("defaults the rail aria-label to `${ariaLabel} tools`", () => {
    render(
      <WorkspaceFrame ariaLabel="Dimensions" rail={<div>R</div>}>
        <div>S</div>
      </WorkspaceFrame>,
    );
    expect(
      screen.getByRole("complementary", { name: "Dimensions tools" }),
    ).toBeInTheDocument();
  });

  it("defaults the inspector aria-label to `${ariaLabel} inspector`", () => {
    render(
      <WorkspaceFrame ariaLabel="Dimensions" inspector={<div>I</div>}>
        <div>S</div>
      </WorkspaceFrame>,
    );
    expect(
      screen.getByRole("complementary", {
        name: "Dimensions inspector",
      }),
    ).toBeInTheDocument();
  });

  it("uses railLabel + inspectorLabel overrides when provided", () => {
    render(
      <WorkspaceFrame
        ariaLabel="Assemble"
        rail={<div>R</div>}
        inspector={<div>I</div>}
        railLabel="Component palette"
        inspectorLabel="Selected tower"
      >
        <div>S</div>
      </WorkspaceFrame>,
    );
    expect(
      screen.getByRole("complementary", { name: "Component palette" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Selected tower" }),
    ).toBeInTheDocument();
  });

  it("passes testId through to data-testid", () => {
    render(
      <WorkspaceFrame ariaLabel="Test" testId="my-frame">
        <div>S</div>
      </WorkspaceFrame>,
    );
    expect(screen.getByTestId("my-frame")).toBeInTheDocument();
  });

  it("composes a custom className with the base class", () => {
    render(
      <WorkspaceFrame
        ariaLabel="Test"
        className="my-extra"
        testId="frame"
      >
        <div>S</div>
      </WorkspaceFrame>,
    );
    const node = screen.getByTestId("frame");
    expect(node).toHaveClass("rater-workspace-frame");
    expect(node).toHaveClass("my-extra");
  });

  it("treats `false` as an omitted rail/inspector slot", () => {
    // Conditional rendering pattern: `rail={hasRail && <RailContent />}`.
    // The frame should treat `false` the same as omitted (no aside).
    render(
      <WorkspaceFrame
        ariaLabel="Test"
        rail={false}
        inspector={false}
        testId="frame"
      >
        <div>STAGE</div>
      </WorkspaceFrame>,
    );
    const node = screen.getByTestId("frame");
    expect(node).toHaveAttribute("data-variant", "stage");
    expect(node.querySelector(".rater-workspace-frame__rail")).toBeNull();
    expect(
      node.querySelector(".rater-workspace-frame__inspector"),
    ).toBeNull();
  });
});
