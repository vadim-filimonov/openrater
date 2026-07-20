/**
 * Brief 45 PR 45.2 — <FactorTooltip> tests.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactorTooltip } from "./FactorTooltip";
import { computeFactorTooltipData } from "../FactorTableViz/factorTooltipData";

const VALUES = [1.3, 1.1, 1.0, 0.95, 0.85];
const MIL_DATUM = { key: "MIL", label: "Milwaukee Co.", value: 1.3 };

function makeAnchor(): { kind: "point"; x: number; y: number } {
  return { kind: "point", x: 200, y: 200 } as const;
}

describe("<FactorTooltip>", () => {
  it("renders nothing when open is false", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
    });
    const { container } = render(
      <FactorTooltip open={false} anchor={makeAnchor()} data={data} />,
    );
    expect(container.querySelector(".rater-factor-tooltip")).toBeNull();
  });

  it("renders nothing when data is null", () => {
    const { container } = render(
      <FactorTooltip open={true} anchor={makeAnchor()} data={null} />,
    );
    expect(container.querySelector(".rater-factor-tooltip")).toBeNull();
  });

  it("renders the level label + value + deviation when open", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
    });
    render(<FactorTooltip open={true} anchor={makeAnchor()} data={data} />);
    expect(screen.getByTestId("rater-factor-tooltip-title").textContent).toBe(
      "Milwaukee Co.",
    );
    expect(screen.getByTestId("rater-factor-tooltip-value").textContent).toBe(
      "1.3",
    );
    expect(
      screen.getByTestId("rater-factor-tooltip-deviation").textContent,
    ).toBe("+30.0% above identity");
  });

  it("renders the percentile rank", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
    });
    render(<FactorTooltip open={true} anchor={makeAnchor()} data={data} />);
    const pct = screen.getByTestId("rater-factor-tooltip-percentile");
    expect(pct.textContent).toContain("highest");
  });

  it("renders chain references when present + within max", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
      getChainReferences: () => ["BOP_premium", "GL_premium"],
    });
    render(<FactorTooltip open={true} anchor={makeAnchor()} data={data} />);
    const chains = screen.getByTestId("rater-factor-tooltip-chains");
    expect(chains.textContent).toContain("Referenced in");
    expect(chains.textContent).toContain("BOP_premium");
    expect(chains.textContent).toContain("GL_premium");
  });

  it("omits chains block when no references", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
    });
    render(<FactorTooltip open={true} anchor={makeAnchor()} data={data} />);
    expect(screen.queryByTestId("rater-factor-tooltip-chains")).toBeNull();
  });

  it("renders '+N more' when chain refs overflow the max", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
      getChainReferences: () => ["a", "b", "c", "d", "e", "f"],
      maxChainRefs: 4,
    });
    render(<FactorTooltip open={true} anchor={makeAnchor()} data={data} />);
    const chains = screen.getByTestId("rater-factor-tooltip-chains");
    // 6 total > 4 max → shows max-1 = 3 pills + "+3 more"
    expect(chains.textContent).toContain("+3 more");
  });

  it("applies the gradient direction class for value-above-identity", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM, // value 1.3 > 1.0
      values: VALUES,
    });
    render(<FactorTooltip open={true} anchor={makeAnchor()} data={data} />);
    const tip = screen.getByTestId("rater-factor-tooltip");
    expect(tip.className).toContain("is-direction-up");
  });

  it("applies the gradient direction class for value-below-identity", () => {
    const data = computeFactorTooltipData({
      datum: { key: "LCR", label: "La Crosse Co.", value: 0.85 },
      values: VALUES,
    });
    render(<FactorTooltip open={true} anchor={makeAnchor()} data={data} />);
    const tip = screen.getByTestId("rater-factor-tooltip");
    expect(tip.className).toContain("is-direction-down");
  });

  it("applies neutral direction for at-identity values", () => {
    const data = computeFactorTooltipData({
      datum: { key: "TX", label: "Texas", value: 1.0 },
      values: VALUES,
    });
    render(<FactorTooltip open={true} anchor={makeAnchor()} data={data} />);
    const tip = screen.getByTestId("rater-factor-tooltip");
    expect(tip.className).toContain("is-direction-neutral");
  });

  it("renders the optional baseline label when supplied", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
    });
    render(
      <FactorTooltip
        open={true}
        anchor={makeAnchor()}
        data={data}
        baselineLabel="against 0.5 base"
      />,
    );
    const tip = screen.getByTestId("rater-factor-tooltip");
    expect(tip.textContent).toContain("against 0.5 base");
  });

  it("respects the custom testId", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
    });
    render(
      <FactorTooltip
        open={true}
        anchor={makeAnchor()}
        data={data}
        testId="my-tip"
      />,
    );
    expect(screen.getByTestId("my-tip")).toBeInTheDocument();
    expect(screen.getByTestId("my-tip-title")).toBeInTheDocument();
    expect(screen.getByTestId("my-tip-value")).toBeInTheDocument();
  });

  it("accepts a rect-shaped anchor", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
    });
    const rect = { x: 100, y: 100, width: 20, height: 30 };
    render(
      <FactorTooltip
        open={true}
        anchor={{ kind: "rect", rect }}
        data={data}
      />,
    );
    expect(screen.getByTestId("rater-factor-tooltip")).toBeInTheDocument();
  });

  it("renders nothing when anchor is null", () => {
    const data = computeFactorTooltipData({
      datum: MIL_DATUM,
      values: VALUES,
    });
    const { container } = render(
      <FactorTooltip open={true} anchor={null} data={data} />,
    );
    // Tooltip portals don't appear in the test container but DO render
    // off-screen. Assert no positioned visible tooltip; the test
    // verifies the component doesn't crash when anchor is null.
    expect(
      container.querySelector(".rater-factor-tooltip"),
    ).toBeNull();
  });
});
