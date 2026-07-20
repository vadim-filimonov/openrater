/**
 * <SearchField> tests — Wave 1 (Shell v3 polish).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Kbd } from "../Kbd";
import { SearchField } from "./SearchField";

describe("<SearchField>", () => {
  it("renders the input with its accessible name and fires onChange with text", () => {
    const onChange = vi.fn();
    render(
      <SearchField value="" onChange={onChange} aria-label="Search dimensions" />,
    );
    const input = screen.getByLabelText("Search dimensions");
    fireEvent.change(input, { target: { value: "terr" } });
    expect(onChange).toHaveBeenCalledWith("terr");
  });

  it("shows the clear button only when there's a value; clicking clears + refocuses", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchField value="" onChange={onChange} aria-label="Search" />,
    );
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();

    rerender(<SearchField value="terr" onChange={onChange} aria-label="Search" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getByLabelText("Search")).toHaveFocus();
  });

  it("Escape clears a non-empty value and stops the event", () => {
    const onChange = vi.fn();
    const outerKeyDown = vi.fn();
    render(
      <div onKeyDown={outerKeyDown}>
        <SearchField value="abc" onChange={onChange} aria-label="Search" />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("");
    expect(outerKeyDown).not.toHaveBeenCalled();
  });

  it("Escape on an empty value propagates (surface-level Esc can take over)", () => {
    const outerKeyDown = vi.fn();
    render(
      <div onKeyDown={outerKeyDown}>
        <SearchField value="" onChange={() => {}} aria-label="Search" />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Escape" });
    expect(outerKeyDown).toHaveBeenCalled();
  });

  it("shows the shortcut hint while empty + unfocused, hides it on value", () => {
    const { rerender } = render(
      <SearchField
        value=""
        onChange={() => {}}
        aria-label="Search"
        shortcutHint={<Kbd keys={["/"]} />}
      />,
    );
    expect(screen.getByText("/")).toBeInTheDocument();
    rerender(
      <SearchField
        value="x"
        onChange={() => {}}
        aria-label="Search"
        shortcutHint={<Kbd keys={["/"]} />}
      />,
    );
    expect(screen.queryByText("/")).not.toBeInTheDocument();
  });
});
