/**
 * Brief 45 PR 45.4 — <OutlierDrawer> tests.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OutlierDrawer } from "./OutlierDrawer";
import {
  computeFactorDistribution,
  type OutlierEntry,
} from "../FactorTableViz/factorDistribution";

function entries(n: number): OutlierEntry[] {
  const distribution = computeFactorDistribution({
    data: Array.from({ length: n }, (_, i) => ({
      key: `k${i}`,
      label: `Level ${i}`,
      value: 1.0 + (i - n / 2) / n,
    })),
  });
  return distribution.allRankedByDeviation.slice() as OutlierEntry[];
}

describe("<OutlierDrawer>", () => {
  it("renders nothing when open is false", () => {
    render(
      <OutlierDrawer
        open={false}
        onClose={vi.fn()}
        entries={entries(5)}
      />,
    );
    expect(screen.queryByTestId("rater-outlier-drawer")).toBeNull();
  });

  it("renders all the entries when open is true", () => {
    const es = entries(8);
    render(<OutlierDrawer open onClose={vi.fn()} entries={es} />);
    for (const e of es) {
      expect(
        screen.getByTestId(`rater-outlier-drawer-row-${e.key}`),
      ).toBeInTheDocument();
    }
  });

  it("renders the title with the entry count + table label", () => {
    render(
      <OutlierDrawer
        open
        onClose={vi.fn()}
        entries={entries(50)}
        tableLabel="class_code_factor"
      />,
    );
    const drawer = screen.getByTestId("rater-outlier-drawer");
    expect(drawer.textContent).toContain("All 50 levels in class_code_factor");
  });

  it("emits onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<OutlierDrawer open onClose={onClose} entries={entries(5)} />);
    fireEvent.click(screen.getByTestId("rater-outlier-drawer-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("emits onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<OutlierDrawer open onClose={onClose} entries={entries(5)} />);
    fireEvent.click(screen.getByTestId("rater-outlier-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when the drawer body is clicked (stops propagation)", () => {
    const onClose = vi.fn();
    render(<OutlierDrawer open onClose={onClose} entries={entries(5)} />);
    fireEvent.click(screen.getByTestId("rater-outlier-drawer-list"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("emits onOutlierClick(key) when a row is clicked", () => {
    const onOutlierClick = vi.fn();
    const es = entries(5);
    render(
      <OutlierDrawer
        open
        onClose={vi.fn()}
        entries={es}
        onOutlierClick={onOutlierClick}
      />,
    );
    const firstKey = es[0]!.key;
    fireEvent.click(
      screen.getByTestId(`rater-outlier-drawer-row-${firstKey}`),
    );
    expect(onOutlierClick).toHaveBeenCalledWith(firstKey);
  });

  it("closes on Escape key press", () => {
    const onClose = vi.fn();
    render(<OutlierDrawer open onClose={onClose} entries={entries(3)} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an empty-state message when there are no entries", () => {
    render(<OutlierDrawer open onClose={vi.fn()} entries={[]} />);
    const drawer = screen.getByTestId("rater-outlier-drawer");
    expect(drawer.textContent).toContain("No levels to rank.");
  });

  it("renders the gradient-colored rank chips", () => {
    const es = entries(3);
    render(<OutlierDrawer open onClose={vi.fn()} entries={es} />);
    const firstRow = screen.getByTestId(
      `rater-outlier-drawer-row-${es[0]!.key}`,
    );
    const rank = firstRow.querySelector(".rater-outlier-drawer__rank");
    // Rank chip color is set via inline style from factorGradient.
    // The browser normalizes the hex value to an rgb() string, so
    // assert non-empty + the rgb shape.
    const color = (rank as HTMLElement)?.style.color;
    expect(color).toBeTruthy();
    expect(color).toMatch(/^rgb\(\d+,\s*\d+,\s*\d+\)$/);
  });
});
