/**
 * <FactorTablePowerTools> tests — Brief 33 PR 33.4.
 *
 * Covers:
 *   • Chip label states (no selection / N cells / N cells + label)
 *   • Buttons disabled when no selection
 *   • "Set to…" popover opens / closes; submitting fires onSetValue
 *   • "+%" popover opens / closes; submitting fires onApplyPercent
 *   • Submit button disabled until input parses as number
 *   • Negative percent submits as-is (e.g. -10)
 *   • Escape inside popover input closes the popover
 *   • Clear button fires onClearSelection
 *   • Toggling one popover closes the other
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FactorTablePowerTools } from "./FactorTablePowerTools";

describe("<FactorTablePowerTools> chip + disabled state", () => {
  it("renders the 'no selection' chip when count is 0", () => {
    render(
      <FactorTablePowerTools
        selectedCount={0}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-power-tools-chip")).toHaveTextContent(
      "No cells selected",
    );
  });

  it("renders 'N cells selected' when count > 0 and no label", () => {
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-power-tools-chip")).toHaveTextContent(
      "3 cells selected",
    );
  });

  it("appends the selection label when provided", () => {
    render(
      <FactorTablePowerTools
        selectedCount={3}
        selectionLabel="column 'owner'"
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-power-tools-chip")).toHaveTextContent(
      "3 cells · column 'owner'",
    );
  });

  it("singularizes for selectedCount === 1", () => {
    render(
      <FactorTablePowerTools
        selectedCount={1}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-power-tools-chip")).toHaveTextContent(
      "1 cell selected",
    );
  });

  it("disables operation buttons when nothing is selected", () => {
    render(
      <FactorTablePowerTools
        selectedCount={0}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-power-tools-set-btn")).toBeDisabled();
    expect(screen.getByTestId("rater-ft-power-tools-pct-btn")).toBeDisabled();
    expect(screen.getByTestId("rater-ft-power-tools-clear-btn")).toBeDisabled();
  });

  it("enables operation buttons when at least one cell is selected", () => {
    render(
      <FactorTablePowerTools
        selectedCount={1}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-power-tools-set-btn")).toBeEnabled();
    expect(screen.getByTestId("rater-ft-power-tools-pct-btn")).toBeEnabled();
    expect(screen.getByTestId("rater-ft-power-tools-clear-btn")).toBeEnabled();
  });

  it("data-has-selection attribute reflects selection state", () => {
    const { rerender } = render(
      <FactorTablePowerTools
        selectedCount={0}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-power-tools")).toHaveAttribute(
      "data-has-selection",
      "false",
    );
    rerender(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-ft-power-tools")).toHaveAttribute(
      "data-has-selection",
      "true",
    );
  });
});

describe("<FactorTablePowerTools> Set to… popover", () => {
  it("opens on click, closes on second click", () => {
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-set-btn"));
    expect(
      screen.getByTestId("rater-ft-power-tools-set-pop"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-set-btn"));
    expect(
      screen.queryByTestId("rater-ft-power-tools-set-pop"),
    ).not.toBeInTheDocument();
  });

  it("submit button is disabled until the input parses", () => {
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-set-btn"));
    const submit = screen.getByTestId("rater-ft-power-tools-set-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("rater-ft-power-tools-set-input"), {
      target: { value: "1.25" },
    });
    expect(submit).toBeEnabled();
  });

  it("submitting fires onSetValue with the parsed number + closes the popover", () => {
    const onSetValue = vi.fn();
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={onSetValue}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-set-btn"));
    fireEvent.change(screen.getByTestId("rater-ft-power-tools-set-input"), {
      target: { value: "1.25" },
    });
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-set-submit"));
    expect(onSetValue).toHaveBeenCalledWith(1.25);
    expect(
      screen.queryByTestId("rater-ft-power-tools-set-pop"),
    ).not.toBeInTheDocument();
  });

  it("Escape inside the input closes the popover without firing", () => {
    const onSetValue = vi.fn();
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={onSetValue}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-set-btn"));
    fireEvent.change(screen.getByTestId("rater-ft-power-tools-set-input"), {
      target: { value: "1.25" },
    });
    fireEvent.keyDown(screen.getByTestId("rater-ft-power-tools-set-input"), {
      key: "Escape",
    });
    expect(
      screen.queryByTestId("rater-ft-power-tools-set-pop"),
    ).not.toBeInTheDocument();
    expect(onSetValue).not.toHaveBeenCalled();
  });
});

describe("<FactorTablePowerTools> +% popover", () => {
  it("submitting fires onApplyPercent with the parsed number", () => {
    const onApplyPercent = vi.fn();
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={() => {}}
        onApplyPercent={onApplyPercent}
        onClearSelection={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-pct-btn"));
    fireEvent.change(screen.getByTestId("rater-ft-power-tools-pct-input"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-pct-submit"));
    expect(onApplyPercent).toHaveBeenCalledWith(5);
  });

  it("accepts negative percents", () => {
    const onApplyPercent = vi.fn();
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={() => {}}
        onApplyPercent={onApplyPercent}
        onClearSelection={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-pct-btn"));
    fireEvent.change(screen.getByTestId("rater-ft-power-tools-pct-input"), {
      target: { value: "-10" },
    });
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-pct-submit"));
    expect(onApplyPercent).toHaveBeenCalledWith(-10);
  });

  it("rejects non-numeric input (submit stays disabled)", () => {
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-pct-btn"));
    fireEvent.change(screen.getByTestId("rater-ft-power-tools-pct-input"), {
      target: { value: "abc" },
    });
    expect(
      screen.getByTestId("rater-ft-power-tools-pct-submit"),
    ).toBeDisabled();
  });
});

describe("<FactorTablePowerTools> popover toggle behavior", () => {
  it("opening +% closes Set to…", () => {
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-set-btn"));
    expect(
      screen.getByTestId("rater-ft-power-tools-set-pop"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-pct-btn"));
    expect(
      screen.queryByTestId("rater-ft-power-tools-set-pop"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("rater-ft-power-tools-pct-pop"),
    ).toBeInTheDocument();
  });
});

describe("<FactorTablePowerTools> Clear button", () => {
  it("fires onClearSelection", () => {
    const onClearSelection = vi.fn();
    render(
      <FactorTablePowerTools
        selectedCount={3}
        onSetValue={() => {}}
        onApplyPercent={() => {}}
        onClearSelection={onClearSelection}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-ft-power-tools-clear-btn"));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });
});
