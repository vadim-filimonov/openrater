/**
 * <InputsPanelV2> — book intake pre-flight tests  .
 *
 * The sentence above the Match table names the leftovers — ignored
 * columns, fuzzy suggestions, missing required inputs — with the SAME
 * derivation the chat door refuses with; an unmapped row with a fuzzy
 * hit carries the amber suggested dot.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping, RequiredInputEntry } from "../InputsWorkspace";
import type { InputDictEntry } from "../InputDictionary";

const INPUTS: RequiredInputEntry[] = [
  { id: "class_code", name: "Class code", category: "inputs" },
  { id: "building_limit", name: "Building limit", category: "inputs" },
];

const DICT: InputDictEntry[] = [
  {
    id: "in_class_code",
    fieldName: "class_code",
    displayName: "Class code",
    dataType: "string",
    source: "form",
    required: true,
  },
  {
    id: "in_building_limit",
    fieldName: "building_limit",
    displayName: "Building limit",
    dataType: "money",
    source: "form",
    required: true,
  },
];

// Header: building_lmit (misspelled), sq_footage (unknown); class_code
// entirely absent — three leftovers, one sentence.
const MAPPING: PlanInputMapping = {
  source: {
    kind: "csv",
    columns: ["building_lmit", "sq_footage"],
    sample_rows: [{ building_lmit: "250000", sq_footage: "1800" }],
  },
  column_map: {},
};

describe("<InputsPanelV2> — the pre-flight sentence (book intake)", () => {
  it("names the misspelled, the unknown, and the missing in one line", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={MAPPING}
        onMappingChange={vi.fn()}
        requiredInputs={INPUTS}
        dimensions={[]}
        dictionary={{ inputs: DICT }}
      />,
    );
    const line = screen.getByTestId("rater-inputs2-preflight");
    expect(line).toHaveTextContent(
      "building_lmit looks like building_limit — confirm the match in Inputs.",
    );
    expect(line).toHaveTextContent(
      "1 of your column isn't a plan input (sq_footage) — ignored unless mapped.",
    );
    expect(line).toHaveTextContent("Missing: class_code.");
  });

  it("a clean, fully-mapped book says nothing", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={{
          source: {
            kind: "csv",
            columns: ["class_code", "building_limit"],
            sample_rows: [{ class_code: "c101", building_limit: "250000" }],
          },
          column_map: {
            class_code: "class_code",
            building_limit: "building_limit",
          },
        }}
        onMappingChange={vi.fn()}
        requiredInputs={INPUTS}
        dimensions={[]}
        dictionary={{ inputs: DICT }}
      />,
    );
    expect(
      screen.queryByTestId("rater-inputs2-preflight"),
    ).not.toBeInTheDocument();
  });
});
