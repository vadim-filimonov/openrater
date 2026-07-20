/**
 * <ModifierEditor> tests — Brief 39 PR 39.3.
 *
 * Three layers:
 *   1. Pure helpers — emptyModifierDraft, emptyCategoryRow,
 *      isModifierDraftValid (mode-aware), computeCategoryRangeSums
 *   2. Render — kind picker switches visible fields; categories
 *      table renders rows with the right columns; flat / provision
 *      fields render their kind-specific inputs
 *   3. Interactions — kind switch fires patch; category add/remove;
 *      cap exceeds → footer state="exceeds"; save disables on invalid
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ModifierEditor,
  emptyModifierDraft,
  emptyCategoryRow,
  isModifierDraftValid,
  computeCategoryRangeSums,
  type ModifierDraft,
} from "./ModifierEditor";

function withSchedule(): ModifierDraft {
  return {
    ...emptyModifierDraft(),
    display_name: "IRPM schedule",
    kind: "schedule",
    cap_pct: 25,
    categories: [
      {
        id: "cat-0",
        name: "Management quality",
        range_lo_pct: -10,
        range_hi_pct: 10,
        reasoning_required: true,
        tier_filter: [],
      },
    ],
  };
}

// ── Pure helpers ────────────────────────────────────────────────

describe("emptyModifierDraft", () => {
  it("defaults to schedule mode with 1 empty category + 25% cap", () => {
    const d = emptyModifierDraft();
    expect(d.kind).toBe("schedule");
    expect(d.cap_pct).toBe(25);
    expect(d.categories).toHaveLength(1);
    expect(d.flat_effect).toBe("factor");
    expect(d.flat_factor).toBe(1.0);
    expect(d.provision_multiplier).toBe(1.0);
    expect(d.provision_applies_to).toBe("all");
  });
});

describe("emptyCategoryRow", () => {
  it("returns a category with ±10% range + no reasoning required", () => {
    const c = emptyCategoryRow(3);
    expect(c.id).toBe("cat-3");
    expect(c.name).toBe("");
    expect(c.range_lo_pct).toBe(-10);
    expect(c.range_hi_pct).toBe(10);
    expect(c.reasoning_required).toBe(false);
    expect(c.tier_filter).toEqual([]);
  });
});

describe("isModifierDraftValid (schedule)", () => {
  it("is true for a fully-formed schedule", () => {
    expect(isModifierDraftValid(withSchedule())).toBe(true);
  });
  it("is false when name is empty", () => {
    expect(
      isModifierDraftValid({ ...withSchedule(), display_name: "" }),
    ).toBe(false);
  });
  it("is false when cap is 0 or negative", () => {
    expect(
      isModifierDraftValid({ ...withSchedule(), cap_pct: 0 }),
    ).toBe(false);
    expect(
      isModifierDraftValid({ ...withSchedule(), cap_pct: -5 }),
    ).toBe(false);
  });
  it("is false when any category has empty name", () => {
    const d = withSchedule();
    expect(
      isModifierDraftValid({
        ...d,
        categories: [{ ...d.categories[0]!, name: "" }],
      }),
    ).toBe(false);
  });
  it("is false when range_lo > range_hi (inverted)", () => {
    const d = withSchedule();
    expect(
      isModifierDraftValid({
        ...d,
        categories: [{ ...d.categories[0]!, range_lo_pct: 20, range_hi_pct: 10 }],
      }),
    ).toBe(false);
  });
});

describe("isModifierDraftValid (flat)", () => {
  it("factor mode: true when factor > 0 + name set", () => {
    const d: ModifierDraft = {
      ...emptyModifierDraft(),
      display_name: "Terrorism loading",
      kind: "flat",
      flat_effect: "factor",
      flat_factor: 1.02,
    };
    expect(isModifierDraftValid(d)).toBe(true);
  });
  it("factor mode: false when factor is 0", () => {
    const d: ModifierDraft = {
      ...emptyModifierDraft(),
      display_name: "Foo",
      kind: "flat",
      flat_effect: "factor",
      flat_factor: 0,
    };
    expect(isModifierDraftValid(d)).toBe(false);
  });
  it("additive mode: true when amount is non-zero", () => {
    const d: ModifierDraft = {
      ...emptyModifierDraft(),
      display_name: "Buyback",
      kind: "flat",
      flat_effect: "additive",
      flat_amount: 250,
    };
    expect(isModifierDraftValid(d)).toBe(true);
  });
  it("additive mode: false when amount is 0", () => {
    const d: ModifierDraft = {
      ...emptyModifierDraft(),
      display_name: "Foo",
      kind: "flat",
      flat_effect: "additive",
      flat_amount: 0,
    };
    expect(isModifierDraftValid(d)).toBe(false);
  });
});

describe("isModifierDraftValid (provision)", () => {
  it("is true when multiplier > 0 + name set", () => {
    const d: ModifierDraft = {
      ...emptyModifierDraft(),
      display_name: "Profit provision",
      kind: "provision",
      provision_multiplier: 1.05,
    };
    expect(isModifierDraftValid(d)).toBe(true);
  });
  it("is false when multiplier is 0 or negative", () => {
    const d: ModifierDraft = {
      ...emptyModifierDraft(),
      display_name: "Foo",
      kind: "provision",
      provision_multiplier: 0,
    };
    expect(isModifierDraftValid(d)).toBe(false);
  });
});

describe("computeCategoryRangeSums", () => {
  it("sums category bounds for schedule mode", () => {
    const d: ModifierDraft = {
      ...withSchedule(),
      categories: [
        { id: "a", name: "A", range_lo_pct: -10, range_hi_pct: 10, reasoning_required: false, tier_filter: [] },
        { id: "b", name: "B", range_lo_pct: -15, range_hi_pct: 15, reasoning_required: false, tier_filter: [] },
        { id: "c", name: "C", range_lo_pct: -25, range_hi_pct: 0, reasoning_required: false, tier_filter: [] },
      ],
    };
    const sums = computeCategoryRangeSums(d);
    expect(sums).toEqual({ sum_lo: -50, sum_hi: 25 });
  });
  it("returns null for non-schedule modes", () => {
    const d: ModifierDraft = { ...emptyModifierDraft(), kind: "flat" };
    expect(computeCategoryRangeSums(d)).toBeNull();
  });
});

// ── Render ──────────────────────────────────────────────────────

describe("<ModifierEditor> — render", () => {
  it("renders the head with display_name + kind + cap (schedule)", () => {
    render(
      <ModifierEditor draft={withSchedule()} onChange={() => {}} />,
    );
    expect(screen.getByText("IRPM schedule")).toBeInTheDocument();
    expect(screen.getByText(/modifier · schedule · ±25% cap/)).toBeInTheDocument();
  });

  it("renders the kind picker with 3 options", () => {
    render(
      <ModifierEditor draft={withSchedule()} onChange={() => {}} />,
    );
    expect(screen.getByTestId("rater-modifier-editor-kind-schedule")).toBeInTheDocument();
    expect(screen.getByTestId("rater-modifier-editor-kind-flat")).toBeInTheDocument();
    expect(screen.getByTestId("rater-modifier-editor-kind-provision")).toBeInTheDocument();
  });

  it("renders the categories table in schedule mode", () => {
    render(
      <ModifierEditor draft={withSchedule()} onChange={() => {}} />,
    );
    expect(screen.getByTestId("rater-modifier-editor-cap")).toBeInTheDocument();
    expect(screen.getByTestId("rater-modifier-editor-cat-0-name")).toBeInTheDocument();
    expect(screen.getByTestId("rater-modifier-editor-add-cat")).toBeInTheDocument();
  });

  it("renders the flat fields in flat mode (factor)", () => {
    const d: ModifierDraft = {
      ...emptyModifierDraft(),
      kind: "flat",
      display_name: "Terrorism",
      flat_factor: 1.02,
    };
    render(<ModifierEditor draft={d} onChange={() => {}} />);
    expect(screen.getByTestId("rater-modifier-editor-flat-factor")).toBeInTheDocument();
    expect(screen.getByTestId("rater-modifier-editor-factor-value")).toBeInTheDocument();
    expect(screen.queryByTestId("rater-modifier-editor-cap")).toBeNull();
    expect(screen.queryByTestId("rater-modifier-editor-amount-value")).toBeNull();
  });

  it("renders the amount input in flat-additive mode", () => {
    const d: ModifierDraft = {
      ...emptyModifierDraft(),
      kind: "flat",
      display_name: "Buyback",
      flat_effect: "additive",
      flat_amount: 250,
    };
    render(<ModifierEditor draft={d} onChange={() => {}} />);
    expect(screen.getByTestId("rater-modifier-editor-amount-value")).toBeInTheDocument();
    expect(screen.queryByTestId("rater-modifier-editor-factor-value")).toBeNull();
  });

  it("renders the provision fields in provision mode", () => {
    const d: ModifierDraft = {
      ...emptyModifierDraft(),
      kind: "provision",
      display_name: "Profit",
      provision_multiplier: 1.05,
    };
    render(<ModifierEditor draft={d} onChange={() => {}} />);
    expect(
      screen.getByTestId("rater-modifier-editor-provision-multiplier"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-modifier-editor-provision-applies-to"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("rater-modifier-editor-cap")).toBeNull();
  });
});

// ── Interactions ────────────────────────────────────────────────

describe("<ModifierEditor> — interactions", () => {
  it("fires onChange when kind picker is clicked", () => {
    const onChange = vi.fn();
    render(
      <ModifierEditor draft={withSchedule()} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("rater-modifier-editor-kind-flat"));
    expect(onChange).toHaveBeenCalled();
    const patch = onChange.mock.calls[0]![0] as ModifierDraft;
    expect(patch.kind).toBe("flat");
  });

  it("fires onChange when a category name changes", () => {
    const onChange = vi.fn();
    render(
      <ModifierEditor draft={withSchedule()} onChange={onChange} />,
    );
    fireEvent.change(
      screen.getByTestId("rater-modifier-editor-cat-0-name"),
      { target: { value: "Building condition" } },
    );
    const patch = onChange.mock.calls[0]![0] as ModifierDraft;
    expect(patch.categories[0]!.name).toBe("Building condition");
  });

  it("adds a category row when Add category clicks", () => {
    const onChange = vi.fn();
    render(
      <ModifierEditor draft={withSchedule()} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("rater-modifier-editor-add-cat"));
    const patch = onChange.mock.calls[0]![0] as ModifierDraft;
    expect(patch.categories).toHaveLength(2);
  });

  it("toggles reasoning_required on a category", () => {
    const onChange = vi.fn();
    render(
      <ModifierEditor draft={withSchedule()} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("rater-modifier-editor-cat-0-reason"));
    const patch = onChange.mock.calls[0]![0] as ModifierDraft;
    // Original was true → toggle to false.
    expect(patch.categories[0]!.reasoning_required).toBe(false);
  });

  it("parses tier_filter as comma-separated", () => {
    const onChange = vi.fn();
    render(
      <ModifierEditor draft={withSchedule()} onChange={onChange} />,
    );
    fireEvent.change(
      screen.getByTestId("rater-modifier-editor-cat-0-tier"),
      { target: { value: "tier-1, tier-2 , preferred" } },
    );
    const patch = onChange.mock.calls[0]![0] as ModifierDraft;
    expect(patch.categories[0]!.tier_filter).toEqual([
      "tier-1",
      "tier-2",
      "preferred",
    ]);
  });

  it("disables save when draft is invalid", () => {
    const d: ModifierDraft = { ...withSchedule(), display_name: "" };
    render(
      <ModifierEditor draft={d} onChange={() => {}} onSave={() => {}} />,
    );
    const save = screen.getByTestId(
      "rater-modifier-editor-save",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("fires onSave when save is clicked and draft is valid", () => {
    const onSave = vi.fn();
    render(
      <ModifierEditor
        draft={withSchedule()}
        onChange={() => {}}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-modifier-editor-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// Phase H.6 — Model mode (Brief 41 + ModifierModelKind)
// ─────────────────────────────────────────────────────────────────

function withModel(overrides: Partial<ModifierDraft> = {}): ModifierDraft {
  return {
    ...emptyModifierDraft(),
    display_name: "Credit-score pricing v1",
    kind: "model",
    model_id: "credit_score_v1",
    model_version: "2026.05",
    model_inputs: [{ id: "mi-0", variable: "credit_score" }],
    clamp_min: 0.85,
    clamp_max: 1.25,
    fallback_factor: 0.95,
    rationale: "Conservative cap pending Q3 filing.",
    ...overrides,
  };
}

describe("isModifierDraftValid (model)", () => {
  it("returns true for a complete model draft", () => {
    expect(isModifierDraftValid(withModel())).toBe(true);
  });

  it("returns false when display_name is empty", () => {
    expect(
      isModifierDraftValid({ ...withModel(), display_name: "" }),
    ).toBe(false);
  });

  it("returns false when model_id is empty", () => {
    expect(isModifierDraftValid({ ...withModel(), model_id: "" })).toBe(false);
    expect(isModifierDraftValid({ ...withModel(), model_id: "   " })).toBe(
      false,
    );
  });

  it("returns false when declared_inputs is empty or has blank variable", () => {
    expect(isModifierDraftValid({ ...withModel(), model_inputs: [] })).toBe(
      false,
    );
    expect(
      isModifierDraftValid({
        ...withModel(),
        model_inputs: [{ id: "x", variable: "" }],
      }),
    ).toBe(false);
  });

  it("returns false when clamp envelope is inverted (min > max)", () => {
    expect(
      isModifierDraftValid({ ...withModel(), clamp_min: 1.5, clamp_max: 0.8 }),
    ).toBe(false);
  });

  it("returns false when fallback_factor is invalid (≤ 0 or non-finite)", () => {
    expect(
      isModifierDraftValid({ ...withModel(), fallback_factor: 0 }),
    ).toBe(false);
    expect(
      isModifierDraftValid({ ...withModel(), fallback_factor: -0.5 }),
    ).toBe(false);
    expect(
      isModifierDraftValid({ ...withModel(), fallback_factor: NaN }),
    ).toBe(false);
  });
});

describe("ModifierEditor (model mode rendering + interactions)", () => {
  it("renders the model fields when kind is 'model'", () => {
    render(<ModifierEditor draft={withModel()} onChange={() => {}} />);
    expect(
      screen.getByTestId("rater-modifier-editor-model-id"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-modifier-editor-clamp-min"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-modifier-editor-clamp-max"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-modifier-editor-fallback-factor"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-modifier-editor-rationale"),
    ).toBeInTheDocument();
    // The embedded ClampVisualizer surfaces with the prefixed testId
    expect(
      screen.getByTestId("rater-modifier-editor-clamp-visualizer"),
    ).toBeInTheDocument();
  });

  it("switches kind from schedule to model when the Model tab is clicked", () => {
    const onChange = vi.fn();
    render(<ModifierEditor draft={withSchedule()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("rater-modifier-editor-kind-model"));
    const patch = onChange.mock.calls[0]![0] as ModifierDraft;
    expect(patch.kind).toBe("model");
  });

  it("fires onChange with the new model_id when the input changes", () => {
    const onChange = vi.fn();
    render(<ModifierEditor draft={withModel()} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("rater-modifier-editor-model-id"), {
      target: { value: "new_model_v2" },
    });
    const patch = onChange.mock.calls[0]![0] as ModifierDraft;
    expect(patch.model_id).toBe("new_model_v2");
  });

  it("adds a declared input row when 'Add input' is clicked", () => {
    const onChange = vi.fn();
    render(<ModifierEditor draft={withModel()} onChange={onChange} />);
    fireEvent.click(
      screen.getByTestId("rater-modifier-editor-model-input-add"),
    );
    const patch = onChange.mock.calls[0]![0] as ModifierDraft;
    expect(patch.model_inputs).toHaveLength(2);
  });

  it("removes a declared input row when the remove button is clicked", () => {
    const onChange = vi.fn();
    render(
      <ModifierEditor
        draft={withModel({
          model_inputs: [
            { id: "mi-0", variable: "credit_score" },
            { id: "mi-1", variable: "building_age" },
          ],
        })}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-modifier-editor-model-input-1-remove"),
    );
    const patch = onChange.mock.calls[0]![0] as ModifierDraft;
    expect(patch.model_inputs).toHaveLength(1);
    expect(patch.model_inputs[0]!.id).toBe("mi-0");
  });

  it("disables save when model draft is invalid (e.g., inverted clamp)", () => {
    const draft: ModifierDraft = withModel({ clamp_min: 1.5, clamp_max: 0.8 });
    render(
      <ModifierEditor draft={draft} onChange={() => {}} onSave={() => {}} />,
    );
    const save = screen.getByTestId(
      "rater-modifier-editor-save",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("surfaces the clamp envelope in the header subtitle", () => {
    render(<ModifierEditor draft={withModel()} onChange={() => {}} />);
    // The header sub renders "modifier · model · clamp [0.85, 1.25]"
    expect(screen.getByText(/clamp \[0\.85, 1\.25\]/i)).toBeInTheDocument();
  });
});
