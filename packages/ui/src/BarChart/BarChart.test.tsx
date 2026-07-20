/**
 * <BarChart> tests — Brief 34 PR 34.1.
 *
 * Covers:
 *   • Empty state when data is empty
 *   • SVG renders with one bar per datum
 *   • Bars tinted by deviation from baseline (data-tint attr)
 *   • Y-axis ticks include the baseline
 *   • focusedKey dims siblings + outlines the focused bar
 *   • onHoverChange fires
 *   • Bars below baseline grow downward; above grow upward
 *   • Value labels render
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BarChart } from "./BarChart";

const CATEGORICAL_DATA = [
  { key: "frame", label: "Frame", value: 1.0 },
  { key: "joisted_masonry", label: "JM", value: 0.92 },
  { key: "fire_resistive", label: "FR", value: 0.78 },
];

describe("<BarChart> mount", () => {
  it("renders empty state when data is empty", () => {
    render(<BarChart data={[]} />);
    expect(screen.getByTestId("rater-bar-chart")).toHaveClass(
      "rater-bar-chart--empty",
    );
  });

  it("renders an SVG with one bar per datum", () => {
    render(<BarChart data={CATEGORICAL_DATA} />);
    expect(screen.getByTestId("rater-bar-chart-svg")).toBeInTheDocument();
    for (const d of CATEGORICAL_DATA) {
      expect(
        screen.getByTestId(`rater-bar-chart-bar-${d.key}`),
      ).toBeInTheDocument();
    }
  });
});

describe("<BarChart> tint encoding", () => {
  it("bar at baseline gets is-mid tint", () => {
    render(<BarChart data={CATEGORICAL_DATA} />);
    expect(screen.getByTestId("rater-bar-chart-bar-frame")).toHaveAttribute(
      "data-tint",
      "mid",
    );
  });

  it("bar below baseline gets is-low tint", () => {
    render(<BarChart data={CATEGORICAL_DATA} />);
    expect(
      screen.getByTestId("rater-bar-chart-bar-fire_resistive"),
    ).toHaveAttribute("data-tint", "low");
  });

  it("bar above baseline gets is-high tint", () => {
    render(
      <BarChart
        data={[
          { key: "x", label: "X", value: 1.25 },
          { key: "y", label: "Y", value: 0.85 },
        ]}
      />,
    );
    expect(screen.getByTestId("rater-bar-chart-bar-x")).toHaveAttribute(
      "data-tint",
      "high",
    );
    expect(screen.getByTestId("rater-bar-chart-bar-y")).toHaveAttribute(
      "data-tint",
      "low",
    );
  });

  it("treats values within 1% of baseline as is-mid (avoids flicker)", () => {
    render(
      <BarChart
        data={[
          { key: "x", label: "X", value: 1.005 },
          { key: "y", label: "Y", value: 0.998 },
        ]}
      />,
    );
    expect(screen.getByTestId("rater-bar-chart-bar-x")).toHaveAttribute(
      "data-tint",
      "mid",
    );
    expect(screen.getByTestId("rater-bar-chart-bar-y")).toHaveAttribute(
      "data-tint",
      "mid",
    );
  });
});

describe("<BarChart> axes", () => {
  it("renders y-axis ticks including the baseline", () => {
    render(<BarChart data={CATEGORICAL_DATA} baseline={1} />);
    expect(
      screen.getByTestId("rater-bar-chart-y-tick-1"),
    ).toBeInTheDocument();
  });

  it("renders x labels for small datasets (no collision)", () => {
    render(<BarChart data={CATEGORICAL_DATA} />);
    expect(
      screen.getByTestId("rater-bar-chart-x-label-frame"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-bar-chart-x-label-fire_resistive"),
    ).toBeInTheDocument();
  });
});

describe("<BarChart> focus + hover", () => {
  it("focusedKey marks bar as focused + dims siblings", () => {
    render(
      <BarChart data={CATEGORICAL_DATA} focusedKey="joisted_masonry" />,
    );
    const focused = screen.getByTestId(
      "rater-bar-chart-bar-joisted_masonry",
    );
    expect(focused).toHaveAttribute("data-focused", "true");
    const sibling = screen.getByTestId("rater-bar-chart-bar-frame");
    expect(sibling.getAttribute("class")).toMatch(/is-dimmed/);
  });

  it("data-focused-key on container reflects the focused key", () => {
    render(<BarChart data={CATEGORICAL_DATA} focusedKey="frame" />);
    expect(screen.getByTestId("rater-bar-chart")).toHaveAttribute(
      "data-focused-key",
      "frame",
    );
  });

  it("onHoverChange fires", () => {
    const onHover = vi.fn();
    render(
      <BarChart data={CATEGORICAL_DATA} onHoverChange={onHover} />,
    );
    const bar = screen.getByTestId("rater-bar-chart-bar-fire_resistive");
    fireEvent.mouseEnter(bar);
    expect(onHover).toHaveBeenLastCalledWith("fire_resistive");
    fireEvent.mouseLeave(bar);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});

describe("<BarChart> value labels (PR 45.10 — hover/focus-only)", () => {
  it("does NOT render value text by default", () => {
    // PR 45.10 — Hover-only: a bar at rest only shows its color +
    // gradient. The previous always-on behavior caused the
    // "1.0505050505" smush at dense series (user-reported screenshot
    // bug at 27 NTEE levels).
    render(<BarChart data={CATEGORICAL_DATA} />);
    const bar = screen.getByTestId("rater-bar-chart-bar-fire_resistive");
    expect(bar.textContent).not.toContain("0.78");
  });

  it("renders the value inline when the bar is focused", () => {
    render(<BarChart data={CATEGORICAL_DATA} focusedKey="fire_resistive" />);
    const bar = screen.getByTestId("rater-bar-chart-bar-fire_resistive");
    expect(bar.textContent).toContain("0.78");
  });

  it("renders the value when the user hovers a bar (internal hover state)", () => {
    render(<BarChart data={CATEGORICAL_DATA} />);
    const bar = screen.getByTestId("rater-bar-chart-bar-fire_resistive");
    expect(bar.textContent).not.toContain("0.78");
    fireEvent.mouseEnter(bar);
    expect(bar.textContent).toContain("0.78");
    fireEvent.mouseLeave(bar);
    expect(bar.textContent).not.toContain("0.78");
  });
});

describe("<BarChart> Brief 45 PR 45.3 — sort + gradient + identity label", () => {
  // Helper to read the rendered SVG bar X positions in DOM order.
  // `rater-bar-chart-bar-{key}` testids only appear on bar <g>s (NOT
  // bar-rect or x-label-*), so the prefix strip is unambiguous.
  function getBarXPositions(): Array<{ key: string; x: number }> {
    const PREFIX = "rater-bar-chart-bar-";
    const all = Array.from(
      document.querySelectorAll(`g[data-testid^="${PREFIX}"]`),
    );
    return all.map((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      const key = id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id;
      const rect = el.querySelector(".rater-bar-chart-bar-rect");
      const x = Number(rect?.getAttribute("x") ?? "0");
      return { key, x };
    });
  }

  it("defaults to sortMode='value-desc' (highest at the left)", () => {
    render(
      <BarChart
        data={[
          { key: "a", label: "A", value: 0.8 },
          { key: "b", label: "B", value: 1.3 },
          { key: "c", label: "C", value: 1.0 },
        ]}
      />,
    );
    const positions = getBarXPositions().sort((a, b) => a.x - b.x);
    expect(positions.map((p) => p.key)).toEqual(["b", "c", "a"]);
  });

  it("sortMode='value-asc' puts the lowest at the left", () => {
    render(
      <BarChart
        sortMode="value-asc"
        data={[
          { key: "a", label: "A", value: 0.8 },
          { key: "b", label: "B", value: 1.3 },
          { key: "c", label: "C", value: 1.0 },
        ]}
      />,
    );
    const positions = getBarXPositions().sort((a, b) => a.x - b.x);
    expect(positions.map((p) => p.key)).toEqual(["a", "c", "b"]);
  });

  it("sortMode='label-asc' orders alphabetically by label", () => {
    render(
      <BarChart
        sortMode="label-asc"
        data={[
          { key: "a", label: "Charlie", value: 0.8 },
          { key: "b", label: "Alpha", value: 1.3 },
          { key: "c", label: "Bravo", value: 1.0 },
        ]}
      />,
    );
    const positions = getBarXPositions().sort((a, b) => a.x - b.x);
    expect(positions.map((p) => p.key)).toEqual(["b", "c", "a"]);
  });

  it("sortMode='given' preserves the input order", () => {
    render(
      <BarChart
        sortMode="given"
        data={[
          { key: "x1", label: "X1", value: 0.8 },
          { key: "y2", label: "Y2", value: 1.3 },
          { key: "z3", label: "Z3", value: 1.0 },
        ]}
      />,
    );
    const positions = getBarXPositions().sort((a, b) => a.x - b.x);
    expect(positions.map((p) => p.key)).toEqual(["x1", "y2", "z3"]);
  });

  it("paints bars inline via the continuous gradient", () => {
    render(
      <BarChart
        data={[
          { key: "high", label: "High", value: 1.5 },
          { key: "low", label: "Low", value: 0.6 },
          { key: "mid", label: "Mid", value: 1.0 },
        ]}
      />,
    );
    const highRect = document
      .querySelector("[data-testid='rater-bar-chart-bar-high'] .rater-bar-chart-bar-rect");
    const lowRect = document
      .querySelector("[data-testid='rater-bar-chart-bar-low'] .rater-bar-chart-bar-rect");
    const midRect = document
      .querySelector("[data-testid='rater-bar-chart-bar-mid'] .rater-bar-chart-bar-rect");
    // High (value 1.5) — orange-500 anchor on the gradient
    expect(highRect?.getAttribute("fill")).toBe("#f97316");
    // Mid (value 1.0) — neutral
    expect(midRect?.getAttribute("fill")).toBe("#d4d4d8");
    // Low (value 0.6) — between azure-300 and azure-500, hex string
    expect(lowRect?.getAttribute("fill")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("renders the '= identity' label at the right of the baseline", () => {
    render(
      <BarChart
        data={[
          { key: "a", label: "A", value: 1.1 },
          { key: "b", label: "B", value: 0.9 },
        ]}
      />,
    );
    const id = screen.getByTestId("rater-bar-chart-identity-label");
    expect(id.textContent).toBe("= identity");
  });
});

describe("<BarChart> filed overlay (Brief 34 PR 34.6)", () => {
  it("renders a filed-tick overlay when filedValues is provided", () => {
    render(
      <BarChart
        data={CATEGORICAL_DATA}
        filedValues={new Map<string, number>([["frame", 0.95]])}
      />,
    );
    expect(
      screen.getByTestId("rater-bar-chart-filed-overlay"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-bar-chart-filed-tick-frame"),
    ).toBeInTheDocument();
  });

  it("does NOT render the overlay when filedValues is omitted", () => {
    render(<BarChart data={CATEGORICAL_DATA} />);
    expect(
      screen.queryByTestId("rater-bar-chart-filed-overlay"),
    ).not.toBeInTheDocument();
  });
});
