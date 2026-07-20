import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClassRegistry } from "./ClassRegistry";
import type { ClassRegistryRecord } from "./types";

const CLASSES: ClassRegistryRecord[] = [
  {
    class_code: "c101",
    display_name: "Meridian Neighborhood Bakery",
    family: "Food services",
    eligible_for: ["bop"],
    attributes: { prop_rate_number: "07", liab_class_group: "mg_02" },
    source: "custom",
  },
  {
    class_code: "c102",
    display_name: "Meridian General Merchandise",
    family: "Retail",
    eligible_for: ["bop"],
    attributes: { prop_rate_number: "11" },
    source: "custom",
  },
];

function setup(overrides: Partial<Parameters<typeof ClassRegistry>[0]> = {}) {
  const props = {
    classes: CLASSES,
    onUpsertClass: vi.fn(),
    onDeleteClass: vi.fn(),
    onBulkImport: vi.fn(),
    onAddToPlan: vi.fn(),
    ...overrides,
  };
  render(<ClassRegistry {...props} />);
  return props;
}

describe("<ClassRegistry>", () => {
  it("lists the plan's classes", () => {
    setup();
    expect(screen.getByText("Meridian Neighborhood Bakery")).toBeInTheDocument();
    expect(screen.getByText("Meridian General Merchandise")).toBeInTheDocument();
  });

  it("renders an honest empty state (not fake rows) with import + new CTAs", () => {
    setup({ classes: [] });
    expect(screen.getByText("No classes yet")).toBeInTheDocument();
    expect(screen.getByText("Paste a class table")).toBeInTheDocument();
  });

  it("shows the derived attributes in the detail pane on row click", () => {
    setup();
    fireEvent.click(screen.getByText("Meridian Neighborhood Bakery"));
    expect(screen.getByText("prop_rate_number")).toBeInTheDocument();
    expect(screen.getByText("liab_class_group")).toBeInTheDocument();
  });

  it("multi-selects and calls onAddToPlan with the selected codes", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("rater-class-registry-check-c101"));
    fireEvent.click(screen.getByTestId("rater-class-registry-check-c102"));
    expect(screen.getByTestId("rater-class-registry-addbar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rater-class-registry-addtoplan"));
    expect(props.onAddToPlan).toHaveBeenCalledWith(["c101", "c102"]);
  });

  it("CTA reads 'Update plan dimension' when the class dimension exists", () => {
    setup({ classDimensionExists: true });
    fireEvent.click(screen.getByTestId("rater-class-registry-check-c101"));
    expect(screen.getByText(/Update plan dimension/)).toBeInTheDocument();
  });
});
