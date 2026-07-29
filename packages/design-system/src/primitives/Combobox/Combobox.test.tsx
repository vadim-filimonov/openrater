/**
 * <Combobox> tests (M2.3).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { Combobox, type ComboboxOption } from "./Combobox";

const CLASSES: readonly ComboboxOption[] = [
  { value: "71641", label: "Restaurants", hint: "71641 · Hospitality" },
  { value: "73912", label: "Bowling Centers", hint: "73912 · Recreation" },
  { value: "91342", label: "Concrete contractors", hint: "91342 · Construction" },
  { value: "97104", label: "Cement contractors", hint: "97104 · Construction (disabled)", disabled: true },
];

function Harness({
  initial = "",
  onChange,
  ...rest
}: Partial<React.ComponentProps<typeof Combobox>> & {
  readonly initial?: string;
  readonly onChange?: (next: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Combobox
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      options={CLASSES}
      placeholder="Pick a class…"
      ariaLabel="Class"
      {...rest}
    />
  );
}

describe("<Combobox> — closed state", () => {
  it("renders the input with placeholder when no value", () => {
    render(<Harness />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByPlaceholderText("Pick a class…")).toBeInTheDocument();
  });

  it("shows the selected option's label when value is set", () => {
    render(<Harness initial="71641" />);
    expect(screen.getByRole("combobox")).toHaveValue("Restaurants");
  });

  it("starts closed (no listbox in the DOM)", () => {
    render(<Harness />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("aria-expanded starts false", () => {
    render(<Harness />);
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("<Combobox> — opening + filtering", () => {
  it("opens on focus", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("opens on ArrowDown if closed", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("shows all options on initial focus (no filter applied)", () => {
    render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(CLASSES.length);
  });

  it("filters by typing — label substring match", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bowling" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Bowling Centers");
  });

  it("filters by typing — value substring match", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "739" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("filters by typing — hint substring match", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "construction" } });
    // Both Concrete + Cement match by hint "Construction"
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("filter is case-insensitive", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "BOWLING" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("renders custom emptyState when no options match", () => {
    render(<Harness emptyState={<>Browse all classes</>} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "no-such-class" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Browse all classes")).toBeInTheDocument();
  });

  it("custom filter overrides default", () => {
    // Filter that only matches if query starts with the value
    const filter = (option: ComboboxOption, query: string) =>
      option.value.startsWith(query);
    render(<Harness filter={filter} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "9" } });
    expect(screen.getAllByRole("option")).toHaveLength(2); // 91342 + 97104
  });
});

describe("<Combobox> — keyboard navigation", () => {
  it("ArrowDown moves highlight to next option", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    // Focus auto-highlights option 0 (first enabled); ArrowDown advances to 1
    fireEvent.focus(input);
    let options = screen.getAllByRole("option");
    expect(options[0]?.className).toContain("--highlighted");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    options = screen.getAllByRole("option");
    expect(options[1]?.className).toContain("--highlighted");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    options = screen.getAllByRole("option");
    expect(options[2]?.className).toContain("--highlighted");
  });

  it("ArrowUp wraps from first to last (skipping disabled)", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    // First open lands on option 0; pressing Up wraps; should skip
    // disabled option (97104) and land on index 2 (Concrete contractors)
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const options = screen.getAllByRole("option");
    expect(options[2]?.className).toContain("--highlighted");
  });

  it("ArrowDown skips disabled options", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    // Move to last non-disabled (index 2: Concrete)
    fireEvent.keyDown(input, { key: "End" });
    const options = screen.getAllByRole("option");
    expect(options[2]?.className).toContain("--highlighted");
    // ArrowDown from there wraps back to first (skipping disabled at 3)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[0]?.className).toContain("--highlighted");
  });

  it("Home jumps to first enabled option", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "End" });
    fireEvent.keyDown(input, { key: "Home" });
    const options = screen.getAllByRole("option");
    expect(options[0]?.className).toContain("--highlighted");
  });

  it("End jumps to last enabled option (skipping disabled)", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "End" });
    const options = screen.getAllByRole("option");
    expect(options[2]?.className).toContain("--highlighted"); // 97104 disabled, so 2
  });

  it("Enter selects the highlighted option", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" }); // highlights Bowling Centers (index 1)
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("73912");
    expect(input).toHaveValue("Bowling Centers");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes WITHOUT selecting + restores input text", () => {
    render(<Harness initial="71641" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bow" } });
    expect(input).toHaveValue("bow");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("Restaurants"); // restored
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Tab closes WITHOUT selecting", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("<Combobox> — mouse interaction", () => {
  it("clicking an option selects it + closes", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("Bowling Centers"));
    expect(onChange).toHaveBeenCalledWith("73912");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clicking a disabled option does NOT select", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("Cement contractors"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pointer-enter on an option highlights it", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    const conc = screen.getByText("Concrete contractors").closest('[role="option"]');
    expect(conc).not.toBeNull();
    if (conc) fireEvent.pointerEnter(conc);
    expect(conc?.className).toContain("--highlighted");
  });
});

describe("<Combobox> — ARIA", () => {
  it("input has role=combobox + aria-autocomplete=list", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
  });

  it("aria-activedescendant points at the highlighted option's id", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    const options = screen.getAllByRole("option");
    const firstId = options[0]?.id;
    expect(input).toHaveAttribute("aria-activedescendant", firstId);
  });

  it("listbox has aria-label", () => {
    render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-label", "Class");
  });

  it("hasError sets aria-invalid", () => {
    render(<Harness hasError />);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });

  it("selected option has aria-selected=true", () => {
    render(<Harness initial="71641" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    const sel = screen.getByRole("option", { name: /Restaurants/i });
    expect(sel).toHaveAttribute("aria-selected", "true");
  });

  it("disabled options have aria-disabled", () => {
    render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    const disabled = screen.getByText("Cement contractors").closest('[role="option"]');
    expect(disabled).toHaveAttribute("aria-disabled", "true");
  });
});

describe("<Combobox> — outside click + portal", () => {
  it("closes on outside click + restores", () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <Harness initial="71641" />
      </div>,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bow" } });
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(input).toHaveValue("Restaurants");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("portal-renders the listbox", () => {
    const { container } = render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    const listbox = screen.getByRole("listbox");
    expect(container.contains(listbox)).toBe(false);
  });
});

describe("<Combobox> — custom renderOption", () => {
  it("uses the renderOption override", () => {
    render(
      <Harness
        renderOption={(opt, state) => (
          <div data-testid="custom" data-state={state.highlighted ? "hl" : "no"}>
            CUSTOM: {opt.label}
          </div>
        )}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    const customs = screen.getAllByTestId("custom");
    expect(customs[0]).toHaveTextContent("CUSTOM: Restaurants");
  });
});
