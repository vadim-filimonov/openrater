/**
 * Brief 66 §3.1 — the keyed-by-mutable-id focus regression.
 *
 * Rows used to key on `level.id` while the id is an editable field
 * (and label-drives-id rewrites it): committing an id change remounted
 * the row, destroying the DOM nodes mid-keystroke and dumping focus to
 * <body>. These tests pin the fix: a commit that REWRITES the id keeps
 * the same DOM nodes (no remount), drafts re-seed from props when the
 * cell is not being edited, and reorders/insertions keep uid identity
 * aligned.
 */

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LevelRowsTable, type LevelRow } from "./LevelRowsTable";

/** A consumer harness mimicking dims2's label-drives-id commit. */
function Harness({ initial }: { readonly initial: readonly LevelRow[] }) {
  const [levels, setLevels] = useState<readonly LevelRow[]>(initial);
  return (
    <LevelRowsTable
      shape="categorical"
      levels={levels}
      onAddLevel={() =>
        setLevels((ls) => [
          ...ls,
          { kind: "categorical", id: `level_${ls.length + 1}`, label: "" },
        ])
      }
      onRemoveLevel={(id) => setLevels((ls) => ls.filter((l) => l.id !== id))}
      onUpdateLevel={(id, patch) =>
        setLevels((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
      }
      onReorderLevels={(ids) =>
        setLevels((ls) =>
          ids.map((id) => ls.find((l) => l.id === id)!).filter(Boolean),
        )
      }
    />
  );
}

const LEVELS: readonly LevelRow[] = [
  { kind: "categorical", id: "frame", label: "Frame" },
  { kind: "categorical", id: "masonry", label: "Masonry" },
];

describe("<LevelRowsTable> — stable row identity (Brief 66 §3.1)", () => {
  it("an id-rewriting label commit does NOT remount the row", () => {
    render(<Harness initial={LEVELS} />);
    const labelBefore = screen.getByTestId(
      "rater-level-rows-table-row-frame-label",
    ) as HTMLInputElement;
    const rowBefore = labelBefore.closest(".rater-dim-levels__row");

    // Label-drives-id: typing a new label rewrites the id on blur.
    fireEvent.change(labelBefore, { target: { value: "Fire resistive" } });
    fireEvent.blur(labelBefore);

    // The id changed (the commit went through)…
    const idAfter = screen.getByTestId(
      "rater-level-rows-table-row-fire_resistive-id",
    ) as HTMLInputElement;
    expect(idAfter.value).toBe("fire_resistive");
    // …but the DOM nodes are the SAME — no remount, focus survives.
    const labelAfter = screen.getByTestId(
      "rater-level-rows-table-row-fire_resistive-label",
    );
    expect(labelAfter).toBe(labelBefore);
    expect(labelAfter.closest(".rater-dim-levels__row")).toBe(rowBefore);
  });

  it("a manual id-cell commit keeps the row's nodes too", () => {
    render(<Harness initial={LEVELS} />);
    const idInput = screen.getByTestId(
      "rater-level-rows-table-row-masonry-id",
    ) as HTMLInputElement;
    fireEvent.change(idInput, { target: { value: "joisted_masonry" } });
    fireEvent.blur(idInput);
    const after = screen.getByTestId("rater-level-rows-table-row-joisted_masonry-id");
    expect(after).toBe(idInput);
    expect((after as HTMLInputElement).value).toBe("joisted_masonry");
  });

  it("drafts re-seed from props when the cell is not being edited", () => {
    function ExternalRename() {
      const [levels, setLevels] = useState<readonly LevelRow[]>(LEVELS);
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setLevels((ls) =>
                ls.map((l) =>
                  l.id === "frame" ? { ...l, label: "Frame (ISO 1)" } : l,
                ),
              )
            }
          >
            external rename
          </button>
          <LevelRowsTable
            shape="categorical"
            levels={levels}
            onAddLevel={() => {}}
            onRemoveLevel={() => {}}
            onUpdateLevel={(id, patch) =>
              setLevels((ls) =>
                ls.map((l) => (l.id === id ? { ...l, ...patch } : l)),
              )
            }
            onReorderLevels={() => {}}
          />
        </>
      );
    }
    render(<ExternalRename />);
    fireEvent.click(screen.getByText("external rename"));
    const label = screen.getByTestId(
      "rater-level-rows-table-row-frame-label",
    ) as HTMLInputElement;
    expect(label.value).toBe("Frame (ISO 1)");
  });

  it("an insertion mints a fresh uid without disturbing neighbors", () => {
    render(<Harness initial={LEVELS} />);
    const masonryLabel = screen.getByTestId("rater-level-rows-table-row-masonry-label");
    fireEvent.click(screen.getByRole("button", { name: /Add another level/ }));
    // The pre-existing row's nodes survive the insertion.
    expect(screen.getByTestId("rater-level-rows-table-row-masonry-label")).toBe(
      masonryLabel,
    );
    // And the new row rendered.
    expect(
      screen.getByTestId("rater-level-rows-table-row-level_3-label"),
    ).toBeInTheDocument();
  });
});
