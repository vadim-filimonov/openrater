/**
 * Brief 45 PR 45.4 — <FactorDistribution> tests.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FactorDistribution } from "./FactorDistribution";
import {
  computeFactorDistribution,
  type FactorDistributionDatum,
} from "../FactorTableViz/factorDistribution";

function gen(n: number): FactorDistributionDatum[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `k${i}`,
    label: `Level ${i}`,
    value: 1.0 + ((i - n / 2) / n) * 1.5,
  }));
}

describe("<FactorDistribution>", () => {
  it("renders the histogram pane + outliers pane", () => {
    const distribution = computeFactorDistribution({ data: gen(50) });
    render(<FactorDistribution distribution={distribution} />);
    expect(
      screen.getByTestId("rater-factor-distribution-histogram"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-factor-distribution-outliers"),
    ).toBeInTheDocument();
  });

  it("renders one bin element per computed bin", () => {
    const distribution = computeFactorDistribution({
      data: gen(50),
      binCount: 7,
    });
    render(<FactorDistribution distribution={distribution} />);
    for (let i = 0; i < 7; i += 1) {
      expect(
        screen.getByTestId(`rater-factor-distribution-bin-${i}`),
      ).toBeInTheDocument();
    }
  });

  it("renders top-5 by default + matches the top outlier keys", () => {
    const distribution = computeFactorDistribution({
      data: [
        { key: "a", label: "A", value: 1.0 },
        { key: "b", label: "B", value: 2.5 },
        { key: "c", label: "C", value: 0.5 },
        { key: "d", label: "D", value: 1.8 },
        { key: "e", label: "E", value: 2.0 },
        { key: "f", label: "F", value: 1.2 },
        { key: "g", label: "G", value: 2.2 },
      ],
    });
    render(<FactorDistribution distribution={distribution} />);
    // Top outliers: b (2.5), g (2.2), e (2.0), d (1.8), f (1.2)
    for (const k of ["b", "g", "e", "d", "f"]) {
      expect(
        screen.getByTestId(`rater-factor-distribution-outlier-${k}`),
      ).toBeInTheDocument();
    }
  });

  it("switches to bottom outliers when the Bottom tab is clicked", () => {
    const distribution = computeFactorDistribution({
      data: [
        { key: "a", label: "A", value: 1.0 },
        { key: "b", label: "B", value: 2.5 },
        { key: "c", label: "C", value: 0.5 },
        { key: "d", label: "D", value: 1.8 },
        { key: "e", label: "E", value: 2.0 },
        { key: "f", label: "F", value: 1.2 },
        { key: "g", label: "G", value: 0.3 },
      ],
    });
    render(<FactorDistribution distribution={distribution} />);
    expect(
      screen.queryByTestId("rater-factor-distribution-outlier-g"),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("rater-factor-distribution-tab-bottom"));
    // Bottom outliers: g (0.3), c (0.5), a (1.0), f (1.2), d (1.8)
    for (const k of ["g", "c", "a", "f", "d"]) {
      expect(
        screen.getByTestId(`rater-factor-distribution-outlier-${k}`),
      ).toBeInTheDocument();
    }
  });

  it("emits onBinClick when a histogram bin is clicked", () => {
    const onBinClick = vi.fn();
    const distribution = computeFactorDistribution({
      data: gen(50),
      binCount: 5,
    });
    render(
      <FactorDistribution
        distribution={distribution}
        onBinClick={onBinClick}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-factor-distribution-bin-2"));
    expect(onBinClick).toHaveBeenCalledWith(2);
  });

  it("emits onOutlierClick when an outlier row is clicked", () => {
    const onOutlierClick = vi.fn();
    const distribution = computeFactorDistribution({
      data: [
        { key: "high", label: "Hi", value: 2.5 },
        { key: "mid", label: "M", value: 1.0 },
      ],
    });
    render(
      <FactorDistribution
        distribution={distribution}
        onOutlierClick={onOutlierClick}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-factor-distribution-outlier-high"),
    );
    expect(onOutlierClick).toHaveBeenCalledWith("high");
  });

  it("renders the 'Show all' link only when outliers don't cover everything", () => {
    const small = computeFactorDistribution({
      data: gen(4),
      outlierCount: 5,
    });
    render(<FactorDistribution distribution={small} />);
    // 4 levels with 5+5 outlier slots — Top covers 4 + Bottom covers 4
    // (overlap) — total 4+4=8 ≥ 4 so the "Show all" suppresses.
    expect(
      screen.queryByTestId("rater-factor-distribution-show-all"),
    ).toBeNull();
  });

  it("renders 'Show all N →' for tables with more levels than outlier-slot count", () => {
    const distribution = computeFactorDistribution({
      data: gen(50),
    });
    render(<FactorDistribution distribution={distribution} />);
    const showAll = screen.getByTestId("rater-factor-distribution-show-all");
    expect(showAll.textContent).toContain("Show all 50");
  });

  it("opens the OutlierDrawer when 'Show all' is clicked + closes when the close button fires", () => {
    const distribution = computeFactorDistribution({
      data: gen(50),
    });
    render(<FactorDistribution distribution={distribution} />);
    fireEvent.click(screen.getByTestId("rater-factor-distribution-show-all"));
    expect(screen.getByTestId("rater-outlier-drawer")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rater-outlier-drawer-close"));
    expect(screen.queryByTestId("rater-outlier-drawer")).toBeNull();
  });

  it("renders the baseline marker when the baseline is inside the domain", () => {
    const distribution = computeFactorDistribution({
      data: [
        { key: "a", label: "A", value: 0.5 },
        { key: "b", label: "B", value: 1.5 },
      ],
    });
    render(
      <FactorDistribution distribution={distribution} baseline={1.0} />,
    );
    expect(
      screen.getByTestId("rater-factor-distribution-baseline"),
    ).toBeInTheDocument();
  });

  it("omits the baseline marker when the baseline is outside the domain", () => {
    const distribution = computeFactorDistribution({
      data: [
        { key: "a", label: "A", value: 0.5 },
        { key: "b", label: "B", value: 0.6 },
      ],
    });
    render(
      <FactorDistribution distribution={distribution} baseline={1.0} />,
    );
    expect(
      screen.queryByTestId("rater-factor-distribution-baseline"),
    ).toBeNull();
  });

  it("displays an empty-state message when the distribution has no data", () => {
    const distribution = computeFactorDistribution({ data: [] });
    render(<FactorDistribution distribution={distribution} />);
    const outliers = screen.getByTestId(
      "rater-factor-distribution-outliers",
    );
    expect(outliers.textContent).toContain("No values to rank.");
  });
});
