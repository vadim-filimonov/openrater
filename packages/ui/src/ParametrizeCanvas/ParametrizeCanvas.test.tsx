/**
 * <ParametrizeCanvas> tests — Brief 33 PR 33.1 + PR 33.2.
 *
 * Covers (Brief 67 — catalog-first):
 *   • No ?table= param → the CATALOG (full-width FactorTablesTable);
 *     `creating` → the editor act (frame + dims palette rail, no inspector)
 *   • Catalog: axes in display names, factor counts, used-by, FILTERING
 *     search, onOpen / onDelete / onNewFactorTable, back crumb
 *   • Left rail groups dims by shape (categorical / banded / classification /
 *     geographic / composite) and renders the shape-class ribbon + glyph
 *   • Empty-rail state when there are no dims
 *   • Editor + zero factor tables → draft <FactorTableNode> + 3-step strip
 *   • Editor + N factor tables → draft <FactorTableNode> alone (no strip)
 *   • onAddDimension fires when rail footer button clicked
 *   • PR 33.2 — dim-chip drag-start sets DIM_DRAG_MIME data
 *   • PR 33.2 — dropping on an axis slot updates the draft axes
 *   • PR 33.2 — assigned chip shows "used" pill + drag is suppressed
 *   • PR 33.2 — title auto-suggests once axes filled
 *   • PR 33.2 — user-typed title overrides the auto-suggest
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ParametrizeCanvas,
  levelsForKeying,
  type FactorTableSummary,
} from "./ParametrizeCanvas";
import type { DimensionRow } from "../DimensionsTable";

// ──────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────

const CONSTRUCTION: DimensionRow = {
  id: "construction",
  display_name: "Construction",
  slug: "construction",
  dimension_type: "standard",
  shape: "categorical",
  data_type: "string",
  role: "rating-input",
  levels: [
    { kind: "categorical", id: "frame", label: "Frame", aliases: [] },
    { kind: "categorical", id: "joisted_masonry", label: "Joisted masonry", aliases: [] },
    { kind: "categorical", id: "fire_resistive", label: "Fire-resistive", aliases: [] },
  ],
};
const OWNERSHIP: DimensionRow = {
  id: "ownership",
  display_name: "Ownership",
  slug: "ownership",
  dimension_type: "standard",
  shape: "categorical",
  data_type: "string",
  role: "rating-input",
  levels: [
    { kind: "categorical", id: "owner", label: "Owner", aliases: [] },
    { kind: "categorical", id: "tenant", label: "Tenant", aliases: [] },
  ],
};
const BUILDING_AGE: DimensionRow = {
  id: "building_age",
  display_name: "Building age",
  slug: "building_age",
  dimension_type: "standard",
  shape: "banded",
  data_type: "number",
  role: "rating-input",
  levels: [
    { kind: "banded", id: "band_0_5", label: "New", lo: 0, hi: 5 },
    { kind: "banded", id: "band_5_15", label: "Modern", lo: 5, hi: 15 },
  ],
};
const CLASS_CODE: DimensionRow = {
  id: "class_code",
  display_name: "Class code",
  slug: "class_code",
  dimension_type: "classification",
  shape: "categorical",
  data_type: "string",
  role: "rating-input",
  levels: [
    { kind: "categorical", id: "71641", label: "Restaurants", aliases: [] },
    { kind: "categorical", id: "91342", label: "Concrete contractors", aliases: [] },
  ],
};
const TERRITORY: DimensionRow = {
  id: "territory",
  display_name: "Territory",
  slug: "territory",
  dimension_type: "geographic",
  shape: "geographic",
  data_type: "string",
  role: "rating-input",
  levels: [],
};
const COMPOSITE: DimensionRow = {
  id: "age_x_class",
  display_name: "Age × Class",
  slug: "age_x_class",
  dimension_type: "standard",
  shape: "composite",
  axes: ["building_age", "class_code"],
};

const ALL_DIMS: readonly DimensionRow[] = [
  CONSTRUCTION,
  OWNERSHIP,
  BUILDING_AGE,
  CLASS_CODE,
  TERRITORY,
  COMPOSITE,
];

const SAMPLE_TABLES: readonly FactorTableSummary[] = [
  {
    id: "class_ownership_factor",
    display_name: "Class × Ownership",
    slug: "class_ownership_factor",
    key_dimensions: ["class_code", "ownership"],
    state: "filed",
    cell_count: 1424,
    edited_ago: "4d ago",
    ref_count: 2,
  },
  {
    id: "construction_factor",
    display_name: "Construction factor",
    slug: "construction_factor",
    key_dimension: "construction",
    state: "filed",
    cell_count: 3,
    edited_ago: "2w ago",
    ref_count: 3,
  },
];

// ──────────────────────────────────────────────────────────────────
// Shell mount
// ──────────────────────────────────────────────────────────────────

describe("<ParametrizeCanvas> shell (Brief 70 — catalog / question / editor)", () => {
  it("no ?table= param renders the CATALOG", () => {
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
      />,
    );
    expect(
      screen.getByTestId("rater-parametrize-canvas-catalog"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-parametrize-canvas-canvas"),
    ).not.toBeInTheDocument();
  });

  it("creating renders the QUESTION — no rail, no frame, no Generate", () => {
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        creating
      />,
    );
    expect(
      screen.getByTestId("rater-parametrize-canvas-create"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("What does this table rate by?"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-parametrize-canvas-rail"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Generate")).not.toBeInTheDocument();
  });

  it("an open table (initialDraft) renders the full-width editor", () => {
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        editingExisting
        initialDraft={{
          title: "Construction factor",
          axes: { rowDimSlug: "construction", colDimSlug: null },
          cells: new Map([["frame", 1.25]]),
        }}
      />,
    );
    expect(
      screen.getByTestId("rater-parametrize-canvas-canvas"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-parametrize-canvas-draft-grid"),
    ).toBeInTheDocument();
  });
});

describe("<ParametrizeCanvas> the creation question (Brief 70 §1)", () => {
  it("renders pickable dims as DimToken rows; composite is excluded (ADR-0051)", () => {
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        creating
        onCreateFromDimension={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-parametrize-canvas-create-dim-construction"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-parametrize-canvas-create-dim-age_x_class"),
    ).not.toBeInTheDocument();
  });

  it("typing filters; picking a dim fires onCreateFromDimension", () => {
    const onCreate = vi.fn();
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        creating
        onCreateFromDimension={onCreate}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search dimensions"), {
      target: { value: "constr" },
    });
    expect(
      screen.queryByTestId("rater-parametrize-canvas-create-dim-ownership"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("rater-parametrize-canvas-create-dim-construction"),
    );
    expect(onCreate).toHaveBeenCalledWith("construction");
  });

  it("a zero-level dim renders disabled with the honest note", () => {
    const empty: DimensionRow = {
      id: "empty_dim",
      display_name: "Empty dim",
      slug: "empty_dim",
      dimension_type: "standard",
      shape: "categorical",
      data_type: "string",
      role: "rating-input",
      levels: [],
    };
    render(
      <ParametrizeCanvas
        dimensions={[...ALL_DIMS, empty]}
        factorTables={SAMPLE_TABLES}
        creating
        onCreateFromDimension={() => {}}
      />,
    );
    const row = screen.getByTestId(
      "rater-parametrize-canvas-create-dim-empty_dim",
    );
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent("no levels yet");
  });

  it("zero dims renders the cross-link empty state", () => {
    const onAdd = vi.fn();
    render(
      <ParametrizeCanvas
        dimensions={[]}
        factorTables={[]}
        creating
        onCreateFromDimension={() => {}}
        onAddDimension={onAdd}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-parametrize-canvas-create-add-dimension"),
    );
    expect(onAdd).toHaveBeenCalled();
  });
});

describe("<ParametrizeCanvas> axis chips (Brief 70 §1)", () => {
  function setupEditor(over: Record<string, unknown> = {}) {
    const onAxesChanged = vi.fn();
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        editingExisting
        initialDraft={{
          title: "Construction factor",
          axes: { rowDimSlug: "construction", colDimSlug: null },
          cells: new Map([
            ["frame", 1.25],
            ["joisted_masonry", 1],
            ["fire_resistive", 1],
          ]),
        }}
        onAxesChanged={onAxesChanged}
        {...over}
      />,
    );
    return { onAxesChanged };
  }

  it("the head reads RATES BY with the axis chip; clicking opens the pick popover", () => {
    setupEditor();
    const chip = screen.getByTestId("rater-parametrize-canvas-axischip-row");
    expect(chip).toHaveTextContent("Construction");
    fireEvent.click(chip);
    expect(
      screen.getByTestId("rater-parametrize-canvas-axispop-row"),
    ).toBeInTheDocument();
  });

  it("picking a new dim re-keys with carry-forward and fires onAxesChanged", () => {
    const { onAxesChanged } = setupEditor();
    fireEvent.click(screen.getByTestId("rater-parametrize-canvas-axischip-row"));
    fireEvent.click(
      screen.getByTestId("rater-parametrize-canvas-axispop-row-ownership"),
    );
    // 1.25 was authored on frame — dropping to ownership axes arms? No:
    // frame has no place on ownership → the impact prompt arms instead.
    expect(
      screen.getByTestId("rater-parametrize-canvas-axes-impact"),
    ).toBeInTheDocument();
    // confirm the change
    fireEvent.click(
      screen.getByTestId("rater-parametrize-canvas-axes-impact-confirm"),
    );
    expect(onAxesChanged).toHaveBeenCalledWith(["ownership"]);
    // the carry report renders
    expect(
      screen.getByTestId("rater-parametrize-canvas-carryreport"),
    ).toBeInTheDocument();
  });

  it("+ Second axis opens the col popover; picking upgrades to 2-D without arming (values carry)", () => {
    const { onAxesChanged } = setupEditor();
    fireEvent.click(screen.getByTestId("rater-parametrize-canvas-second-axis"));
    fireEvent.click(
      screen.getByTestId("rater-parametrize-canvas-axispop-col-ownership"),
    );
    // 1-D→2-D copies row values into every column — nothing drops.
    expect(
      screen.queryByTestId("rater-parametrize-canvas-axes-impact"),
    ).not.toBeInTheDocument();
    expect(onAxesChanged).toHaveBeenCalledWith(["construction", "ownership"]);
  });

  it("read-only renders the chips disabled", () => {
    setupEditor({ readOnly: true, onAxesChanged: undefined });
    expect(
      screen.getByTestId("rater-parametrize-canvas-axischip-row"),
    ).toBeDisabled();
    expect(
      screen.queryByTestId("rater-parametrize-canvas-second-axis"),
    ).not.toBeInTheDocument();
  });
});


describe("<ParametrizeCanvas> catalog (Brief 67 §3.1)", () => {
  it("renders one row per table with axes in DISPLAY names + factor counts", () => {
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
      />,
    );
    expect(
      screen.getByTestId(
        "rater-parametrize-canvas-catalog-table-row-class_ownership_factor",
      ),
    ).toBeInTheDocument();
    // Axes read with the actuary's vocabulary, not slugs.
    expect(screen.getByText("Class code × Ownership")).toBeInTheDocument();
    expect(screen.getByText("Construction")).toBeInTheDocument();
    // Factor counts, formatted.
    expect(screen.getByText("1,424")).toBeInTheDocument();
  });

  it("the search field FILTERS the catalog (it was inert in the old saved list)", () => {
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search factor tables"), {
      target: { value: "construction" },
    });
    expect(
      screen.getByTestId(
        "rater-parametrize-canvas-catalog-table-row-construction_factor",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "rater-parametrize-canvas-catalog-table-row-class_ownership_factor",
      ),
    ).not.toBeInTheDocument();
    // No-match states itself honestly.
    fireEvent.change(screen.getByLabelText("Search factor tables"), {
      target: { value: "zzz" },
    });
    expect(
      screen.getByTestId("rater-parametrize-canvas-catalog-nomatch"),
    ).toBeInTheDocument();
  });

  it("fires onOpenFactorTable from the row's name button", () => {
    const onOpen = vi.fn();
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        onOpenFactorTable={onOpen}
      />,
    );
    fireEvent.click(
      screen.getByTestId(
        "rater-parametrize-canvas-catalog-table-open-class_ownership_factor",
      ),
    );
    expect(onOpen).toHaveBeenCalledWith("class_ownership_factor");
  });

  it("fires onDeleteFactorTable from the row trash; none renders when omitted (N19)", () => {
    const onDelete = vi.fn();
    const { rerender } = render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        onDeleteFactorTable={onDelete}
      />,
    );
    fireEvent.click(
      screen.getByTestId(
        "rater-parametrize-canvas-catalog-table-delete-construction_factor",
      ),
    );
    expect(onDelete).toHaveBeenCalledWith("construction_factor");
    rerender(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
      />,
    );
    expect(
      screen.queryByTestId(
        "rater-parametrize-canvas-catalog-table-delete-construction_factor",
      ),
    ).not.toBeInTheDocument();
  });

  it("'New table' fires onNewFactorTable (head + zero-state CTA)", () => {
    const onNew = vi.fn();
    const { rerender } = render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        onNewFactorTable={onNew}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-parametrize-canvas-catalog-new"),
    );
    expect(onNew).toHaveBeenCalledTimes(1);
    rerender(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={[]}
        onNewFactorTable={onNew}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-parametrize-canvas-catalog-empty-new"),
    );
    expect(onNew).toHaveBeenCalledTimes(2);
  });

  it("Import CSV renders with the write pair; the confirm COMMITS via onCreateFromCsv", async () => {
    const onNew = vi.fn();
    const onCreateFromCsv = vi.fn();
    const { rerender } = render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        onNewFactorTable={onNew}
      />,
    );
    // No onCreateFromCsv → no Import CSV affordance.
    expect(
      screen.queryByTestId("rater-parametrize-canvas-catalog-import-csv"),
    ).not.toBeInTheDocument();
    rerender(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        onNewFactorTable={onNew}
        onCreateFromCsv={onCreateFromCsv}
      />,
    );
    const input = screen.getByTestId(
      "rater-parametrize-canvas-catalog-csv-input",
    );
    const csvBody =
      "construction,Factor\nFrame,1.25\nJoisted masonry,1.0\n";
    const file = new File([csvBody], "construction_factors.csv", {
      type: "text/csv",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(csvBody),
    });
    fireEvent.change(input, { target: { files: [file] } });
    const panel = await screen.findByTestId(
      "rater-parametrize-canvas-catalog-csvnew",
    );
    expect(panel).toHaveTextContent("construction_factors.csv");
    fireEvent.click(
      screen.getByTestId("rater-parametrize-canvas-catalog-csvnew-create"),
    );
    // Brief 70 — the confirm CREATES directly (no draft hand-off).
    expect(onCreateFromCsv).toHaveBeenCalledTimes(1);
    const payload = onCreateFromCsv.mock.calls[0]![0]!;
    expect(payload.title).toBe("Construction factors");
    expect(payload.axes.rowDimSlug).toBe("construction");
    expect(payload.cells.get("frame")).toBe(1.25);
    expect(onNew).not.toHaveBeenCalled();
  });

  it("the CATALOG never clears the stored draft (the Brief 58 defeat)", async () => {
    const onDraftChange = vi.fn();
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={SAMPLE_TABLES}
        onDraftChange={onDraftChange}
      />,
    );
    // The old debounce fired onDraftChange(null) ~400ms after landing
    // on the catalog — and the route CLEARED the autosaved draft.
    await new Promise((r) => setTimeout(r, 600));
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("shows the used-by lookups when provided", () => {
    render(
      <ParametrizeCanvas
        dimensions={ALL_DIMS}
        factorTables={[
          {
            ...SAMPLE_TABLES[1]!,
            used_by: ["Construction factor · Building chain"],
          },
        ]}
      />,
    );
    expect(
      screen.getByText("Construction factor · Building chain"),
    ).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// Canvas mode body
// ──────────────────────────────────────────────────────────────────

describe("levelsForKeying (ADR-0028 territory keying)", () => {
  // A realistic State geo dim: 51 raw state levels grouped into 5
  // territory buckets (the cold-test M scenario, abbreviated).
  const STATE_LEVELS = [
    { kind: "geographic" as const, id: "CA", label: "California" },
    { kind: "geographic" as const, id: "FL", label: "Florida" },
    { kind: "geographic" as const, id: "TX", label: "Texas" },
    { kind: "geographic" as const, id: "NY", label: "New York" },
    { kind: "geographic" as const, id: "WY", label: "Wyoming" },
  ];
  const TERRITORIES = [
    { id: "territory_1", label: "T1", members: ["CA", "FL"] },
    { id: "territory_2", label: "T2", members: ["TX"] },
    { id: "territory_3", label: "T3", members: ["NY"] },
    { id: "territory_4", label: "T4", members: ["WY"] },
  ];

  it("presents territory ids (not raw states) for a grouped geo dim", () => {
    const out = levelsForKeying({
      dimension_type: "geographic",
      shape: "geographic",
      levels: STATE_LEVELS,
      geo_territories: TERRITORIES,
    });
    expect(out.map((l) => l.id)).toEqual([
      "territory_1",
      "territory_2",
      "territory_3",
      "territory_4",
    ]);
    // Labels (T1…T4) ride along so the grid + chart axis read nicely.
    expect(out.map((l) => l.label)).toEqual(["T1", "T2", "T3", "T4"]);
  });

  it("reads whatever ids the dim carries, then the ungrouped tail (ADR-0038 mixed model)", () => {
    // Legacy bare-`territory` id (pre-M9) must still surface verbatim,
    // proving the keying never assumes the territory_N naming. Under the
    // ADR-0038 mixed model a PARTIALLY grouped dim ALSO keeps its ungrouped
    // levels as keys (FL/NY/WY here) so they stay rateable instead of
    // silently dropping to the 1.0 default (the pre-ADR behavior dropped them).
    const out = levelsForKeying({
      dimension_type: "geographic",
      shape: "geographic",
      levels: STATE_LEVELS,
      geo_territories: [
        { id: "territory", label: "T1", members: ["CA"] },
        { id: "territory_2", label: "T2", members: ["TX"] },
      ],
    });
    expect(out.map((l) => l.id)).toEqual([
      "territory",
      "territory_2",
      "FL",
      "NY",
      "WY",
    ]);
  });

  it("falls back to raw state levels when the geo dim has no grouping", () => {
    // V21 behavior — "rate directly on the states." A geo dim with an
    // empty / absent territory list keeps its raw levels as keys.
    const out = levelsForKeying({
      dimension_type: "geographic",
      shape: "geographic",
      levels: STATE_LEVELS,
      geo_territories: [],
    });
    expect(out.map((l) => l.id)).toEqual(["CA", "FL", "TX", "NY", "WY"]);
  });

  it("ignores territories on a NON-geographic dim", () => {
    // Defensive — a categorical dim that somehow carries a stray
    // geo_territories array must still key on its own levels.
    const out = levelsForKeying({
      dimension_type: "standard",
      shape: "categorical",
      levels: [
        { kind: "categorical", id: "a", label: "A" },
        { kind: "categorical", id: "b", label: "B" },
      ],
      geo_territories: [{ id: "territory_1", label: "T1", members: ["a"] }],
    });
    expect(out.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("keys on territories via the `shape` discriminator alone", () => {
    // Some dims set shape='geographic' without dimension_type; the keying
    // must still trip on the territory grouping. The leading "territory_1"
    // (and the absence of a bare "CA") proves geo keying tripped; the
    // ungrouped tail (FL/TX/NY/WY) follows per the ADR-0038 mixed model.
    const out = levelsForKeying({
      shape: "geographic",
      levels: STATE_LEVELS,
      geo_territories: [{ id: "territory_1", label: "T1", members: ["CA"] }],
    });
    expect(out.map((l) => l.id)).toEqual([
      "territory_1",
      "FL",
      "TX",
      "NY",
      "WY",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Brief 53 — "+ Coverage split" (the cost-cutting affordance)
// ──────────────────────────────────────────────────────────────────
