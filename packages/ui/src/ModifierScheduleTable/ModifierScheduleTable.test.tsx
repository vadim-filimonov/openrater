/**
 * <ModifierScheduleTable> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ModifierScheduleTable,
  type ModifierScheduleCategoryRow,
} from "./ModifierScheduleTable";

const CATEGORIES: ModifierScheduleCategoryRow[] = [
  {
    category_id: "management",
    name: "Management experience",
    range_pct: 5,
    reasoning_required: true,
  },
  {
    category_id: "employees",
    name: "Employees",
    range_pct: 5,
    reasoning_required: true,
    note: "Quality + training + retention",
  },
  {
    category_id: "equipment",
    name: "Equipment",
    range_pct: 10,
    reasoning_required: false,
  },
];

describe("<ModifierScheduleTable> — header", () => {
  it("renders the display name", () => {
    render(
      <ModifierScheduleTable
        displayName="Property schedule mod"
        totalCapPct={25}
        categories={CATEGORIES}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Property schedule mod/i }),
    ).toBeInTheDocument();
  });

  it("renders the total cap", () => {
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
      />,
    );
    expect(screen.getByText(/±25% cap/i)).toBeInTheDocument();
  });

  it("renders the optional scope label", () => {
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
        scopeLabel="per coverage"
      />,
    );
    expect(screen.getByText("per coverage")).toBeInTheDocument();
  });

  it("uses an article aria-label that includes the schedule name", () => {
    render(
      <ModifierScheduleTable
        displayName="Property schedule mod"
        totalCapPct={25}
        categories={CATEGORIES}
      />,
    );
    expect(
      screen.getByRole("article", { name: /Modifier schedule: Property/i }),
    ).toBeInTheDocument();
  });
});

describe("<ModifierScheduleTable> — categories", () => {
  it("renders one row per category", () => {
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
      />,
    );
    expect(screen.getByText("Management experience")).toBeInTheDocument();
    expect(screen.getByText("Employees")).toBeInTheDocument();
    expect(screen.getByText("Equipment")).toBeInTheDocument();
  });

  it("renders the ±N% range per category", () => {
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
      />,
    );
    expect(screen.getAllByText("±5%")).toHaveLength(2);
    expect(screen.getByText("±10%")).toBeInTheDocument();
  });

  it("renders the 'reason req.' chip only when reasoning_required is true", () => {
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
      />,
    );
    // Management + Employees have reasoning_required=true; Equipment doesn't.
    expect(screen.getAllByText(/reason req/i)).toHaveLength(2);
  });

  it("renders the optional per-category note", () => {
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
      />,
    );
    expect(
      screen.getByText("Quality + training + retention"),
    ).toBeInTheDocument();
  });

  it("renders empty state when no categories", () => {
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={[]}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/No categories yet/i)).toBeInTheDocument();
  });
});

describe("<ModifierScheduleTable> — footer", () => {
  it("renders the citation when provided", () => {
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
        citation="ISO BOP §4.2"
      />,
    );
    expect(screen.getByText(/Citation: ISO BOP §4.2/i)).toBeInTheDocument();
  });

  it("does not render footer when neither citation nor onAddCategory provided", () => {
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
      />,
    );
    expect(screen.queryByText(/Citation:/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add category/i }),
    ).not.toBeInTheDocument();
  });

  it("renders 'Add category' when onAddCategory provided", () => {
    const onAddCategory = vi.fn();
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
        onAddCategory={onAddCategory}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add category/i }));
    expect(onAddCategory).toHaveBeenCalledOnce();
  });
});

describe("<ModifierScheduleTable> — per-category callbacks", () => {
  it("fires onEditCategory with the right id", () => {
    const onEditCategory = vi.fn();
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
        onEditCategory={onEditCategory}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Edit Employees/i }));
    expect(onEditCategory).toHaveBeenCalledWith("employees");
  });

  it("fires onDeleteCategory with the right id", () => {
    const onDeleteCategory = vi.fn();
    render(
      <ModifierScheduleTable
        displayName="Test"
        totalCapPct={25}
        categories={CATEGORIES}
        onDeleteCategory={onDeleteCategory}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Delete Equipment/i }));
    expect(onDeleteCategory).toHaveBeenCalledWith("equipment");
  });
});
