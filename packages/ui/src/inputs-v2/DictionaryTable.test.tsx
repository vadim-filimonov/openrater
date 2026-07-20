/**
 * <DictionaryTable> — P0.1 dictionary authoring tests.
 *
 * Browser-verified the full flow on a draft; this guards the contract:
 * read-only vs editable, declare (slug derive + source default), rename
 * (slug preserved), and the two-click delete confirm.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DictionaryTable } from "./DictionaryTable";
import type { InputDictEntry } from "../InputDictionary/types";

const ENTRY: InputDictEntry = {
  id: "stage_1",
  fieldName: "tiv",
  displayName: "Total insured value",
  dataType: "money",
  source: "form",
  required: true,
};

describe("<DictionaryTable>", () => {
  it("is a pure read-only view when not editable", () => {
    render(<DictionaryTable inputs={[ENTRY]} editable={false} />);
    // No "+ Field" affordance...
    expect(
      screen.queryByRole("button", { name: "Input" }),
    ).not.toBeInTheDocument();
    // ...and the name isn't an enabled editable button.
    const name = screen.getByText("Total insured value");
    expect(name.closest("button")).toBeDisabled();
  });

  it("declares a new field — slug derived, source defaulted", () => {
    const onUpsert = vi.fn();
    render(<DictionaryTable inputs={[]} editable onUpsert={onUpsert} />);

    fireEvent.click(screen.getByRole("button", { name: "Input" }));
    const input = screen.getByPlaceholderText("Field name");
    fireEvent.change(input, { target: { value: "Annual revenue" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onUpsert).toHaveBeenCalledTimes(1);
    expect(onUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "",
        fieldName: "annual_revenue",
        displayName: "Annual revenue",
        dataType: "string",
        source: "form",
      }),
    );
  });

  it("renames a field but preserves its slug", () => {
    const onUpsert = vi.fn();
    render(<DictionaryTable inputs={[ENTRY]} editable onUpsert={onUpsert} />);

    fireEvent.click(screen.getByText("Total insured value"));
    const input = screen.getByLabelText("Field name");
    fireEvent.change(input, { target: { value: "TIV" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ fieldName: "tiv", displayName: "TIV" }),
    );
  });

  it("deletes via a two-click confirm", () => {
    const onDelete = vi.fn();
    render(
      <DictionaryTable
        inputs={[ENTRY]}
        editable
        onUpsert={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Total insured value" }),
    );
    expect(onDelete).not.toHaveBeenCalled(); // armed, awaiting confirm
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDelete).toHaveBeenCalledWith("stage_1");
  });
});
