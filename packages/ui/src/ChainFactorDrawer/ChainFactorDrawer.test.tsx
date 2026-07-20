/**
 * <ChainFactorDrawer> tests.
 *
 * Exercises the composite primitive's surface: title + subtitle, Save
 * gating via isFactorDraftComplete, footer button wiring, error banner,
 * loading state, and drawer-level dismiss (Cancel / Escape / backdrop).
 *
 * The underlying <FactorEditor> + <Drawer> primitives have their own
 * exhaustive suites; here we test the composition + the drawer-specific
 * additions (button labels, gating, error banner).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  ChainFactorDrawer,
  type ChainFactorDrawerProps,
} from "./ChainFactorDrawer";
import type { FactorDraft } from "../FactorEditor";
import type { ClassPickerOption } from "../ClassPicker";
import type { DimensionRefOption } from "../DimensionRefPicker";
import type { FactorTableRefOption } from "../FactorTableRefPicker";

const CLASSES: ClassPickerOption[] = [
  {
    class_code: "1234",
    display_name: "Bowling Centers",
    family: "BOP",
  },
];

const DIMENSIONS: DimensionRefOption[] = [
  {
    id: "construction_class",
    display_name: "Construction Class",
    slug: "construction_class",
  },
];

const FACTOR_TABLES: FactorTableRefOption[] = [
  {
    id: "construction_factors",
    display_name: "Construction Factors",
    slug: "construction_factors",
  },
];

function renderDrawer(overrides: Partial<ChainFactorDrawerProps> = {}) {
  const props: ChainFactorDrawerProps = {
    open: true,
    mode: "add",
    draft: { kind: "" } satisfies FactorDraft,
    onDraftChange: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    classes: CLASSES,
    dimensions: DIMENSIONS,
    factorTables: FACTOR_TABLES,
    ...overrides,
  };
  return { props, ...render(<ChainFactorDrawer {...props} />) };
}

describe("<ChainFactorDrawer> — rendering", () => {
  it("renders nothing when open={false}", () => {
    renderDrawer({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders 'Add chain factor' title in mode='add'", () => {
    renderDrawer({ mode: "add" });
    expect(
      screen.getByRole("heading", { name: /Add chain factor/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Edit chain factor' title in mode='edit'", () => {
    renderDrawer({
      mode: "edit",
      draft: { kind: "constant", value: 1.5, reason: "test" },
    });
    expect(
      screen.getByRole("heading", { name: /Edit chain factor/i }),
    ).toBeInTheDocument();
  });

  it("renders subtitle when chainName is provided", () => {
    renderDrawer({ chainName: "BOP class factor chain" });
    expect(
      screen.getByText(/Chain: BOP class factor chain/i),
    ).toBeInTheDocument();
  });

  it("omits subtitle when chainName is not provided", () => {
    renderDrawer();
    expect(screen.queryByText(/^Chain:/i)).not.toBeInTheDocument();
  });

  it("omits subtitle when chainName is an empty string", () => {
    renderDrawer({ chainName: "" });
    expect(screen.queryByText(/^Chain:/i)).not.toBeInTheDocument();
  });

  it("renders the FactorEditor inside the drawer body", () => {
    renderDrawer();
    expect(
      screen.getByTestId("rater-chain-factor-drawer"),
    ).toBeInTheDocument();
    // FactorEditor's kind select is the entry point.
    expect(
      screen.getByRole("combobox", { name: /Factor kind/i }),
    ).toBeInTheDocument();
  });
});

describe("<ChainFactorDrawer> — Save button gating", () => {
  it("disables Save when draft.kind is unset", () => {
    renderDrawer({ draft: { kind: "" } });
    expect(screen.getByRole("button", { name: /Add factor/i })).toBeDisabled();
  });

  it("disables Save when a constant draft has an empty value", () => {
    renderDrawer({
      draft: { kind: "constant", value: "", reason: "" },
    });
    expect(screen.getByRole("button", { name: /Add factor/i })).toBeDisabled();
  });

  it("enables Save when a constant draft is complete", () => {
    renderDrawer({
      draft: { kind: "constant", value: 0.95, reason: "" },
    });
    expect(screen.getByRole("button", { name: /Add factor/i })).toBeEnabled();
  });

  it("disables Save when saving=true even if draft is complete", () => {
    renderDrawer({
      draft: { kind: "constant", value: 0.95, reason: "" },
      saving: true,
    });
    expect(screen.getByRole("button", { name: /Add factor/i })).toBeDisabled();
  });

  it("uses 'Add factor' label in mode='add'", () => {
    renderDrawer({ mode: "add" });
    expect(
      screen.getByRole("button", { name: /Add factor/i }),
    ).toBeInTheDocument();
  });

  it("uses 'Save changes' label in mode='edit'", () => {
    renderDrawer({
      mode: "edit",
      draft: { kind: "constant", value: 0.95, reason: "" },
    });
    expect(
      screen.getByRole("button", { name: /Save changes/i }),
    ).toBeInTheDocument();
  });

  it("disables Save for a deferred kind (lookup.range)", () => {
    renderDrawer({ draft: { kind: "lookup.range" } });
    expect(screen.getByRole("button", { name: /Add factor/i })).toBeDisabled();
  });

  it("disables Save for a deferred kind (formula)", () => {
    renderDrawer({ draft: { kind: "formula" } });
    expect(screen.getByRole("button", { name: /Add factor/i })).toBeDisabled();
  });
});

describe("<ChainFactorDrawer> — footer button wiring", () => {
  it("Cancel button fires onCancel", () => {
    const onCancel = vi.fn();
    renderDrawer({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Save button fires onSave when enabled", () => {
    const onSave = vi.fn();
    renderDrawer({
      draft: { kind: "constant", value: 1.0, reason: "" },
      onSave,
    });
    fireEvent.click(screen.getByRole("button", { name: /Add factor/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("Save button does not fire onSave when disabled", () => {
    const onSave = vi.fn();
    renderDrawer({ draft: { kind: "" }, onSave });
    fireEvent.click(screen.getByRole("button", { name: /Add factor/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Cancel button is disabled while saving=true", () => {
    renderDrawer({
      draft: { kind: "constant", value: 1.0, reason: "" },
      saving: true,
    });
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeDisabled();
  });
});

describe("<ChainFactorDrawer> — drawer dismiss", () => {
  it("Escape key fires onCancel", () => {
    const onCancel = vi.fn();
    renderDrawer({ onCancel });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Close (×) button fires onCancel", () => {
    const onCancel = vi.fn();
    renderDrawer({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: /Close/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Backdrop click fires onCancel", () => {
    const onCancel = vi.fn();
    renderDrawer({ onCancel });
    fireEvent.click(screen.getByTestId("rater-drawer-backdrop"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("<ChainFactorDrawer> — error banner", () => {
  it("renders the error banner when errorMessage is provided", () => {
    renderDrawer({ errorMessage: "Factor save failed: 503" });
    const banner = screen.getByTestId("rater-chain-factor-drawer-error");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "alert");
    expect(within(banner).getByText(/Factor save failed: 503/i)).toBeInTheDocument();
  });

  it("does not render the error banner when errorMessage is undefined", () => {
    renderDrawer();
    expect(
      screen.queryByTestId("rater-chain-factor-drawer-error"),
    ).not.toBeInTheDocument();
  });

  it("does not render the error banner when errorMessage is the empty string", () => {
    renderDrawer({ errorMessage: "" });
    expect(
      screen.queryByTestId("rater-chain-factor-drawer-error"),
    ).not.toBeInTheDocument();
  });
});

describe("<ChainFactorDrawer> — draft change wiring", () => {
  it("typing into the constant value field fires onDraftChange", () => {
    const onDraftChange = vi.fn();
    renderDrawer({
      draft: { kind: "constant", value: "", reason: "" },
      onDraftChange,
    });
    // Pin to the value input via its DOM id — "Constant value" matches
    // both the value input's aria-label and the reason input's
    // "Reason for the constant value" aria-label (substring match).
    const valueInput = document.getElementById(
      "rater-factor-editor-constant-value",
    ) as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: "0.95" } });
    expect(onDraftChange).toHaveBeenCalledWith({
      kind: "constant",
      value: 0.95,
      reason: "",
    });
  });
});

describe("<ChainFactorDrawer> — picker data passthrough", () => {
  it("forwards classes to FactorEditor for lookup.classification", () => {
    renderDrawer({
      draft: { kind: "lookup.classification", class_code: "" },
    });
    // ClassPicker opens its options on focus.
    fireEvent.focus(screen.getByRole("combobox", { name: /^Class$/i }));
    expect(screen.getByText(/Bowling Centers/i)).toBeInTheDocument();
  });

  it("forwards dimensions + factorTables to FactorEditor for lookup.direct", () => {
    renderDrawer({
      draft: {
        kind: "lookup.direct",
        dimension_id: "",
        factor_table_id: "",
      },
    });
    fireEvent.focus(screen.getByRole("combobox", { name: /Dimension/i }));
    // Use role=option so we match the listbox entry, not the
    // ChainFactorKindSelect hint text "(e.g., construction class → factor)".
    expect(
      screen.getByRole("option", { name: /Construction Class/i }),
    ).toBeInTheDocument();
  });

});
