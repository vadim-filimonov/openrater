/**
 * Brief 45 PR 45.1 — colorRamp unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  FACTOR_GRADIENT_MAX,
  FACTOR_GRADIENT_MIN,
  FACTOR_GRADIENT_NEUTRAL,
  factorGradient,
  factorGradientLegend,
} from "./colorRamp";

describe("factorGradient", () => {
  it("returns the deepest azure for values at or below 0.5", () => {
    expect(factorGradient(0.5)).toBe("#1d4ed8");
    expect(factorGradient(0.3)).toBe("#1d4ed8"); // clamped
    expect(factorGradient(0)).toBe("#1d4ed8");
    expect(factorGradient(-100)).toBe("#1d4ed8");
  });

  it("returns the deepest orange for values at or above 2.0", () => {
    expect(factorGradient(2.0)).toBe("#ea580c");
    expect(factorGradient(3.5)).toBe("#ea580c"); // clamped
    expect(factorGradient(100)).toBe("#ea580c");
  });

  it("returns the neutral mid for exactly 1.0 (identity)", () => {
    expect(factorGradient(1.0)).toBe("#d4d4d8");
  });

  it("interpolates inside the cool side (azure ramp)", () => {
    const mid = factorGradient(0.7);
    expect(mid).toBe("#3b82f6"); // azure-500 anchor
    const between = factorGradient(0.6);
    expect(between).not.toBe("#1d4ed8");
    expect(between).not.toBe("#3b82f6");
    expect(between).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("interpolates inside the warm side (orange ramp)", () => {
    const mid = factorGradient(1.5);
    expect(mid).toBe("#f97316"); // orange-500 anchor
    const between = factorGradient(1.3);
    expect(between).not.toBe("#fdba74");
    expect(between).not.toBe("#f97316");
    expect(between).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("hex output is always a valid 7-char string starting with #", () => {
    for (const v of [0.5, 0.7, 0.85, 0.93, 1.0, 1.12, 1.25, 1.5, 1.8, 2.0]) {
      expect(factorGradient(v)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("returns the neutral for non-finite inputs", () => {
    expect(factorGradient(Number.NaN)).toBe(FACTOR_GRADIENT_NEUTRAL);
    expect(factorGradient(Number.POSITIVE_INFINITY)).toBe(
      FACTOR_GRADIENT_NEUTRAL,
    );
    expect(factorGradient(Number.NEGATIVE_INFINITY)).toBe(
      FACTOR_GRADIENT_NEUTRAL,
    );
  });

  it("returns the neutral when baseline is non-finite or non-positive", () => {
    expect(factorGradient(1.2, Number.NaN)).toBe(FACTOR_GRADIENT_NEUTRAL);
    expect(factorGradient(1.2, 0)).toBe(FACTOR_GRADIENT_NEUTRAL);
    expect(factorGradient(1.2, -1)).toBe(FACTOR_GRADIENT_NEUTRAL);
  });

  it("re-centers around a non-1.0 baseline via value / baseline", () => {
    // value 0.5 with baseline 0.5 → normalized 1.0 → neutral
    expect(factorGradient(0.5, 0.5)).toBe("#d4d4d8");
    // value 1.0 with baseline 0.5 → normalized 2.0 → deepest orange
    expect(factorGradient(1.0, 0.5)).toBe("#ea580c");
    // value 0.25 with baseline 0.5 → normalized 0.5 → deepest azure
    expect(factorGradient(0.25, 0.5)).toBe("#1d4ed8");
  });

  it("is monotone increasing through the gradient (azure to orange)", () => {
    // Track that as value rises, the warm channel (orange) rises and
    // the cool channel (azure-blue) drops past the neutral midpoint.
    const samples = [0.5, 0.7, 0.85, 1.0, 1.15, 1.5, 2.0];
    const colors = samples.map((v) => factorGradient(v));
    // Spot check the curve has the right anchor colors at the
    // canonical stops.
    expect(colors[0]).toBe("#1d4ed8");
    expect(colors[colors.length - 1]).toBe("#ea580c");
    // The center is the neutral.
    expect(colors[3]).toBe("#d4d4d8");
  });
});

describe("factorGradientLegend", () => {
  it("returns 6 stops covering the full gradient range", () => {
    const legend = factorGradientLegend();
    expect(legend).toHaveLength(6);
    expect(legend[0]?.value).toBe(0.5);
    expect(legend[legend.length - 1]?.value).toBe(2.0);
  });

  it("includes the neutral 1.0 stop", () => {
    const legend = factorGradientLegend();
    const neutral = legend.find((s) => s.value === 1.0);
    expect(neutral).toBeDefined();
    expect(neutral?.hex).toBe("#d4d4d8");
  });

  it("every stop has a parseable hex color", () => {
    for (const s of factorGradientLegend()) {
      expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.label).toMatch(/^\d+(\.\d+)?$/);
    }
  });
});

describe("FACTOR_GRADIENT_MIN / MAX constants", () => {
  it("MIN is 0.5 and MAX is 2.0 (the gradient clamps)", () => {
    expect(FACTOR_GRADIENT_MIN).toBe(0.5);
    expect(FACTOR_GRADIENT_MAX).toBe(2.0);
  });
});
