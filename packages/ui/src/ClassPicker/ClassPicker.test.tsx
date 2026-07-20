/**
 * <ClassPicker> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClassPicker, type ClassPickerOption } from "./ClassPicker";

const CLASSES: ClassPickerOption[] = [
  { class_code: "c101", display_name: "Meridian Recreation", family: "Recreation" },
  { class_code: "10103", display_name: "Lumber Yards", family: "Wholesale Trade" },
  { class_code: "60311", display_name: "Lawyers — Offices", family: "Office" },
];

describe("<ClassPicker> — rendering", () => {
  it("uses 'Class' as the default aria-label", () => {
    render(<ClassPicker classes={CLASSES} value="" onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: /class/i })).toBeInTheDocument();
  });

  it("uses 'Pick a class…' as the default placeholder", () => {
    render(<ClassPicker classes={CLASSES} value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText(/Pick a class/i)).toBeInTheDocument();
  });

  it("renders the current value's display_name when set", () => {
    render(<ClassPicker classes={CLASSES} value="c101" onChange={() => {}} />);
    expect(screen.getByDisplayValue(/Meridian Recreation/)).toBeInTheDocument();
  });

  it("accepts an aria-label override", () => {
    render(
      <ClassPicker
        classes={CLASSES}
        value=""
        onChange={() => {}}
        ariaLabel="Pick the class for this factor"
      />,
    );
    expect(
      screen.getByRole("combobox", {
        name: /Pick the class for this factor/i,
      }),
    ).toBeInTheDocument();
  });

  it("accepts a placeholder override", () => {
    render(
      <ClassPicker
        classes={CLASSES}
        value=""
        onChange={() => {}}
        placeholder="Choose a BOP class"
      />,
    );
    expect(screen.getByPlaceholderText("Choose a BOP class")).toBeInTheDocument();
  });
});

describe("<ClassPicker> — options projection", () => {
  it("opens the popover and shows display_name + subLabel", () => {
    render(<ClassPicker classes={CLASSES} value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(screen.getByText("Meridian Recreation")).toBeInTheDocument();
    expect(screen.getByText("c101 · Recreation")).toBeInTheDocument();
    expect(screen.getByText("Lumber Yards")).toBeInTheDocument();
    expect(screen.getByText("10103 · Wholesale Trade")).toBeInTheDocument();
  });

  it("subLabel format follows 'class_code · family' convention", () => {
    render(<ClassPicker classes={CLASSES} value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByText("60311 · Office")).toBeInTheDocument();
  });
});

describe("<ClassPicker> — selection", () => {
  it("calls onChange with the class_code when an option is picked", () => {
    const onChange = vi.fn();
    render(<ClassPicker classes={CLASSES} value="" onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("Meridian Recreation"));
    expect(onChange).toHaveBeenCalledWith("c101");
  });
});

describe("<ClassPicker> — empty action", () => {
  it("renders the empty-action CTA when no options match the typed query", () => {
    const onClick = vi.fn();
    render(
      <ClassPicker
        classes={CLASSES}
        value=""
        onChange={() => {}}
        emptyAction={{
          label: "Browse all classes",
          onClick,
        }}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyzzy-no-match" } });
    expect(screen.getByText("Browse all classes")).toBeInTheDocument();
  });

  it("empty-action onClick fires when clicked", () => {
    const onClick = vi.fn();
    render(
      <ClassPicker
        classes={CLASSES}
        value=""
        onChange={() => {}}
        emptyAction={{ label: "Browse all classes", onClick }}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyzzy" } });
    fireEvent.click(screen.getByText("Browse all classes"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("<ClassPicker> — disabled state", () => {
  it("respects the disabled prop", () => {
    render(
      <ClassPicker
        classes={CLASSES}
        value=""
        onChange={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

describe("<ClassPicker> — plural form", () => {
  it("uses 'classes' (not 'classs') in the no-match empty hint", () => {
    render(<ClassPicker classes={[]} value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    // Should say "No classes match." not "No classs match."
    expect(screen.getByText(/No classes match/i)).toBeInTheDocument();
  });
});
