/**
 * SurfaceHeader tests — pins the Brief 88 §3.3 anatomy: one h1 (the nav
 * word), the room's own acts unchanged, actions on the right, and
 * nothing else (R3 — three slots, one height).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SurfaceHeader } from "./SurfaceHeader";

describe("SurfaceHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<SurfaceHeader title="Portfolio" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Portfolio" }),
    ).toBeInTheDocument();
  });

  it("mounts acts and actions verbatim; slots absent when omitted", () => {
    const { container, rerender } = render(
      <SurfaceHeader
        title="Data Lab"
        acts={<span data-testid="acts">Map ⇄ Browse</span>}
        actions={<button type="button">New plan</button>}
      />,
    );
    expect(screen.getByTestId("acts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New plan" })).toBeInTheDocument();
    expect(
      container.querySelectorAll(".rater-surface-header__acts"),
    ).toHaveLength(1);

    rerender(<SurfaceHeader title="Data Lab" />);
    expect(
      container.querySelectorAll(".rater-surface-header__acts"),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll(".rater-surface-header__actions"),
    ).toHaveLength(0);
  });
});
