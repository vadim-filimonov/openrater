/**
 * <InputsPanelV2> — Brief 89 genesis-mode tests (R2–R4 + §2.2).
 *
 * The two-door block replaces the empty-Inputs stranger stack while the
 * plan is fully empty; the data door reveals the source act in place
 * (genesis copy, not score copy); a book landing on an empty dictionary
 * promotes the declare-from-book bridge to a standalone primary card
 * with identifier-honest type inference (leading zeros never become
 * Numbers).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { InputsPanelV2 } from "./InputsPanelV2";
import type { PlanInputMapping } from "../InputsWorkspace";
import type { InputDictEntry } from "../InputDictionary/types";

const noop = () => {};

function dictProp(
  overrides: Partial<{
    inputs: readonly InputDictEntry[];
    onBulkAdd: (entries: readonly InputDictEntry[]) => void;
  }> = {},
) {
  return {
    inputs: overrides.inputs ?? [],
    onUpsert: noop,
    onDelete: noop,
    ...(overrides.onBulkAdd ? { onBulkAdd: overrides.onBulkAdd } : {}),
  };
}

describe("<InputsPanelV2> — genesis (Brief 89)", () => {
  it("renders the two doors on a fully-empty plan and suppresses the stranger stack (R2)", () => {
    const onAlg = vi.fn();
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={null}
        onMappingChange={noop}
        dictionary={dictProp()}
        genesis={{ onAlgorithmDoor: onAlg }}
      />,
    );
    expect(screen.getByTestId("rater-genesis")).toBeInTheDocument();
    // The old empty stack must NOT co-render with the doors.
    expect(screen.queryByText("No inputs declared yet")).toBeNull();
    expect(screen.queryByText(/Drop a CSV to score a book/)).toBeNull();
    fireEvent.click(screen.getByTestId("rater-genesis-door-algorithm"));
    expect(onAlg).toHaveBeenCalledTimes(1);
  });

  it("data door reveals the source act with authoring copy; Back returns to the doors (R4, §6)", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={null}
        onMappingChange={noop}
        dictionary={dictProp()}
        genesis={{ onAlgorithmDoor: noop }}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-genesis-door-data"));
    // Genesis copy — authoring words, never "score" (§6 language pass).
    expect(
      screen.getByText("Drop a book of business (CSV)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Columns become typed inputs/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/score a book/)).toBeNull();
    fireEvent.click(screen.getByTestId("rater-genesis-back"));
    expect(screen.getByTestId("rater-genesis")).toBeInTheDocument();
  });

  it("without the genesis prop the classic empty stack still renders (mount owns the R2 predicate)", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={null}
        onMappingChange={noop}
        dictionary={dictProp()}
      />,
    );
    expect(screen.queryByTestId("rater-genesis")).toBeNull();
    expect(screen.getByText("No inputs declared yet")).toBeInTheDocument();
    expect(
      screen.getByText("Drop a CSV to score a book"),
    ).toBeInTheDocument();
  });

  it("a book on an empty dictionary promotes the bridge; declare uses identifier-honest types (§2.2)", () => {
    const onBulkAdd = vi.fn();
    const onMappingChange = vi.fn();
    const mapping: PlanInputMapping = {
      source: {
        kind: "csv",
        columns: ["class_code", "tiv", "sprinklered"],
        sample_rows: [
          { class_code: "09331", tiv: "250000", sprinklered: "yes" },
          { class_code: "65141", tiv: "480000", sprinklered: "no" },
        ],
        // The parse says class_code is numeric — the leading zero in the
        // raw sample is the identifier truth that overrides it.
        dtypes: {
          class_code: "number",
          tiv: "number",
          sprinklered: "boolean",
        },
      } as unknown as PlanInputMapping["source"],
      column_map: {},
    };
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={mapping}
        onMappingChange={onMappingChange}
        dictionary={dictProp({ onBulkAdd })}
        genesis={{ onAlgorithmDoor: noop }}
      />,
    );
    // The doors dissolved (a source exists); the bridge leads.
    expect(screen.queryByTestId("rater-genesis")).toBeNull();
    const bridge = screen.getByTestId("rater-inputs2-bridge");
    expect(bridge).toHaveTextContent(
      "Turn these columns into the plan's inputs",
    );
    expect(bridge).toHaveTextContent(
      "3 columns · 1 number · 1 text · 1 yes/no",
    );
    // One affordance: the dictionary head chip yields to the bridge.
    expect(
      screen.getAllByRole("button", {
        name: /book columns as inputs/i,
      }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Add 3 book columns as inputs" }),
    );
    expect(onBulkAdd).toHaveBeenCalledTimes(1);
    const entries = onBulkAdd.mock.calls[0]![0] as readonly InputDictEntry[];
    const byField = new Map(entries.map((e) => [e.fieldName, e.dataType]));
    expect(byField.get("class_code")).toBe("string"); // leading zero
    expect(byField.get("tiv")).toBe("float");
    expect(byField.get("sprinklered")).toBe("bool");
    // The match is identity (fieldName === column) — column_map extends
    // in the same click, so the payoff lands mapped, not "0 of N".
    expect(onMappingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        column_map: {
          class_code: "class_code",
          tiv: "tiv",
          sprinklered: "sprinklered",
        },
      }),
    );
  });

  it("any declared input dissolves genesis (R2)", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={null}
        onMappingChange={noop}
        dictionary={dictProp({
          inputs: [
            {
              id: "s1",
              fieldName: "tiv",
              displayName: "TIV",
              dataType: "float",
              source: "form",
              required: true,
            },
          ],
        })}
        genesis={{ onAlgorithmDoor: noop }}
      />,
    );
    expect(screen.queryByTestId("rater-genesis")).toBeNull();
  });

  it("R8: an UNDECLARED constant slot never renders as a ghost or Match row; declaring it re-admits it", () => {
    const mapping: PlanInputMapping = {
      source: {
        kind: "csv",
        columns: ["exposure", "lcm"],
        sample_rows: [{ exposure: "100000", lcm: "1.4" }],
      },
      column_map: {},
    };
    const required = [
      {
        id: "exposure",
        name: "exposure",
        dtype: "number",
        category: "inputs",
        subLabel: "Chain · Premium exposure",
      },
      {
        id: "lcm",
        name: "lcm",
        dtype: "number",
        category: "inputs",
        subLabel: "Chain · Premium LCM",
        constantSlot: true,
      },
    ] as const;
    const rowNames = (c: HTMLElement): string[] =>
      [...c.querySelectorAll(".rater-inputs2__fname")].map(
        (el) => el.textContent ?? "",
      );
    const { container, rerender } = render(
      <InputsPanelV2
        stages={[]}
        inputMapping={mapping}
        onMappingChange={noop}
        requiredInputs={required as never}
        dictionary={dictProp()}
      />,
    );
    // The true risk input renders as a row; the unset constant does not
    // (the source-column <option>s don't count — they list CSV columns).
    expect(rowNames(container)).toContain("exposure");
    expect(rowNames(container)).not.toContain("lcm");

    // Declaring lcm deliberately (the E10e column-shaped path) re-admits it.
    rerender(
      <InputsPanelV2
        stages={[]}
        inputMapping={mapping}
        onMappingChange={noop}
        requiredInputs={required as never}
        dictionary={dictProp({
          inputs: [
            {
              id: "s-lcm",
              fieldName: "lcm",
              displayName: "LCM",
              dataType: "float",
              source: "form",
              required: true,
            },
          ],
        })}
      />,
    );
    expect(rowNames(container)).toContain("LCM");
  });

  it("read-only genesis renders disabled doors (§7)", () => {
    render(
      <InputsPanelV2
        stages={[]}
        inputMapping={null}
        dictionary={dictProp()}
        genesis={{ onAlgorithmDoor: noop }}
      />,
    );
    expect(screen.getByTestId("rater-genesis-door-data")).toBeDisabled();
    expect(
      screen.getByText(/read-only — reopen a draft/i),
    ).toBeInTheDocument();
  });
});
