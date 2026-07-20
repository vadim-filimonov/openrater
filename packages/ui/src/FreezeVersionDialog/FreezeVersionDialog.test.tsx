/**
 * <FreezeVersionDialog> tests — Brief 43 / PR 43.1.
 *
 * Covers the user-observable contract:
 *   • Mount-gating (closed when open=false).
 *   • Default name pre-fills the input.
 *   • Submit disabled while the name input is empty / whitespace-only.
 *   • Submit fires onConfirm with the trimmed name + null notes when
 *     the notes field is blank.
 *   • Submit fires onConfirm with notes as a string when populated.
 *   • Cancel + close-X (via Modal) fires onClose.
 *   • errorMessage prop renders the inline 409 banner.
 *   • isSubmitting disables everything + changes the label.
 *   • Form state resets when the dialog re-opens with a new default.
 *   • Form fields prevent submission when the value exceeds max length
 *     (the input doesn't truncate — it surfaces an error hint).
 */

import { describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { FreezeVersionDialog } from "./FreezeVersionDialog";

const PLAN = {
  display_name: "Meridian BOP — 2026 baseline",
  line_of_business: "bop",
  effective_date: "2026-04-01",
  content_hash: "abc1234567890def",
};

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof FreezeVersionDialog>> = {},
) {
  const props = {
    open: true,
    plan: PLAN,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  return { ...render(<FreezeVersionDialog {...props} />), props };
}

describe("<FreezeVersionDialog> mount-gating", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <FreezeVersionDialog
        open={false}
        plan={PLAN}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the form when open=true", () => {
    renderDialog();
    expect(
      screen.getByTestId("rater-freeze-version-dialog"),
    ).toBeInTheDocument();
  });
});

describe("<FreezeVersionDialog> context strip", () => {
  it("renders the plan name + LOB + effective date + short hash", () => {
    renderDialog();
    const strip = screen.getByTestId("rater-freeze-version-dialog-context");
    expect(strip).toHaveTextContent("Meridian BOP — 2026 baseline");
    expect(strip).toHaveTextContent("BOP");
    expect(strip).toHaveTextContent("2026-04-01");
    // Hash is sliced to the first 7 chars.
    expect(strip).toHaveTextContent("abc1234");
    expect(strip).not.toHaveTextContent("567890def");
  });

  it("omits the hash chip when content_hash is null", () => {
    renderDialog({
      plan: { ...PLAN, content_hash: null },
    });
    const strip = screen.getByTestId("rater-freeze-version-dialog-context");
    expect(strip).not.toHaveTextContent("abc1234");
  });
});

describe("<FreezeVersionDialog> default name + submit gating", () => {
  it("pre-fills the name input with defaultName", () => {
    renderDialog({ defaultName: "draft_2026-05-26" });
    expect(
      screen.getByTestId("rater-freeze-version-dialog-name"),
    ).toHaveValue("draft_2026-05-26");
  });

  it("disables submit when the name is empty", () => {
    renderDialog({ defaultName: "" });
    expect(
      screen.getByTestId("rater-freeze-version-dialog-confirm"),
    ).toBeDisabled();
  });

  it("disables submit when the name is whitespace-only", () => {
    renderDialog({ defaultName: "   " });
    expect(
      screen.getByTestId("rater-freeze-version-dialog-confirm"),
    ).toBeDisabled();
  });

  it("enables submit once the name is non-empty", () => {
    renderDialog({ defaultName: "v1" });
    expect(
      screen.getByTestId("rater-freeze-version-dialog-confirm"),
    ).not.toBeDisabled();
  });
});

describe("<FreezeVersionDialog> confirm payload", () => {
  it("trims the name + sends null notes when the notes field is blank", () => {
    const onConfirm = vi.fn();
    renderDialog({ defaultName: "  filed_q3  ", onConfirm });
    fireEvent.click(
      screen.getByTestId("rater-freeze-version-dialog-confirm"),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      display_name: "filed_q3",
      notes: null,
    });
  });

  it("trims the notes + sends as a string when the field is populated", () => {
    const onConfirm = vi.fn();
    renderDialog({ defaultName: "v1", onConfirm });
    fireEvent.change(
      screen.getByTestId("rater-freeze-version-dialog-notes"),
      { target: { value: "  baseline pricing  " } },
    );
    fireEvent.click(
      screen.getByTestId("rater-freeze-version-dialog-confirm"),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      display_name: "v1",
      notes: "baseline pricing",
    });
  });

  it("submits via the form (Enter key inside the input)", () => {
    const onConfirm = vi.fn();
    renderDialog({ defaultName: "v2", onConfirm });
    fireEvent.submit(
      screen.getByTestId("rater-freeze-version-dialog"),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      display_name: "v2",
      notes: null,
    });
  });
});

describe("<FreezeVersionDialog> cancel + close", () => {
  it("fires onClose when the cancel button is clicked", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(
      screen.getByTestId("rater-freeze-version-dialog-cancel"),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("<FreezeVersionDialog> inline error banner", () => {
  it("does not render the banner when errorMessage is falsy", () => {
    renderDialog({ defaultName: "v1" });
    expect(
      screen.queryByTestId("rater-freeze-version-dialog-error"),
    ).not.toBeInTheDocument();
  });

  it("renders the banner with the supplied message", () => {
    renderDialog({
      defaultName: "filed_q3",
      errorMessage: "That name is already in use on this plan.",
    });
    const banner = screen.getByTestId(
      "rater-freeze-version-dialog-error",
    );
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(
      "That name is already in use on this plan.",
    );
  });
});

describe("<FreezeVersionDialog> isSubmitting state", () => {
  it("disables both buttons + changes the confirm label", () => {
    renderDialog({ defaultName: "v1", isSubmitting: true });
    const confirm = screen.getByTestId(
      "rater-freeze-version-dialog-confirm",
    );
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent("Saving…");
    expect(
      screen.getByTestId("rater-freeze-version-dialog-cancel"),
    ).toBeDisabled();
  });

  it("disables the form inputs", () => {
    renderDialog({ defaultName: "v1", isSubmitting: true });
    expect(
      screen.getByTestId("rater-freeze-version-dialog-name"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("rater-freeze-version-dialog-notes"),
    ).toBeDisabled();
  });
});

describe("<FreezeVersionDialog> overflow validation", () => {
  it("disables submit + shows the trim hint when name exceeds 200 chars", () => {
    renderDialog({ defaultName: "x".repeat(201) });
    expect(
      screen.getByTestId("rater-freeze-version-dialog-confirm"),
    ).toBeDisabled();
    expect(
      screen.getByText(/Trim to 200 characters/),
    ).toBeInTheDocument();
  });

  it("disables submit + shows the trim hint when notes exceeds 2000 chars", () => {
    renderDialog({ defaultName: "v1" });
    fireEvent.change(
      screen.getByTestId("rater-freeze-version-dialog-notes"),
      { target: { value: "x".repeat(2001) } },
    );
    expect(
      screen.getByTestId("rater-freeze-version-dialog-confirm"),
    ).toBeDisabled();
    expect(
      screen.getByText(/Trim to 2000 characters/),
    ).toBeInTheDocument();
  });
});

describe("<FreezeVersionDialog> reopen resets form state", () => {
  it("re-applies defaultName + clears notes when the dialog re-opens", () => {
    const { rerender } = render(
      <FreezeVersionDialog
        open={true}
        plan={PLAN}
        defaultName="draft_1"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    // User edits the name + adds notes.
    fireEvent.change(
      screen.getByTestId("rater-freeze-version-dialog-name"),
      { target: { value: "edited" } },
    );
    fireEvent.change(
      screen.getByTestId("rater-freeze-version-dialog-notes"),
      { target: { value: "scratch" } },
    );
    // Close the dialog.
    rerender(
      <FreezeVersionDialog
        open={false}
        plan={PLAN}
        defaultName="draft_1"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    // Reopen with a new defaultName.
    rerender(
      <FreezeVersionDialog
        open={true}
        plan={PLAN}
        defaultName="draft_2"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-freeze-version-dialog-name"),
    ).toHaveValue("draft_2");
    expect(
      screen.getByTestId("rater-freeze-version-dialog-notes"),
    ).toHaveValue("");
    cleanup();
  });
});
