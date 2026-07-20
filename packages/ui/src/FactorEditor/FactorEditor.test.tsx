/**
 * <FactorEditor> tests.
 *
 * Three layers:
 *   · Pure helpers (isFactorDraftComplete, emptyDraftForKind)
 *   · Render — placeholder, every-kind transition, deferred kinds
 *   · Interaction — typing values, picking class codes
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FactorEditor,
  emptyDraftForKind,
  isFactorDraftComplete,
  type FactorDraft,
} from "./FactorEditor";
import type { ClassPickerOption } from "../ClassPicker";
import type { DimensionRefOption } from "../DimensionRefPicker";
import type { FactorTableRefOption } from "../FactorTableRefPicker";

const CLASSES: ClassPickerOption[] = [
  { class_code: "c101", display_name: "Meridian Recreation", family: "Recreation" },
  { class_code: "60311", display_name: "Lawyers — Offices", family: "Office" },
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("isFactorDraftComplete", () => {
  it("returns false for the unset state", () => {
    expect(isFactorDraftComplete({ kind: "" })).toBe(false);
  });

  it("returns false for constant with empty value", () => {
    expect(
      isFactorDraftComplete({ kind: "constant", value: "", reason: "" }),
    ).toBe(false);
  });

  it("returns true for constant with a number value", () => {
    expect(
      isFactorDraftComplete({ kind: "constant", value: 0.95, reason: "x" }),
    ).toBe(true);
  });

  it("returns false for constant with NaN", () => {
    expect(
      isFactorDraftComplete({ kind: "constant", value: NaN, reason: "" }),
    ).toBe(false);
  });

  it("returns false for classification with empty class_code", () => {
    expect(
      isFactorDraftComplete({ kind: "lookup.classification", class_code: "" }),
    ).toBe(false);
  });

  it("returns true for classification with a class_code", () => {
    expect(
      isFactorDraftComplete({
        kind: "lookup.classification",
        class_code: "c101",
      }),
    ).toBe(true);
  });

  it("returns true for flat_factor with a number", () => {
    expect(
      isFactorDraftComplete({ kind: "flat_factor", factor: 1.1, reason: "" }),
    ).toBe(true);
  });

  it("returns false for lookup.direct with empty fields", () => {
    expect(
      isFactorDraftComplete({
        kind: "lookup.direct",
        dimension_id: "",
        factor_table_id: "",
      }),
    ).toBe(false);
    expect(
      isFactorDraftComplete({
        kind: "lookup.direct",
        dimension_id: "construction_class",
        factor_table_id: "",
      }),
    ).toBe(false);
  });

  it("returns true for lookup.direct with both fields", () => {
    expect(
      isFactorDraftComplete({
        kind: "lookup.direct",
        dimension_id: "construction_class",
        factor_table_id: "construction_table",
      }),
    ).toBe(true);
  });

  it("returns false for the still-deferred kinds (lookup.range, formula)", () => {
    expect(isFactorDraftComplete({ kind: "lookup.range" })).toBe(false);
    expect(isFactorDraftComplete({ kind: "formula" })).toBe(false);
  });
});

describe("emptyDraftForKind", () => {
  it("returns the unset draft for empty kind", () => {
    expect(emptyDraftForKind("")).toEqual({ kind: "" });
  });

  it("returns a fresh constant draft", () => {
    expect(emptyDraftForKind("constant")).toEqual({
      kind: "constant",
      value: "",
      reason: "",
    });
  });

  it("returns a fresh classification draft", () => {
    expect(emptyDraftForKind("lookup.classification")).toEqual({
      kind: "lookup.classification",
      class_code: "",
    });
  });

  it("returns a fresh flat_factor draft", () => {
    expect(emptyDraftForKind("flat_factor")).toEqual({
      kind: "flat_factor",
      factor: "",
      reason: "",
    });
  });

  it("returns a fresh lookup.direct draft with empty refs", () => {
    expect(emptyDraftForKind("lookup.direct")).toEqual({
      kind: "lookup.direct",
      dimension_id: "",
      factor_table_id: "",
    });
  });

  it("returns a minimal draft for still-deferred kinds", () => {
    expect(emptyDraftForKind("lookup.range")).toEqual({ kind: "lookup.range" });
    expect(emptyDraftForKind("formula")).toEqual({ kind: "formula" });
  });
});

// ---------------------------------------------------------------------------
// Render — unset state
// ---------------------------------------------------------------------------

describe("<FactorEditor> — unset state", () => {
  it("shows placeholder hint when value.kind is empty", () => {
    render(<FactorEditor value={{ kind: "" }} onChange={() => {}} />);
    expect(
      screen.getByText(/Pick a kind above to start/i),
    ).toBeInTheDocument();
  });

  it("kind picker is rendered with empty value", () => {
    render(<FactorEditor value={{ kind: "" }} onChange={() => {}} />);
    expect(screen.getByLabelText("Factor kind")).toHaveValue("");
  });

  it("picking a kind fires onChange with the empty draft for that kind", () => {
    const onChange = vi.fn();
    render(<FactorEditor value={{ kind: "" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Factor kind"), {
      target: { value: "constant" },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "constant",
      value: "",
      reason: "",
    });
  });
});

// ---------------------------------------------------------------------------
// Constant fields
// ---------------------------------------------------------------------------

describe("<FactorEditor> — constant kind", () => {
  const baseDraft: FactorDraft = { kind: "constant", value: "", reason: "" };

  it("renders Value + Reason fields", () => {
    render(<FactorEditor value={baseDraft} onChange={() => {}} />);
    expect(screen.getByLabelText("Constant value")).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason for the constant/i)).toBeInTheDocument();
  });

  it("typing a number fires onChange with the parsed number", () => {
    const onChange = vi.fn();
    render(<FactorEditor value={baseDraft} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Constant value"), {
      target: { value: "0.95" },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "constant",
      value: 0.95,
      reason: "",
    });
  });

  it("clearing the input fires onChange with empty string", () => {
    const onChange = vi.fn();
    render(
      <FactorEditor
        value={{ kind: "constant", value: 1.0, reason: "" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Constant value"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "constant",
      value: "",
      reason: "",
    });
  });

  it("typing in Reason fires onChange with the new text", () => {
    const onChange = vi.fn();
    render(<FactorEditor value={baseDraft} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Reason for the constant/i), {
      target: { value: "sprinkler credit" },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "constant",
      value: "",
      reason: "sprinkler credit",
    });
  });
});

// ---------------------------------------------------------------------------
// Classification fields
// ---------------------------------------------------------------------------

describe("<FactorEditor> — classification kind", () => {
  it("renders the ClassPicker with the passed-in classes", () => {
    render(
      <FactorEditor
        value={{ kind: "lookup.classification", class_code: "" }}
        onChange={() => {}}
        classes={CLASSES}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox", { name: /class/i }));
    expect(screen.getByText("Meridian Recreation")).toBeInTheDocument();
    expect(screen.getByText("Lawyers — Offices")).toBeInTheDocument();
  });

  it("picking a class fires onChange with the new class_code", () => {
    const onChange = vi.fn();
    render(
      <FactorEditor
        value={{ kind: "lookup.classification", class_code: "" }}
        onChange={onChange}
        classes={CLASSES}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox", { name: /class/i }));
    fireEvent.mouseDown(screen.getByText("Meridian Recreation"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "lookup.classification",
      class_code: "c101",
    });
  });

  it("handles undefined classes array gracefully (no crash, no options)", () => {
    render(
      <FactorEditor
        value={{ kind: "lookup.classification", class_code: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("combobox", { name: /class/i })).toBeInTheDocument();
  });

  it("forwards classPickerEmptyAction to the picker", () => {
    const emptyAction = { label: "Browse all classes", onClick: vi.fn() };
    render(
      <FactorEditor
        value={{ kind: "lookup.classification", class_code: "" }}
        onChange={() => {}}
        classes={CLASSES}
        classPickerEmptyAction={emptyAction}
      />,
    );
    const input = screen.getByRole("combobox", { name: /class/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "no-match-xyzzy" } });
    expect(screen.getByText("Browse all classes")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Flat factor fields
// ---------------------------------------------------------------------------

describe("<FactorEditor> — flat_factor kind", () => {
  it("renders Factor + Reason fields", () => {
    render(
      <FactorEditor
        value={{ kind: "flat_factor", factor: "", reason: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Flat factor value")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Reason for the flat factor/i),
    ).toBeInTheDocument();
  });

  it("typing in factor fires onChange with parsed number", () => {
    const onChange = vi.fn();
    render(
      <FactorEditor
        value={{ kind: "flat_factor", factor: "", reason: "" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Flat factor value"), {
      target: { value: "1.1" },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "flat_factor",
      factor: 1.1,
      reason: "",
    });
  });
});

// ---------------------------------------------------------------------------
// Deferred kinds
// ---------------------------------------------------------------------------

describe("<FactorEditor> — still-deferred kinds (lookup.range, formula)", () => {
  it("shows 'Editor lands in next PR' for lookup.range", () => {
    render(
      <FactorEditor value={{ kind: "lookup.range" }} onChange={() => {}} />,
    );
    expect(screen.getByText(/Editor lands in next PR/i)).toBeInTheDocument();
    expect(screen.getByText("lookup.range")).toBeInTheDocument();
  });

  it("shows 'Editor lands in next PR' for formula", () => {
    render(<FactorEditor value={{ kind: "formula" }} onChange={() => {}} />);
    expect(screen.getByText(/Editor lands in next PR/i)).toBeInTheDocument();
    expect(screen.getByText("formula")).toBeInTheDocument();
  });

  it("deferred message uses role=status for screen readers", () => {
    render(
      <FactorEditor value={{ kind: "lookup.range" }} onChange={() => {}} />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// New wired kinds (lookup.direct)
// ---------------------------------------------------------------------------

const DIMENSIONS: DimensionRefOption[] = [
  { id: "construction_class", display_name: "Construction Class", slug: "construction_class" },
  { id: "deductible", display_name: "Deductible", slug: "deductible" },
];
const FACTOR_TABLES: FactorTableRefOption[] = [
  { id: "construction_table", display_name: "Construction Factors", slug: "construction_table" },
];

describe("<FactorEditor> — lookup.direct kind (M4.3.6)", () => {
  const baseDraft: FactorDraft = {
    kind: "lookup.direct",
    dimension_id: "",
    factor_table_id: "",
  };

  it("renders Key-dimension + Factor-table picker fields", () => {
    render(
      <FactorEditor
        value={baseDraft}
        onChange={() => {}}
        dimensions={DIMENSIONS}
        factorTables={FACTOR_TABLES}
      />,
    );
    expect(screen.getByRole("combobox", { name: /dimension/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /factor table/i })).toBeInTheDocument();
  });

  it("picking a dimension fires onChange with the new dimension_id", () => {
    const onChange = vi.fn();
    render(
      <FactorEditor
        value={baseDraft}
        onChange={onChange}
        dimensions={DIMENSIONS}
        factorTables={FACTOR_TABLES}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox", { name: /dimension/i }));
    fireEvent.mouseDown(screen.getByText("Construction Class"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "lookup.direct",
      dimension_id: "construction_class",
      factor_table_id: "",
    });
  });

  it("picking a factor table fires onChange with the new factor_table_id", () => {
    const onChange = vi.fn();
    render(
      <FactorEditor
        value={baseDraft}
        onChange={onChange}
        dimensions={DIMENSIONS}
        factorTables={FACTOR_TABLES}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox", { name: /factor table/i }));
    fireEvent.mouseDown(screen.getByText("Construction Factors"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "lookup.direct",
      dimension_id: "",
      factor_table_id: "construction_table",
    });
  });

  it("handles undefined dimensions + factorTables gracefully", () => {
    render(<FactorEditor value={baseDraft} onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: /dimension/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /factor table/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Kind transitions
// ---------------------------------------------------------------------------

describe("<FactorEditor> — kind transitions", () => {
  it("changing kind resets the draft to the new kind's empty shape", () => {
    const onChange = vi.fn();
    render(
      <FactorEditor
        value={{ kind: "constant", value: 0.95, reason: "x" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Factor kind"), {
      target: { value: "lookup.classification" },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: "lookup.classification",
      class_code: "",
    });
  });
});
