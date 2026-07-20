/**
 * <FlatFactorStageDrawer> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FlatFactorStageDrawer,
  emptyFlatFactorDraft,
  isFlatFactorDraftComplete,
  type FlatFactorDraft,
  type FlatFactorStageDrawerProps,
} from "./FlatFactorStageDrawer";

function renderDrawer(overrides: Partial<FlatFactorStageDrawerProps> = {}) {
  const props: FlatFactorStageDrawerProps = {
    open: true,
    mode: "add",
    draft: emptyFlatFactorDraft(),
    onDraftChange: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<FlatFactorStageDrawer {...props} />) };
}

const COMPLETE: FlatFactorDraft = {
  display_name: "Expense loading",
  factor_kind: "expense_loading",
  factor: 1.35,
  citation_rule: "Meridian BOP §5.A.2",
  citation_page: "p. 31",
  description_template: "{factor_kind}: ×{value}",
  predicate_path: "",
  predicate_equals: "",
};

// ── Pure helpers ───────────────────────────────────────────────

describe("emptyFlatFactorDraft", () => {
  it("returns a draft with all required fields empty", () => {
    expect(emptyFlatFactorDraft()).toEqual({
      display_name: "",
      factor_kind: "",
      factor: "",
      citation_rule: "",
      citation_page: "",
      description_template: "",
      predicate_path: "",
      predicate_equals: "",
    });
  });
});

describe("isFlatFactorDraftComplete", () => {
  it("returns false for an empty draft", () => {
    expect(isFlatFactorDraftComplete(emptyFlatFactorDraft())).toBe(false);
  });

  it("returns false when display_name is blank", () => {
    expect(
      isFlatFactorDraftComplete({ ...COMPLETE, display_name: "" }),
    ).toBe(false);
  });

  it("returns false when factor_kind is blank", () => {
    expect(
      isFlatFactorDraftComplete({ ...COMPLETE, factor_kind: "" }),
    ).toBe(false);
  });

  it("returns false when factor is the empty-string sentinel", () => {
    expect(isFlatFactorDraftComplete({ ...COMPLETE, factor: "" })).toBe(false);
  });

  it("returns true when display_name + factor_kind + factor are filled", () => {
    expect(isFlatFactorDraftComplete(COMPLETE)).toBe(true);
  });

  it("trims whitespace from string fields", () => {
    expect(
      isFlatFactorDraftComplete({
        ...COMPLETE,
        display_name: "   ",
      }),
    ).toBe(false);
  });
});

// ── Drawer rendering ───────────────────────────────────────────

describe("<FlatFactorStageDrawer> — rendering", () => {
  it("renders nothing when open={false}", () => {
    renderDrawer({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders 'Add factor stage' title in mode='add'", () => {
    renderDrawer({ mode: "add" });
    expect(
      screen.getByRole("heading", { name: /Add factor stage/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Edit factor stage' title in mode='edit'", () => {
    renderDrawer({ mode: "edit", draft: COMPLETE });
    expect(
      screen.getByRole("heading", { name: /Edit factor stage/i }),
    ).toBeInTheDocument();
  });

  it("renders the contextLabel as subtitle when provided", () => {
    renderDrawer({ contextLabel: "Loadings" });
    expect(screen.getByText("Loadings")).toBeInTheDocument();
  });

  it("renders all 6 form fields", () => {
    renderDrawer();
    expect(screen.getByLabelText(/Display name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Factor kind$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Factor value/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Citation rule/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Citation page/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Description template/i),
    ).toBeInTheDocument();
  });
});

// ── Save button gating ─────────────────────────────────────────

describe("<FlatFactorStageDrawer> — Save button gating", () => {
  it("disables Save for an empty draft", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: /Add stage/i })).toBeDisabled();
  });

  it("enables Save for a complete draft", () => {
    renderDrawer({ draft: COMPLETE });
    expect(screen.getByRole("button", { name: /Add stage/i })).toBeEnabled();
  });

  it("disables Save when saving=true even if draft is complete", () => {
    renderDrawer({ draft: COMPLETE, saving: true });
    expect(screen.getByRole("button", { name: /Add stage/i })).toBeDisabled();
  });

  it("uses 'Save changes' label in mode='edit'", () => {
    renderDrawer({ mode: "edit", draft: COMPLETE });
    expect(
      screen.getByRole("button", { name: /Save changes/i }),
    ).toBeInTheDocument();
  });
});

// ── Wire-through ───────────────────────────────────────────────

describe("<FlatFactorStageDrawer> — wire-through", () => {
  it("Cancel button fires onCancel", () => {
    const onCancel = vi.fn();
    renderDrawer({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Save button fires onSave when enabled", () => {
    const onSave = vi.fn();
    renderDrawer({ draft: COMPLETE, onSave });
    fireEvent.click(screen.getByRole("button", { name: /Add stage/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("typing into display_name fires onDraftChange", () => {
    const onDraftChange = vi.fn();
    renderDrawer({ onDraftChange });
    fireEvent.change(screen.getByLabelText(/Display name/i), {
      target: { value: "Tax surcharge" },
    });
    expect(onDraftChange).toHaveBeenCalled();
    const next = onDraftChange.mock.calls[0]![0] as FlatFactorDraft;
    expect(next.display_name).toBe("Tax surcharge");
  });

  it("typing a number into factor coerces to a number type", () => {
    const onDraftChange = vi.fn();
    renderDrawer({ onDraftChange });
    fireEvent.change(screen.getByLabelText(/Factor value/i), {
      target: { value: "1.026" },
    });
    const next = onDraftChange.mock.calls[0]![0] as FlatFactorDraft;
    expect(next.factor).toBe(1.026);
    expect(typeof next.factor).toBe("number");
  });

  it("clearing the factor input emits the empty-string sentinel", () => {
    const onDraftChange = vi.fn();
    renderDrawer({ draft: COMPLETE, onDraftChange });
    fireEvent.change(screen.getByLabelText(/Factor value/i), {
      target: { value: "" },
    });
    const next = onDraftChange.mock.calls[0]![0] as FlatFactorDraft;
    expect(next.factor).toBe("");
  });
});

// ── Error banner ───────────────────────────────────────────────

describe("<FlatFactorStageDrawer> — error banner", () => {
  it("renders the error banner when errorMessage is provided", () => {
    renderDrawer({ errorMessage: "Save failed: 503" });
    expect(
      screen.getByTestId("rater-flat-factor-stage-drawer-error"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Save failed: 503",
    );
  });

  it("does not render the error banner when errorMessage is empty", () => {
    renderDrawer({ errorMessage: "" });
    expect(
      screen.queryByTestId("rater-flat-factor-stage-drawer-error"),
    ).not.toBeInTheDocument();
  });
});

describe("<FlatFactorStageDrawer> — priced notice (P2 G6-full)", () => {
  it("renders the PRICED notice — loadings apply at score time now", () => {
    renderDrawer();
    const notice = screen.getByTestId("rater-flat-factor-stage-drawer-priced");
    expect(notice).toHaveTextContent(/prices at score time/i);
    expect(notice).not.toHaveTextContent(/not yet priced/i);
  });
});

// ── Predicate control (finding E6) ─────────────────────────────

describe("<FlatFactorStageDrawer> — predicate control (E6)", () => {
  it("renders both predicate fields — the control the banner promises", () => {
    renderDrawer();
    expect(
      screen.getByLabelText(/Predicate input path/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Predicate equals value/i),
    ).toBeInTheDocument();
  });

  it("typing a path fires onDraftChange with predicate_path", () => {
    const onDraftChange = vi.fn();
    renderDrawer({ onDraftChange });
    fireEvent.change(screen.getByLabelText(/Predicate input path/i), {
      target: { value: "form_input.is_new_business" },
    });
    const next = onDraftChange.mock.calls[0]![0] as FlatFactorDraft;
    expect(next.predicate_path).toBe("form_input.is_new_business");
  });

  it("the equals input is disabled until a path is set (blank = always applies)", () => {
    renderDrawer();
    expect(screen.getByLabelText(/Predicate equals value/i)).toBeDisabled();
  });

  it("the equals input enables once the draft carries a path", () => {
    const onDraftChange = vi.fn();
    renderDrawer({
      draft: { ...COMPLETE, predicate_path: "form_input.is_new_business" },
      onDraftChange,
    });
    const equals = screen.getByLabelText(/Predicate equals value/i);
    expect(equals).toBeEnabled();
    fireEvent.change(equals, { target: { value: "true" } });
    const next = onDraftChange.mock.calls[0]![0] as FlatFactorDraft;
    expect(next.predicate_equals).toBe("true");
  });

  it("a predicate is OPTIONAL — completeness is unaffected by blank predicate fields", () => {
    expect(isFlatFactorDraftComplete(COMPLETE)).toBe(true);
    expect(
      isFlatFactorDraftComplete({
        ...COMPLETE,
        predicate_path: "form_input.is_new_business",
        predicate_equals: "",
      }),
    ).toBe(true);
  });
});
