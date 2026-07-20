/**
 * <LineChart> tests — Brief 34 PR 34.1.
 *
 * Covers:
 *   • Empty state when data is empty
 *   • SVG renders with viewBox + polyline + markers
 *   • One marker per datum
 *   • Y-axis ticks include the baseline
 *   • X-axis labels render (subject to collision avoidance)
 *   • Outlier keys get the is-outlier class + callout line
 *   • focusedKey prop dims siblings + grows the focused marker
 *   • onHoverChange fires on marker hover
 *   • Value labels render above each marker
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LineChart } from "./LineChart";

const BANDED_DATA = [
  { key: "band_0_5", label: "0–5", value: 0.85 },
  { key: "band_5_15", label: "5–15", value: 0.92 },
  { key: "band_15_30", label: "15–30", value: 0.88 },
  { key: "band_30_50", label: "30–50", value: 1.05 },
  { key: "band_50_100", label: "50–100", value: 1.18 },
];

describe("<LineChart> mount", () => {
  it("renders the empty state when data is empty", () => {
    render(<LineChart data={[]} />);
    expect(screen.getByTestId("rater-line-chart")).toHaveClass(
      "rater-line-chart--empty",
    );
    expect(screen.getByText("No data to plot")).toBeInTheDocument();
  });

  it("renders an SVG with the polyline for non-empty data", () => {
    render(<LineChart data={BANDED_DATA} />);
    expect(screen.getByTestId("rater-line-chart-svg")).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-line-chart-polyline"),
    ).toBeInTheDocument();
  });

  it("renders one marker group per datum", () => {
    render(<LineChart data={BANDED_DATA} />);
    for (const d of BANDED_DATA) {
      expect(
        screen.getByTestId(`rater-line-chart-point-${d.key}`),
      ).toBeInTheDocument();
    }
  });

  it("polyline points string matches the data shape", () => {
    render(<LineChart data={BANDED_DATA} />);
    const polyline = screen.getByTestId(
      "rater-line-chart-polyline",
    ) as unknown as SVGPolylineElement;
    const points = polyline.getAttribute("points");
    expect(points).not.toBeNull();
    // 5 points → 5 comma-separated pairs
    const pairs = points!.trim().split(/\s+/);
    expect(pairs.length).toBe(5);
  });
});

describe("<LineChart> axes", () => {
  it("renders y-axis ticks that include the baseline value", () => {
    render(<LineChart data={BANDED_DATA} baseline={1} />);
    // The baseline tick has value 1
    expect(
      screen.getByTestId("rater-line-chart-y-tick-1"),
    ).toBeInTheDocument();
  });

  it("renders x-axis labels for each datum (small dataset, no collision)", () => {
    render(<LineChart data={BANDED_DATA} />);
    // Use first datum — collision avoidance should keep at least the first label
    expect(
      screen.getByTestId("rater-line-chart-x-label-band_0_5"),
    ).toBeInTheDocument();
  });
});

describe("<LineChart> outliers", () => {
  it("marks outlier points with is-outlier class + data-outlier attr", () => {
    render(
      <LineChart
        data={BANDED_DATA}
        outlierKeys={new Set(["band_15_30"])}
      />,
    );
    const outlier = screen.getByTestId(
      "rater-line-chart-point-band_15_30",
    );
    expect(outlier).toHaveAttribute("data-outlier", "true");
    expect(outlier.getAttribute("class")).toMatch(/is-outlier/);
  });

  it("non-outlier points have data-outlier=false", () => {
    render(
      <LineChart
        data={BANDED_DATA}
        outlierKeys={new Set(["band_15_30"])}
      />,
    );
    expect(
      screen.getByTestId("rater-line-chart-point-band_0_5"),
    ).toHaveAttribute("data-outlier", "false");
  });

  it("x-label gets is-outlier class for outlier rows", () => {
    render(
      <LineChart
        data={BANDED_DATA}
        outlierKeys={new Set(["band_15_30"])}
      />,
    );
    const xLabel = screen.getByTestId(
      "rater-line-chart-x-label-band_15_30",
    );
    expect(xLabel.getAttribute("class") ?? "").toMatch(/is-outlier/);
  });
});

describe("<LineChart> focus + hover", () => {
  it("focusedKey marks that point as focused + dims siblings", () => {
    render(
      <LineChart data={BANDED_DATA} focusedKey="band_15_30" />,
    );
    const focused = screen.getByTestId(
      "rater-line-chart-point-band_15_30",
    );
    expect(focused).toHaveAttribute("data-focused", "true");
    const sibling = screen.getByTestId(
      "rater-line-chart-point-band_0_5",
    );
    expect(sibling.getAttribute("class")).toMatch(/is-dimmed/);
  });

  it("data-focused-key on container reflects the focused key", () => {
    render(<LineChart data={BANDED_DATA} focusedKey="band_30_50" />);
    expect(screen.getByTestId("rater-line-chart")).toHaveAttribute(
      "data-focused-key",
      "band_30_50",
    );
  });

  it("onHoverChange fires with the key on mouseEnter and null on mouseLeave", () => {
    const onHover = vi.fn();
    render(<LineChart data={BANDED_DATA} onHoverChange={onHover} />);
    const point = screen.getByTestId("rater-line-chart-point-band_5_15");
    fireEvent.mouseEnter(point);
    expect(onHover).toHaveBeenLastCalledWith("band_5_15");
    fireEvent.mouseLeave(point);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("hovering with no focusedKey applies local hover state", () => {
    render(<LineChart data={BANDED_DATA} />);
    const point = screen.getByTestId("rater-line-chart-point-band_5_15");
    fireEvent.mouseEnter(point);
    // Container's data-focused-key reflects local hover
    expect(screen.getByTestId("rater-line-chart")).toHaveAttribute(
      "data-focused-key",
      "band_5_15",
    );
  });
});

describe("<LineChart> value labels (PR 45.10 — hover/focus-only)", () => {
  it("does NOT render value text by default", () => {
    // PR 45.10 — Hover-only: a marker at rest only shows its color
    // + size. Always-on labels at dense series produced "1.21.21.2"
    // smush (user-reported NTEE 27-level bug).
    render(<LineChart data={BANDED_DATA} />);
    const group = screen.getByTestId("rater-line-chart-point-band_0_5");
    expect(group.textContent).not.toContain("0.85");
  });

  it("renders the formatted value when the marker is focused", () => {
    render(<LineChart data={BANDED_DATA} focusedKey="band_0_5" />);
    const group = screen.getByTestId("rater-line-chart-point-band_0_5");
    expect(group.textContent).toContain("0.85");
  });

  it("renders the value on hover (internal hover state)", () => {
    render(<LineChart data={BANDED_DATA} />);
    const group = screen.getByTestId("rater-line-chart-point-band_0_5");
    expect(group.textContent).not.toContain("0.85");
    fireEvent.mouseEnter(group);
    expect(group.textContent).toContain("0.85");
    fireEvent.mouseLeave(group);
    expect(group.textContent).not.toContain("0.85");
  });
});

describe("<LineChart> selection + brush (Brief 34 PR 34.5)", () => {
  it("selectedKeys marks the matching marker with is-selected", () => {
    render(
      <LineChart
        data={BANDED_DATA}
        selectedKeys={new Set(["band_5_15", "band_15_30"])}
      />,
    );
    expect(
      screen.getByTestId("rater-line-chart-point-band_5_15"),
    ).toHaveClass("is-selected");
    expect(
      screen.getByTestId("rater-line-chart-point-band_15_30"),
    ).toHaveClass("is-selected");
    expect(
      screen.getByTestId("rater-line-chart-point-band_0_5"),
    ).not.toHaveClass("is-selected");
  });

  it("renders a selection-region rect spanning the selected datums", () => {
    render(
      <LineChart
        data={BANDED_DATA}
        selectedKeys={new Set(["band_5_15", "band_15_30"])}
      />,
    );
    expect(
      screen.getByTestId("rater-line-chart-selection-region"),
    ).toBeInTheDocument();
  });

  it("no selection-region rendered when selectedKeys is empty", () => {
    render(<LineChart data={BANDED_DATA} selectedKeys={new Set()} />);
    expect(
      screen.queryByTestId("rater-line-chart-selection-region"),
    ).not.toBeInTheDocument();
  });

  // NOTE: full brush + click gestures (pointerdown→move→up + pointer
  // capture) rely on JSDOM's PointerEvent support, which is incomplete
  // (button/viewBox quirks). The brush math is covered by
  // brushSelect.test.ts as pure-function tests; the wiring is exercised
  // here via prop presence + the data-brushing attribute, and end-to-
  // end via Playwright as a follow-up.

  it("data-brushing attribute is 'false' when no brush is active", () => {
    render(
      <LineChart data={BANDED_DATA} onBrushSelect={vi.fn()} />,
    );
    expect(screen.getByTestId("rater-line-chart")).toHaveAttribute(
      "data-brushing",
      "false",
    );
  });

  it("brush rect is NOT rendered when no brush is active", () => {
    render(
      <LineChart data={BANDED_DATA} onBrushSelect={vi.fn()} />,
    );
    expect(
      screen.queryByTestId("rater-line-chart-brush-rect"),
    ).not.toBeInTheDocument();
  });
});

describe("<LineChart> filed overlay (Brief 34 PR 34.6)", () => {
  it("renders a filed-overlay group + dashed polyline when filedValues is provided", () => {
    render(
      <LineChart
        data={BANDED_DATA}
        filedValues={
          new Map<string, number>([
            ["band_0_5", 0.8],
            ["band_5_15", 0.9],
            ["band_15_30", 0.95],
          ])
        }
      />,
    );
    expect(
      screen.getByTestId("rater-line-chart-filed-overlay"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-line-chart-filed-marker-band_0_5"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-line-chart-filed-marker-band_5_15"),
    ).toBeInTheDocument();
  });

  it("skips filed markers for keys absent from the filed map", () => {
    render(
      <LineChart
        data={BANDED_DATA}
        filedValues={new Map<string, number>([["band_0_5", 0.8]])}
      />,
    );
    expect(
      screen.getByTestId("rater-line-chart-filed-marker-band_0_5"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-line-chart-filed-marker-band_5_15"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the overlay when filedValues is omitted", () => {
    render(<LineChart data={BANDED_DATA} />);
    expect(
      screen.queryByTestId("rater-line-chart-filed-overlay"),
    ).not.toBeInTheDocument();
  });
});

describe("<LineChart> Brief 45 PR 45.3 — area fill + identity label + gradient markers", () => {
  it("renders the subtle area path under the line", () => {
    render(<LineChart data={BANDED_DATA} />);
    expect(screen.getByTestId("rater-line-chart-area")).toBeInTheDocument();
  });

  it("does NOT render the area when data has fewer than 2 points", () => {
    render(
      <LineChart
        data={[{ key: "only", label: "Only", value: 1.0 }]}
      />,
    );
    expect(screen.queryByTestId("rater-line-chart-area")).toBeNull();
  });

  it("renders the '= identity' baseline label", () => {
    render(<LineChart data={BANDED_DATA} />);
    const id = screen.getByTestId("rater-line-chart-identity-label");
    expect(id.textContent).toBe("= identity");
  });

  it("paints non-outlier markers with the continuous gradient", () => {
    render(
      <LineChart
        data={[
          { key: "a", label: "A", value: 1.5 }, // → orange-500 anchor
          { key: "b", label: "B", value: 1.0 }, // → neutral
        ]}
      />,
    );
    const aMarker = document
      .querySelector("[data-testid='rater-line-chart-point-a'] .rater-line-chart-marker");
    const bMarker = document
      .querySelector("[data-testid='rater-line-chart-point-b'] .rater-line-chart-marker");
    expect(aMarker?.getAttribute("fill")).toBe("#f97316");
    expect(bMarker?.getAttribute("fill")).toBe("#d4d4d8");
  });

  it("outlier markers keep the CSS-driven danger color (no inline gradient fill)", () => {
    render(
      <LineChart
        data={[
          { key: "a", label: "A", value: 1.0 },
          { key: "b", label: "B", value: 1.5 },
        ]}
        outlierKeys={new Set(["b"])}
      />,
    );
    const bMarker = document
      .querySelector("[data-testid='rater-line-chart-point-b'] .rater-line-chart-marker");
    // Outlier markers leave `fill` unset so the CSS .is-outlier rule wins.
    expect(bMarker?.getAttribute("fill")).toBeNull();
  });
});
