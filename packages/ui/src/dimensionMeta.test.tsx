/**
 * dimensionMeta tests — Brief 70 Phase 1.
 *
 * Pins the extracted-verbatim behavior (the pure-move proof rides
 * dims2's own suite continuing to pass; these pin the module's
 * contract for its NEW consumers) + the <DimToken> densities.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DimensionRow } from "./DimensionsTable";
import { DimToken, countLabel, shapeOf, shapeOfCanonical } from "./dimensionMeta";

const CATEGORICAL: DimensionRow = {
  id: "construction",
  slug: "construction",
  display_name: "Construction class",
  data_type: "string",
  role: "rating-input",
  shape: "categorical",
  levels: [
    { kind: "categorical", id: "frame", label: "Frame" },
    { kind: "categorical", id: "masonry", label: "Masonry" },
  ],
};

const BANDED: DimensionRow = {
  id: "age",
  slug: "building_age",
  display_name: "Building Age",
  data_type: "number",
  role: "rating-input",
  shape: "banded",
  levels: [{ kind: "banded", id: "b1", label: "New", lo: 0, hi: 5 }],
};

const GEO_GROUPED: DimensionRow = {
  id: "territory",
  slug: "territory",
  display_name: "Territory",
  data_type: "string",
  role: "rating-input",
  dimension_type: "geographic",
  shape: "geographic",
  geo_granularity: "state",
  geo_territories: [
    { territory_id: "T1", display_name: "Metro", member_level_ids: ["ks"] },
    { territory_id: "T2", display_name: "Rural", member_level_ids: ["mo"] },
  ] as never,
  levels: Array.from({ length: 51 }, (_, i) => ({
    kind: "geographic" as const,
    id: `s${i}`,
    label: `State ${i}`,
  })),
};

describe("shapeOf / shapeOfCanonical", () => {
  it("classifies by authored fields", () => {
    expect(shapeOf(CATEGORICAL)).toBe("categorical");
    expect(shapeOf(BANDED)).toBe("banded");
    expect(shapeOf(GEO_GROUPED)).toBe("geographic");
  });

  it("canonical variant reads a geo dim authored as categorical (ADR-0038)", () => {
    const sneakyGeo: DimensionRow = {
      ...GEO_GROUPED,
      shape: "categorical",
    };
    expect(shapeOfCanonical(sneakyGeo)).toBe("geographic");
  });
});

describe("countLabel (the unit grammar)", () => {
  it("categorical → levels; banded → bands (singular handled)", () => {
    expect(countLabel(CATEGORICAL, "categorical")).toBe("2 levels");
    expect(countLabel(BANDED, "banded")).toBe("1 band");
  });

  it("geo grouped → TERRITORIES, never the raw level count (Brief 66 §3.3)", () => {
    expect(countLabel(GEO_GROUPED, "geographic")).toBe("2 territories");
  });

  it("geo ungrouped → granularity grammar", () => {
    const ungrouped = { ...GEO_GROUPED, geo_territories: [] as never };
    expect(countLabel(ungrouped, "geographic")).toBe("51 states");
  });
});

describe("<DimToken>", () => {
  it("row density: tile + name + slug + count; activates as a button", () => {
    const onActivate = vi.fn();
    render(
      <DimToken dim={CATEGORICAL} onActivate={onActivate} testId="tok" />,
    );
    const btn = screen.getByTestId("tok");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveTextContent("Construction class");
    expect(btn).toHaveTextContent("construction");
    expect(btn).toHaveTextContent("2 levels");
    expect(btn).toHaveAttribute("data-shape", "categorical");
    fireEvent.click(btn);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("inline density: name only, static span without onActivate", () => {
    render(<DimToken dim={BANDED} density="inline" testId="tok2" />);
    const el = screen.getByTestId("tok2");
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveTextContent("Building Age");
    expect(el).not.toHaveTextContent("1 band");
  });
});
