import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClassEditDrawer } from "./ClassEditDrawer";
import { emptyDraft } from "./types";

describe("<ClassEditDrawer>", () => {
  it("disables save until class_code + display_name are filled", () => {
    render(
      <ClassEditDrawer
        open
        mode="add"
        draft={emptyDraft()}
        onDraftChange={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Add class" })).toBeDisabled();
  });

  it("calls onSave when the draft is valid", () => {
    const onSave = vi.fn();
    render(
      <ClassEditDrawer
        open
        mode="add"
        draft={{ ...emptyDraft(), class_code: "53983", display_name: "Army/Navy" }}
        onDraftChange={() => {}}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add class" }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("adds a derived-attribute row", () => {
    render(
      <ClassEditDrawer
        open
        mode="add"
        draft={{ ...emptyDraft(), class_code: "1", display_name: "X" }}
        onDraftChange={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add attribute/i }));
    expect(screen.getByPlaceholderText("prop_rate_number")).toBeInTheDocument();
  });

  it("warns when an added code collides with an existing one", () => {
    render(
      <ClassEditDrawer
        open
        mode="add"
        draft={{ ...emptyDraft(), class_code: "09015", display_name: "Dup" }}
        onDraftChange={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
        existingCodes={new Set(["09015"])}
      />,
    );
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  it("renders Delete in edit mode and fires it", () => {
    const onDelete = vi.fn();
    render(
      <ClassEditDrawer
        open
        mode="edit"
        draft={{ ...emptyDraft(), class_code: "1", display_name: "X" }}
        onDraftChange={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
