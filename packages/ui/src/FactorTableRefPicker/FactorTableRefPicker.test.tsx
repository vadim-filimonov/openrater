/**
 * <FactorTableRefPicker> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FactorTableRefPicker,
  type FactorTableRefOption,
} from "./FactorTableRefPicker";

const TABLES: FactorTableRefOption[] = [
  {
    id: "sample_bop_class_factors_2026",
    display_name: "BOP Class Factors",
    slug: "sample_bop_class_factors_2026",
  },
  {
    id: "construction_class_table",
    display_name: "Construction Class Factors",
    slug: "construction_class_table",
  },
];

describe("<FactorTableRefPicker>", () => {
  it("uses 'Factor table' as default aria-label", () => {
    render(<FactorTableRefPicker tables={TABLES} value="" onChange={() => {}} />);
    expect(
      screen.getByRole("combobox", { name: /factor table/i }),
    ).toBeInTheDocument();
  });

  it("uses 'Pick a factor table…' as default placeholder", () => {
    render(<FactorTableRefPicker tables={TABLES} value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText(/Pick a factor table/i)).toBeInTheDocument();
  });

  it("renders the current value's display_name when set", () => {
    render(
      <FactorTableRefPicker
        tables={TABLES}
        value="sample_bop_class_factors_2026"
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue(/BOP Class Factors/)).toBeInTheDocument();
  });

  it("projects slug as subLabel", () => {
    render(<FactorTableRefPicker tables={TABLES} value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByText("sample_bop_class_factors_2026")).toBeInTheDocument();
    expect(screen.getByText("construction_class_table")).toBeInTheDocument();
  });

  it("calls onChange with id on pick", () => {
    const onChange = vi.fn();
    render(<FactorTableRefPicker tables={TABLES} value="" onChange={onChange} />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("BOP Class Factors"));
    expect(onChange).toHaveBeenCalledWith("sample_bop_class_factors_2026");
  });

  it("uses plural 'factor tables' in empty state", () => {
    render(<FactorTableRefPicker tables={[]} value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByText(/No factor tables match/i)).toBeInTheDocument();
  });

  it("respects disabled prop", () => {
    render(
      <FactorTableRefPicker
        tables={TABLES}
        value=""
        onChange={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("renders empty-action CTA on no-match", () => {
    const onClick = vi.fn();
    render(
      <FactorTableRefPicker
        tables={TABLES}
        value=""
        onChange={() => {}}
        emptyAction={{ label: "Open factor tables section", onClick }}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyzzy" } });
    expect(screen.getByText("Open factor tables section")).toBeInTheDocument();
  });
});
