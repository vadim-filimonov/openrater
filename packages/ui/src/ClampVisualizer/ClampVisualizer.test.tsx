/**
 * <ClampVisualizer> tests (Phase H.6).
 *
 * Covers the pure helpers (computeXBounds, factorToX) + the SVG
 * primitive's rendering invariants. The actual visual look is
 * verified in browser preview; these tests pin the data-driven
 * behavior the actuary depends on.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ClampVisualizer,
  computeXBounds,
  factorToX,
} from "./ClampVisualizer";

describe("computeXBounds", () => {
  it("uses the default 0.5-1.5 range when values fit inside", () => {
    expect(computeXBounds(0.85, 1.25, undefined, undefined)).toEqual({
      xMin: 0.5,
      xMax: 1.5,
    });
  });

  it("auto-extends below 0.5 when min_factor sits outside", () => {
    const { xMin, xMax } = computeXBounds(0.3, 1.25, undefined, undefined);
    expect(xMax).toBe(1.5);
    expect(xMin).toBeLessThan(0.3);
    expect(xMin).toBeGreaterThan(0.27); // 0.3 - (0.5 - 0.3) * 0.1 = 0.28
  });

  it("auto-extends above 1.5 when max_factor sits outside", () => {
    const { xMin, xMax } = computeXBounds(0.85, 2.0, undefined, undefined);
    expect(xMin).toBe(0.5);
    expect(xMax).toBeGreaterThan(2.0);
    expect(xMax).toBeLessThan(2.06); // 2.0 + (2.0 - 1.5) * 0.1 = 2.05
  });

  it("extends the range to include fallback_factor when it sits outside", () => {
    const { xMin, xMax } = computeXBounds(0.85, 1.25, 0.4, undefined);
    expect(xMin).toBeLessThan(0.5);
    expect(xMax).toBe(1.5);
  });

  it("extends the range to include actual_factor when it sits outside", () => {
    const { xMin, xMax } = computeXBounds(0.85, 1.25, undefined, 1.8);
    expect(xMin).toBe(0.5);
    expect(xMax).toBeGreaterThan(1.5);
  });
});

describe("factorToX", () => {
  it("maps the min of the range to padLeft", () => {
    expect(factorToX(0.5, 0.5, 1.5, 200, 10)).toBe(10);
  });

  it("maps the max of the range to padLeft + width", () => {
    expect(factorToX(1.5, 0.5, 1.5, 200, 10)).toBe(210);
  });

  it("maps the midpoint to padLeft + half width", () => {
    expect(factorToX(1.0, 0.5, 1.5, 200, 10)).toBe(110);
  });

  it("returns the center when range collapses to zero", () => {
    expect(factorToX(1.0, 1.0, 1.0, 200, 10)).toBe(110);
  });
});

describe("ClampVisualizer", () => {
  it("renders the clamp band + axis + baseline for a typical envelope", () => {
    render(<ClampVisualizer minFactor={0.85} maxFactor={1.25} />);
    expect(screen.getByTestId("rater-clamp-visualizer-band")).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-clamp-visualizer-baseline"),
    ).toBeInTheDocument();
  });

  it("renders the fallback marker when fallback_factor is provided", () => {
    render(
      <ClampVisualizer
        minFactor={0.85}
        maxFactor={1.25}
        fallbackFactor={0.95}
      />,
    );
    expect(
      screen.getByTestId("rater-clamp-visualizer-fallback"),
    ).toBeInTheDocument();
  });

  it("omits the fallback marker when fallback_factor is undefined", () => {
    render(<ClampVisualizer minFactor={0.85} maxFactor={1.25} />);
    expect(
      screen.queryByTestId("rater-clamp-visualizer-fallback"),
    ).not.toBeInTheDocument();
  });

  it("renders the actual factor marker when actual_factor is provided", () => {
    render(
      <ClampVisualizer minFactor={0.85} maxFactor={1.25} actualFactor={1.10} />,
    );
    expect(
      screen.getByTestId("rater-clamp-visualizer-actual"),
    ).toBeInTheDocument();
  });

  it("flags the invalid state when min > max + suppresses the band", () => {
    render(<ClampVisualizer minFactor={1.25} maxFactor={0.85} />);
    // The wrapping div carries the is-invalid modifier class
    const wrapper = screen.getByTestId("rater-clamp-visualizer");
    expect(wrapper.classList.contains("is-invalid")).toBe(true);
    // Warning text surfaces
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid/i);
    // The shaded band is suppressed
    expect(
      screen.queryByTestId("rater-clamp-visualizer-band"),
    ).not.toBeInTheDocument();
  });

  it("uses an aria-label that summarizes the envelope for screen readers", () => {
    render(
      <ClampVisualizer
        minFactor={0.85}
        maxFactor={1.25}
        fallbackFactor={0.95}
      />,
    );
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/clamp envelope/i),
    );
    expect(svg.getAttribute("aria-label")).toMatch(/0\.85/);
    expect(svg.getAttribute("aria-label")).toMatch(/1\.25/);
    expect(svg.getAttribute("aria-label")).toMatch(/fallback/i);
  });
});
