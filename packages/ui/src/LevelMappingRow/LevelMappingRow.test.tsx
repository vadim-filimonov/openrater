/**
 * <LevelMappingRow> tests — Brief 26 PR 6.
 *
 * Smoke coverage for the kind-aware rendering + field wiring.
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LevelMappingRow } from "./LevelMappingRow";

describe("LevelMappingRow — categorical", () => {
  const categoricalLevel = {
    kind: "categorical" as const,
    id: "71641",
    label: "Restaurants — full service",
    aliases: ["Restaurant", "Restaurant - dine-in"],
  };

  it("renders the id + label + alias chip-cloud", () => {
    render(
      <LevelMappingRow level={categoricalLevel} onChange={() => {}} />,
    );
    expect(screen.getByText("71641")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Restaurants — full service"),
    ).toBeInTheDocument();
    expect(screen.getByText("Restaurant")).toBeInTheDocument();
    expect(screen.getByText("Restaurant - dine-in")).toBeInTheDocument();
  });

  it("editing the label fires onChange", () => {
    const onChange = vi.fn();
    render(
      <LevelMappingRow level={categoricalLevel} onChange={onChange} />,
    );
    const labelInput = screen.getByTestId("rater-level-mapping-row-label");
    fireEvent.change(labelInput, { target: { value: "Cafés" } });
    expect(onChange).toHaveBeenCalledWith({
      ...categoricalLevel,
      label: "Cafés",
    });
  });

  it("adding an alias via chip-input fires onChange with the new aliases", () => {
    const onChange = vi.fn();
    render(
      <LevelMappingRow level={categoricalLevel} onChange={onChange} />,
    );
    const chipInput = screen.getByTestId(
      "rater-level-mapping-row-aliases-input",
    );
    fireEvent.change(chipInput, { target: { value: "Pizzeria" } });
    fireEvent.keyDown(chipInput, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({
      ...categoricalLevel,
      aliases: ["Restaurant", "Restaurant - dine-in", "Pizzeria"],
    });
  });

  it("removing an alias via chip ✕ fires onChange", () => {
    const onChange = vi.fn();
    render(
      <LevelMappingRow level={categoricalLevel} onChange={onChange} />,
    );
    fireEvent.click(
      screen.getByTestId("rater-level-mapping-row-aliases-chip-0-remove"),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...categoricalLevel,
      aliases: ["Restaurant - dine-in"],
    });
  });

  it("renders no banded/geographic affordances", () => {
    render(
      <LevelMappingRow level={categoricalLevel} onChange={() => {}} />,
    );
    expect(
      screen.queryByTestId("rater-level-mapping-row-lo"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-level-mapping-row-territory-ref"),
    ).not.toBeInTheDocument();
  });

  it("readOnly disables the chip input + label", () => {
    render(
      <LevelMappingRow
        level={categoricalLevel}
        onChange={() => {}}
        readOnly
      />,
    );
    expect(
      screen.getByTestId("rater-level-mapping-row-label"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("rater-level-mapping-row-aliases-input"),
    ).toBeDisabled();
  });
});

describe("LevelMappingRow — banded", () => {
  const bandedLevel = {
    kind: "banded" as const,
    id: "band_0_5",
    label: "New",
    lo: 0,
    hi: 5,
  };

  it("renders the id + label + lo/hi inputs", () => {
    render(<LevelMappingRow level={bandedLevel} onChange={() => {}} />);
    expect(screen.getByText("band_0_5")).toBeInTheDocument();
    expect(screen.getByDisplayValue("New")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
  });

  it("editing lo fires onChange with parsed number", () => {
    const onChange = vi.fn();
    render(<LevelMappingRow level={bandedLevel} onChange={onChange} />);
    const lo = screen.getByTestId("rater-level-mapping-row-lo");
    fireEvent.change(lo, { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith({ ...bandedLevel, lo: 1 });
  });

  it("editing hi fires onChange with parsed number", () => {
    const onChange = vi.fn();
    render(<LevelMappingRow level={bandedLevel} onChange={onChange} />);
    const hi = screen.getByTestId("rater-level-mapping-row-hi");
    fireEvent.change(hi, { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith({ ...bandedLevel, hi: 10 });
  });

  it("typing 'inf' on hi sets +Infinity", () => {
    const onChange = vi.fn();
    render(<LevelMappingRow level={bandedLevel} onChange={onChange} />);
    const hi = screen.getByTestId("rater-level-mapping-row-hi");
    fireEvent.change(hi, { target: { value: "inf" } });
    expect(onChange).toHaveBeenCalledWith({
      ...bandedLevel,
      hi: Number.POSITIVE_INFINITY,
    });
  });

  it("typing '-inf' on lo sets -Infinity", () => {
    const onChange = vi.fn();
    render(<LevelMappingRow level={bandedLevel} onChange={onChange} />);
    const lo = screen.getByTestId("rater-level-mapping-row-lo");
    fireEvent.change(lo, { target: { value: "-inf" } });
    expect(onChange).toHaveBeenCalledWith({
      ...bandedLevel,
      lo: Number.NEGATIVE_INFINITY,
    });
  });

  it("renders ±∞ display when lo/hi are infinities", () => {
    const open = {
      kind: "banded" as const,
      id: "open",
      label: "Open",
      lo: Number.NEGATIVE_INFINITY,
      hi: Number.POSITIVE_INFINITY,
    };
    render(<LevelMappingRow level={open} onChange={() => {}} />);
    expect(screen.getByDisplayValue("-inf")).toBeInTheDocument();
    expect(screen.getByDisplayValue("inf")).toBeInTheDocument();
  });

  it("renders no alias chip-cloud", () => {
    render(<LevelMappingRow level={bandedLevel} onChange={() => {}} />);
    expect(
      screen.queryByTestId("rater-level-mapping-row-aliases-input"),
    ).not.toBeInTheDocument();
  });
});

describe("LevelMappingRow — geographic", () => {
  const geographicLevel = {
    kind: "geographic" as const,
    id: "wi_001",
    label: "WI-001",
    territory_ref: "wi-bop-2026-q3:001",
  };

  it("renders the id + label + territory_ref", () => {
    render(
      <LevelMappingRow level={geographicLevel} onChange={() => {}} />,
    );
    expect(screen.getByText("wi_001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("WI-001")).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-level-mapping-row-territory-ref"),
    ).toHaveTextContent("wi-bop-2026-q3:001");
  });

  it("territory_ref is read-only", () => {
    render(
      <LevelMappingRow level={geographicLevel} onChange={() => {}} />,
    );
    // It's a <code>, not an input — no editable behavior.
    expect(
      screen.getByTestId("rater-level-mapping-row-territory-ref").tagName,
    ).toBe("CODE");
  });

  it("renders no alias chip-cloud or banded inputs", () => {
    render(
      <LevelMappingRow level={geographicLevel} onChange={() => {}} />,
    );
    expect(
      screen.queryByTestId("rater-level-mapping-row-aliases-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-level-mapping-row-lo"),
    ).not.toBeInTheDocument();
  });
});

describe("LevelMappingRow — delete", () => {
  it("renders a delete button only when onDelete supplied", () => {
    const { rerender } = render(
      <LevelMappingRow
        level={{
          kind: "categorical",
          id: "x",
          label: "X",
          aliases: [],
        }}
        onChange={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("rater-level-mapping-row-delete"),
    ).not.toBeInTheDocument();

    const onDelete = vi.fn();
    rerender(
      <LevelMappingRow
        level={{
          kind: "categorical",
          id: "x",
          label: "X",
          aliases: [],
        }}
        onChange={() => {}}
        onDelete={onDelete}
      />,
    );
    expect(
      screen.getByTestId("rater-level-mapping-row-delete"),
    ).toBeInTheDocument();
  });

  it("clicking delete fires onDelete", () => {
    const onDelete = vi.fn();
    render(
      <LevelMappingRow
        level={{
          kind: "categorical",
          id: "x",
          label: "X",
          aliases: [],
        }}
        onChange={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-level-mapping-row-delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
