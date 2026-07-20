/**
 * <RateCardExhibit> · total-less multi-coverage plans (93.4).
 *
 * Every cell of a rate card is a risk's PRICE. A filing with ≥2
 * coverage towers and no total row declares no premium output, so a
 * cell that reads one output prints the LAST tower — the same drift
 * that headlined "$72" for a $267 risk on the plan report. Each cell
 * is the dec-page SUM of its towers, matching what /score derives
 * (`views.premium`, basis "coverage_sum") for the same inputs.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { registerBuiltinKinds, type Plan } from "@openrater/contracts";
import { RateCardExhibit } from "./RateCardExhibit";
import type { DimensionRow } from "../DimensionsTable";

beforeAll(() => registerBuiltinKinds());

/** Construction class drives BOTH towers, so each cell moves with the
 *  axis: building 130 × cls, contents 60 × cls. Frame (1.5) costs
 *  195 + 90 = $285; masonry (1.0) costs 130 + 60 = $190. */
function twoTowerPlan(): Plan {
  const tower = (tag: string, base: number, field: string) => ({
    nodes: [
      { id: `${tag}_base`, kind: "constant", params: { value: base, type: "money" } },
      {
        id: `${tag}_chain`,
        kind: "chain.mult",
        params: { factorNames: ["Construction class"], stopOnZero: false },
      },
      { id: `${tag}_out`, kind: "output", params: { fieldName: field, fieldType: "money" } },
    ],
    edges: [
      { from: { node: `${tag}_base`, port: "value" }, to: { node: `${tag}_chain`, port: "base" } },
      { from: { node: "cls_lookup", port: "value" }, to: { node: `${tag}_chain`, port: "factors" } },
      { from: { node: `${tag}_chain`, port: "result" }, to: { node: `${tag}_out`, port: "value" } },
    ],
  });
  const b = tower("b", 130, "building_premium");
  const c = tower("c", 60, "contents_premium");
  return {
    id: "rc-total-less",
    version: "1.0.0",
    name: "Two towers, no total",
    nodes: [
      { id: "in_cls", kind: "input", params: { fieldName: "construction_class" } },
      {
        id: "cls_lookup",
        kind: "lookup.direct",
        label: "Construction class",
        params: { table: { frame: 1.5, masonry: 1.0 }, defaultValue: 1.0 },
      },
      ...b.nodes,
      ...c.nodes,
    ],
    edges: [
      { from: { node: "in_cls", port: "value" }, to: { node: "cls_lookup", port: "key" } },
      ...b.edges,
      ...c.edges,
    ],
  } as unknown as Plan;
}

/** Two chains, NO round stage — the plan declares no total. */
const STAGES = [
  {
    stage_id: "chain_1",
    stage_kind: "multiplicative_chain",
    config_json: {
      chains: [
        { name: "building", output_field: "building_premium" },
        { name: "contents", output_field: "contents_premium" },
      ],
    },
  },
];

const DIMENSIONS: DimensionRow[] = [
  {
    id: "construction_class",
    slug: "construction_class",
    display_name: "Construction class",
    data_type: "string",
    levels: [
      { kind: "categorical", id: "frame", label: "Frame" },
      { kind: "categorical", id: "masonry", label: "Masonry" },
    ],
  } as unknown as DimensionRow,
];

function renderCard(): void {
  render(
    <RateCardExhibit
      plan={twoTowerPlan()}
      stages={STAGES}
      dimensions={DIMENSIONS}
      factorTables={[]}
    />,
  );
}

describe("<RateCardExhibit> · total-less multi-coverage (93.4)", () => {
  it("⭐ each cell SUMS its coverage towers — never the last tower alone", () => {
    renderCard();
    // Frame: 130×1.5 + 60×1.5 = $285. Masonry: 130 + 60 = $190.
    expect(screen.getByText("$285")).toBeInTheDocument();
    expect(screen.getByText("$190")).toBeInTheDocument();
    // The last tower alone would have printed these.
    expect(screen.queryByText("$90")).not.toBeInTheDocument();
    expect(screen.queryByText("$60")).not.toBeInTheDocument();
  });

  it("says the cells are a sum — a synthesized total is never passed off as a filed one", () => {
    renderCard();
    expect(screen.getByText("All coverages (sum)")).toBeInTheDocument();
  });
});
