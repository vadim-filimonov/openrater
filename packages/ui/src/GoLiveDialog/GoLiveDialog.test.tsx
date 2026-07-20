/**
 * <GoLiveDialog> tests — Brief 84 D-B: the ONE deploy verb's dialog.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GoLiveDialog } from "./GoLiveDialog";

function renderDialog(
  overrides: Partial<Parameters<typeof GoLiveDialog>[0]> = {},
) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <GoLiveDialog
      open
      mode="first"
      defaultVersionName="v1"
      onClose={onClose}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, onClose };
}

describe("<GoLiveDialog>", () => {
  it("first mode: Go live copy + the what-happens list names the turn-on", () => {
    renderDialog();
    expect(
      screen.getByRole("heading", { name: "Go live" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The quote API turns on — callers get v1/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/draft stays editable/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Go live/ }),
    ).toBeInTheDocument();
  });

  it("update mode: names the switch from the live version", () => {
    renderDialog({
      mode: "update",
      defaultVersionName: "v2",
      liveVersionName: "v1",
    });
    expect(screen.getByText("Publish update")).toBeInTheDocument();
    expect(
      screen.getByText(/Callers switch from v1 to v2 immediately/),
    ).toBeInTheDocument();
    expect(screen.getByText(/v1 stays in the timeline/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Publish v2" }),
    ).toBeInTheDocument();
  });

  it("update + live apps: WARNS they pause until a Hub re-test (audit gap #3)", () => {
    renderDialog({
      mode: "update",
      defaultVersionName: "v2",
      liveVersionName: "v1",
      liveConnectionNames: ["Meridian Front"],
    });
    const row = screen.getByText(
      "Meridian Front pauses until v2 passes a re-test in the Hub",
    );
    expect(row.closest("li")?.className).toContain("what-row--warn");
    // The pre-tripwire promise is dead copy.
    expect(screen.queryByText(/no Hub steps/)).not.toBeInTheDocument();
  });

  it("update + two live apps: joins the names, plural verb", () => {
    renderDialog({
      mode: "update",
      defaultVersionName: "v3",
      liveVersionName: "v2",
      liveConnectionNames: ["Meridian Front", "AgentPort"],
    });
    expect(
      screen.getByText(
        "Meridian Front and AgentPort pause until v3 passes a re-test in the Hub",
      ),
    ).toBeInTheDocument();
  });

  it("update + no live apps: says nothing pauses (calm, honest)", () => {
    renderDialog({
      mode: "update",
      defaultVersionName: "v2",
      liveVersionName: "v1",
    });
    expect(
      screen.getByText(
        "No connected apps are serving this plan — nothing pauses",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/re-test in the Hub/)).not.toBeInTheDocument();
  });

  it("confirms with the trimmed name + null notes when blank", () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId("rater-go-live-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      version_name: "v1",
      notes: null,
    });
  });

  it("carries an edited name + notes through", () => {
    const { onConfirm } = renderDialog();
    fireEvent.change(screen.getByTestId("rater-go-live-dialog-name"), {
      target: { value: " filed_2026_q3 " },
    });
    fireEvent.change(screen.getByTestId("rater-go-live-dialog-notes"), {
      target: { value: "Q3 filing." },
    });
    fireEvent.click(screen.getByTestId("rater-go-live-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      version_name: "filed_2026_q3",
      notes: "Q3 filing.",
    });
  });

  it("blocks submit on an empty name", () => {
    const { onConfirm } = renderDialog();
    fireEvent.change(screen.getByTestId("rater-go-live-dialog-name"), {
      target: { value: "  " },
    });
    expect(screen.getByTestId("rater-go-live-dialog-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("rater-go-live-dialog-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("surfaces the parent-mapped 409 inline and keeps the form", () => {
    renderDialog({
      errorMessage: 'A version named "v1" already exists for this plan.',
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "already exists",
    );
    // The user can fix the name without losing anything.
    expect(screen.getByTestId("rater-go-live-dialog-name")).toBeEnabled();
  });

  it("busy state disables + relabels the primary", () => {
    renderDialog({ isSubmitting: true });
    const primary = screen.getByTestId("rater-go-live-dialog-confirm");
    expect(primary).toBeDisabled();
    expect(primary.textContent).toContain("Publishing…");
  });
});
