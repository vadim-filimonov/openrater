import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Two tiny state polygons inside the continental US so geoAlbersUsa projects
// them to real paths (it returns null outside the US).
const STATES = new Map<string, unknown>([
  ["CA", { type: "Feature", id: "06", properties: { GEOID: "06", USPS: "CA", NAME: "California" },
    geometry: { type: "Polygon", coordinates: [[[-122, 37], [-119, 37], [-119, 40], [-122, 40], [-122, 37]]] } }],
  ["TX", { type: "Feature", id: "48", properties: { GEOID: "48", USPS: "TX", NAME: "Texas" },
    geometry: { type: "Polygon", coordinates: [[[-100, 30], [-97, 30], [-97, 33], [-100, 33], [-100, 30]]] } }],
]);

// A nation silhouette spanning both states, so geoAlbersUsa projects it.
const NATION = {
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [[[-122, 30], [-97, 30], [-97, 40], [-122, 40], [-122, 30]]] },
};

vi.mock("../GeoMapEditor/geoCatalog", () => ({
  loadGeoCatalog: vi.fn(async () => ({
    statesByUsps: STATES,
    countiesByState: new Map(),
    countiesByGeoid: new Map(),
    nationOutline: NATION,
  })),
}));

import { UsChoropleth } from "./UsChoropleth";

const colors = new Map([["CA", "#2f86e0"], ["TX", "#9fe0f5"]]);
const values = new Map([["CA", 21.4], ["TX", 18.2]]);
const fmt = (v: number | null): string => `$${v}M`;

describe("<UsChoropleth>", () => {
  it("renders an Albers SVG path per region with the bucketed fill", async () => {
    render(<UsChoropleth granularity="state" colorById={colors} valueById={values} formatValue={fmt} />);
    const ca = await screen.findByTestId("rater-us-choropleth-region-CA");
    expect(ca).toHaveAttribute("fill", "#2f86e0");
    expect(ca.getAttribute("d")).toBeTruthy(); // d3-geo produced real geometry
    expect(screen.getByTestId("rater-us-choropleth-region-TX")).toHaveAttribute("fill", "#9fe0f5");
  });

  it("a region with no color reads as empty — never a fake fill", async () => {
    render(<UsChoropleth granularity="state" colorById={new Map([["CA", "#2f86e0"]])} />);
    const tx = await screen.findByTestId("rater-us-choropleth-region-TX");
    expect(tx.getAttribute("class")).toContain("is-empty");
    expect(tx).not.toHaveAttribute("fill");
  });

  it("reports the clicked region id (consumer owns toggle)", async () => {
    const onSelect = vi.fn();
    render(<UsChoropleth granularity="state" colorById={colors} selectedId="CA" onSelect={onSelect} />);
    fireEvent.click(await screen.findByTestId("rater-us-choropleth-region-CA"));
    expect(onSelect).toHaveBeenCalledWith("CA");
  });

  it("regions are keyboard-operable when interactive (role + Enter/Space)", async () => {
    const onSelect = vi.fn();
    render(<UsChoropleth granularity="state" colorById={colors} valueById={values} formatValue={fmt} onSelect={onSelect} />);
    const ca = await screen.findByTestId("rater-us-choropleth-region-CA");
    expect(ca).toHaveAttribute("role", "button");
    expect(ca).toHaveAttribute("tabindex", "0");
    expect(ca).toHaveAttribute("aria-label", expect.stringContaining("California"));
    fireEvent.keyDown(ca, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("CA");
  });

  it("is not focusable when there is no cross-filter handler", async () => {
    render(<UsChoropleth granularity="state" colorById={colors} />);
    const ca = await screen.findByTestId("rater-us-choropleth-region-CA");
    expect(ca).not.toHaveAttribute("tabindex");
    expect(ca).not.toHaveAttribute("role");
  });

  it("highlights the selected region and dims the rest", async () => {
    render(<UsChoropleth granularity="state" colorById={colors} selectedId="CA" />);
    const ca = await screen.findByTestId("rater-us-choropleth-region-CA");
    expect(ca.getAttribute("class")).toContain("is-selected");
    expect(screen.getByTestId("rater-us-choropleth-region-TX").getAttribute("class")).toContain("is-dimmed");
  });

  it("hover shows a tooltip with the formatted value", async () => {
    render(<UsChoropleth granularity="state" colorById={colors} valueById={values} formatValue={fmt} metricLabel="Earned premium" />);
    fireEvent.mouseMove(await screen.findByTestId("rater-us-choropleth-region-CA"));
    const tt = await screen.findByTestId("rater-us-choropleth-tooltip");
    expect(tt).toHaveTextContent("California");
    expect(tt).toHaveTextContent("$21.4M");
  });

  it("draws the geographic-context backdrop when enabled (halo + graticule + coastline)", async () => {
    const { container } = render(
      <UsChoropleth granularity="state" colorById={colors} geographicContext />,
    );
    await screen.findByTestId("rater-us-choropleth-region-CA");
    const halo = container.querySelector(".rater-us-choropleth__halo");
    const grat = container.querySelector(".rater-us-choropleth__graticule");
    const coast = container.querySelector(".rater-us-choropleth__coastline");
    expect(halo).toBeInTheDocument();
    expect(grat).toBeInTheDocument();
    expect(coast).toBeInTheDocument();
    // real projected geometry, and the graticule is clipped to the land
    expect(coast?.getAttribute("d")).toBeTruthy();
    expect(grat?.getAttribute("clip-path")).toBe("url(#rater-us-choropleth-land)");
  });

  it("omits the backdrop by default (no context props bleed in)", async () => {
    const { container } = render(<UsChoropleth granularity="state" colorById={colors} />);
    await screen.findByTestId("rater-us-choropleth-region-CA");
    expect(container.querySelector(".rater-us-choropleth__coastline")).not.toBeInTheDocument();
    expect(container.querySelector(".rater-us-choropleth__halo")).not.toBeInTheDocument();
  });
});
