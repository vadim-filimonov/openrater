/**
 * <OrderedSheet> tests — Brief 70 Phase 1.
 *
 * Pins the reorder contract: keyboard twin (Alt+Arrow) fires the FULL
 * new order, numbering re-flows, read-only withholds grips/actions,
 * and the aria-live announce names the new position.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OrderedSheet } from "./OrderedSheet";

const ROWS = [
  { id: "a", label: "Rule A" },
  { id: "b", label: "Rule B" },
  { id: "c", label: "Rule C" },
];

function setup(over: Record<string, unknown> = {}) {
  const onReorder = vi.fn();
  render(
    <OrderedSheet
      rows={ROWS}
      renderRow={(r) => <span>{r.label}</span>}
      onReorder={onReorder}
      ariaLabel="Rules"
      {...over}
    />,
  );
  return { onReorder };
}

describe("<OrderedSheet> (Brief 70.1)", () => {
  it("renders numbered rows in order", () => {
    setup();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("1.");
    expect(rows[0]).toHaveTextContent("Rule A");
    expect(rows[2]).toHaveTextContent("3.");
  });

  it("Alt+ArrowDown fires the FULL new id order (the keyboard twin)", () => {
    const { onReorder } = setup();
    fireEvent.keyDown(screen.getByTestId("rater-ordered-sheet-row-a"), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("Alt+ArrowUp at the top is a no-op (clamped)", () => {
    const { onReorder } = setup();
    fireEvent.keyDown(screen.getByTestId("rater-ordered-sheet-row-a"), {
      key: "ArrowUp",
      altKey: true,
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("announces the move via the live region", () => {
    setup();
    fireEvent.keyDown(screen.getByTestId("rater-ordered-sheet-row-b"), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(
      screen.getByText("Moved to position 3 of 3"),
    ).toBeInTheDocument();
  });

  it("read-only renders no grips and no actions", () => {
    setup({
      readOnly: true,
      rowActions: () => <button type="button">x</button>,
    });
    expect(
      screen.queryByTestId("rater-ordered-sheet-grip-a"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("drag + drop onto another row reorders (jsdom's zero-rect lands the below edge)", () => {
    const { onReorder } = setup();
    const grip = screen.getByTestId("rater-ordered-sheet-grip-c");
    const targetRow = screen.getByTestId("rater-ordered-sheet-row-a");
    const dt = { effectAllowed: "", setData: vi.fn(), getData: vi.fn() };
    fireEvent.dragStart(grip, { dataTransfer: dt });
    // jsdom has no layout: rects are all zeros, so the midpoint test
    // resolves "below" — dropping c onto a lands it AFTER a. The
    // above-edge arithmetic is exercised by the keyboard-twin tests.
    fireEvent.dragOver(targetRow, { dataTransfer: dt });
    fireEvent.drop(targetRow, { dataTransfer: dt });
    expect(onReorder).toHaveBeenCalledWith(["a", "c", "b"]);
  });
});
