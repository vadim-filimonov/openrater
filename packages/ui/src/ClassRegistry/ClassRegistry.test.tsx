import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClassRegistry } from "./ClassRegistry";
import type { ClassRegistryRecord } from "./types";

const CLASSES: ClassRegistryRecord[] = [
  {
    class_code: "09015",
    display_name: "Bagelry",
    family: "Restaurants",
    eligible_for: ["bop"],
    attributes: { prop_rate_number: "18", liab_class_group: "cg_40" },
    source: "iso",
  },
  {
    class_code: "53983",
    display_name: "Army/Navy Retail",
    family: "Retail",
    eligible_for: ["bop"],
    attributes: { prop_rate_number: "09" },
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
    expect(screen.getByText("Bagelry")).toBeInTheDocument();
    expect(screen.getByText("Army/Navy Retail")).toBeInTheDocument();
  });

  it("renders an honest empty state (not fake rows) with import + new CTAs", () => {
    setup({ classes: [] });
    expect(screen.getByText("No classes yet")).toBeInTheDocument();
    expect(screen.getByText("Paste a class table")).toBeInTheDocument();
  });

  it("shows the derived attributes in the detail pane on row click", () => {
    setup();
    fireEvent.click(screen.getByText("Bagelry"));
    expect(screen.getByText("prop_rate_number")).toBeInTheDocument();
    expect(screen.getByText("liab_class_group")).toBeInTheDocument();
  });

  it("multi-selects and calls onAddToPlan with the selected codes", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("rater-class-registry-check-09015"));
    fireEvent.click(screen.getByTestId("rater-class-registry-check-53983"));
    expect(screen.getByTestId("rater-class-registry-addbar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rater-class-registry-addtoplan"));
    expect(props.onAddToPlan).toHaveBeenCalledWith(["09015", "53983"]);
  });

  it("CTA reads 'Update plan dimension' when the class dimension exists", () => {
    setup({ classDimensionExists: true });
    fireEvent.click(screen.getByTestId("rater-class-registry-check-09015"));
    expect(screen.getByText(/Update plan dimension/)).toBeInTheDocument();
  });
});
