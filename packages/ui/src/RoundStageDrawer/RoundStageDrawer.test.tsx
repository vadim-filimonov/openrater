/**
 * <RoundStageDrawer> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  RoundStageDrawer,
  emptyRoundDraft,
  isRoundDraftComplete,
  type RoundDraft,
  type RoundStageDrawerProps,
} from "./RoundStageDrawer";

function renderDrawer(overrides: Partial<RoundStageDrawerProps> = {}) {
  const props: RoundStageDrawerProps = {
    open: true,
    mode: "add",
    draft: emptyRoundDraft(),
    onDraftChange: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<RoundStageDrawer {...props} />) };
}

const COMPLETE: RoundDraft = {
  display_name: "Round to nearest dollar",
  increment_input: "literal:1",
  min_value_input: "literal:500",
  citation_rule: "ISO BOP §6.B.1",
  citation_page: "p. 48",
};

describe("emptyRoundDraft", () => {
  it("defaults to literals the live scorer executes", () => {
    const d = emptyRoundDraft();
    // v4 G6 — the old form_input.* defaults parsed to "no increment /
    // no floor" in the projector and scored as if the stage weren't
    // there. Defaults are literals now; the floor is opt-in.
    expect(d.display_name).toBe("");
    expect(d.increment_input).toBe("literal:1");
    expect(d.min_value_input).toBe("");
  });
});

describe("isRoundDraftComplete", () => {
  it("returns false when display_name is blank", () => {
    expect(
      isRoundDraftComplete({ ...COMPLETE, display_name: "" }),
    ).toBe(false);
  });

  it("returns false when increment_input is blank", () => {
    expect(
      isRoundDraftComplete({ ...COMPLETE, increment_input: "" }),
    ).toBe(false);
  });

  it("allows a blank min_value_input (round without a floor)", () => {
    expect(
      isRoundDraftComplete({ ...COMPLETE, min_value_input: "" }),
    ).toBe(true);
  });

  it("returns true for a complete draft", () => {
    expect(isRoundDraftComplete(COMPLETE)).toBe(true);
  });
});

describe("<RoundStageDrawer> — rendering", () => {
  it("renders nothing when open={false}", () => {
    renderDrawer({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders 'Add round stage' in add mode", () => {
    renderDrawer({ mode: "add" });
    expect(
      screen.getByRole("heading", { name: /Add round stage/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Edit round stage' in edit mode", () => {
    renderDrawer({ mode: "edit", draft: COMPLETE });
    expect(
      screen.getByRole("heading", { name: /Edit round stage/i }),
    ).toBeInTheDocument();
  });

  it("renders the literal increment default in an empty draft", () => {
    renderDrawer();
    expect(screen.getByDisplayValue("literal:1")).toBeInTheDocument();
    // No default floor — the minimum premium is opt-in.
    expect(screen.getByLabelText(/Minimum premium floor/i)).toHaveValue("");
  });
});

describe("<RoundStageDrawer> — Save gating", () => {
  it("disables Save for empty draft (display_name missing)", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: /Add stage/i })).toBeDisabled();
  });

  it("enables Save for a complete draft", () => {
    renderDrawer({ draft: COMPLETE });
    expect(screen.getByRole("button", { name: /Add stage/i })).toBeEnabled();
  });
});

describe("<RoundStageDrawer> — wire-through", () => {
  it("Cancel fires onCancel", () => {
    const onCancel = vi.fn();
    renderDrawer({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Save fires onSave when enabled", () => {
    const onSave = vi.fn();
    renderDrawer({ draft: COMPLETE, onSave });
    fireEvent.click(screen.getByRole("button", { name: /Add stage/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("typing into display_name fires onDraftChange", () => {
    const onDraftChange = vi.fn();
    renderDrawer({ onDraftChange });
    fireEvent.change(screen.getByLabelText(/Display name/i), {
      target: { value: "Snap to dollar" },
    });
    const next = onDraftChange.mock.calls[0]![0] as RoundDraft;
    expect(next.display_name).toBe("Snap to dollar");
  });
});

// ── Brief 80 D-D — the total-field contract ──────────────────────

describe("<RoundStageDrawer> — output-field contract (Brief 80 D-D)", () => {
  it("states the standard contract when no outputField is supplied (add mode)", () => {
    renderDrawer();
    const line = screen.getByTestId("rater-round-stage-drawer-output-standard");
    expect(line).toHaveTextContent(/total_premium/);
    expect(
      screen.queryByTestId("rater-round-stage-drawer-output-nonstandard"),
    ).not.toBeInTheDocument();
  });

  it("states the standard contract for a standard-field stage (edit mode)", () => {
    renderDrawer({ mode: "edit", outputField: "total_premium" });
    expect(
      screen.getByTestId("rater-round-stage-drawer-output-standard"),
    ).toBeInTheDocument();
  });

  it("warns on a bespoke total field and names both fields", () => {
    renderDrawer({ mode: "edit", outputField: "final_premium_usd" });
    const warn = screen.getByTestId(
      "rater-round-stage-drawer-output-nonstandard",
    );
    expect(warn).toHaveTextContent(/final_premium_usd/);
    expect(warn).toHaveTextContent(/total_premium/);
  });

  it("the one-click normalize fires the route's handler", () => {
    const onNormalizeOutputField = vi.fn();
    renderDrawer({
      mode: "edit",
      outputField: "final_premium_usd",
      onNormalizeOutputField,
    });
    fireEvent.click(
      screen.getByTestId("rater-round-stage-drawer-normalize-output"),
    );
    expect(onNormalizeOutputField).toHaveBeenCalledOnce();
  });

  it("no normalize button without a handler (read-only surfaces)", () => {
    renderDrawer({ mode: "edit", outputField: "final_premium_usd" });
    expect(
      screen.queryByTestId("rater-round-stage-drawer-normalize-output"),
    ).not.toBeInTheDocument();
  });
});
