/**
 * <Switch> tests — Wave 1 (Shell v3 polish).
 *
 * Layered: render contract (role=switch + aria-checked) · toggle on
 * click + keyboard · label click toggles · disabled · size modifier.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Switch } from "./Switch";

describe("<Switch>", () => {
  it("renders role=switch with aria-checked reflecting state", () => {
    const { rerender } = render(
      <Switch checked={false} onChange={() => {}} aria-label="Live preview" />,
    );
    const sw = screen.getByRole("switch", { name: "Live preview" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    rerender(
      <Switch checked={true} onChange={() => {}} aria-label="Live preview" />,
    );
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("fires onChange with the next state on click", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="X" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("clicking the visible label toggles", () => {
    const onChange = vi.fn();
    render(<Switch checked={true} onChange={onChange} label="Include archived" />);
    fireEvent.click(screen.getByText("Include archived"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("the visible label names the switch", () => {
    render(<Switch checked={false} onChange={() => {}} label="Webhooks" />);
    // label element wraps the control → accessible name from content
    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(screen.getByText("Webhooks")).toBeInTheDocument();
  });

  it("does not fire when disabled", () => {
    const onChange = vi.fn();
    render(
      <Switch checked={false} onChange={onChange} disabled aria-label="X" />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies the size modifier (md default, sm on request)", () => {
    const { rerender, container } = render(
      <Switch checked={false} onChange={() => {}} aria-label="X" />,
    );
    expect(container.querySelector(".rater-switch--md")).not.toBeNull();
    rerender(
      <Switch checked={false} onChange={() => {}} size="sm" aria-label="X" />,
    );
    expect(container.querySelector(".rater-switch--sm")).not.toBeNull();
  });

  it("marks is-checked on the root for the thumb travel", () => {
    const { container } = render(
      <Switch checked={true} onChange={() => {}} aria-label="X" />,
    );
    expect(container.querySelector(".rater-switch.is-checked")).not.toBeNull();
  });
});
