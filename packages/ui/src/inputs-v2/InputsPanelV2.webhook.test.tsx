/**
 * <InputsPanelV2> — P2.1 webhook source integration.
 *
 * The view is source-agnostic: a webhook's inferred `payload_schema.fields`
 * drive the column-mapping table exactly like CSV headers do, and the
 * dropzone offers "Fetch from an API" as the other source mode. These
 * tests assert the MOUNT contract (onMappingChange writes) without any
 * live fetch — onInferSchema is the mount's job (tested via WebhookSource).
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
];

describe("<InputsPanelV2> — webhook source (P2.1)", () => {
  it("drives the mapping table from a webhook's inferred fields", () => {
    const mapping: PlanInputMapping = {
      source: {
        kind: "webhook",
        url: "https://api.example.com/book",
        method: "GET",
        payload_schema: {
          content_type: "application/json",
          fields: [
            { name: "base", dtype: "number" },
            { name: "state", dtype: "string" },
          ],
        },
      },
      column_map: {},
    };

    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={mapping}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
      />,
    );

    // The webhook config head + the mapping table (fed by the fields) both show.
    expect(screen.getByText("Fetch from an API")).toBeInTheDocument();
    expect(screen.getByText("Match columns")).toBeInTheDocument();
    // The inferred field is offered as a source column in the mapping select.
    expect(
      screen.getByRole("option", { name: "base" }),
    ).toBeInTheDocument();
  });

  it("switches the source to a webhook from the dropzone", () => {
    const onMappingChange = vi.fn();
    const mapping: PlanInputMapping = {
      source: { kind: "csv", columns: [] }, // empty ⇒ dropzone, not the book bar
      column_map: {},
    };

    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={mapping}
        onMappingChange={onMappingChange}
        requiredInputs={REQUIRED}
        dimensions={[]}
      />,
    );

    // Exact name — the outer dropzone is itself a role="button" whose
    // accessible name also contains this text.
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch from an API" }),
    );
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ kind: "webhook" }),
      }),
    );
  });

  it("hides the mapping table for a webhook with no inferred fields yet", () => {
    const mapping: PlanInputMapping = {
      source: {
        kind: "webhook",
        url: "https://api.example.com/book",
        payload_schema: { content_type: "application/json", fields: [] },
      },
      column_map: {},
    };

    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={mapping}
        onMappingChange={() => {}}
        requiredInputs={REQUIRED}
        dimensions={[]}
      />,
    );
    // The config is visible, but with zero fields there's nothing to map yet.
    expect(screen.getByText("Fetch from an API")).toBeInTheDocument();
    expect(screen.queryByText("Match columns")).not.toBeInTheDocument();
  });
});
