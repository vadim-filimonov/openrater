/**
 * Brief 44 PR 44.2 — GeoDimWizard component tests.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { GeoDimWizard, type GeoDimDraft } from "./GeoDimWizard";

function setup(existingSlugs: readonly string[] = []) {
  const onCreate = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <GeoDimWizard
      existingSlugs={existingSlugs}
      onCreate={onCreate}
      onCancel={onCancel}
    />,
  );
  return { ...utils, onCreate, onCancel };
}

describe("<GeoDimWizard>", () => {
  it("opens on step 1 with state granularity as the default", () => {
    setup();
    expect(
      screen.getByText("How fine-grained is this geographic dimension?"),
    ).toBeInTheDocument();
    const stateOpt = screen
      .getByText("State")
      .closest(".rater-geo-wizard__opt");
    expect(stateOpt).toHaveClass("is-selected");
  });

  it("Back is disabled on step 1; Next is enabled", () => {
    setup();
    expect(screen.getByRole("button", { name: /Back/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
  });

  it("Cancel calls onCancel", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Step 1 → 2 advances; Next is disabled until a state is picked", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Which states are in scope?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  });

  it("clicking a state cell enables Next", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    const wi = screen.getByTitle("Wisconsin");
    fireEvent.click(wi);
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
    expect(wi).toHaveAttribute("aria-pressed", "true");
  });

  it("Whole country toggle bypasses the state grid", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    const toggle = screen.getByRole("button", { name: /Whole country/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    // The 13x4 state grid is gone in national mode.
    expect(screen.queryByTitle("Wisconsin")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
  });

  it("step 3 shows the auto-seed preview count", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // → step 2
    fireEvent.click(screen.getByTitle("Wisconsin"));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // → step 3

    // The "Review" step title — narrow by tag so it doesn't collide
    // with the "Review" step-indicator label.
    expect(
      screen.getByRole("heading", { name: "Review" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Auto-seeded levels/i)).toBeInTheDocument();
    // state-granularity + WI → 1 level. Asserted via the strong
    // element inside the review row (the "1" lives in <strong>).
    const reviewRow = screen
      .getByText(/Auto-seeded levels/i)
      .closest(".rater-geo-wizard__review-row");
    expect(reviewRow).toBeTruthy();
    expect(reviewRow!.querySelector("strong")?.textContent).toBe("1");
  });

  it("Create emits a fully-formed geographic draft (state granularity, WI)", () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 2
    fireEvent.click(screen.getByTitle("Wisconsin"));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 3
    fireEvent.click(
      screen.getByRole("button", { name: /Create dimension/ }),
    );

    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0]?.[0] as GeoDimDraft;
    expect(draft.dimension_type).toBe("geographic");
    expect(draft.geo_granularity).toBe("state");
    expect(draft.geo_scope).toEqual({ kind: "subset", states: ["WI"] });
    expect(draft.geo_territories).toEqual([]);
    expect(draft.levels).toHaveLength(1);
    expect(draft.levels[0]?.id).toBe("WI");
    expect(draft.slug).toBe("state");
    expect(draft.dim_id).toBe("state");
    // ADR-0038 — shape is "geographic" (was wrongly "categorical"); the
    // default name follows the granularity label.
    expect(draft.shape).toBe("geographic");
    expect(draft.display_name).toBe("State");
  });

  it("names the dim from an edited Name field, deriving slug + display_name (ADR-0038)", () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("radio", { name: /ZIP/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 2
    fireEvent.click(screen.getByTitle("Kansas"));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 3
    fireEvent.change(screen.getByLabelText("Dimension name"), {
      target: { value: "Territory" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create dimension/ }));

    const draft = onCreate.mock.calls[0]?.[0] as GeoDimDraft;
    // Identity is the NAME, not the granularity — no "zip" leak at birth.
    expect(draft.display_name).toBe("Territory");
    expect(draft.slug).toBe("territory");
    expect(draft.dim_id).toBe("territory");
    expect(draft.shape).toBe("geographic");
    expect(draft.geo_granularity).toBe("zip");
  });

  it("F13 — a ZIP-granularity dim defaults to 'Territory', not its granularity label", () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("radio", { name: /ZIP/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 2
    fireEvent.click(screen.getByTitle("Kansas"));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 3
    // No name edit — the default must be the rating concept, not "ZIP".
    fireEvent.click(screen.getByRole("button", { name: /Create dimension/ }));

    const draft = onCreate.mock.calls[0]?.[0] as GeoDimDraft;
    expect(draft.display_name).toBe("Territory");
    expect(draft.slug).toBe("territory");
    expect(draft.geo_granularity).toBe("zip");
  });

  it("Create with county granularity + WI emits 72 levels", () => {
    const { onCreate } = setup();
    // Step 1: pick County
    fireEvent.click(screen.getByRole("radio", { name: /County/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 2
    fireEvent.click(screen.getByTitle("Wisconsin"));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 3
    fireEvent.click(
      screen.getByRole("button", { name: /Create dimension/ }),
    );

    const draft = onCreate.mock.calls[0]?.[0] as GeoDimDraft;
    expect(draft.geo_granularity).toBe("county");
    expect(draft.levels).toHaveLength(72);
    expect(draft.levels[0]?.id).toMatch(/^55\d{3}$/);
    expect(draft.slug).toBe("county");
  });

  it("Create with national scope emits 51 levels (state granularity)", () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 2
    fireEvent.click(screen.getByRole("button", { name: /Whole country/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 3
    fireEvent.click(
      screen.getByRole("button", { name: /Create dimension/ }),
    );

    const draft = onCreate.mock.calls[0]?.[0] as GeoDimDraft;
    expect(draft.geo_scope).toEqual({ kind: "national" });
    expect(draft.levels).toHaveLength(51);
  });

  it("Back from step 2 → step 1", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // → step 2
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(
      screen.getByText("How fine-grained is this geographic dimension?"),
    ).toBeInTheDocument();
  });

  it("slug collision is avoided with a numeric suffix", () => {
    const { onCreate } = setup(["state", "state_2"]);
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 2
    fireEvent.click(screen.getByTitle("Wisconsin"));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 3
    fireEvent.click(
      screen.getByRole("button", { name: /Create dimension/ }),
    );

    const draft = onCreate.mock.calls[0]?.[0] as GeoDimDraft;
    expect(draft.slug).toBe("state_3");
  });

  it("ZIP granularity points to CSV import in review (honest seeding copy)", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: /ZIP/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 2
    fireEvent.click(screen.getByRole("button", { name: /Whole country/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ })); // step 3
    expect(screen.getByText(/import a ZIP/i)).toBeInTheDocument();
  });
});
