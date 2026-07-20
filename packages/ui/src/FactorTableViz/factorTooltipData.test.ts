/**
 * Brief 45 PR 45.2 — factorTooltipData unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  computeFactorTooltipData,
  computePercentile,
  formatDeviationLabel,
  formatPercentileLabel,
} from "./factorTooltipData";

describe("computePercentile", () => {
  it("returns 100 for the max value", () => {
    expect(computePercentile(5, [1, 2, 3, 4, 5])).toBe(100);
  });

  it("returns 20 for the min in a 5-element set (count of ≤ / n)", () => {
    expect(computePercentile(1, [1, 2, 3, 4, 5])).toBe(20);
  });

  it("returns 60 for the median in a 5-element set (3 out of 5 ≤ 3)", () => {
    expect(computePercentile(3, [1, 2, 3, 4, 5])).toBe(60);
  });

  it("returns 50 for an empty population", () => {
    expect(computePercentile(1, [])).toBe(50);
  });

  it("groups ties — identical values share their rank", () => {
    expect(computePercentile(2, [2, 2, 2])).toBe(100);
  });
});

describe("formatPercentileLabel", () => {
  it("returns 'highest' for 100 and 'lowest' for 0", () => {
    expect(formatPercentileLabel(100)).toBe("highest");
    expect(formatPercentileLabel(0)).toBe("lowest");
  });

  it("uses the right ordinal suffix", () => {
    expect(formatPercentileLabel(1)).toBe("1st percentile");
    expect(formatPercentileLabel(2)).toBe("2nd percentile");
    expect(formatPercentileLabel(3)).toBe("3rd percentile");
    expect(formatPercentileLabel(4)).toBe("4th percentile");
    expect(formatPercentileLabel(11)).toBe("11th percentile");
    expect(formatPercentileLabel(12)).toBe("12th percentile");
    expect(formatPercentileLabel(13)).toBe("13th percentile");
    expect(formatPercentileLabel(21)).toBe("21st percentile");
    expect(formatPercentileLabel(92)).toBe("92nd percentile");
  });

  it("rounds before applying the ordinal", () => {
    expect(formatPercentileLabel(92.4)).toBe("92nd percentile");
    expect(formatPercentileLabel(99.6)).toBe("highest"); // rounds to 100
  });

  it("returns em dash for non-finite", () => {
    expect(formatPercentileLabel(Number.NaN)).toBe("—");
  });
});

describe("formatDeviationLabel", () => {
  it("formats positive deviations with the '+' sign", () => {
    expect(formatDeviationLabel(0.247)).toBe("+24.7% above identity");
  });

  it("formats negative deviations with the '-' sign", () => {
    expect(formatDeviationLabel(-0.15)).toBe("-15.0% below identity");
  });

  it("returns 'at identity' for deviations within 0.5% of zero", () => {
    expect(formatDeviationLabel(0)).toBe("at identity");
    expect(formatDeviationLabel(0.003)).toBe("at identity");
    expect(formatDeviationLabel(-0.004)).toBe("at identity");
  });

  it("returns em dash for non-finite", () => {
    expect(formatDeviationLabel(Number.NaN)).toBe("—");
    expect(formatDeviationLabel(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("computeFactorTooltipData", () => {
  const ALL_VALUES = [1.3, 1.1, 1.0, 0.95, 0.85];
  const MIL = { key: "MIL", label: "Milwaukee Co.", value: 1.3 };
  const LCR = { key: "LCR", label: "La Crosse Co.", value: 0.85 };

  it("computes deviation + percentile + direction for the highest datum", () => {
    const data = computeFactorTooltipData({
      datum: MIL,
      values: ALL_VALUES,
    });
    expect(data.label).toBe("Milwaukee Co.");
    expect(data.value).toBe(1.3);
    expect(data.deviation).toBeCloseTo(0.3, 5);
    expect(data.deviationLabel).toBe("+30.0% above identity");
    expect(data.direction).toBe("up");
    expect(data.percentile).toBe(100);
    expect(data.percentileLabel).toBe("highest");
  });

  it("computes the right values for the lowest datum", () => {
    const data = computeFactorTooltipData({
      datum: LCR,
      values: ALL_VALUES,
    });
    expect(data.deviation).toBeCloseTo(-0.15, 5);
    expect(data.deviationLabel).toBe("-15.0% below identity");
    expect(data.direction).toBe("down");
    expect(data.percentile).toBe(20);
    expect(data.percentileLabel).toBe("20th percentile");
  });

  it("supports a non-1.0 baseline (deviation = value / baseline - 1)", () => {
    const data = computeFactorTooltipData({
      datum: { key: "a", label: "A", value: 1.0 },
      values: [1.0, 2.0, 0.5],
      baseline: 0.5,
    });
    expect(data.deviation).toBeCloseTo(1.0, 5); // 1.0/0.5 - 1 = 1.0
    expect(data.deviationLabel).toBe("+100.0% above identity");
  });

  it("classifies near-identity as direction='neutral'", () => {
    const data = computeFactorTooltipData({
      datum: { key: "x", label: "X", value: 1.001 },
      values: [1.0, 1.001, 1.002],
    });
    expect(data.direction).toBe("neutral");
    expect(data.deviationLabel).toBe("at identity");
  });

  it("calls getChainReferences when supplied, otherwise no chains", () => {
    const withCb = computeFactorTooltipData({
      datum: MIL,
      values: ALL_VALUES,
      getChainReferences: () => ["BOP_chain", "GL_chain"],
    });
    expect(withCb.chainRefs).toEqual(["BOP_chain", "GL_chain"]);
    expect(withCb.chainRefsTotal).toBe(2);

    const noCb = computeFactorTooltipData({ datum: MIL, values: ALL_VALUES });
    expect(noCb.chainRefs).toEqual([]);
    expect(noCb.chainRefsTotal).toBe(0);
  });

  it("truncates chainRefs at maxChainRefs and reports total separately", () => {
    const data = computeFactorTooltipData({
      datum: MIL,
      values: ALL_VALUES,
      getChainReferences: () => ["a", "b", "c", "d", "e", "f"],
      maxChainRefs: 4,
    });
    // 6 total > 4 max → display max-1=3 + "+N more" handled by view
    expect(data.chainRefs).toHaveLength(3);
    expect(data.chainRefsTotal).toBe(6);
  });

  it("does not truncate when chains count ≤ maxChainRefs", () => {
    const data = computeFactorTooltipData({
      datum: MIL,
      values: ALL_VALUES,
      getChainReferences: () => ["a", "b"],
      maxChainRefs: 4,
    });
    expect(data.chainRefs).toEqual(["a", "b"]);
    expect(data.chainRefsTotal).toBe(2);
  });

  it("filters undefined / NaN / Inf from the percentile population", () => {
    const data = computeFactorTooltipData({
      datum: { key: "x", label: "X", value: 1.0 },
      values: [
        1.0,
        undefined,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        0.5,
        1.5,
      ],
    });
    // Population was [1.0, 0.5, 1.5] — value 1.0 percentile = 2/3 ≈ 66.67
    expect(data.percentile).toBeCloseTo(66.67, 1);
  });

  it("handles a zero baseline gracefully (deviation = 0)", () => {
    const data = computeFactorTooltipData({
      datum: { key: "x", label: "X", value: 1.0 },
      values: [1.0],
      baseline: 0,
    });
    expect(data.deviation).toBe(0);
    expect(data.deviationLabel).toBe("at identity");
  });
});
