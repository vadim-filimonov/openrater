/**
 * <InputsPanelV2> — P2.3 connector enrich + route provenance.
 *
 * The mount owns the per-row connector invoke (onEnrichBook) and the
 * api-sourced map (routes → "API · via {route}" + resolved value); the view
 * surfaces them. These tests assert the surfacing: the provenance chip
 * replaces the CSV-column select for a route-fed input, "Enrich book" shows
 * only when a route actually feeds an input, and the jump fires onOpenApiLab.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { _clearRegistryForTests, registerBuiltinKinds } from "@openrater/contracts";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";

beforeAll(() => {
  _clearRegistryForTests();
  registerBuiltinKinds();
});

const REQUIRED: readonly RequiredInputEntry[] = [
  { id: "base", name: "Base rate", dtype: "number", category: "inputs" },
  { id: "sqft", name: "Square footage", dtype: "number", category: "inputs" },
];

const CSV: PlanInputMapping = {
  source: {
    kind: "csv",
    columns: ["base", "address"],
    sample_rows: [{ base: "750", address: "1 Main St" }],
  },
  column_map: { base: "base" },
};

const sourced = (value: string) =>
  new Map([["sqft", { sourceLabel: "LightBox", value }]]);

describe("<InputsPanelV2> — connector enrich + provenance (P2.3)", () => {
  it("renders 'API · via {route}' + the value in place of the column select", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={CSV}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        apiSourcedByKey={sourced("18000")}
      />,
    );
    expect(screen.getByText(/API · via LightBox/)).toBeInTheDocument();
    expect(screen.getByText("18000")).toBeInTheDocument();
    // The non-sourced input still gets its CSV column select.
    expect(
      screen.getByLabelText("Source column for Base rate"),
    ).toBeInTheDocument();
    // The sourced input does NOT (it's connector-fed, not column-mapped).
    expect(
      screen.queryByLabelText("Source column for Square footage"),
    ).not.toBeInTheDocument();
  });

  it("shows 'not run yet' when the route has no resolved value", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={CSV}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        apiSourcedByKey={sourced("")}
      />,
    );
    expect(screen.getByText("not run yet")).toBeInTheDocument();
  });

  it("offers 'Enrich book' only when a route feeds an input, and invokes it", () => {
    const onEnrichBook = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={CSV}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        onEnrichBook={onEnrichBook}
        apiSourcedByKey={sourced("")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Fill from API Lab/ }));
    expect(onEnrichBook).toHaveBeenCalledWith(CSV);
  });

  it("hides 'Enrich book' when no input is route-fed", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={CSV}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        onEnrichBook={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Fill from API Lab/ }),
    ).not.toBeInTheDocument();
  });

  it("jumps to API Lab from the provenance chip", () => {
    const onOpenApiLab = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={CSV}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
        apiSourcedByKey={sourced("18000")}
        onOpenApiLab={onOpenApiLab}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Open the API Lab route feeding Square footage/,
      }),
    );
    expect(onOpenApiLab).toHaveBeenCalledOnce();
  });
});
