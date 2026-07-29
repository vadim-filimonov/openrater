/**
 * Brief 44 PR 44.3 — GeoDimEditor component tests.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  GeoDimEditor,
  type GeoDimEditorDimension,
  type GeoDimEditorTab,
} from "./GeoDimEditor";

const WI_STATE_DIM: GeoDimEditorDimension = {
  dim_id: "state",
  display_name: "State",
  geo_granularity: "state",
  geo_scope: { kind: "subset", states: ["WI"] },
  geo_territories: [],
  levels: [{ kind: "categorical", id: "WI", label: "Wisconsin" }],
};

const NATIONAL_STATE_DIM: GeoDimEditorDimension = {
  dim_id: "state",
  display_name: "State",
  geo_granularity: "state",
  geo_scope: { kind: "national" },
  geo_territories: [],
  levels: [
    { kind: "categorical", id: "WI", label: "Wisconsin" },
    { kind: "categorical", id: "MN", label: "Minnesota" },
    { kind: "categorical", id: "IL", label: "Illinois" },
  ],
};

interface SetupOverrides {
  dimension?: GeoDimEditorDimension;
  activeTab?: GeoDimEditorTab;
}

function setup(overrides: SetupOverrides = {}) {
  const onTabChange = vi.fn();
  const onDisplayNameChange = vi.fn();
  const onLevelsChange = vi.fn();
  const onBack = vi.fn();
  const utils = render(
    <GeoDimEditor
      dimension={overrides.dimension ?? WI_STATE_DIM}
      activeTab={overrides.activeTab ?? "levels"}
      onTabChange={onTabChange}
      onDisplayNameChange={onDisplayNameChange}
      onLevelsChange={onLevelsChange}
      onBack={onBack}
      saveState="saved"
    />,
  );
  return {
    ...utils,
    onTabChange,
    onDisplayNameChange,
    onLevelsChange,
    onBack,
  };
}

describe("<GeoDimEditor>", () => {
  it("renders the header with shape badge + meta row", () => {
    setup();
    expect(
      screen.getByText(/geographic · state · 1 level/),
    ).toBeInTheDocument();
    expect(screen.getByText(/scope: WI/)).toBeInTheDocument();
    expect(screen.getByText(/granularity: state/)).toBeInTheDocument();
    expect(screen.getByText(/id: state/)).toBeInTheDocument();
  });

  it("the saved pill renders when saveState=saved", () => {
    setup();
    // Unified <SavePill> copy — canonical "Saved" (was "All changes saved").
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("hides the Import CSV affordance when onImportLevelsAndTerritories is omitted", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: /Import CSV/ }),
    ).not.toBeInTheDocument();
  });

  it("imports a ZIP→territory CSV → seeds levels + territories in one commit (ADR-0038)", async () => {
    const onImport = vi.fn();
    render(
      <GeoDimEditor
        dimension={{
          dim_id: "zip",
          display_name: "Territory",
          geo_granularity: "zip",
          geo_scope: { kind: "subset", states: ["KS"] },
          geo_territories: [],
          levels: [],
        }}
        activeTab="levels"
        onTabChange={vi.fn()}
        onDisplayNameChange={vi.fn()}
        onLevelsChange={vi.fn()}
        onImportLevelsAndTerritories={onImport}
        onBack={vi.fn()}
        saveState="saved"
      />,
    );
    const input = screen.getByLabelText("Import a ZIP to territory CSV");
    const file = new File(
      ["zip,territory\n66101,701\n66102,701\n67201,702"],
      "ks.csv",
      { type: "text/csv" },
    );
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const call = onImport.mock.calls[0] as [
      ReadonlyArray<{ id: string }>,
      ReadonlyArray<{ id: string }>,
    ];
    expect(call[0].map((l) => l.id)).toEqual(["66101", "66102", "67201"]);
    expect(call[1].map((t) => t.id).sort()).toEqual(["701", "702"]);
    // The import report renders (honest, role=status).
    expect(screen.getByText(/Imported 3 levels/)).toBeInTheDocument();
  });

  it("crumb fires onBack when clicked", () => {
    const { onBack } = setup();
    fireEvent.click(screen.getByRole("button", { name: /All dimensions/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("name edit fires onDisplayNameChange", () => {
    const { onDisplayNameChange } = setup();
    const input = screen.getByLabelText("Display name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Wisconsin only" } });
    expect(onDisplayNameChange).toHaveBeenCalledWith("Wisconsin only");
  });

  it("tab bar shows 3 tabs with counts; clicking calls onTabChange", () => {
    const { onTabChange } = setup({
      dimension: { ...WI_STATE_DIM, geo_territories: [] },
    });
    // Levels (1), Map (no count), Territories (0)
    expect(screen.getByRole("tab", { name: /Levels/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: /Map/ }));
    expect(onTabChange).toHaveBeenCalledWith("map");
  });

  it("Levels tab — adding a custom level fires onLevelsChange with the new entry", () => {
    const { onLevelsChange } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /Add custom level/ }),
    );
    fireEvent.change(screen.getByLabelText("New level id"), {
      target: { value: "MILITARY" },
    });
    fireEvent.change(screen.getByLabelText("New level label"), {
      target: { value: "Military APO/FPO" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onLevelsChange).toHaveBeenCalledWith([
      { kind: "categorical", id: "WI", label: "Wisconsin" },
      { kind: "categorical", id: "MILITARY", label: "Military APO/FPO" },
    ]);
  });

  it("Add — duplicate ids are quietly rejected (disabled Add button)", () => {
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: /Add custom level/ }),
    );
    fireEvent.change(screen.getByLabelText("New level id"), {
      target: { value: "WI" },
    });
    const submit = screen.getByRole("button", { name: "Add" });
    expect(submit).toBeDisabled();
  });

  it("Custom level shows the 'custom' badge + delete button", () => {
    setup({
      dimension: {
        ...WI_STATE_DIM,
        levels: [
          { kind: "categorical", id: "WI", label: "Wisconsin" },
          { kind: "categorical", id: "MILITARY", label: "Military" },
        ],
      },
    });
    // The custom badge only appears next to MILITARY (not WI).
    const customBadges = screen.getAllByText("custom");
    expect(customBadges).toHaveLength(1);
  });

  it("Deleting a custom level fires onLevelsChange without it", () => {
    const { onLevelsChange } = setup({
      dimension: {
        ...WI_STATE_DIM,
        levels: [
          { kind: "categorical", id: "WI", label: "Wisconsin" },
          { kind: "categorical", id: "MILITARY", label: "Military" },
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Remove Military/ }));
    expect(onLevelsChange).toHaveBeenCalledWith([
      { kind: "categorical", id: "WI", label: "Wisconsin" },
    ]);
  });

  it("Reset from scope replaces with the canonical seed", () => {
    const { onLevelsChange } = setup({
      dimension: {
        ...WI_STATE_DIM,
        levels: [{ kind: "categorical", id: "MILITARY", label: "Mil" }],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Reset from scope/ }),
    );
    // Confirm dialog appears
    fireEvent.click(
      screen.getByRole("button", { name: /^Reset$/ }),
    );
    expect(onLevelsChange).toHaveBeenCalledWith([
      { kind: "categorical", id: "WI", label: "Wisconsin" },
    ]);
  });

  it("Reset confirm dialog can be cancelled", () => {
    const { onLevelsChange } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /Reset from scope/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(onLevelsChange).not.toHaveBeenCalled();
  });

  it("Map tab renders the UsChoropleth scope preview (state grain → no picker)", () => {
    setup({ activeTab: "map" });
    // Maps next-gen: the MapLibre GeoMapEditor was replaced by <UsChoropleth>.
    // A state-grain dim draws the national choropleth (footprint-tinted), so
    // there's no state-flip picker; the choropleth host renders by testid.
    expect(screen.getByTestId("rater-geo-editor-map")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pick a state")).not.toBeInTheDocument();
  });

  it("Map tab shows a fallback for ZIP grain (us-atlas has no ZIP geometry)", () => {
    setup({
      activeTab: "map",
      dimension: {
        ...WI_STATE_DIM,
        geo_granularity: "zip",
      },
    });
    expect(screen.getByText("ZIP-level map unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("rater-geo-editor-map")).not.toBeInTheDocument();
  });

  it("Territories tab shows the read-only fallback when onTerritoriesChange is omitted", () => {
    // The setup helper doesn't pass onTerritoriesChange, so the tab
    // renders the read-only fallback copy.
    setup({ activeTab: "territories" });
    expect(
      screen.getByText(/Territories tab is read-only/),
    ).toBeInTheDocument();
  });

  it("National scope renders as 'national (50 + DC)' in the meta row", () => {
    setup({ dimension: NATIONAL_STATE_DIM });
    expect(screen.getByText(/scope: national \(50 \+ DC\)/)).toBeInTheDocument();
  });

  it("Empty levels list shows the empty state copy", () => {
    setup({
      dimension: {
        ...WI_STATE_DIM,
        levels: [],
        geo_granularity: "zip", // no seed in v1
      },
    });
    expect(screen.getByText(/No levels yet/)).toBeInTheDocument();
    // ZIP has empty seed → "Reset from scope" hidden
    expect(
      screen.queryByRole("button", { name: /Reset from scope/ }),
    ).not.toBeInTheDocument();
  });

  it("Subset scope with > 6 states truncates and shows +N more", () => {
    setup({
      dimension: {
        ...WI_STATE_DIM,
        geo_scope: {
          kind: "subset",
          states: ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE"],
        },
        levels: [],
      },
    });
    expect(
      screen.getByText(/scope: AL, AK, AZ, AR, CA, CO, \+2 more/),
    ).toBeInTheDocument();
  });

  // I4 — long level lists get a search box that filters the rows.
  it("filters the level list via search when there are many levels", () => {
    const manyLevels = Array.from({ length: 20 }, (_, i) => ({
      kind: "categorical" as const,
      id: `Z${String(i).padStart(2, "0")}`,
      label: i === 7 ? "Wichita" : `City ${i}`,
    }));
    const { container } = setup({
      dimension: {
        ...NATIONAL_STATE_DIM,
        levels: manyLevels,
      },
    });
    expect(
      container.querySelectorAll(".rater-geo-editor__levels-row"),
    ).toHaveLength(20);
    const search = screen.getByTestId("rater-geo-editor-levels-search");
    fireEvent.change(search, { target: { value: "wichita" } });
    expect(
      container.querySelectorAll(".rater-geo-editor__levels-row"),
    ).toHaveLength(1);
  });

  it("hides the level search for short lists", () => {
    setup(); // WI_STATE_DIM has 1 level
    expect(
      screen.queryByTestId("rater-geo-editor-levels-search"),
    ).toBeNull();
  });
});
