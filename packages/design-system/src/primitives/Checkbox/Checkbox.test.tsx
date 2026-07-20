/**
 * <Checkbox> tests — Wave 1 (Shell v3 polish).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Checkbox } from "./Checkbox";

describe("<Checkbox>", () => {
  it("renders a real native checkbox reflecting state", () => {
    const { rerender } = render(
      <Checkbox checked={false} onChange={() => {}} label="Replace existing" />,
    );
    const cb = screen.getByRole("checkbox", { name: "Replace existing" });
    expect(cb).not.toBeChecked();
    rerender(
      <Checkbox checked={true} onChange={() => {}} label="Replace existing" />,
    );
    expect(cb).toBeChecked();
  });

  it("fires onChange with the next state", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="X" />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("clicking the label toggles (native association)", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={true} onChange={onChange} label="Select all" />);
    fireEvent.click(screen.getByText("Select all"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does not fire when disabled", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} disabled label="X" />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports aria-label when no visible label", () => {
    render(<Checkbox checked={false} onChange={() => {}} aria-label="Pick row" />);
    expect(screen.getByRole("checkbox", { name: "Pick row" })).toBeInTheDocument();
  });
});
