/**
 * <FactorTablesTable> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FactorTablesTable,
  type FactorTableRow,
} from "./FactorTablesTable";

const SAMPLE: FactorTableRow[] = [
  {
    id: "class_factor",
    display_name: "Class factor table",
    slug: "class_factor",
    description: "Class-code → rate factor multiplier",
    key_dimension: "class_code",
  },
  {
    id: "construction_factor",
    display_name: "Construction factor table",
    slug: "construction_factor",
    description:
      "Construction class → rate factor multiplier (frame, masonry, …)",
    key_dimension: "construction_class",
  },
  {
    id: "untyped",
    display_name: "Untyped table",
    slug: "untyped",
  },
];

describe("<FactorTablesTable> — empty state", () => {
  it("shows the empty headline when no tables are passed", () => {
    render(<FactorTablesTable tables={[]} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/No factor tables yet/i)).toBeInTheDocument();
  });

  it("includes a hint about what factor tables are + the optional CTA", () => {
    render(
      <FactorTablesTable
        tables={[]}
        emptyAction={<button type="button">New table</button>}
      />,
    );
    expect(
      screen.getByText(/import a CSV and the axes are inferred/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New table" }),
    ).toBeInTheDocument();
  });
});

describe("<FactorTablesTable> — rendering", () => {
  it("renders one row per table", () => {
    render(<FactorTablesTable tables={SAMPLE} />);
    expect(screen.getByText("Class factor table")).toBeInTheDocument();
    expect(screen.getByText("Construction factor table")).toBeInTheDocument();
    expect(screen.getByText("Untyped table")).toBeInTheDocument();
  });

  it("renders descriptions when present", () => {
    render(<FactorTablesTable tables={SAMPLE} />);
    expect(
      screen.getByText("Class-code → rate factor multiplier"),
    ).toBeInTheDocument();
  });

  it("renders the Axes column (axes_label preferred, key dims as fallback)", () => {
    render(
      <FactorTablesTable
        tables={[
          { ...SAMPLE[0]!, axes_label: "Class code" },
          SAMPLE[1]!,
        ]}
      />,
    );
    // axes_label wins over the raw key_dimension slug.
    expect(screen.getByText("Class code")).toBeInTheDocument();
    expect(screen.queryByText("class_code")).not.toBeInTheDocument();
    expect(screen.getByText("construction_class")).toBeInTheDocument();
  });

  it("renders muted dashes for missing axes / counts / used-by", () => {
    render(<FactorTablesTable tables={SAMPLE} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders factor counts formatted + used-by labels", () => {
    render(
      <FactorTablesTable
        tables={[
          {
            ...SAMPLE[0]!,
            cell_count: 1424,
            used_by: ["Class factor · Building chain"],
          },
        ]}
      />,
    );
    expect(screen.getByText("1,424")).toBeInTheDocument();
    expect(
      screen.getByText("Class factor · Building chain"),
    ).toBeInTheDocument();
  });

  it("uses the right aria-label", () => {
    render(<FactorTablesTable tables={SAMPLE} />);
    expect(
      screen.getByRole("table", { name: /Factor tables/i }),
    ).toBeInTheDocument();
  });

  it("onOpen makes the name a button that fires with the id", () => {
    const onOpen = vi.fn();
    render(<FactorTablesTable tables={SAMPLE} onOpen={onOpen} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Class factor table" }),
    );
    expect(onOpen).toHaveBeenCalledWith("class_factor");
  });
});

describe("<FactorTablesTable> — action callbacks", () => {
  it("does not render edit/delete buttons when no callbacks are passed", () => {
    render(<FactorTablesTable tables={SAMPLE} />);
    expect(
      screen.queryByRole("button", { name: /^Edit /i }),
    ).not.toBeInTheDocument();
  });

  it("fires onEdit + onDelete with the right id", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <FactorTablesTable tables={SAMPLE} onEdit={onEdit} onDelete={onDelete} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Edit Construction factor table/i,
      }),
    );
    expect(onEdit).toHaveBeenCalledWith("construction_factor");
    fireEvent.click(
      screen.getByRole("button", { name: /Delete Untyped table/i }),
    );
    expect(onDelete).toHaveBeenCalledWith("untyped");
  });
});

describe("<FactorTablesTable> — renderActions override", () => {
  it("replaces the default buttons when renderActions is passed", () => {
    render(
      <FactorTablesTable
        tables={SAMPLE.slice(0, 1)}
        renderActions={(t) => (
          <span data-testid={`custom-${t.id}`}>custom for {t.id}</span>
        )}
      />,
    );
    expect(screen.getByTestId("custom-class_factor")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Edit /i }),
    ).not.toBeInTheDocument();
  });
});
