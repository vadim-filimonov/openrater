/**
 * <InputsPanelV2> — P1 mismatch detection tests.
 *
 * A mapped column whose values aren't in the dim's levels surfaces as a
 * quiet on-row "N unmatched" flag (not a banner stack); expanding it offers
 * an inline alias resolve that writes alias_overrides via onMappingChange.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Dimension } from "@openrater/contracts";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

const constructionDim: Dimension = {
  id: "dim_construction",
  slug: "construction",
  display_name: "Construction",
  data_type: "enum",
  role: "rating-input",
  shape: "categorical",
  levels: [
    { kind: "categorical", id: "frame", label: "Frame", aliases: ["wood frame"] },
    { kind: "categorical", id: "masonry", label: "Masonry", aliases: ["brick"] },
    {
      kind: "categorical",
      id: "non_combustible",
      label: "Non-combustible",
      aliases: ["nc"],
    },
  ],
};

const CONSTRUCTION_INPUT: RequiredInputEntry = {
  id: "construction",
  name: "construction",
  category: "dimensions",
  dimSlug: "construction",
};

// "Masonary" (typo) is not a level; "frame" is — so exactly one mismatch.
const MAPPING: PlanInputMapping = {
  source: {
    kind: "csv",
    columns: ["construction"],
    sample_rows: [{ construction: "Masonary" }, { construction: "frame" }],
  },
  column_map: { construction: "construction" },
};

describe("<InputsPanelV2> — mismatch detection (P1)", () => {
  it("flags an unmatched value on the row, then aliases it inline", () => {
    const onMappingChange = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        onMappingChange={onMappingChange}
        requiredInputs={[CONSTRUCTION_INPUT]}
        dimensions={[constructionDim]}
      />,
    );

    const flag = screen.getByRole("button", { name: /unmatched/ });
    expect(flag).toHaveTextContent("1 unmatched");

    fireEvent.click(flag);
    expect(screen.getByText("Masonary")).toBeInTheDocument();

    const select = screen.getByLabelText(
      "Map Masonary to a level",
    ) as HTMLSelectElement;
    const suggestion = [...select.options].find((o) => o.value !== "");
    expect(
      suggestion,
      "detectMismatches should suggest a close level",
    ).toBeTruthy();

    fireEvent.change(select, { target: { value: suggestion!.value } });
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        alias_overrides: { construction: { Masonary: suggestion!.value } },
      }),
    );
  });

  it("read-only: shows the flag but no resolve select", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        requiredInputs={[CONSTRUCTION_INPUT]}
        dimensions={[constructionDim]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unmatched/ }));
    expect(screen.getByText("Masonary")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Map Masonary to a level"),
    ).not.toBeInTheDocument();
  });
});
