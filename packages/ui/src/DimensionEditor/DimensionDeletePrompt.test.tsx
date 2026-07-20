/**
 * <DimensionDeletePrompt> tests — Brief 30 PR 30.5 (Frame 10).
 *
 * Covers:
 *   • Mount-gating (closed when open=false or dim=null).
 *   • 0-ref simple variant (no consumers → safe-delete copy).
 *   • n-ref impact variant (impact preview + warning + ref list).
 *   • Subtitle pluralization (1 reference vs N references).
 *   • Reference row click → onJumpToReference (with the ref payload).
 *   • Reference rows disabled when onJumpToReference is omitted.
 *   • Per-kind icon container classes (chain / factor-table /
 *     modifier / curve).
 *   • Confirm + cancel handlers fire.
 *   • Modal sizing flips lg ↔ sm per variant (via data-variant attr).
 *   • Title fallback (display_name → slug → id).
 *
 * Per the Brief 30 §10 lock: "10+ tests covering 0-ref vs n-ref
 * flows, jump-to-reference, delete confirmation."
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DimensionDeletePrompt } from "./DimensionDeletePrompt";
import type { DimensionReference } from "./UsedInPanel";
import type { DimensionRow } from "../DimensionsTable";

const CONSTRUCTION_DIM: DimensionRow = {
  id: "construction",
  display_name: "Construction",
  slug: "construction",
  dimension_type: "standard",
  shape: "categorical",
  data_type: "string",
  role: "rating-input",
  levels: [],
};

const ORPHAN_DIM: DimensionRow = {
  id: "orphan_dim",
  display_name: "",
  slug: "orphan_dim",
  dimension_type: "standard",
  shape: "categorical",
  data_type: "string",
  role: "rating-input",
  levels: [],
};

const ID_ONLY_DIM: DimensionRow = {
  id: "id-only",
  display_name: "",
  slug: "",
  dimension_type: "standard",
  shape: "categorical",
  data_type: "string",
  role: "rating-input",
  levels: [],
};

const SINGLE_REF: readonly DimensionReference[] = [
  {
    kind: "factor-table",
    id: "construction_factor",
    label: "construction_factor",
    context: "key column · 6 rows",
  },
];

const MIXED_REFS: readonly DimensionReference[] = [
  {
    kind: "chain",
    id: "stage_3::0::1",
    label: "Construction relativity",
    context: "stage 3 · chain factor",
  },
  {
    kind: "factor-table",
    id: "construction_factor",
    label: "construction_factor",
    context: "key column · 6 rows",
  },
  {
    kind: "modifier",
    id: "mod_construction",
    label: "Construction surcharge",
    context: "modifier schedule · 3 tiers",
  },
  {
    kind: "curve",
    id: "construction_curve",
    label: "Construction curve",
    context: "x-axis · 4 breakpoints",
  },
];

// ──────────────────────────────────────────────────────────────────
// Mount-gating
// ──────────────────────────────────────────────────────────────────

describe("<DimensionDeletePrompt> mount-gating", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <DimensionDeletePrompt
        open={false}
        dim={CONSTRUCTION_DIM}
        references={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when dim=null even if open=true", () => {
    const { container } = render(
      <DimensionDeletePrompt
        open={true}
        dim={null}
        references={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// ──────────────────────────────────────────────────────────────────
// 0-ref simple variant
// ──────────────────────────────────────────────────────────────────

describe("<DimensionDeletePrompt> 0-ref (simple) variant", () => {
  it("renders the simple variant when references=[]", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={ORPHAN_DIM}
        references={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-dim-delete-prompt"),
    ).toHaveAttribute("data-variant", "simple");
  });

  it("uses safe-delete copy + Delete (not 'Delete dimension') button", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={ORPHAN_DIM}
        references={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText(/This dimension has no consumers/),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-dim-delete-prompt-confirm"),
    ).toHaveTextContent("Delete");
    // The impact-flow warning + ref list should NOT render.
    expect(
      screen.queryByTestId("rater-dim-delete-prompt-warning"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-dim-delete-prompt-refs"),
    ).not.toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// n-ref impact variant
// ──────────────────────────────────────────────────────────────────

describe("<DimensionDeletePrompt> n-ref (impact) variant", () => {
  it("renders the impact variant when references is non-empty", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={CONSTRUCTION_DIM}
        references={MIXED_REFS}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-dim-delete-prompt"),
    ).toHaveAttribute("data-variant", "impact");
    expect(
      screen.getByTestId("rater-dim-delete-prompt-warning"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-dim-delete-prompt-refs"),
    ).toBeInTheDocument();
  });

  it("renders a row per reference + the per-kind icon class hook", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={CONSTRUCTION_DIM}
        references={MIXED_REFS}
        onConfirm={() => {}}
        onCancel={() => {}}
        onJumpToReference={() => {}}
      />,
    );
    const list = screen.getByTestId("rater-dim-delete-prompt-refs");
    // 4 reference rows.
    expect(within(list).getAllByRole("button")).toHaveLength(4);
    // Each kind gets its discriminator class on the button.
    expect(
      within(list).getByTestId(
        "rater-dim-delete-prompt-ref-chain-stage_3::0::1",
      ),
    ).toHaveClass("rater-dim-delete-prompt__ref--chain");
    expect(
      within(list).getByTestId(
        "rater-dim-delete-prompt-ref-factor-table-construction_factor",
      ),
    ).toHaveClass("rater-dim-delete-prompt__ref--factor-table");
    expect(
      within(list).getByTestId(
        "rater-dim-delete-prompt-ref-modifier-mod_construction",
      ),
    ).toHaveClass("rater-dim-delete-prompt__ref--modifier");
    expect(
      within(list).getByTestId(
        "rater-dim-delete-prompt-ref-curve-construction_curve",
      ),
    ).toHaveClass("rater-dim-delete-prompt__ref--curve");
  });

  it("uses 'Delete dimension' label on the danger button (impact variant)", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={CONSTRUCTION_DIM}
        references={MIXED_REFS}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-dim-delete-prompt-confirm"),
    ).toHaveTextContent("Delete dimension");
  });

  it("singular subtitle for 1 reference", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={CONSTRUCTION_DIM}
        references={SINGLE_REF}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // The Modal renders the subtitle. "1 reference will break."
    expect(
      screen.getByText("1 reference will break."),
    ).toBeInTheDocument();
  });

  it("plural subtitle for N references", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={CONSTRUCTION_DIM}
        references={MIXED_REFS}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText("4 references will break."),
    ).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────

describe("<DimensionDeletePrompt> handlers", () => {
  it("fires onConfirm when the danger button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <DimensionDeletePrompt
        open={true}
        dim={ORPHAN_DIM}
        references={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-dim-delete-prompt-confirm"),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <DimensionDeletePrompt
        open={true}
        dim={ORPHAN_DIM}
        references={[]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-dim-delete-prompt-cancel"),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("fires onJumpToReference with the ref payload when a row is clicked", () => {
    const onJumpToReference = vi.fn();
    render(
      <DimensionDeletePrompt
        open={true}
        dim={CONSTRUCTION_DIM}
        references={MIXED_REFS}
        onConfirm={() => {}}
        onCancel={() => {}}
        onJumpToReference={onJumpToReference}
      />,
    );
    fireEvent.click(
      screen.getByTestId(
        "rater-dim-delete-prompt-ref-factor-table-construction_factor",
      ),
    );
    expect(onJumpToReference).toHaveBeenCalledTimes(1);
    expect(onJumpToReference).toHaveBeenCalledWith(MIXED_REFS[1]);
  });

  it("disables reference rows when onJumpToReference is omitted", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={CONSTRUCTION_DIM}
        references={MIXED_REFS}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByTestId(
        "rater-dim-delete-prompt-ref-chain-stage_3::0::1",
      ),
    ).toBeDisabled();
  });
});

// ──────────────────────────────────────────────────────────────────
// Display label fallback
// ──────────────────────────────────────────────────────────────────

describe("<DimensionDeletePrompt> display label fallback", () => {
  it("uses display_name in the title when set", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={CONSTRUCTION_DIM}
        references={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText('Delete "Construction"?'),
    ).toBeInTheDocument();
  });

  it("falls back to slug when display_name is empty", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={ORPHAN_DIM}
        references={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText('Delete "orphan_dim"?'),
    ).toBeInTheDocument();
  });

  it("falls back to id when both display_name + slug are empty", () => {
    render(
      <DimensionDeletePrompt
        open={true}
        dim={ID_ONLY_DIM}
        references={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText('Delete "id-only"?'),
    ).toBeInTheDocument();
  });
});
