/**
 * Brief 45 PR 45.1 — <FactorVizHeroStrip> tests.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactorVizHeroStrip } from "./FactorVizHeroStrip";
import { computeFactorStats } from "../FactorTableViz/factorStats";

describe("<FactorVizHeroStrip>", () => {
  it("renders three stat cells (Mean, Range, Coverage)", () => {
    render(<FactorVizHeroStrip values={[1.0, 1.1, 0.9]} />);
    expect(screen.getByTestId("rater-factor-viz-hero-strip-mean"))
      .toBeInTheDocument();
    expect(screen.getByTestId("rater-factor-viz-hero-strip-range"))
      .toBeInTheDocument();
    expect(screen.getByTestId("rater-factor-viz-hero-strip-coverage"))
      .toBeInTheDocument();
  });

  it("displays the formatted mean value", () => {
    // Mean of [1.30, 1.10, 1.00, 0.95, 0.85] = 1.04
    render(<FactorVizHeroStrip values={[1.3, 1.1, 1.0, 0.95, 0.85]} />);
    const mean = screen.getByTestId("rater-factor-viz-hero-strip-mean");
    expect(mean.textContent).toContain("1.04");
    expect(mean.textContent).toContain("Mean");
  });

  it("displays the range as [min ... max]", () => {
    render(<FactorVizHeroStrip values={[1.3, 1.1, 1.0, 0.95, 0.85]} />);
    const range = screen.getByTestId("rater-factor-viz-hero-strip-range");
    expect(range.textContent).toContain("0.85");
    expect(range.textContent).toContain("1.3");
    expect(range.textContent).toContain("Range");
  });

  it("displays coverage as populated / total", () => {
    render(
      <FactorVizHeroStrip
        values={[1.0, undefined, 1.2, undefined, undefined]}
      />,
    );
    const coverage = screen.getByTestId("rater-factor-viz-hero-strip-coverage");
    expect(coverage.textContent).toContain("2");
    expect(coverage.textContent).toContain("5");
    expect(coverage.textContent).toContain("40%");
  });

  it("flags the mean as near-identity when within ±2% of baseline", () => {
    // Mean 1.01 — within 2% of 1.0
    render(<FactorVizHeroStrip values={[0.99, 1.0, 1.03, 1.02]} />);
    const mean = screen.getByTestId("rater-factor-viz-hero-strip-mean");
    expect(mean.getAttribute("data-flag")).toBe("near-identity");
    expect(mean.textContent).toContain("at identity");
  });

  it("flags the mean as skew-high when more than +10% over baseline", () => {
    // Mean 1.25 — more than 10% above
    render(<FactorVizHeroStrip values={[1.2, 1.3, 1.25, 1.25]} />);
    const mean = screen.getByTestId("rater-factor-viz-hero-strip-mean");
    expect(mean.getAttribute("data-flag")).toBe("skew-high");
    expect(mean.textContent).toContain("+25% vs identity");
  });

  it("flags the mean as skew-low when more than 10% below baseline", () => {
    // Mean ≈ 0.5 — way below
    render(<FactorVizHeroStrip values={[0.4, 0.5, 0.5, 0.6]} />);
    const mean = screen.getByTestId("rater-factor-viz-hero-strip-mean");
    expect(mean.getAttribute("data-flag")).toBe("skew-low");
    expect(mean.textContent).toContain("-50% vs identity");
  });

  it("flags coverage as full at 100% with the complete detail", () => {
    render(<FactorVizHeroStrip values={[1.0, 1.1, 1.2]} />);
    const cov = screen.getByTestId("rater-factor-viz-hero-strip-coverage");
    expect(cov.className).toContain("is-full");
    expect(cov.textContent).toContain("complete");
  });

  it("flags coverage as partial below 100% with the needs-authoring hint", () => {
    render(<FactorVizHeroStrip values={[1.0, undefined, 1.2]} />);
    const cov = screen.getByTestId("rater-factor-viz-hero-strip-coverage");
    expect(cov.className).toContain("is-partial");
    expect(cov.textContent).toContain("needs authoring");
  });

  it("flags coverage as empty when there are no cells at all", () => {
    render(<FactorVizHeroStrip values={[]} />);
    const cov = screen.getByTestId("rater-factor-viz-hero-strip-coverage");
    expect(cov.className).toContain("is-empty");
    expect(cov.textContent).toContain("no cells");
  });

  it("renders em dash for mean / range when no cells are populated", () => {
    render(<FactorVizHeroStrip values={[undefined, undefined]} />);
    const mean = screen.getByTestId("rater-factor-viz-hero-strip-mean");
    expect(mean.textContent).toContain("—");
    const range = screen.getByTestId("rater-factor-viz-hero-strip-range");
    expect(range.textContent).toContain("—");
  });

  it("accepts a precomputed FactorStats instead of raw values", () => {
    const stats = computeFactorStats([1.3, 1.1, 1.0, 0.95, 0.85]);
    render(<FactorVizHeroStrip stats={stats} />);
    const mean = screen.getByTestId("rater-factor-viz-hero-strip-mean");
    expect(mean.textContent).toContain("1.04");
  });

  it("prefers `stats` over `values` when both are supplied", () => {
    const stats = computeFactorStats([10, 10, 10, 10]); // mean = 10
    render(<FactorVizHeroStrip stats={stats} values={[1, 1, 1]} />);
    const mean = screen.getByTestId("rater-factor-viz-hero-strip-mean");
    expect(mean.textContent).toContain("10");
  });

  it("renders no chart-mode-specific text — UI-agnostic on what comes below", () => {
    // The hero is independent of the chart mode underneath it.
    const { container } = render(<FactorVizHeroStrip values={[1.0, 1.1]} />);
    expect(container.textContent).not.toContain("bar");
    expect(container.textContent).not.toContain("line");
  });

  it("respects a custom testId for downstream selection", () => {
    render(<FactorVizHeroStrip values={[1.0]} testId="custom-hero" />);
    expect(screen.getByTestId("custom-hero")).toBeInTheDocument();
    expect(screen.getByTestId("custom-hero-mean")).toBeInTheDocument();
    expect(screen.getByTestId("custom-hero-range")).toBeInTheDocument();
    expect(screen.getByTestId("custom-hero-coverage")).toBeInTheDocument();
  });

  it("exposes data-coverage attribute for downstream CSS / instrumentation", () => {
    render(<FactorVizHeroStrip values={[1.0, undefined, undefined, undefined]} />);
    const cov = screen.getByTestId("rater-factor-viz-hero-strip-coverage");
    expect(cov.getAttribute("data-coverage")).toBe("0.2500");
  });

  it("honors a non-1.0 baseline when classifying the mean", () => {
    // Mean = 1.0; baseline = 0.5 → ratio = 2.0 → +100% skew-high
    render(<FactorVizHeroStrip values={[1.0, 1.0, 1.0]} baseline={0.5} />);
    const mean = screen.getByTestId("rater-factor-viz-hero-strip-mean");
    expect(mean.getAttribute("data-flag")).toBe("skew-high");
    expect(mean.textContent).toContain("+100% vs identity");
  });
});
