/**
 * <EntityRefPicker> tests (M2.4 — Brief 7).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { EntityRefPicker, type EntityRefOption } from "./EntityRefPicker";

const CLASSES: readonly EntityRefOption[] = [
  { value: "c102", label: "Meridian Hospitality", subLabel: "c102 · Hospitality" },
  { value: "c101", label: "Meridian Recreation", subLabel: "c101 · Recreation" },
  { value: "c103", label: "Meridian Contracting", subLabel: "c103 · Construction" },
];

function Harness({
  initial = "",
  options = CLASSES,
  entityLabel = "class",
  emptyAction,
  onChange,
}: {
  readonly initial?: string;
  readonly options?: readonly EntityRefOption[];
  readonly entityLabel?: string;
  readonly emptyAction?: { label: string; onClick: () => void };
  readonly onChange?: (next: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <EntityRefPicker
      entityLabel={entityLabel}
      options={options}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      {...(emptyAction ? { emptyAction } : {})}
    />
  );
}

describe("<EntityRefPicker> — defaults", () => {
  it("uses entityLabel for placeholder", () => {
    render(<Harness entityLabel="dimension" />);
    expect(
      screen.getByPlaceholderText("Pick a dimension…"),
    ).toBeInTheDocument();
  });

  it("uses entityLabel for aria-label (title-cased)", () => {
    render(<Harness entityLabel="curve" />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-label", "Curve");
  });

  it("accepts placeholder override", () => {
    render(
      <EntityRefPicker
        entityLabel="class"
        options={CLASSES}
        value=""
        onChange={() => {}}
        placeholder="Choose a class code"
      />,
    );
    expect(
      screen.getByPlaceholderText("Choose a class code"),
    ).toBeInTheDocument();
  });
});

describe("<EntityRefPicker> — selection", () => {
  it("selecting an option calls onChange with the value", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("Meridian Recreation"));
    expect(onChange).toHaveBeenCalledWith("c101");
  });

  it("displays the selected option's label when value matches", () => {
    render(<Harness initial="c103" />);
    expect(screen.getByRole("combobox")).toHaveValue("Meridian Contracting");
  });

  it("renders option label + monospace subLabel", () => {
    render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByText("Meridian Hospitality")).toBeInTheDocument();
    expect(screen.getByText("c102 · Hospitality")).toBeInTheDocument();
    const subLabel = screen.getByText("c102 · Hospitality");
    expect(subLabel.className).toContain("__opt-sublabel");
  });
});

describe("<EntityRefPicker> — stale-ref detection", () => {
  it("does NOT show warning when value is empty", () => {
    render(<Harness initial="" />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("does NOT show warning when value matches an option", () => {
    render(<Harness initial="c102" />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("SHOWS warning when value doesn't match any option", () => {
    render(<Harness initial="99999" />);
    const warning = screen.getByRole("img");
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/doesn't match any registered class/),
    );
  });

  it("warning tooltip uses the entityLabel", () => {
    render(<Harness initial="999" entityLabel="curve" />);
    const warning = screen.getByRole("img");
    expect(warning.getAttribute("aria-label")).toMatch(
      /doesn't match any registered curve/,
    );
  });

  it("input gets aria-invalid when stale-ref", () => {
    render(<Harness initial="99999" />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("warning clears once a valid option is selected", () => {
    const onChange = vi.fn();
    render(<Harness initial="99999" onChange={onChange} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Meridian Recreation"));
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("<EntityRefPicker> — empty state + emptyAction", () => {
  it("shows 'No classes match.' when query matches nothing (no emptyAction)", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyz-no-match" } });
    expect(screen.getByText(/no class.*match/i)).toBeInTheDocument();
  });

  it("pluralizes 'dimension' to 'dimensions' in empty state", () => {
    render(<Harness entityLabel="dimension" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(screen.getByText("No dimensions match.")).toBeInTheDocument();
  });

  it("pluralizes 'class' to 'classes' (handles -s suffix)", () => {
    render(<Harness entityLabel="class" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(screen.getByText("No classes match.")).toBeInTheDocument();
  });

  it("pluralizes 'curve' to 'curves'", () => {
    render(<Harness entityLabel="curve" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(screen.getByText("No curves match.")).toBeInTheDocument();
  });

  it("entityLabelPlural overrides the built-in pluralizer", () => {
    render(
      <EntityRefPicker
        entityLabel="datum"
        entityLabelPlural="data"
        options={[]}
        value=""
        onChange={() => {}}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByText("No data match.")).toBeInTheDocument();
  });

  it("renders the emptyAction CTA when provided", () => {
    const onClick = vi.fn();
    render(
      <Harness
        emptyAction={{ label: "Browse all classes", onClick }}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "no-match" },
    });
    expect(screen.getByText("Browse all classes")).toBeInTheDocument();
  });

  it("clicking the emptyAction CTA fires the callback", () => {
    const onClick = vi.fn();
    render(
      <Harness
        emptyAction={{ label: "Browse all classes", onClick }}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "no-match" },
    });
    fireEvent.click(screen.getByText("Browse all classes"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("<EntityRefPicker> — keyboard nav (delegated to Combobox)", () => {
  it("ArrowDown opens listbox + highlights first option", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("Enter selects the highlighted option", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" }); // moves to Meridian Recreation (index 1)
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c101");
  });

  it("Escape closes without selecting", () => {
    const onChange = vi.fn();
    render(<Harness initial="c102" onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bow" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("Meridian Hospitality"); // restored
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("<EntityRefPicker> — disabled state", () => {
  it("disabled picker doesn't open on focus", () => {
    render(
      <EntityRefPicker
        entityLabel="class"
        options={CLASSES}
        value=""
        onChange={() => {}}
        disabled
      />,
    );
    const input = screen.getByRole("combobox");
    expect(input).toBeDisabled();
    fireEvent.focus(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
