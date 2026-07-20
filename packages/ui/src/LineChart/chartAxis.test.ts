/**
 * chartAxis tests — Brief 34 PR 34.1.
 */

import { describe, expect, it } from "vitest";
import {
  computeYTicks,
  computeXPositions,
  pickVisibleXLabels,
  pickValueLabelIndices,
  truncateLabel,
  valueToY,
  formatTickLabel,
  DEFAULT_BASELINE,
  PLOT_INSET,
  CHART_VIEWBOX,
} from "./chartAxis";

describe("computeYTicks", () => {
  it("returns a default range when values is empty", () => {
    const result = computeYTicks([]);
    expect(result.ticks.length).toBeGreaterThanOrEqual(4);
    // Baseline (1.0) should be one of the ticks
    expect(result.ticks.some((t) => t.value === 1)).toBe(true);
  });

  it("brackets the data range with the baseline included", () => {
    const { ticks, min, max } = computeYTicks([0.85, 0.92, 1.05, 1.18], 1);
    expect(min).toBeLessThanOrEqual(0.85);
    expect(max).toBeGreaterThanOrEqual(1.18);
    expect(ticks.some((t) => Math.abs(t.value - 1) < 1e-6)).toBe(true);
  });

  it("renders 4-6 ticks for typical factor-table ranges", () => {
    const { ticks } = computeYTicks([0.85, 0.92, 1.05, 1.18]);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(8);
  });

  it("formatTickLabel strips trailing zeros", () => {
    expect(formatTickLabel(1)).toBe("1");
    expect(formatTickLabel(1.25)).toBe("1.25");
    expect(formatTickLabel(0.875)).toBe("0.875");
    expect(formatTickLabel(0)).toBe("0");
  });
});

describe("valueToY", () => {
  it("maps min to bottom of plot, max to top", () => {
    const minY = valueToY(0, 0, 10);
    const maxY = valueToY(10, 0, 10);
    expect(minY).toBeGreaterThan(maxY); // SVG y grows downward
    expect(maxY).toBe(PLOT_INSET.top);
  });

  it("returns the plot midpoint when range is zero", () => {
    const y = valueToY(5, 5, 5);
    const plotHeight =
      CHART_VIEWBOX.height - PLOT_INSET.top - PLOT_INSET.bottom;
    expect(y).toBe(PLOT_INSET.top + plotHeight / 2);
  });
});

describe("computeXPositions", () => {
  it("returns one position per data point", () => {
    const positions = computeXPositions(5);
    expect(positions.length).toBe(5);
  });

  it("each position has a center within the plot region", () => {
    const positions = computeXPositions(3);
    const plotWidth =
      CHART_VIEWBOX.width - PLOT_INSET.left - PLOT_INSET.right;
    for (const p of positions) {
      expect(p.center).toBeGreaterThanOrEqual(PLOT_INSET.left);
      expect(p.center).toBeLessThanOrEqual(PLOT_INSET.left + plotWidth);
    }
  });

  it("returns empty array for count=0", () => {
    expect(computeXPositions(0)).toEqual([]);
  });
});

describe("pickVisibleXLabels", () => {
  it("returns every index when labels fit", () => {
    const labels = ["a", "b", "c"];
    const visible = pickVisibleXLabels(labels, 100);
    expect(visible).toEqual([0, 1, 2]);
  });

  it("drops some indices when labels overflow", () => {
    // 12 labels in a small slot — many will collide.
    const labels = Array.from({ length: 12 }, (_, i) => `label_${i}`);
    const visible = pickVisibleXLabels(labels, 20);
    expect(visible.length).toBeLessThan(12);
    expect(visible[0]).toBe(0);
  });

  it("returns empty array for empty labels", () => {
    expect(pickVisibleXLabels([], 100)).toEqual([]);
  });
});

describe("DEFAULT_BASELINE", () => {
  it("is exactly 1 (multiplicative identity)", () => {
    expect(DEFAULT_BASELINE).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// Brief 45 PR 45.9 — Label-collision helpers
// ─────────────────────────────────────────────────────────────────

describe("truncateLabel (PR 45.9)", () => {
  it("returns the input unchanged when length <= maxChars", () => {
    expect(truncateLabel("short", 14)).toBe("short");
    expect(truncateLabel("exactlyFourteen", 15)).toBe("exactlyFourteen");
  });

  it("appends an ellipsis when truncating", () => {
    expect(truncateLabel("Community Improvement", 14)).toBe("Community Imp…");
    expect(truncateLabel("Religion-Related", 8)).toBe("Religio…");
  });

  it("defaults maxChars to 14", () => {
    expect(truncateLabel("Community Improvement")).toBe("Community Imp…");
  });

  it("handles edge cases — empty string, maxChars=1", () => {
    expect(truncateLabel("", 14)).toBe("");
    // Implementation floors the keep-count at 1 so the truncated
    // value still surfaces SOMETHING; with maxChars=1 the result
    // is "X…" rather than just "…" (which would be ambiguous).
    expect(truncateLabel("XYZ", 1)).toBe("X…");
  });

  it("is idempotent — truncating twice with same maxChars matches single truncation", () => {
    const once = truncateLabel("Community Improvement", 14);
    const twice = truncateLabel(once, 14);
    expect(twice).toBe(once);
  });
});

describe("pickValueLabelIndices (PR 45.9 — Q6 top-K filter)", () => {
  it("returns empty set for empty values", () => {
    const result = pickValueLabelIndices([], 1);
    expect(result.size).toBe(0);
  });

  it("labels EVERY index when values <= denseThreshold (default 10)", () => {
    const values = [0.9, 1.0, 1.1, 1.2, 1.3];
    const result = pickValueLabelIndices(values, 1);
    expect(result.size).toBe(5);
    for (let i = 0; i < 5; i += 1) expect(result.has(i)).toBe(true);
  });

  it("filters to top-K by deviation when values > denseThreshold", () => {
    // 11 values; 10 are at exactly 1.0 (zero deviation), 1 is at 1.5
    // (deviation 0.5). The default K=10 picks 10 indices — the
    // 0.5-deviation outlier + 9 of the zero-deviation ones (ties
    // broken by lowest index first).
    const values = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.5];
    const result = pickValueLabelIndices(values, 1);
    expect(result.size).toBe(10);
    // The outlier must be included.
    expect(result.has(10)).toBe(true);
  });

  it("ranks by absolute deviation (negative deviations matter)", () => {
    // 15 values, baseline 1.0. Most are at 1.0; spread the strongest
    // deviations across negative + positive directions.
    const values = [
      1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, // 8 baseline
      0.3, // |dev| = 0.7
      0.6, // |dev| = 0.4
      1.4, // |dev| = 0.4
      1.7, // |dev| = 0.7
      1.0, // baseline
      0.2, // |dev| = 0.8
      1.8, // |dev| = 0.8
    ];
    const result = pickValueLabelIndices(values, 1, 4);
    expect(result.size).toBe(4);
    // The 4 most-deviant indices should be 13 (0.2 → 0.8), 14 (1.8 → 0.8),
    // 8 (0.3 → 0.7), 11 (1.7 → 0.7).
    expect(result.has(13)).toBe(true);
    expect(result.has(14)).toBe(true);
    expect(result.has(8)).toBe(true);
    expect(result.has(11)).toBe(true);
  });

  it("ties break on lower index first", () => {
    // 11 identical values. Default K=10 picks the first 10 (indices 0..9).
    const values = [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];
    const result = pickValueLabelIndices(values, 1);
    expect(result.size).toBe(10);
    expect(result.has(10)).toBe(false);
    for (let i = 0; i <= 9; i += 1) expect(result.has(i)).toBe(true);
  });

  it("honors a custom topK + denseThreshold", () => {
    const values = [1.0, 1.5, 1.2, 1.8, 0.7, 1.1];
    // denseThreshold = 4 — 6 values forces top-K filter
    // topK = 2 — only the 2 most-deviant
    const result = pickValueLabelIndices(values, 1, 2, 4);
    expect(result.size).toBe(2);
    // Index 3 (1.8 → 0.8), index 4 (0.7 → 0.3)... wait, 1.5 → 0.5, 1.8 → 0.8.
    // Top 2 by deviation: 3 (1.8 → 0.8) + 1 (1.5 → 0.5).
    expect(result.has(3)).toBe(true);
    expect(result.has(1)).toBe(true);
  });
});
