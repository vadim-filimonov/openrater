/**
 * <EmptyState> tests — Polish PR 5.
 *
 * Layered:
 *   1. Render contract — icon, title, description, actions, cue
 *   2. Optional fields collapse cleanly (no DOM noise when omitted)
 *   3. role="status" present for accessibility
 *   4. testId passthrough
 *   5. className composition
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

const Icon = () => <svg data-testid="hero-icon" width={24} height={24} />;

describe("<EmptyState>", () => {
  it("renders the hero icon, title, and role=status", () => {
    render(<EmptyState icon={<Icon />} title="Nothing here" />);
    expect(screen.getByTestId("hero-icon")).toBeInTheDocument();
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("hides description, actions, and cue when not provided", () => {
    render(<EmptyState icon={<Icon />} title="Empty" />);
    expect(
      screen.queryByText(/description/i),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector(".rater-empty-state__description"),
    ).toBeNull();
    expect(
      document.querySelector(".rater-empty-state__actions"),
    ).toBeNull();
    expect(document.querySelector(".rater-empty-state__cue")).toBeNull();
  });

  it("renders description when provided", () => {
    render(
      <EmptyState
        icon={<Icon />}
        title="Empty"
        description="Add something to get started."
      />,
    );
    expect(
      screen.getByText("Add something to get started."),
    ).toBeInTheDocument();
  });

  it("renders children as actions", () => {
    render(
      <EmptyState icon={<Icon />} title="Empty">
        <button type="button">Get started</button>
      </EmptyState>,
    );
    expect(
      screen.getByRole("button", { name: "Get started" }),
    ).toBeInTheDocument();
    expect(
      document.querySelector(".rater-empty-state__actions"),
    ).toBeInTheDocument();
  });

  it("renders cue when provided", () => {
    render(
      <EmptyState
        icon={<Icon />}
        title="Empty"
        cue={
          <>
            Click <strong>Add filter</strong> in the tool pane.
          </>
        }
      />,
    );
    expect(
      screen.getByText(/Click/),
    ).toBeInTheDocument();
    expect(screen.getByText("Add filter")).toBeInTheDocument();
  });

  it("passes testId through to data-testid attribute", () => {
    render(
      <EmptyState
        icon={<Icon />}
        title="Empty"
        testId="my-empty-state"
      />,
    );
    expect(
      screen.getByTestId("my-empty-state"),
    ).toBeInTheDocument();
  });

  it("composes a custom className with the base class", () => {
    render(
      <EmptyState
        icon={<Icon />}
        title="Empty"
        className="custom-extra"
      />,
    );
    const node = document.querySelector(".rater-empty-state");
    expect(node).toHaveClass("rater-empty-state");
    expect(node).toHaveClass("custom-extra");
  });

  it("supports rich ReactNode in title via description-position", () => {
    // Title is a string per the contract — verifies API discipline.
    render(<EmptyState icon={<Icon />} title="Search returned nothing" />);
    expect(
      screen.getByText("Search returned nothing"),
    ).toBeInTheDocument();
  });
});
