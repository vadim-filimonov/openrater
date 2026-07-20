/**
 * <InlineEdit> tests — Wave 1 (Shell v3 polish).
 *
 * The interaction contract: blur commits (trimmed), Enter rides the
 * blur path, Escape reverts, empty/unchanged silently revert, the
 * draft streams via onDraftChange, and upstream value changes re-seed.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineEdit } from "./InlineEdit";

function setup(over: Partial<Parameters<typeof InlineEdit>[0]> = {}) {
  const onCommit = vi.fn();
  const utils = render(
    <InlineEdit
      value="Construction class"
      onCommit={onCommit}
      aria-label="Dimension display name"
      {...over}
    />,
  );
  const input = screen.getByLabelText(
    "Dimension display name",
  ) as HTMLInputElement;
  return { onCommit, input, ...utils };
}

describe("<InlineEdit>", () => {
  it("commits the trimmed draft on blur", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "  Build class  " } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("Build class");
  });

  it("Enter commits (via the blur path)", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input); // jsdom doesn't blur on .blur() inside keyDown reliably
    expect(onCommit).toHaveBeenCalledWith("Renamed");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("Escape reverts the draft and never commits", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "Half-typed typo" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("Construction class");
  });

  it("empty and unchanged drafts silently revert (no commit)", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("Construction class");

    fireEvent.change(input, { target: { value: "Construction class" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("streams the draft through onDraftChange (label-drives-id coupling)", () => {
    const onDraftChange = vi.fn();
    const { input } = setup({ onDraftChange });
    fireEvent.change(input, { target: { value: "New Name" } });
    expect(onDraftChange).toHaveBeenCalledWith("New Name");
  });

  it("re-seeds the draft when the committed value changes upstream", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <InlineEdit value="One" onCommit={onCommit} aria-label="X" />,
    );
    const input = screen.getByLabelText("X") as HTMLInputElement;
    rerender(<InlineEdit value="Two" onCommit={onCommit} aria-label="X" />);
    expect(input.value).toBe("Two");
  });

  it("mono variant sizes to its content", () => {
    render(
      <InlineEdit
        value="liab_exposure_base"
        onCommit={() => {}}
        variant="mono"
        aria-label="Dimension id"
      />,
    );
    const input = screen.getByLabelText("Dimension id");
    expect(input).toHaveAttribute("size", String("liab_exposure_base".length + 1));
  });
});
