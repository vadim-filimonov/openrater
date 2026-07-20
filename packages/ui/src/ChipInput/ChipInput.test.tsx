/**
 * <ChipInput> tests — Brief 26 PR 6.
 *
 * Smoke-level coverage for the controlled-component contract,
 * add / remove semantics, keyboard nav, and paste expansion.
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChipInput } from "./ChipInput";

describe("ChipInput — render", () => {
  it("renders one chip per value", () => {
    render(
      <ChipInput
        values={["frame", "masonry", "non-combustible"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("frame")).toBeInTheDocument();
    expect(screen.getByText("masonry")).toBeInTheDocument();
    expect(screen.getByText("non-combustible")).toBeInTheDocument();
  });

  it("renders an empty chip cloud when values is empty", () => {
    render(<ChipInput values={[]} onChange={() => {}} />);
    expect(
      screen.getByTestId("rater-chip-input-input"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-chip-input-chip-0"),
    ).not.toBeInTheDocument();
  });

  it("places the input after the chips", () => {
    render(<ChipInput values={["a", "b"]} onChange={() => {}} />);
    const list = screen.getByRole("list");
    const items = list.querySelectorAll("li");
    // last <li> is the input wrap
    expect(items[items.length - 1]?.querySelector("input")).toBeTruthy();
  });

  it("renders the placeholder on the input", () => {
    render(
      <ChipInput
        values={[]}
        onChange={() => {}}
        placeholder="Add a class…"
      />,
    );
    expect(screen.getByPlaceholderText("Add a class…")).toBeInTheDocument();
  });

  it("uses the provided ariaLabel", () => {
    render(
      <ChipInput
        values={[]}
        onChange={() => {}}
        ariaLabel="Add alias for Bowling"
      />,
    );
    expect(screen.getByLabelText("Add alias for Bowling")).toBeInTheDocument();
  });
});

describe("ChipInput — add", () => {
  it("Enter commits the draft as a new chip", () => {
    const onChange = vi.fn();
    render(<ChipInput values={["frame"]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "masonry" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["frame", "masonry"]);
  });

  it("comma commits the draft", () => {
    const onChange = vi.fn();
    render(<ChipInput values={[]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "frame" } });
    fireEvent.keyDown(input, { key: "," });
    expect(onChange).toHaveBeenCalledWith(["frame"]);
  });

  it("Tab commits the draft (with non-empty)", () => {
    const onChange = vi.fn();
    render(<ChipInput values={[]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "frame" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onChange).toHaveBeenCalledWith(["frame"]);
  });

  it("blur commits the draft", () => {
    const onChange = vi.fn();
    render(<ChipInput values={[]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "frame" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(["frame"]);
  });

  it("drops whitespace-only drafts", () => {
    const onChange = vi.fn();
    render(<ChipInput values={["frame"]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores case-insensitive duplicates", () => {
    const onChange = vi.fn();
    render(<ChipInput values={["Frame"]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "FRAME" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores trimmed-equality duplicates", () => {
    const onChange = vi.fn();
    render(<ChipInput values={["frame"]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "  frame  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("splits a comma-separated draft on commit", () => {
    const onChange = vi.fn();
    render(<ChipInput values={[]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, {
      target: { value: "frame, masonry, non-combustible" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith([
      "frame",
      "masonry",
      "non-combustible",
    ]);
  });

  it("respects maxChips cap", () => {
    const onChange = vi.fn();
    render(
      <ChipInput
        values={["a", "b"]}
        onChange={onChange}
        maxChips={2}
      />,
    );
    const input = screen.getByTestId("rater-chip-input-input");
    expect(input).toBeDisabled();
  });

  it("does not add past the cap during multi-value commit", () => {
    const onChange = vi.fn();
    render(
      <ChipInput
        values={["a"]}
        onChange={onChange}
        maxChips={2}
      />,
    );
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "b, c, d" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Only "b" fits within the cap of 2.
    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });

  it("uses custom isDuplicate when supplied", () => {
    const onChange = vi.fn();
    // Reverse-order match: only consider chips identical when
    // their reverse strings match.
    const isDuplicate = (next: string, existing: string) =>
      next.split("").reverse().join("") === existing;
    render(
      <ChipInput
        values={["abc"]}
        onChange={onChange}
        isDuplicate={isDuplicate}
      />,
    );
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "cba" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ChipInput — remove", () => {
  it("removes a chip via its ✕ button", () => {
    const onChange = vi.fn();
    render(
      <ChipInput
        values={["frame", "masonry", "non-combustible"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-chip-input-chip-1-remove"));
    expect(onChange).toHaveBeenCalledWith(["frame", "non-combustible"]);
  });

  it("Backspace on empty input removes the trailing chip", () => {
    const onChange = vi.fn();
    render(
      <ChipInput
        values={["frame", "masonry"]}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith(["frame"]);
  });

  it("Backspace on NON-empty input does NOT remove a chip", () => {
    const onChange = vi.fn();
    render(
      <ChipInput
        values={["frame"]}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled mode prevents add + remove", () => {
    const onChange = vi.fn();
    render(
      <ChipInput
        values={["frame"]}
        onChange={onChange}
        disabled={true}
      />,
    );
    const input = screen.getByTestId("rater-chip-input-input");
    expect(input).toBeDisabled();
    const removeBtn = screen.getByTestId("rater-chip-input-chip-0-remove");
    expect(removeBtn).toBeDisabled();
  });
});

describe("ChipInput — paste", () => {
  it("comma-separated paste splits into multiple chips", () => {
    const onChange = vi.fn();
    render(<ChipInput values={["existing"]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    // jsdom doesn't simulate ClipboardEvent fully — use the React
    // event we get from fireEvent.paste with a mock dataTransfer.
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "frame, masonry, non-combustible",
      },
    });
    expect(onChange).toHaveBeenCalledWith([
      "existing",
      "frame",
      "masonry",
      "non-combustible",
    ]);
  });

  it("newline-separated paste splits", () => {
    const onChange = vi.fn();
    render(<ChipInput values={[]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "frame\nmasonry\nnon-combustible",
      },
    });
    expect(onChange).toHaveBeenCalledWith([
      "frame",
      "masonry",
      "non-combustible",
    ]);
  });

  it("single-value paste falls through to draft", () => {
    const onChange = vi.fn();
    render(<ChipInput values={[]} onChange={onChange} />);
    const input = screen.getByTestId("rater-chip-input-input");
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "frame",
      },
    });
    // No commit happened — single-value paste sits in the input.
    expect(onChange).not.toHaveBeenCalled();
  });
});
