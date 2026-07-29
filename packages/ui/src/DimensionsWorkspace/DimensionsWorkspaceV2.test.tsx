/**
 * <DimensionsWorkspaceV2> — P1 shell tests.
 *
 * The 2-column view: a filterable list on the left + the selected dimension's
 * detail inline on the right. §2B — same props as v1; this asserts the shell.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DimensionsWorkspaceV2 } from "./DimensionsWorkspaceV2";
import type { DimensionRow } from "../DimensionsTable";

const DIMS: readonly DimensionRow[] = [
  {
    id: "construction_class",
    display_name: "Construction Class",
    slug: "construction_class",
    levels: [
      { kind: "categorical", id: "frame", label: "Frame" },
      { kind: "categorical", id: "jm", label: "Joisted Masonry" },
    ],
  },
  {
    id: "building_age",
    display_name: "Building Age",
    slug: "building_age",
    shape: "banded",
    levels: [{ kind: "banded", id: "0_10", label: "0–10", lo: 0, hi: 10 }],
  },
  {
    id: "territory",
    display_name: "Territory",
    slug: "territory",
    dimension_type: "geographic",
    levels: [{ kind: "geographic", id: "701", label: "701" }],
  },
];

describe("<DimensionsWorkspaceV2> — shell (P1)", () => {
  it("lists every dimension with its tinted tile and full count", () => {
    const { container } = render(<DimensionsWorkspaceV2 dimensions={DIMS} />);
    const list = within(
      container.querySelector(".rater-dims2__rows") as HTMLElement,
    );
    expect(list.getByText("Construction Class")).toBeInTheDocument();
    expect(list.getByText("Building Age")).toBeInTheDocument();
    expect(list.getByText("Territory")).toBeInTheDocument();
    // Wave 3 — the count keeps its unit; the redundant shape chip is gone
    // (the tinted tile is the one shape signal).
    expect(list.getByText("2 levels")).toBeInTheDocument();
    expect(list.getByText("1 band")).toBeInTheDocument();
    expect(
      container.querySelector(".rater-dims2__shape--banded"),
    ).not.toBeNull();
    expect(container.querySelector(".rater-dims2__rows .rater-chip")).toBeNull();
  });

  it("filters the list by shape via the Segmented control", () => {
    const { container } = render(<DimensionsWorkspaceV2 dimensions={DIMS} />);
    fireEvent.click(screen.getByRole("radio", { name: "Banded" }));
    const list = within(
      container.querySelector(".rater-dims2__rows") as HTMLElement,
    );
    expect(list.getByText("Building Age")).toBeInTheDocument();
    // filtered out of the LIST — but the auto-selected detail keeps
    // rendering it (filtering never destroys an open selection).
    expect(list.queryByText("Construction Class")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Construction Class" }),
    ).toBeInTheDocument();
  });

  it("filters the list by search", () => {
    const { container } = render(<DimensionsWorkspaceV2 dimensions={DIMS} />);
    fireEvent.change(screen.getByLabelText("Search dimensions"), {
      target: { value: "territ" },
    });
    const list = within(
      container.querySelector(".rater-dims2__rows") as HTMLElement,
    );
    expect(list.getByText("Territory")).toBeInTheDocument();
    expect(list.queryByText("Building Age")).not.toBeInTheDocument();
  });

  it("auto-selects the first dimension; clicking another switches the detail", () => {
    render(<DimensionsWorkspaceV2 dimensions={DIMS} />);
    // Wave 3 — the empty pane is an edge case: the first dim opens
    // immediately (read-only here — no onCommit).
    expect(
      screen.getByRole("heading", { name: "Construction Class" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Frame")).toBeInTheDocument();
    expect(screen.getByText("Joisted Masonry")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Building Age"));
    expect(
      screen.getByRole("heading", { name: "Building Age" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Frame")).not.toBeInTheDocument();
  });

  it("shows the zero-dimensions empty state only when there are none", () => {
    render(<DimensionsWorkspaceV2 dimensions={[]} onAdd={vi.fn()} />);
    expect(screen.getByText("No dimensions yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add a categorical dimension/ }),
    ).toBeInTheDocument();
  });

  it("shows the Add-shape menu only when editable (onAdd present)", () => {
    const onAdd = vi.fn();
    const { rerender } = render(<DimensionsWorkspaceV2 dimensions={DIMS} />);
    expect(
      screen.queryByRole("button", { name: "Add" }),
    ).not.toBeInTheDocument();

    rerender(<DimensionsWorkspaceV2 dimensions={DIMS} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Banded/ }));
    expect(onAdd).toHaveBeenCalledWith("banded");
  });
});

describe("<DimensionsWorkspaceV2> — editable detail (P2)", () => {
  it("renders a read-only detail (no inputs) when onCommitDimension is absent", () => {
    render(<DimensionsWorkspaceV2 dimensions={DIMS} />);
    // the auto-selected first dim renders as a static heading, no inputs
    expect(
      screen.queryByRole("textbox", { name: "Dimension display name" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Construction Class" }),
    ).toBeInTheDocument();
  });

  it("commits a display-name edit on blur (and syncs the id)", () => {
    const onCommitDimension = vi.fn();
    render(
      <DimensionsWorkspaceV2
        dimensions={DIMS}
        onCommitDimension={onCommitDimension}
      />,
    );
    fireEvent.click(screen.getByText("Construction Class"));
    const nameInput = screen.getByRole("textbox", {
      name: "Dimension display name",
    });
    fireEvent.change(nameInput, { target: { value: "Build Class" } });
    fireEvent.blur(nameInput);
    expect(onCommitDimension).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "construction_class",
        display_name: "Build Class",
        slug: "build_class", // label-drives-id while not overridden
      }),
    );
  });

  it("commits an added level through the reused level grid", () => {
    const onCommitDimension = vi.fn();
    render(
      <DimensionsWorkspaceV2
        dimensions={DIMS}
        onCommitDimension={onCommitDimension}
      />,
    );
    fireEvent.click(screen.getByText("Construction Class")); // 2 levels
    fireEvent.click(screen.getByRole("button", { name: "Add another level" }));
    expect(onCommitDimension).toHaveBeenCalledTimes(1);
    const committed = onCommitDimension.mock.calls[0]![0] as {
      levels: readonly unknown[];
    };
    expect(committed.levels).toHaveLength(3);
  });

  it("renders the sync-blocked banner with retry (Brief 66 §3.2)", () => {
    const onRetrySync = vi.fn();
    render(
      <DimensionsWorkspaceV2
        dimensions={DIMS}
        syncBlocked
        onRetrySync={onRetrySync}
      />,
    );
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Changes aren't being saved");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetrySync).toHaveBeenCalledOnce();
    // healthy state renders no banner
  });

  it("renders no banner when the sync is healthy", () => {
    render(<DimensionsWorkspaceV2 dimensions={DIMS} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces banded gaps inline with a one-click fix (Brief 66 §3.5)", () => {
    const onCommitDimension = vi.fn();
    const GAPPED: readonly DimensionRow[] = [
      {
        id: "tiv",
        display_name: "TIV",
        slug: "tiv",
        shape: "banded",
        levels: [
          { kind: "banded", id: "b0", label: "Small", lo: 0, hi: 100 },
          // gap: 100 ≤ x < 500 is uncovered
          { kind: "banded", id: "b1", label: "Large", lo: 500, hi: 1000 },
        ],
      },
    ];
    render(
      <DimensionsWorkspaceV2
        dimensions={GAPPED}
        onCommitDimension={onCommitDimension}
      />,
    );
    // The gap renders as an inline warning row between the bands…
    expect(screen.getByText("Coverage gap")).toBeInTheDocument();
    // …with the one-click fix that inserts a band spanning the gap.
    fireEvent.click(screen.getByRole("button", { name: /Add band/ }));
    expect(onCommitDimension).toHaveBeenCalledTimes(1);
    const committed = onCommitDimension.mock.calls[0]![0] as {
      levels: readonly { lo?: number; hi?: number }[];
    };
    expect(committed.levels).toHaveLength(3);
    expect(committed.levels[1]).toMatchObject({ lo: 100, hi: 500 });
  });

  it("surfaces duplicate level ids inline (Brief 66 §3.5)", () => {
    const DUP: readonly DimensionRow[] = [
      {
        id: "construction",
        display_name: "Construction",
        slug: "construction",
        levels: [
          { kind: "categorical", id: "frame", label: "Frame" },
          { kind: "categorical", id: "frame", label: "Frame again" },
        ],
      },
    ];
    render(
      <DimensionsWorkspaceV2 dimensions={DUP} onCommitDimension={vi.fn()} />,
    );
    expect(screen.getByText("Duplicate id")).toBeInTheDocument();
    expect(
      screen.getByText(/already names level 1/),
    ).toBeInTheDocument();
  });

  it("an open-ended band renders an empty hi cell and splits on add (Brief 66 §3.5)", () => {
    const onCommitDimension = vi.fn();
    const OPEN: readonly DimensionRow[] = [
      {
        id: "tiv",
        display_name: "TIV",
        slug: "tiv",
        shape: "banded",
        levels: [
          {
            kind: "banded",
            id: "band_0_up",
            label: "All",
            lo: 0,
            hi: Number.POSITIVE_INFINITY,
          },
        ],
      },
    ];
    render(
      <DimensionsWorkspaceV2
        dimensions={OPEN}
        onCommitDimension={onCommitDimension}
      />,
    );
    // The open hi renders as an EMPTY input ("no cap"), not "Infinity".
    const hiInput = document.querySelector(
      ".rater-dim-levels__banded-input--hi",
    ) as HTMLInputElement;
    expect(hiInput.value).toBe("");
    expect(hiInput.placeholder).toBe("no cap");
    // Add another level SPLITS the open tail: [0,∞) -> [0,100) + [100,∞).
    fireEvent.click(screen.getByRole("button", { name: "Add another level" }));
    const committed = onCommitDimension.mock.calls[0]![0] as {
      levels: readonly { lo?: number; hi?: number }[];
    };
    expect(committed.levels).toHaveLength(2);
    expect(committed.levels[0]).toMatchObject({ lo: 0, hi: 100 });
    expect(committed.levels[1]!.lo).toBe(100);
    expect(committed.levels[1]!.hi).toBe(Number.POSITIVE_INFINITY);
  });

  it("deletes via the ⋯ actions menu (fires the route's impact handler)", () => {
    const onDeleteDimension = vi.fn();
    render(
      <DimensionsWorkspaceV2
        dimensions={DIMS}
        onCommitDimension={vi.fn()}
        onDeleteDimension={onDeleteDimension}
      />,
    );
    fireEvent.click(screen.getByText("Building Age"));
    fireEvent.click(screen.getByRole("button", { name: "Dimension actions" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Delete dimension/ }),
    );
    expect(onDeleteDimension).toHaveBeenCalledWith("building_age");
  });
});
