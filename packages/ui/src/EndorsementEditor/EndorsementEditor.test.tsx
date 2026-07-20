/**
 * <EndorsementEditor> tests — Brief 39 PR 39.4.
 *
 * Three layers:
 *   1. Pure helpers — emptyEndorsementDraft, isEndorsementDraftValid
 *      (effect-kind-aware), isTriggerRowComplete, getReferencedFields,
 *      DEFAULT_FORM_SUGGESTIONS shape
 *   2. Render — head reflects form_number + display_name; effect picker
 *      switches visible fields; trigger block toggles between add-CTA
 *      and inline editor; mismatch banner renders when refs unmapped
 *   3. Interactions — effect switch fires patch; trigger add/clear;
 *      suggested form dropdown applies form_number + display_name +
 *      optional effect_kind; save disables on invalid or unmapped
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  EndorsementEditor,
  emptyEndorsementDraft,
  emptyBranchFactorLookupRow,
  isEndorsementDraftValid,
  isTriggerRowComplete,
  getReferencedFields,
  DEFAULT_FORM_SUGGESTIONS,
  ENDORSEMENT_OPS,
  ENDORSEMENT_OP_LABELS,
  type EndorsementDraft,
  type EndorsementFieldRef,
} from "./EndorsementEditor";

const FIELDS: readonly EndorsementFieldRef[] = Object.freeze([
  { id: "tiv", type: "money" },
  { id: "class_code", type: "string" },
  { id: "state", type: "string" },
  { id: "limit", type: "money" },
  { id: "deductible", type: "money" },
]);

function withFactor(): EndorsementDraft {
  return {
    ...emptyEndorsementDraft(),
    endorsement_id: "MS-10-03",
    form_number: "MS 10 03",
    display_name: "Liquor liability",
    effect_kind: "factor",
    factor: 1.15,
    trigger: { variable: "class_code", op: "eq", value: "5821" },
  };
}

function withSublimit(): EndorsementDraft {
  return {
    ...emptyEndorsementDraft(),
    endorsement_id: "MS-10-02",
    form_number: "MS 10 02",
    display_name: "Peak-limit endorsement",
    effect_kind: "sublimit",
    sublimit_coverage: "peak_items",
    sublimit_value: 100000,
    trigger: { variable: "tiv", op: "gt", value: "1000000" },
  };
}

function withAdditive(): EndorsementDraft {
  return {
    ...emptyEndorsementDraft(),
    endorsement_id: "MS-10-06",
    form_number: "MS 10 06",
    display_name: "Water back-up",
    effect_kind: "additive",
    amount: 250,
    trigger: { variable: "", op: "eq", value: "" },
  };
}

// ── Pure helpers ────────────────────────────────────────────────

describe("emptyEndorsementDraft", () => {
  it("defaults to factor effect with empty trigger (always-attach)", () => {
    const d = emptyEndorsementDraft();
    expect(d.effect_kind).toBe("factor");
    expect(d.factor).toBe(1.0);
    expect(d.amount).toBe(0);
    expect(d.sublimit_coverage).toBe("");
    expect(d.sublimit_value).toBe(0);
    expect(d.trigger.variable).toBe("");
    expect(d.trigger.op).toBe("eq");
  });
});

describe("ENDORSEMENT_OPS + labels", () => {
  it("exposes 8 comparison ops with mathematical labels", () => {
    expect(ENDORSEMENT_OPS).toHaveLength(8);
    expect(ENDORSEMENT_OP_LABELS.eq).toBe("=");
    expect(ENDORSEMENT_OP_LABELS.ne).toBe("≠");
    expect(ENDORSEMENT_OP_LABELS.gt).toBe(">");
    expect(ENDORSEMENT_OP_LABELS.in).toBe("∈");
    expect(ENDORSEMENT_OP_LABELS.nin).toBe("∉");
  });
});

describe("isTriggerRowComplete", () => {
  it("is true when both variable + value populated", () => {
    expect(
      isTriggerRowComplete({ variable: "tiv", op: "gt", value: "1000000" }),
    ).toBe(true);
  });
  it("is false when variable empty (always-attach mode)", () => {
    expect(isTriggerRowComplete({ variable: "", op: "eq", value: "" })).toBe(
      false,
    );
  });
  it("is false when variable set but value missing", () => {
    expect(isTriggerRowComplete({ variable: "tiv", op: "gt", value: "" })).toBe(
      false,
    );
  });
});

describe("isEndorsementDraftValid (factor)", () => {
  it("is true for a fully-formed factor endorsement", () => {
    expect(isEndorsementDraftValid(withFactor())).toBe(true);
  });
  it("is false when form_number missing", () => {
    expect(
      isEndorsementDraftValid({ ...withFactor(), form_number: "" }),
    ).toBe(false);
  });
  it("is false when display_name missing", () => {
    expect(
      isEndorsementDraftValid({ ...withFactor(), display_name: "" }),
    ).toBe(false);
  });
  it("is false when factor ≤ 0", () => {
    expect(isEndorsementDraftValid({ ...withFactor(), factor: 0 })).toBe(false);
    expect(isEndorsementDraftValid({ ...withFactor(), factor: -1 })).toBe(
      false,
    );
  });
  it("is false when trigger variable set but value missing", () => {
    expect(
      isEndorsementDraftValid({
        ...withFactor(),
        trigger: { variable: "tiv", op: "gt", value: "" },
      }),
    ).toBe(false);
  });
  it("is true when trigger variable empty (always-attach)", () => {
    expect(
      isEndorsementDraftValid({
        ...withFactor(),
        trigger: { variable: "", op: "eq", value: "" },
      }),
    ).toBe(true);
  });
});

describe("isEndorsementDraftValid (additive)", () => {
  it("is true for a fully-formed additive endorsement", () => {
    expect(isEndorsementDraftValid(withAdditive())).toBe(true);
  });
  it("is false when amount is 0", () => {
    expect(isEndorsementDraftValid({ ...withAdditive(), amount: 0 })).toBe(
      false,
    );
  });
  it("accepts negative additive amounts (credit)", () => {
    expect(isEndorsementDraftValid({ ...withAdditive(), amount: -150 })).toBe(
      true,
    );
  });
});

describe("isEndorsementDraftValid (sublimit)", () => {
  it("is true for a fully-formed sublimit endorsement", () => {
    expect(isEndorsementDraftValid(withSublimit())).toBe(true);
  });
  it("is false when coverage name is empty", () => {
    expect(
      isEndorsementDraftValid({ ...withSublimit(), sublimit_coverage: "" }),
    ).toBe(false);
  });
  it("is false when sublimit value ≤ 0", () => {
    expect(
      isEndorsementDraftValid({ ...withSublimit(), sublimit_value: 0 }),
    ).toBe(false);
    expect(
      isEndorsementDraftValid({ ...withSublimit(), sublimit_value: -100 }),
    ).toBe(false);
  });
});

describe("getReferencedFields", () => {
  it("returns trigger variable when set", () => {
    expect(getReferencedFields(withFactor())).toEqual(["class_code"]);
    expect(getReferencedFields(withSublimit())).toEqual(["tiv"]);
  });
  it("returns empty when trigger variable empty (always-attach)", () => {
    expect(getReferencedFields(withAdditive())).toEqual([]);
  });
});

describe("DEFAULT_FORM_SUGGESTIONS", () => {
  it("ships ≥10 Meridian BOP form suggestions", () => {
    expect(DEFAULT_FORM_SUGGESTIONS.length).toBeGreaterThanOrEqual(10);
  });
  it("each suggestion has form_number + display_name", () => {
    for (const s of DEFAULT_FORM_SUGGESTIONS) {
      expect(s.form_number.length).toBeGreaterThan(0);
      expect(s.display_name.length).toBeGreaterThan(0);
    }
  });
  it("includes the fictional Meridian reference forms", () => {
    const numbers = DEFAULT_FORM_SUGGESTIONS.map((s) => s.form_number);
    expect(numbers).toContain("MS 10 01");
    expect(numbers).toContain("MS 10 02");
    expect(numbers).toContain("MS 10 03");
  });
});

// ── Render layer ────────────────────────────────────────────────

describe("<EndorsementEditor> render", () => {
  it("renders head with form_number + display_name", () => {
    render(
      <EndorsementEditor
        draft={withSublimit()}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/MS 10 02 — Peak-limit endorsement/),
    ).toBeInTheDocument();
    expect(screen.getByText(/endorsement · sublimit/)).toBeInTheDocument();
  });

  it("falls back to 'Untitled endorsement' when both name + form blank", () => {
    render(
      <EndorsementEditor
        draft={emptyEndorsementDraft()}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Untitled endorsement/)).toBeInTheDocument();
  });

  it("renders factor field when effect_kind === factor", () => {
    render(
      <EndorsementEditor
        draft={withFactor()}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("rater-endorsement-editor-factor-value"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-endorsement-editor-amount-value"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-endorsement-editor-sublimit-coverage"),
    ).not.toBeInTheDocument();
  });

  it("renders amount field when effect_kind === additive", () => {
    render(
      <EndorsementEditor
        draft={withAdditive()}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("rater-endorsement-editor-amount-value"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-endorsement-editor-factor-value"),
    ).not.toBeInTheDocument();
  });

  it("renders coverage + value fields when effect_kind === sublimit", () => {
    render(
      <EndorsementEditor
        draft={withSublimit()}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("rater-endorsement-editor-sublimit-coverage"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-endorsement-editor-sublimit-value"),
    ).toBeInTheDocument();
  });

  it("renders trigger Add-CTA when trigger variable empty", () => {
    render(
      <EndorsementEditor
        draft={withAdditive() /* trigger.variable === "" */}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("rater-endorsement-editor-trigger-add"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-endorsement-editor-trigger"),
    ).not.toBeInTheDocument();
  });

  it("renders trigger inline editor when variable set", () => {
    render(
      <EndorsementEditor
        draft={withFactor()}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("rater-endorsement-editor-trigger"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-endorsement-editor-trigger-add"),
    ).not.toBeInTheDocument();
  });
});

// ── Mismatch banner ──────────────────────────────────────────────

describe("<EndorsementEditor> mismatch banner", () => {
  it("renders banner + blocks save when unmappedReferences non-empty", () => {
    const onSave = vi.fn();
    const draft: EndorsementDraft = {
      ...withFactor(),
      trigger: { variable: "distance_to_coast", op: "lt", value: "5" },
    };
    render(
      <EndorsementEditor
        draft={draft}
        availableFields={FIELDS}
        unmappedReferences={["distance_to_coast"]}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );
    const banner = screen.getByTestId("rater-endorsement-editor-mismatch");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("distance_to_coast");

    const save = screen.getByTestId("rater-endorsement-editor-save") as HTMLButtonElement;
    expect(save).toBeDisabled();
    expect(save).toHaveTextContent(/blocked/i);

    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("renders no banner + allows save when refs all mapped", () => {
    const onSave = vi.fn();
    render(
      <EndorsementEditor
        draft={withFactor()}
        availableFields={FIELDS}
        unmappedReferences={[]}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(
      screen.queryByTestId("rater-endorsement-editor-mismatch"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rater-endorsement-editor-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

// ── Interactions ─────────────────────────────────────────────────

describe("<EndorsementEditor> interactions", () => {
  it("fires onChange with new effect_kind when picker clicked", () => {
    const onChange = vi.fn();
    render(
      <EndorsementEditor
        draft={withFactor()}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-endorsement-editor-effect-sublimit"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ effect_kind: "sublimit" }),
    );
  });

  it("fires onChange when form_number input changes", () => {
    const onChange = vi.fn();
    render(
      <EndorsementEditor
        draft={emptyEndorsementDraft()}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    fireEvent.change(
      screen.getByTestId("rater-endorsement-editor-form-number"),
      { target: { value: "MS 99 99" } },
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ form_number: "MS 99 99" }),
    );
  });

  it("trigger Add-CTA populates trigger with first available field", () => {
    const onChange = vi.fn();
    render(
      <EndorsementEditor
        draft={emptyEndorsementDraft()}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-endorsement-editor-trigger-add"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          variable: "tiv",
          op: "eq",
          value: "",
        }),
      }),
    );
  });

  it("trigger Clear button resets trigger to empty (always-attach)", () => {
    const onChange = vi.fn();
    render(
      <EndorsementEditor
        draft={withFactor()}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-endorsement-editor-trigger-clear"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: { variable: "", op: "eq", value: "" },
      }),
    );
  });

  it("trigger field/op/value updates fire onChange with merged trigger", () => {
    const onChange = vi.fn();
    render(
      <EndorsementEditor
        draft={withFactor()}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    fireEvent.change(
      screen.getByTestId("rater-endorsement-editor-trigger-field"),
      { target: { value: "state" } },
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({ variable: "state" }),
      }),
    );
  });

  it("suggested-form picker opens menu + applies all three fields on click", () => {
    const onChange = vi.fn();
    render(
      <EndorsementEditor
        draft={emptyEndorsementDraft()}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    expect(
      screen.queryByTestId("rater-endorsement-editor-suggest-menu"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("rater-endorsement-editor-suggest-toggle"),
    );
    expect(
      screen.getByTestId("rater-endorsement-editor-suggest-menu"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("rater-endorsement-editor-suggest-MS-10-02"),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        form_number: "MS 10 02",
        display_name: "Peak-limit endorsement",
        effect_kind: "sublimit",
      }),
    );
  });

  it("save button disabled when form_number blank (invalid)", () => {
    const onSave = vi.fn();
    render(
      <EndorsementEditor
        draft={{ ...withFactor(), form_number: "" }}
        availableFields={FIELDS}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );
    const save = screen.getByTestId("rater-endorsement-editor-save") as HTMLButtonElement;
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("fires onSave when valid + clicked", () => {
    const onSave = vi.fn();
    render(
      <EndorsementEditor
        draft={withSublimit()}
        availableFields={FIELDS}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-endorsement-editor-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel + onTestAgainstSample when provided", () => {
    const onCancel = vi.fn();
    const onTest = vi.fn();
    render(
      <EndorsementEditor
        draft={withFactor()}
        availableFields={FIELDS}
        onChange={vi.fn()}
        onCancel={onCancel}
        onTestAgainstSample={onTest}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-endorsement-editor-cancel"));
    expect(onCancel).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("rater-endorsement-editor-test"));
    expect(onTest).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
// Phase H.5 — Inline factor-lookup authoring for rate_branch
// (Brief 40 §−1 Q7)
// ─────────────────────────────────────────────────────────────────

function withRateBranch(
  overrides: Partial<EndorsementDraft> = {},
): EndorsementDraft {
  const base = emptyEndorsementDraft();
  return {
    ...base,
    endorsement_id: "CG-2147",
    form_number: "CG 21 47",
    display_name: "Liquor Liability",
    effect_kind: "rate_branch",
    trigger: {
      variable: "has_liquor_sales",
      op: "eq",
      value: "true",
    },
    branch_chain: {
      ...base.branch_chain,
      name: "liquor_premium",
      base_input: "form_input.liquor_receipts",
      exposure_input: "form_input.liquor_receipts",
      exposure_unit_divisor: 1000,
      lcm_input_path: "form_input.lcm",
      output_field: "liquor_premium",
    },
    ...overrides,
  };
}

describe("emptyBranchFactorLookupRow", () => {
  it("returns a fresh empty row with a stable indexed id", () => {
    const r = emptyBranchFactorLookupRow(0);
    expect(r.id).toBe("bfl-0");
    expect(r.name).toBe("");
    expect(r.factor_kind).toBe("");
    expect(r.dim_slug).toBe("");
    expect(r.source_path).toBe("");

    const r2 = emptyBranchFactorLookupRow(3);
    expect(r2.id).toBe("bfl-3");
  });
});

describe("emptyEndorsementDraft (factor_lookups default)", () => {
  it("seeds branch_chain.factor_lookups as an empty array", () => {
    const d = emptyEndorsementDraft();
    expect(d.branch_chain.factor_lookups).toEqual([]);
  });
});

describe("isEndorsementDraftValid (rate_branch + factor_lookups)", () => {
  it("returns true for a complete rate_branch draft with no factor_lookups", () => {
    expect(isEndorsementDraftValid(withRateBranch())).toBe(true);
  });

  it("returns true when a factor_lookup row is fully populated", () => {
    const d: EndorsementDraft = withRateBranch({
      branch_chain: {
        ...withRateBranch().branch_chain,
        factor_lookups: [
          {
            id: "bfl-0",
            name: "territory_factor",
            factor_kind: "liquor_territory_v1",
            dim_slug: "state",
            source_path: "form_input.state",
          },
        ],
      },
    });
    expect(isEndorsementDraftValid(d)).toBe(true);
  });

  it("returns true when a factor_lookup row is entirely empty", () => {
    // An entirely empty row (the freshly-added state) is allowed —
    // it's how the user starts authoring a new row before typing.
    const d: EndorsementDraft = withRateBranch({
      branch_chain: {
        ...withRateBranch().branch_chain,
        factor_lookups: [emptyBranchFactorLookupRow(0)],
      },
    });
    expect(isEndorsementDraftValid(d)).toBe(true);
  });

  it("returns false when a factor_lookup row is half-filled", () => {
    // Only `name` filled, others empty → invalid (prevents accidental
    // persistence of a partial reference).
    const d: EndorsementDraft = withRateBranch({
      branch_chain: {
        ...withRateBranch().branch_chain,
        factor_lookups: [
          {
            id: "bfl-0",
            name: "territory_factor",
            factor_kind: "",
            dim_slug: "",
            source_path: "",
          },
        ],
      },
    });
    expect(isEndorsementDraftValid(d)).toBe(false);
  });

  it("returns false when ANY row is half-filled, even if others are valid", () => {
    const d: EndorsementDraft = withRateBranch({
      branch_chain: {
        ...withRateBranch().branch_chain,
        factor_lookups: [
          {
            id: "bfl-0",
            name: "territory_factor",
            factor_kind: "liquor_territory_v1",
            dim_slug: "state",
            source_path: "form_input.state",
          },
          {
            id: "bfl-1",
            name: "class_factor",
            factor_kind: "",
            dim_slug: "",
            source_path: "",
          },
        ],
      },
    });
    expect(isEndorsementDraftValid(d)).toBe(false);
  });
});

describe("EndorsementEditor (rate_branch + factor_lookups UI)", () => {
  it("renders the branch fields + the empty-state hint when no lookups exist", () => {
    render(
      <EndorsementEditor
        draft={withRateBranch()}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    // Chain identity inputs render
    expect(
      screen.getByTestId("rater-endorsement-editor-branch-name"),
    ).toBeInTheDocument();
    // Empty-state hint surfaces
    expect(
      screen.getByTestId("rater-endorsement-editor-branch-flu-empty"),
    ).toBeInTheDocument();
    // Add affordance is available
    expect(
      screen.getByTestId("rater-endorsement-editor-branch-flu-add"),
    ).toBeInTheDocument();
  });

  it("renders the lookups table + 4 input columns per row when rows exist", () => {
    const d = withRateBranch({
      branch_chain: {
        ...withRateBranch().branch_chain,
        factor_lookups: [
          {
            id: "bfl-0",
            name: "territory_factor",
            factor_kind: "liquor_territory_v1",
            dim_slug: "state",
            source_path: "form_input.state",
          },
        ],
      },
    });
    render(
      <EndorsementEditor
        draft={d}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("rater-endorsement-editor-branch-flu"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-endorsement-editor-branch-flu-0-name"),
    ).toHaveValue("territory_factor");
    expect(
      screen.getByTestId("rater-endorsement-editor-branch-flu-0-kind"),
    ).toHaveValue("liquor_territory_v1");
    expect(
      screen.getByTestId("rater-endorsement-editor-branch-flu-0-dim"),
    ).toHaveValue("state");
    expect(
      screen.getByTestId("rater-endorsement-editor-branch-flu-0-source"),
    ).toHaveValue("form_input.state");
  });

  it("fires onChange with a fresh empty row when 'Add factor lookup' is clicked", () => {
    const onChange = vi.fn();
    render(
      <EndorsementEditor
        draft={withRateBranch()}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-endorsement-editor-branch-flu-add"),
    );
    const patch = onChange.mock.calls[0]![0] as EndorsementDraft;
    expect(patch.branch_chain.factor_lookups).toHaveLength(1);
    expect(patch.branch_chain.factor_lookups[0]!.name).toBe("");
  });

  it("removes the targeted row when the per-row remove button fires", () => {
    const onChange = vi.fn();
    render(
      <EndorsementEditor
        draft={withRateBranch({
          branch_chain: {
            ...withRateBranch().branch_chain,
            factor_lookups: [
              {
                id: "bfl-0",
                name: "territory_factor",
                factor_kind: "liquor_territory_v1",
                dim_slug: "state",
                source_path: "form_input.state",
              },
              {
                id: "bfl-1",
                name: "class_factor",
                factor_kind: "liquor_class_v1",
                dim_slug: "class_code",
                source_path: "form_input.class_code",
              },
            ],
          },
        })}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-endorsement-editor-branch-flu-1-remove"),
    );
    const patch = onChange.mock.calls[0]![0] as EndorsementDraft;
    expect(patch.branch_chain.factor_lookups).toHaveLength(1);
    expect(patch.branch_chain.factor_lookups[0]!.id).toBe("bfl-0");
  });

  it("disables save when a factor_lookup row is half-filled", () => {
    const d = withRateBranch({
      branch_chain: {
        ...withRateBranch().branch_chain,
        factor_lookups: [
          {
            id: "bfl-0",
            name: "territory_factor",
            factor_kind: "",
            dim_slug: "",
            source_path: "",
          },
        ],
      },
    });
    render(
      <EndorsementEditor
        draft={d}
        availableFields={FIELDS}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const save = screen.getByTestId(
      "rater-endorsement-editor-save",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
