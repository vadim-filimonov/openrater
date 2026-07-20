/**
 * <GeneratePanel> tests — the banded-level generator.
 *
 * Brief 66 cutover note: this file once also tested the legacy
 * <DimensionEditor> banded shape and <BandedScrubberStrip>; both were
 * deleted with the legacy editor (dims2 mounts GeneratePanel directly).
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import { GeneratePanel } from "./GeneratePanel";
import type { LevelRow } from "./LevelRowsTable";

const HAND_TUNED_LEVELS: readonly LevelRow[] = [
  { kind: "banded", id: "band_0_5", label: "New", lo: 0, hi: 5 },
  { kind: "banded", id: "band_5_15", label: "Modern", lo: 5, hi: 15 },
];

describe("<GeneratePanel>", () => {
  it("renders 2 selectable methods + 2 disabled methods", () => {
    render(
      <GeneratePanel
        currentLevels={[]}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-generate-panel-method-equal-width"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-generate-panel-method-log-scale"),
    ).toBeInTheDocument();
    // Disabled rows render but are not testid'd; check by text.
    expect(screen.getByText("Quantile")).toBeInTheDocument();
    expect(screen.getByText("Manual list")).toBeInTheDocument();
  });

  it("starts on equal-width method", () => {
    render(
      <GeneratePanel
        currentLevels={[]}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const equalWidth = screen
      .getByTestId("rater-generate-panel-method-equal-width")
      .querySelector("input") as HTMLInputElement;
    expect(equalWidth.checked).toBe(true);
  });

  it("seeds min/max from current levels", () => {
    render(
      <GeneratePanel
        currentLevels={HAND_TUNED_LEVELS}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("rater-generate-panel-min")).toHaveValue(0);
    expect(screen.getByTestId("rater-generate-panel-max")).toHaveValue(15);
    expect(screen.getByTestId("rater-generate-panel-count")).toHaveValue(2);
  });

  it("renders a 5-row preview for equal-width 0-100 / 5", () => {
    render(
      <GeneratePanel
        currentLevels={[]}
        defaultMin={0}
        defaultMax={100}
        defaultCount={5}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const preview = screen.getByTestId("rater-generate-panel-preview");
    // Five band ids in the preview list.
    expect(within(preview).getByText("band_0_20")).toBeInTheDocument();
    expect(within(preview).getByText("band_20_40")).toBeInTheDocument();
    expect(within(preview).getByText("band_80_100")).toBeInTheDocument();
  });

  it("renders replace-warning when hand-tuned levels exist", () => {
    render(
      <GeneratePanel
        currentLevels={HAND_TUNED_LEVELS}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-generate-panel-replace-warning"),
    ).toBeInTheDocument();
  });

  it("does NOT render replace-warning when levels are default-id", () => {
    const defaultLevels: readonly LevelRow[] = [
      { kind: "banded", id: "band_0_5", label: "", lo: 0, hi: 5 },
      { kind: "banded", id: "band_5_10", label: "", lo: 5, hi: 10 },
    ];
    render(
      <GeneratePanel
        currentLevels={defaultLevels}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("rater-generate-panel-replace-warning"),
    ).not.toBeInTheDocument();
  });

  it("fires onApply with recipe + generated levels on confirm", () => {
    const onApply = vi.fn();
    render(
      <GeneratePanel
        currentLevels={[]}
        defaultMin={0}
        defaultMax={100}
        defaultCount={5}
        onApply={onApply}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-generate-panel-apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [recipe, levels] = onApply.mock.calls[0]!;
    expect(recipe).toMatchObject({
      method: "equal-width",
      min: 0,
      max: 100,
      count: 5,
    });
    expect(levels).toHaveLength(5);
  });

  it("fires onCancel when cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <GeneratePanel
        currentLevels={[]}
        onApply={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-generate-panel-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables apply when max <= min", () => {
    render(
      <GeneratePanel
        currentLevels={[]}
        defaultMin={10}
        defaultMax={5}
        defaultCount={5}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-generate-panel-apply"),
    ).toBeDisabled();
  });

  it("disables log-scale when min ≤ 0", () => {
    render(
      <GeneratePanel
        currentLevels={[]}
        defaultMin={0}
        defaultMax={100}
        defaultCount={5}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const logRadio = screen
      .getByTestId("rater-generate-panel-method-log-scale")
      .querySelector("input") as HTMLInputElement;
    expect(logRadio.disabled).toBe(true);
  });

  it("primary button label reflects replace mode", () => {
    const { rerender } = render(
      <GeneratePanel
        currentLevels={[]}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-generate-panel-apply"),
    ).toHaveTextContent("Generate");
    rerender(
      <GeneratePanel
        currentLevels={HAND_TUNED_LEVELS}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-generate-panel-apply"),
    ).toHaveTextContent("Replace 2 bands");
  });
});
