/**
 * Brief 44 PR 44.7 — <TerritoryGrouping> component tests.
 *
 * jsdom can't simulate native HTML5 drag events realistically (no
 * DataTransfer payload, no synthetic dragover). The state-mutation
 * logic is verified separately in territoryOps.test.ts. These tests
 * focus on what IS testable: render shape, +New territory, rename,
 * delete, and the empty/populated state copy.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { TerritoryGrouping } from "./TerritoryGrouping";
import type { GeoTerritory } from "./territoryOps";

const LEVELS = [
  { kind: "categorical" as const, id: "55001", label: "Adams" },
  { kind: "categorical" as const, id: "55025", label: "Dane" },
  { kind: "categorical" as const, id: "55079", label: "Milwaukee" },
  { kind: "categorical" as const, id: "55133", label: "Waukesha" },
];

const TERRITORIES: GeoTerritory[] = [
  { id: "mke_metro", label: "Milwaukee metro", members: ["55079", "55133"] },
];

describe("<TerritoryGrouping>", () => {
  it("renders the two-column layout (Ungrouped + Territories)", () => {
    render(
      <TerritoryGrouping
        levels={LEVELS}
        territories={TERRITORIES}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Ungrouped levels")).toBeInTheDocument();
    expect(screen.getByText("Territories")).toBeInTheDocument();
  });

  it("ungrouped column lists levels not in any territory", () => {
    render(
      <TerritoryGrouping
        levels={LEVELS}
        territories={TERRITORIES}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Adams")).toBeInTheDocument();
    expect(screen.getByText("Dane")).toBeInTheDocument();
    // Milwaukee + Waukesha are in MKE metro, so they appear inside
    // the bucket, not the ungrouped column.
    expect(screen.getAllByText("Milwaukee")).toHaveLength(1);
  });

  it("bucket shows the territory name + member count + delete button", () => {
    render(
      <TerritoryGrouping
        levels={LEVELS}
        territories={TERRITORIES}
        onChange={() => {}}
      />,
    );
    const nameInput = screen.getByLabelText(/Rename territory/) as HTMLInputElement;
    expect(nameInput.value).toBe("Milwaukee metro");
    expect(
      screen.getByRole("button", { name: /Delete Milwaukee metro/ }),
    ).toBeInTheDocument();
  });

  it("renaming a bucket fires onChange with the new label", () => {
    const onChange = vi.fn();
    render(
      <TerritoryGrouping
        levels={LEVELS}
        territories={TERRITORIES}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Rename territory/), {
      target: { value: "Greater Milwaukee" },
    });
    expect(onChange).toHaveBeenCalledWith([
      { ...TERRITORIES[0], label: "Greater Milwaukee" },
    ]);
  });

  it("delete button fires onChange without the territory", () => {
    const onChange = vi.fn();
    render(
      <TerritoryGrouping
        levels={LEVELS}
        territories={TERRITORIES}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Delete Milwaukee metro/ }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("+ New territory appends an empty territory", () => {
    const onChange = vi.fn();
    render(
      <TerritoryGrouping
        levels={LEVELS}
        territories={TERRITORIES}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New territory/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as GeoTerritory[];
    expect(next).toHaveLength(2);
    expect(next[1]?.label).toBe("New territory");
    expect(next[1]?.members).toEqual([]);
  });

  it("empty-everywhere shows the 'every level is in a territory' empty state", () => {
    const onChange = vi.fn();
    const allInOne: GeoTerritory[] = [
      {
        id: "all",
        label: "All",
        members: LEVELS.map((l) => l.id),
      },
    ];
    render(
      <TerritoryGrouping
        levels={LEVELS}
        territories={allInOne}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByText(/Every level is in a territory/),
    ).toBeInTheDocument();
  });

  it("empty bucket shows the 'Drop levels here' hint", () => {
    const onChange = vi.fn();
    const empty: GeoTerritory[] = [
      { id: "empty", label: "Empty bucket", members: [] },
    ];
    render(
      <TerritoryGrouping
        levels={LEVELS}
        territories={empty}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Drop levels here")).toBeInTheDocument();
  });

  // V8 — a real filing groups hundreds of ZIPs into a territory; the bucket
  // must cap the preview and expand on demand, not render them all at once.
  it("caps a large bucket's member chips and expands on click", () => {
    const manyLevels = Array.from({ length: 30 }, (_, i) => ({
      kind: "categorical" as const,
      id: `z${String(i).padStart(3, "0")}`,
      label: `City ${i}`,
    }));
    const bigTerr: GeoTerritory[] = [
      { id: "t1", label: "Big territory", members: manyLevels.map((l) => l.id) },
    ];
    const { container } = render(
      <TerritoryGrouping levels={manyLevels} territories={bigTerr} onChange={() => {}} />,
    );
    // Capped at 24 chips, with a "+6 more" toggle.
    expect(container.querySelectorAll("[data-level-id]")).toHaveLength(24);
    const more = screen.getByText("+6 more");
    fireEvent.click(more);
    expect(container.querySelectorAll("[data-level-id]")).toHaveLength(30);
    expect(screen.getByText("Show fewer")).toBeInTheDocument();
  });

  it("disambiguates duplicate city labels via a ZIP tooltip on the chip", () => {
    const dupLevels = [
      { kind: "categorical" as const, id: "66044", label: "LAWRENCE" },
      { kind: "categorical" as const, id: "66045", label: "LAWRENCE" },
    ];
    const terr: GeoTerritory[] = [
      { id: "t1", label: "T", members: ["66044", "66045"] },
    ];
    const { container } = render(
      <TerritoryGrouping levels={dupLevels} territories={terr} onChange={() => {}} />,
    );
    const chip = container.querySelector('[data-level-id="66044"]');
    expect(chip?.getAttribute("title")).toBe("66044 · LAWRENCE");
  });
});
