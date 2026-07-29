/**
 * <ClampStageDrawer> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ClampStageDrawer,
  emptyClampDraft,
  isClampDraftComplete,
  type ClampDraft,
  type ClampStageDrawerProps,
} from "./ClampStageDrawer";

function renderDrawer(overrides: Partial<ClampStageDrawerProps> = {}) {
  const props: ClampStageDrawerProps = {
    open: true,
    mode: "add",
    draft: emptyClampDraft(),
    onDraftChange: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ClampStageDrawer {...props} />) };
}

const MIN_ONLY: ClampDraft = {
  display_name: "Minimum premium",
  min_value: 500,
  max_value: "",
  max_pct_of_input: "",
  apply_as_multiplier: false,
  citation_rule: "ISO BOP §6.A.1",
  citation_page: "p. 47",
};

const MAX_ONLY: ClampDraft = { ...MIN_ONLY, min_value: "", max_value: 50000 };
const PCT_ONLY: ClampDraft = {
  ...MIN_ONLY,
  min_value: "",
  max_pct_of_input: "input * 0.10",
};

describe("emptyClampDraft", () => {
  it("returns a draft with all bounds empty", () => {
    expect(emptyClampDraft()).toEqual({
      display_name: "",
      min_value: "",
      max_value: "",
      max_pct_of_input: "",
      apply_as_multiplier: false,
      citation_rule: "",
      citation_page: "",
    });
  });
});

describe("isClampDraftComplete", () => {
  it("returns false for an empty draft", () => {
    expect(isClampDraftComplete(emptyClampDraft())).toBe(false);
  });

  it("returns false when display_name is blank", () => {
    expect(
      isClampDraftComplete({ ...MIN_ONLY, display_name: "" }),
    ).toBe(false);
  });

  it("returns false when no bound is set", () => {
    expect(
      isClampDraftComplete({
        ...MIN_ONLY,
        min_value: "",
        max_value: "",
        max_pct_of_input: "",
      }),
    ).toBe(false);
  });

  it("returns true when only min_value is set", () => {
    expect(isClampDraftComplete(MIN_ONLY)).toBe(true);
  });

  it("returns true when only max_value is set", () => {
    expect(isClampDraftComplete(MAX_ONLY)).toBe(true);
  });

  it("returns true when only max_pct_of_input is set", () => {
    expect(isClampDraftComplete(PCT_ONLY)).toBe(true);
  });
});

describe("<ClampStageDrawer> — rendering", () => {
  it("renders nothing when open={false}", () => {
    renderDrawer({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders 'Add premium limit' title in mode='add'", () => {
    renderDrawer({ mode: "add" });
    expect(
      screen.getByRole("heading", { name: /Add premium limit/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Edit premium limit' title in mode='edit'", () => {
    renderDrawer({ mode: "edit", draft: MIN_ONLY });
    expect(
      screen.getByRole("heading", { name: /Edit premium limit/i }),
    ).toBeInTheDocument();
  });

  it("renders contextLabel as subtitle when provided", () => {
    renderDrawer({ contextLabel: "Final Adjustments" });
    expect(screen.getByText("Final Adjustments")).toBeInTheDocument();
  });

  it("renders all expected form fields", () => {
    renderDrawer();
    expect(screen.getByLabelText(/Display name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Minimum value/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Maximum value/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Max percent of input/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Citation rule/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Citation page/i)).toBeInTheDocument();
  });
});

describe("<ClampStageDrawer> — Save gating", () => {
  it("disables Save for empty draft", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: /Add limit/i })).toBeDisabled();
  });

  it("enables Save with min_value set", () => {
    renderDrawer({ draft: MIN_ONLY });
    expect(screen.getByRole("button", { name: /Add limit/i })).toBeEnabled();
  });

  it("disables Save while saving=true", () => {
    renderDrawer({ draft: MIN_ONLY, saving: true });
    expect(screen.getByRole("button", { name: /Add limit/i })).toBeDisabled();
  });

  it("uses 'Save changes' label in edit mode", () => {
    renderDrawer({ mode: "edit", draft: MIN_ONLY });
    expect(
      screen.getByRole("button", { name: /Save changes/i }),
    ).toBeInTheDocument();
  });
});

describe("<ClampStageDrawer> — wire-through", () => {
  it("Cancel fires onCancel", () => {
    const onCancel = vi.fn();
    renderDrawer({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Save fires onSave when enabled", () => {
    const onSave = vi.fn();
    renderDrawer({ draft: MIN_ONLY, onSave });
    fireEvent.click(screen.getByRole("button", { name: /Add limit/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("typing min_value coerces to number", () => {
    const onDraftChange = vi.fn();
    renderDrawer({ onDraftChange });
    fireEvent.change(screen.getByLabelText(/Minimum value/i), {
      target: { value: "500" },
    });
    const next = onDraftChange.mock.calls[0]![0] as ClampDraft;
    expect(next.min_value).toBe(500);
  });

  it("apply_as_multiplier checkbox toggles", () => {
    const onDraftChange = vi.fn();
    renderDrawer({ onDraftChange });
    fireEvent.click(screen.getByRole("checkbox"));
    const next = onDraftChange.mock.calls[0]![0] as ClampDraft;
    expect(next.apply_as_multiplier).toBe(true);
  });
});

describe("<ClampStageDrawer> — error banner", () => {
  it("renders error banner when errorMessage provided", () => {
    renderDrawer({ errorMessage: "Save failed: 503" });
    expect(
      screen.getByTestId("rater-clamp-stage-drawer-error"),
    ).toBeInTheDocument();
  });

  it("does not render error banner when errorMessage empty", () => {
    renderDrawer({ errorMessage: "" });
    expect(
      screen.queryByTestId("rater-clamp-stage-drawer-error"),
    ).not.toBeInTheDocument();
  });
});

describe("<ClampStageDrawer> — priced notice (P2 G6-full)", () => {
  it("renders the PRICED notice — clamps apply at score time now", () => {
    renderDrawer();
    const notice = screen.getByTestId("rater-clamp-stage-drawer-priced");
    expect(notice).toHaveTextContent(/prices at score time/i);
    expect(notice).not.toHaveTextContent(/not yet priced/i);
  });
});
