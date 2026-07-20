import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ChoroplethScaleLegend } from "./ChoroplethScaleLegend";
import { DIVERGING_RAMP, SEQUENTIAL_RAMP } from "./map-bucket";

const usd = (v: number): string => `$${Math.round(v).toLocaleString()}`;

describe("ChoroplethScaleLegend", () => {
  it("paints the ramp as a left→right gradient of every stop", () => {
    const { getByTestId } = render(
      <ChoroplethScaleLegend ramp={SEQUENTIAL_RAMP} min={0} max={100} formatValue={usd} />,
    );
    const bar = getByTestId("rater-choro-legend").querySelector(
      ".rater-choro-legend__bar",
    ) as HTMLElement;
    const bg = bar.style.background;
    expect(bg).toContain("linear-gradient(90deg");
    // every ramp color appears, low→high, in order
    for (const stop of SEQUENTIAL_RAMP) expect(bg).toContain(stop);
  });

  it("sequential: ticks read min, midpoint, max", () => {
    const { getByTestId } = render(
      <ChoroplethScaleLegend ramp={SEQUENTIAL_RAMP} min={20} max={120} formatValue={usd} />,
    );
    const ticks = [
      ...getByTestId("rater-choro-legend").querySelectorAll(".rater-choro-legend__tick"),
    ].map((t) => t.textContent);
    expect(ticks).toEqual(["$20", "$70", "$120"]); // (20+120)/2 = 70
  });

  it("diverging: the centre tick is the baseline, not the midpoint", () => {
    const { getByTestId } = render(
      <ChoroplethScaleLegend
        ramp={DIVERGING_RAMP}
        min={-10}
        max={30}
        diverging
        baseline={5}
        formatValue={(v) => `${v}%`}
      />,
    );
    const ticks = [
      ...getByTestId("rater-choro-legend").querySelectorAll(".rater-choro-legend__tick"),
    ].map((t) => t.textContent);
    expect(ticks).toEqual(["-10%", "5%", "30%"]); // centre = baseline 5, not 10
  });

  it("collapses to a single tick when the range has no spread", () => {
    const { getByTestId } = render(
      <ChoroplethScaleLegend ramp={SEQUENTIAL_RAMP} min={42} max={42} formatValue={usd} />,
    );
    const ticks = getByTestId("rater-choro-legend").querySelectorAll(
      ".rater-choro-legend__tick",
    );
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.textContent).toBe("$42");
  });

  it("renders the optional metric label", () => {
    const { getByText } = render(
      <ChoroplethScaleLegend
        ramp={SEQUENTIAL_RAMP}
        min={0}
        max={1}
        formatValue={usd}
        label="Earned premium"
      />,
    );
    expect(getByText("Earned premium")).toBeInTheDocument();
  });
});
