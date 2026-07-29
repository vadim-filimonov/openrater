/**
 * <PlanDeleteDialog> tests — K1.4.
 *
 * Covers the architectural contract this primitive promises:
 *
 *   1. Mount gating — open=false or plan=null short-circuits to null.
 *   2. Mode-specific copy — discard vs delete titles/bodies/buttons.
 *   3. Plan name echoed in title — "the user is confirming THIS plan."
 *   4. Cancel autofocuses on open — safe default for accidental Enter.
 *   5. Confirm + cancel handlers fire on click.
 *   6. Impact lines render only when count > 0 — no "0 stages" noise.
 *   7. Singular vs plural agreement.
 *   8. Pending state disables confirm + swaps in the pending label.
 *   9. Inline error row renders only when `error` is set, and never
 *      blocks a retry (confirm stays clickable while idle).
 *
 * No tests for the discard / delete *mutations* — those live at the
 * hook + service layer. This file is pure presentation coverage.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  PlanDeleteDialog,
  type PlanDeleteTarget,
} from "./PlanDeleteDialog";

const PLAN: PlanDeleteTarget = {
  rating_plan_id: "bop_wi_draft_abc",
  display_name: "Nonprofit 990 D&O + GL",
  status: "draft",
};

const ARCHIVED_PLAN: PlanDeleteTarget = {
  ...PLAN,
  status: "archived",
};

describe("<PlanDeleteDialog />", () => {
  it("renders null when open=false", () => {
    const { container } = render(
      <PlanDeleteDialog
        open={false}
        mode="discard"
        plan={PLAN}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when plan is null", () => {
    const { container } = render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("discarding a LIVE plan names the API turn-off (Brief 84 D-E)", () => {
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        isLive
        liveIntegrationCount={2}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText(
        "The quote API turns off — callers stop getting quotes immediately",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 connected apps stop receiving quotes from this plan",
      ),
    ).toBeInTheDocument();
  });

  it("names the live version when publishedVersionName is known", () => {
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        isLive
        publishedVersionName="v3"
        liveIntegrationCount={1}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText(
        "This plan is live (v3) — archiving turns its quote API off and callers stop getting quotes immediately",
      ),
    ).toBeInTheDocument();
    // The unnamed fallback must not double-render.
    expect(
      screen.queryByText(
        "The quote API turns off — callers stop getting quotes immediately",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("1 connected app stops receiving quotes from this plan"),
    ).toBeInTheDocument();
  });

  it("discarding a plain draft says nothing about the API", () => {
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.queryByText(/quote API turns off/),
    ).not.toBeInTheDocument();
  });

  it("echoes the plan display_name in the discard title", () => {
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Discard "Nonprofit 990 D&O \+ GL"\?/)).toBeTruthy();
    expect(screen.getByTestId("rater-plan-delete-dialog-confirm").textContent).toBe(
      "Discard plan",
    );
  });

  it("echoes the plan display_name in the delete title", () => {
    render(
      <PlanDeleteDialog
        open
        mode="delete"
        plan={ARCHIVED_PLAN}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText(/Permanently delete "Nonprofit 990 D&O \+ GL"\?/),
    ).toBeTruthy();
    expect(screen.getByTestId("rater-plan-delete-dialog-confirm").textContent).toBe(
      "Delete permanently",
    );
  });

  it("autofocuses Cancel on open (safe default)", () => {
    render(
      <PlanDeleteDialog
        open
        mode="delete"
        plan={ARCHIVED_PLAN}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const cancelBtn = screen.getByTestId("rater-plan-delete-dialog-cancel");
    expect(document.activeElement).toBe(cancelBtn);
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-plan-delete-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <PlanDeleteDialog
        open
        mode="delete"
        plan={ARCHIVED_PLAN}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-plan-delete-dialog-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("hides the impact callout when no impact prop is passed", () => {
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("rater-plan-delete-dialog-impact")).toBeNull();
  });

  it("hides the impact callout when every count is zero", () => {
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        impact={{ stages: 0, dimensions: 0 }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("rater-plan-delete-dialog-impact")).toBeNull();
  });

  it("renders only non-zero impact lines", () => {
    render(
      <PlanDeleteDialog
        open
        mode="delete"
        plan={ARCHIVED_PLAN}
        impact={{ stages: 4, dimensions: 0, factorTables: 2 }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const callout = screen.getByTestId("rater-plan-delete-dialog-impact");
    expect(callout.textContent).toContain("4 stages");
    expect(callout.textContent).toContain("2 factor tables");
    expect(callout.textContent).not.toContain("dimension");
  });

  it("pluralizes correctly (1 stage vs 4 stages)", () => {
    render(
      <PlanDeleteDialog
        open
        mode="delete"
        plan={ARCHIVED_PLAN}
        impact={{ stages: 1, dimensions: 4 }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const callout = screen.getByTestId("rater-plan-delete-dialog-impact");
    expect(callout.textContent).toContain("1 stage will be");
    expect(callout.textContent).toContain("4 dimensions will be");
  });

  it("uses 'archived' verb in discard mode, 'permanently removed' in delete mode", () => {
    const { rerender } = render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        impact={{ stages: 3 }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-plan-delete-dialog-impact").textContent,
    ).toContain("archived");

    rerender(
      <PlanDeleteDialog
        open
        mode="delete"
        plan={ARCHIVED_PLAN}
        impact={{ stages: 3 }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-plan-delete-dialog-impact").textContent,
    ).toContain("permanently removed");
  });

  it("disables the confirm button + swaps to pending label when pending=true", () => {
    render(
      <PlanDeleteDialog
        open
        mode="delete"
        plan={ARCHIVED_PLAN}
        pending
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const confirm = screen.getByTestId(
      "rater-plan-delete-dialog-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toBe("Deleting…");
  });

  it("uses data-mode attribute for QA + style hooks", () => {
    const { rerender } = render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-plan-delete-dialog").getAttribute("data-mode"),
    ).toBe("discard");

    rerender(
      <PlanDeleteDialog
        open
        mode="delete"
        plan={ARCHIVED_PLAN}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-plan-delete-dialog").getAttribute("data-mode"),
    ).toBe("delete");
  });

  it("hides the error row when no error is passed", () => {
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("rater-plan-delete-dialog-error")).toBeNull();
  });

  it("renders the inline error row when error is set", () => {
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        error="Couldn't reach the server to discard this plan. Check that API Lab is running, then try again."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const errorRow = screen.getByTestId("rater-plan-delete-dialog-error");
    expect(errorRow.getAttribute("role")).toBe("alert");
    expect(errorRow.textContent).toContain("Check that API Lab is running");
  });

  it("keeps confirm clickable while an error shows (retry is possible)", () => {
    const onConfirm = vi.fn();
    render(
      <PlanDeleteDialog
        open
        mode="discard"
        plan={PLAN}
        error="Couldn't discard this plan: boom"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const confirm = screen.getByTestId(
      "rater-plan-delete-dialog-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
