/**
 * <ChainFactorKindSelect> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ChainFactorKindSelect,
  FACTOR_KIND_HINTS,
  FACTOR_KIND_LABELS,
  FACTOR_KIND_OPTIONS,
} from "./ChainFactorKindSelect";

describe("FACTOR_KIND_OPTIONS catalog", () => {
  it("covers every supported chain-factor kind", () => {
    expect(FACTOR_KIND_OPTIONS).toContain("constant");
    expect(FACTOR_KIND_OPTIONS).toContain("lookup.direct");
    expect(FACTOR_KIND_OPTIONS).toContain("lookup.classification");
    expect(FACTOR_KIND_OPTIONS).toContain("lookup.range");
    expect(FACTOR_KIND_OPTIONS).toContain("formula");
    expect(FACTOR_KIND_OPTIONS).toContain("flat_factor");
  });

  it("FACTOR_KIND_LABELS has an entry for every option", () => {
    for (const kind of FACTOR_KIND_OPTIONS) {
      expect(FACTOR_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("FACTOR_KIND_HINTS has an entry for every option", () => {
    for (const kind of FACTOR_KIND_OPTIONS) {
      expect(FACTOR_KIND_HINTS[kind]).toBeTruthy();
    }
  });

  it("uses actuary-language labels per Brief 8 §B", () => {
    // The naming decision: 'Class' (not 'Classification' / 'Class code lookup')
    expect(FACTOR_KIND_LABELS["lookup.classification"]).toBe("Class");
    // Disambiguated where needed
    expect(FACTOR_KIND_LABELS["lookup.direct"]).toBe("Direct lookup");
    expect(FACTOR_KIND_LABELS["lookup.range"]).toBe("Range lookup");
  });

  it("FACTOR_KIND_OPTIONS is frozen", () => {
    expect(Object.isFrozen(FACTOR_KIND_OPTIONS)).toBe(true);
  });
});

describe("<ChainFactorKindSelect> — rendering", () => {
  it("renders every kind as an option", () => {
    render(<ChainFactorKindSelect value="" onChange={() => {}} />);
    for (const kind of FACTOR_KIND_OPTIONS) {
      expect(screen.getByRole("option", { name: FACTOR_KIND_LABELS[kind] }))
        .toBeInTheDocument();
    }
  });

  it("shows the placeholder option when value is empty", () => {
    render(
      <ChainFactorKindSelect
        value=""
        onChange={() => {}}
        placeholder="Choose a kind"
      />,
    );
    expect(screen.getByRole("option", { name: "Choose a kind" }))
      .toBeInTheDocument();
  });

  it("uses default placeholder when not provided", () => {
    render(<ChainFactorKindSelect value="" onChange={() => {}} />);
    expect(
      screen.getByRole("option", { name: "Pick a factor kind…" }),
    ).toBeInTheDocument();
  });

  it("uses default aria-label of 'Factor kind'", () => {
    render(<ChainFactorKindSelect value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Factor kind")).toBeInTheDocument();
  });

  it("accepts an aria-label override", () => {
    render(
      <ChainFactorKindSelect
        value=""
        onChange={() => {}}
        ariaLabel="Pick the rating factor kind"
      />,
    );
    expect(
      screen.getByLabelText("Pick the rating factor kind"),
    ).toBeInTheDocument();
  });

  it("respects the disabled prop", () => {
    render(<ChainFactorKindSelect value="" onChange={() => {}} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

describe("<ChainFactorKindSelect> — selection", () => {
  it("calls onChange with the picked kind id", () => {
    const onChange = vi.fn();
    render(<ChainFactorKindSelect value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "lookup.classification" },
    });
    expect(onChange).toHaveBeenCalledWith("lookup.classification");
  });

  it("reflects the current value in the select", () => {
    render(<ChainFactorKindSelect value="constant" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveValue("constant");
  });
});

describe("<ChainFactorKindSelect> — hint", () => {
  it("shows the hint for the selected kind by default", () => {
    render(
      <ChainFactorKindSelect value="constant" onChange={() => {}} />,
    );
    expect(screen.getByText(FACTOR_KIND_HINTS["constant"])).toBeInTheDocument();
  });

  it("hides the hint when showHint=false", () => {
    render(
      <ChainFactorKindSelect
        value="constant"
        onChange={() => {}}
        showHint={false}
      />,
    );
    expect(screen.queryByText(FACTOR_KIND_HINTS["constant"])).toBeNull();
  });

  it("hides the hint when no value is set", () => {
    render(<ChainFactorKindSelect value="" onChange={() => {}} />);
    // None of the hint texts should be in the doc
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("hint is announced via aria-live=polite", () => {
    render(
      <ChainFactorKindSelect value="lookup.range" onChange={() => {}} />,
    );
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("aria-live", "polite");
  });

  it("hint updates when value changes", () => {
    const { rerender } = render(
      <ChainFactorKindSelect value="constant" onChange={() => {}} />,
    );
    expect(screen.getByText(FACTOR_KIND_HINTS["constant"])).toBeInTheDocument();
    rerender(
      <ChainFactorKindSelect value="lookup.range" onChange={() => {}} />,
    );
    expect(
      screen.getByText(FACTOR_KIND_HINTS["lookup.range"]),
    ).toBeInTheDocument();
    expect(screen.queryByText(FACTOR_KIND_HINTS["constant"])).toBeNull();
  });
});
