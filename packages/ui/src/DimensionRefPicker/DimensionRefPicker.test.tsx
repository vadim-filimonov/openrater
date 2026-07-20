/**
 * <DimensionRefPicker> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DimensionRefPicker,
  type DimensionRefOption,
} from "./DimensionRefPicker";

const DIMENSIONS: DimensionRefOption[] = [
  { id: "construction_class", display_name: "Construction Class", slug: "construction_class" },
  { id: "protection_class", display_name: "Protection Class", slug: "protection_class" },
  { id: "sprinklered", display_name: "Sprinklered", slug: "sprinklered" },
];

describe("<DimensionRefPicker> — rendering", () => {
  it("uses 'Dimension' as default aria-label", () => {
    render(<DimensionRefPicker dimensions={DIMENSIONS} value="" onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: /dimension/i })).toBeInTheDocument();
  });

  it("uses 'Pick a dimension…' as default placeholder", () => {
    render(<DimensionRefPicker dimensions={DIMENSIONS} value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText(/Pick a dimension/i)).toBeInTheDocument();
  });

  it("renders the current value's display_name when set", () => {
    render(
      <DimensionRefPicker
        dimensions={DIMENSIONS}
        value="construction_class"
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue(/Construction Class/)).toBeInTheDocument();
  });

  it("accepts an aria-label override", () => {
    render(
      <DimensionRefPicker
        dimensions={DIMENSIONS}
        value=""
        onChange={() => {}}
        ariaLabel="Pick the key dimension"
      />,
    );
    expect(
      screen.getByRole("combobox", { name: /Pick the key dimension/i }),
    ).toBeInTheDocument();
  });

  it("accepts a placeholder override", () => {
    render(
      <DimensionRefPicker
        dimensions={DIMENSIONS}
        value=""
        onChange={() => {}}
        placeholder="Choose a dimension"
      />,
    );
    expect(screen.getByPlaceholderText("Choose a dimension")).toBeInTheDocument();
  });

  it("respects the disabled prop", () => {
    render(
      <DimensionRefPicker
        dimensions={DIMENSIONS}
        value=""
        onChange={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

describe("<DimensionRefPicker> — options projection", () => {
  it("opens popover and shows display_name + slug subLabel", () => {
    render(<DimensionRefPicker dimensions={DIMENSIONS} value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByText("Construction Class")).toBeInTheDocument();
    // slug rendered as subLabel
    expect(screen.getByText("construction_class")).toBeInTheDocument();
    expect(screen.getByText("Protection Class")).toBeInTheDocument();
    expect(screen.getByText("protection_class")).toBeInTheDocument();
  });
});

describe("<DimensionRefPicker> — selection", () => {
  it("calls onChange with the dimension id on pick", () => {
    const onChange = vi.fn();
    render(<DimensionRefPicker dimensions={DIMENSIONS} value="" onChange={onChange} />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Sprinklered"));
    expect(onChange).toHaveBeenCalledWith("sprinklered");
  });
});

describe("<DimensionRefPicker> — empty action", () => {
  it("renders the empty-action CTA when no options match the query", () => {
    const onClick = vi.fn();
    render(
      <DimensionRefPicker
        dimensions={DIMENSIONS}
        value=""
        onChange={() => {}}
        emptyAction={{ label: "Add a new dimension", onClick }}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyzzy" } });
    expect(screen.getByText("Add a new dimension")).toBeInTheDocument();
  });

  it("empty-action onClick fires", () => {
    const onClick = vi.fn();
    render(
      <DimensionRefPicker
        dimensions={DIMENSIONS}
        value=""
        onChange={() => {}}
        emptyAction={{ label: "Add a new dimension", onClick }}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyzzy" } });
    fireEvent.click(screen.getByText("Add a new dimension"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("<DimensionRefPicker> — plural", () => {
  it("uses 'dimensions' (not 'dimensionss') in the no-match empty hint", () => {
    render(<DimensionRefPicker dimensions={[]} value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByText(/No dimensions match/i)).toBeInTheDocument();
  });
});
