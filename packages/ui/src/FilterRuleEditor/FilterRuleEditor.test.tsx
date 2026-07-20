/**
 * <FilterRuleEditor> tests — Brief 39 PR 39.2 + Brief 55 (4-tier lift).
 *
 * Three layers:
 *   1. Pure helpers — emptyFilterRuleDraft, isFilterRuleDraftValid,
 *      getReferencedFields
 *   2. Render — quick/advanced modes, conditions render with field
 *      picker + op + value, the native 4-tier picker
 *   3. Interactions — onChange fires the tier on pill click, save
 *      disables when invalid or has unmapped references
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FilterRuleEditor,
  emptyFilterRuleDraft,
  isFilterRuleDraftValid,
  saveDisabledReason,
  isConditionRowValid,
  getReferencedFields,
  FILTER_OPS,
  type FilterRuleDraft,
  type FilterFieldRef,
} from "./FilterRuleEditor";

const FIELDS: readonly FilterFieldRef[] = [
  { id: "tiv", type: "money" },
  { id: "class_code", type: "string" },
  { id: "limit", type: "money" },
  { id: "deductible", type: "money" },
];

const VALID_DRAFT: FilterRuleDraft = {
  rule_id: "high_tiv",
  display_name: "High TIV referral",
  mode: "quick",
  conditions: [{ id: "c0", variable: "tiv", op: "gt", value: "10000000" }],
  tier: "submit",
  reasoning: "High TIV needs senior review",
  citation: "UW manual §3.1",
};

// ── Pure helpers ────────────────────────────────────────────────

describe("emptyFilterRuleDraft", () => {
  it("returns a draft with one empty condition, quick mode, submit tier", () => {
    const d = emptyFilterRuleDraft();
    expect(d.mode).toBe("quick");
    expect(d.conditions).toHaveLength(1);
    expect(d.conditions[0]!.variable).toBe("");
    expect(d.tier).toBe("submit");
  });
});

describe("isConditionRowValid", () => {
  it("is true when variable + value are non-empty", () => {
    expect(
      isConditionRowValid({ id: "c0", variable: "tiv", op: "gt", value: "100" }),
    ).toBe(true);
  });
  it("is false when variable is empty", () => {
    expect(
      isConditionRowValid({ id: "c0", variable: "", op: "gt", value: "100" }),
    ).toBe(false);
  });
  it("is false when value is empty", () => {
    expect(
      isConditionRowValid({ id: "c0", variable: "tiv", op: "gt", value: "" }),
    ).toBe(false);
  });
});

describe("isFilterRuleDraftValid", () => {
  it("is true for a fully-formed draft", () => {
    expect(isFilterRuleDraftValid(VALID_DRAFT)).toBe(true);
  });
  it("is false when display_name is empty", () => {
    expect(
      isFilterRuleDraftValid({ ...VALID_DRAFT, display_name: "  " }),
    ).toBe(false);
  });
  it("is false when any condition is incomplete", () => {
    expect(
      isFilterRuleDraftValid({
        ...VALID_DRAFT,
        conditions: [
          { id: "c0", variable: "tiv", op: "gt", value: "100" },
          { id: "c1", variable: "", op: "eq", value: "" },
        ],
      }),
    ).toBe(false);
  });
  it("is valid for every tier (no route requirement — Brief 55)", () => {
    for (const tier of ["preferred", "standard", "submit", "decline"] as const) {
      expect(isFilterRuleDraftValid({ ...VALID_DRAFT, tier })).toBe(true);
    }
  });
});

describe("saveDisabledReason", () => {
  it("returns null when the draft is ready", () => {
    expect(saveDisabledReason(VALID_DRAFT, false)).toBeNull();
  });
  it("flags the missing Display name first (E04)", () => {
    expect(
      saveDisabledReason({ ...VALID_DRAFT, display_name: "  " }, false),
    ).toMatch(/name this filter/i);
  });
  it("flags incomplete conditions once the name is set", () => {
    expect(
      saveDisabledReason(
        {
          ...VALID_DRAFT,
          conditions: [{ id: "c0", variable: "tiv", op: "gt", value: "" }],
        },
        false,
      ),
    ).toMatch(/complete every condition/i);
  });
  it("flags unmapped references last (after name + conditions are valid)", () => {
    expect(saveDisabledReason(VALID_DRAFT, true)).toMatch(
      /unmapped input references/i,
    );
  });
  it("name takes precedence over unmapped references", () => {
    expect(
      saveDisabledReason({ ...VALID_DRAFT, display_name: "" }, true),
    ).toMatch(/name this filter/i);
  });
});

describe("getReferencedFields", () => {
  it("returns unique variable names across conditions", () => {
    const d: FilterRuleDraft = {
      ...VALID_DRAFT,
      conditions: [
        { id: "c0", variable: "tiv", op: "gt", value: "100" },
        { id: "c1", variable: "limit", op: "gt", value: "100" },
        { id: "c2", variable: "tiv", op: "lt", value: "50" }, // duplicate
      ],
    };
    expect(getReferencedFields(d)).toEqual(["tiv", "limit"]);
  });
  it("skips empty variables", () => {
    const d: FilterRuleDraft = {
      ...VALID_DRAFT,
      conditions: [{ id: "c0", variable: "", op: "eq", value: "" }],
    };
    expect(getReferencedFields(d)).toEqual([]);
  });
});

describe("FILTER_OPS", () => {
  it("exposes 8 operators in stable order", () => {
    expect(FILTER_OPS).toEqual([
      "eq",
      "ne",
      "lt",
      "le",
      "gt",
      "ge",
      "in",
      "nin",
    ]);
  });
});

// ── Render ──────────────────────────────────────────────────────

describe("<FilterRuleEditor> — render", () => {
  it("renders the display name + sub-label", () => {
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("High TIV referral")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_content, el) =>
          (el?.className ?? "").toString().includes("head-sub") &&
          /filter ·\s*row\s*·\s*ready/.test(el?.textContent ?? ""),
      ),
    ).toBeInTheDocument();
  });

  it("renders the quick-mode condition row with field + op + value", () => {
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        onChange={() => {}}
      />,
    );
    const fieldSel = screen.getByTestId(
      "rater-filter-rule-editor-condition-0-field",
    ) as HTMLSelectElement;
    expect(fieldSel.value).toBe("tiv");
    const opSel = screen.getByTestId(
      "rater-filter-rule-editor-condition-0-op",
    ) as HTMLSelectElement;
    expect(opSel.value).toBe("gt");
  });

  it("V6 — de-duplicates a field that is both an input and a dimension", () => {
    const dupFields: readonly FilterFieldRef[] = [
      { id: "tiv", type: "money", category: "input" },
      { id: "territory", type: "string", category: "input" },
      { id: "territory", category: "dimension", label: "Territory" },
    ];
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={dupFields}
        onChange={() => {}}
      />,
    );
    const fieldSel = screen.getByTestId(
      "rater-filter-rule-editor-condition-0-field",
    ) as HTMLSelectElement;
    const territoryOpts = [...fieldSel.options].filter(
      (o) => o.value === "territory",
    );
    expect(territoryOpts).toHaveLength(1);
  });

  it("I7 — a dimension option leads with its display name, not an opaque auto-id", () => {
    const fields: readonly FilterFieldRef[] = [
      { id: "tiv", type: "money", category: "input" },
      { id: "dim_6", category: "dimension", label: "Construction class" },
    ];
    render(
      <FilterRuleEditor draft={VALID_DRAFT} availableFields={fields} onChange={() => {}} />,
    );
    const sel = screen.getByTestId(
      "rater-filter-rule-editor-condition-0-field",
    ) as HTMLSelectElement;
    const opt = [...sel.options].find((o) => o.value === "dim_6");
    // Shows "Construction class · dim_6" — the human name first, not "dim_6 · …".
    expect(opt?.textContent?.startsWith("Construction class")).toBe(true);
  });

  it("renders all four tier pills with the active tier checked", () => {
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        onChange={() => {}}
      />,
    );
    for (const t of ["preferred", "standard", "submit", "decline"] as const) {
      expect(
        screen.getByTestId(`rater-filter-rule-editor-tier-${t}`),
      ).toBeInTheDocument();
    }
    expect(
      screen
        .getByTestId("rater-filter-rule-editor-tier-submit")
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("switches to advanced view when mode is advanced", () => {
    render(
      <FilterRuleEditor
        draft={{ ...VALID_DRAFT, mode: "advanced" }}
        availableFields={FIELDS}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("rater-filter-rule-editor-tree"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-filter-rule-editor-condition-0-field"),
    ).toBeNull();
  });

  it("surfaces the hard-mismatch banner when unmappedReferences is non-empty", () => {
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS.filter((f) => f.id !== "tiv")}
        unmappedReferences={["tiv"]}
        onChange={() => {}}
      />,
    );
    const banner = screen.getByTestId("rater-filter-rule-editor-mismatch");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/unmapped input/i);
    expect(banner.textContent).toMatch(/tiv/);
  });
});

// ── Scope (E03 / brief D4 + D5) ─────────────────────────────────

describe("<FilterRuleEditor> — gate scope", () => {
  it("defaults to row scope; switching to policy fires onChange + shows the chip", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterRuleEditor draft={VALID_DRAFT} availableFields={FIELDS} onChange={onChange} />,
    );
    // No policy chip in row scope.
    expect(screen.queryByTestId("rater-filter-rule-editor-policy-chip")).toBeNull();
    fireEvent.click(screen.getByTestId("rater-filter-rule-editor-scope-policy"));
    expect((onChange.mock.calls[0]![0] as FilterRuleDraft).scope).toBe("policy");
    // Re-render in policy scope → the chip appears.
    rerender(
      <FilterRuleEditor
        draft={{ ...VALID_DRAFT, scope: "policy" }}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByTestId("rater-filter-rule-editor-policy-chip").textContent,
    ).toMatch(/roll up/i);
  });

  it("a policy-scope gate's field-picker uses policyFields", () => {
    render(
      <FilterRuleEditor
        draft={{ ...VALID_DRAFT, scope: "policy" }}
        availableFields={FIELDS}
        policyFields={[{ id: "tiv" }, { id: "location_count" }]}
        onChange={() => {}}
      />,
    );
    const field = screen.getByTestId(
      "rater-filter-rule-editor-condition-0-field",
    ) as HTMLSelectElement;
    const opts = [...field.options].map((o) => o.value);
    expect(opts).toContain("tiv");
    expect(opts).toContain("location_count");
    expect(opts).not.toContain("class_code");
  });

  it("D5 — a row-scope rule reading a rolled-up field surfaces the nudge + 'Make policy-scope'", () => {
    const onChange = vi.fn();
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT} // reads `tiv`, scope defaults to row
        availableFields={FIELDS}
        rollupFieldNames={["tiv", "premium"]}
        onChange={onChange}
      />,
    );
    const nudge = screen.getByTestId("rater-filter-rule-editor-policy-nudge");
    expect(nudge.textContent).toMatch(/rolls up to the policy/i);
    fireEvent.click(screen.getByTestId("rater-filter-rule-editor-make-policy"));
    expect((onChange.mock.calls[0]![0] as FilterRuleDraft).scope).toBe("policy");
  });

  it("no nudge when the rule reads neither a rolled-up nor an aggregate-by-convention field", () => {
    render(
      <FilterRuleEditor
        // Reads `class_code` — not a declared roll-up AND not an aggregate
        // by name, so neither the D5 nor the F18 nudge fires.
        draft={{
          ...VALID_DRAFT,
          conditions: [
            { id: "c0", variable: "class_code", op: "eq", value: "5678" },
          ],
        }}
        availableFields={FIELDS}
        rollupFieldNames={["premium"]}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("rater-filter-rule-editor-policy-nudge")).toBeNull();
    expect(
      screen.queryByTestId("rater-filter-rule-editor-aggregate-nudge"),
    ).toBeNull();
  });

  it("F18 — a row-scope rule on an aggregate-by-convention field (tiv / *_limit) nudges to policy scope even with no roll-up declared", () => {
    const onChange = vi.fn();
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT} // reads `tiv`; row scope; NO rollupFieldNames
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    // The D5 nudge can't fire (nothing is declared as a roll-up yet) but the
    // convention lint still catches `tiv` as a policy aggregate.
    expect(screen.queryByTestId("rater-filter-rule-editor-policy-nudge")).toBeNull();
    const nudge = screen.getByTestId("rater-filter-rule-editor-aggregate-nudge");
    expect(nudge.textContent).toMatch(/sums across a policy's locations/i);
    fireEvent.click(
      screen.getByTestId("rater-filter-rule-editor-aggregate-make-policy"),
    );
    expect((onChange.mock.calls[0]![0] as FilterRuleDraft).scope).toBe("policy");
  });
});

// ── Interactions ────────────────────────────────────────────────

describe("<FilterRuleEditor> — interactions", () => {
  it("fires onChange when a condition row's value changes", () => {
    const onChange = vi.fn();
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    const valueInput = screen.getByTestId(
      "rater-filter-rule-editor-condition-0-value",
    );
    fireEvent.change(valueInput, { target: { value: "5000000" } });
    expect(onChange).toHaveBeenCalled();
    const patch = onChange.mock.calls[0]![0] as FilterRuleDraft;
    expect(patch.conditions[0]!.value).toBe("5000000");
  });

  it("fires onChange with the tier when a tier pill is clicked (decline)", () => {
    const onChange = vi.fn();
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-filter-rule-editor-tier-decline"));
    expect(onChange).toHaveBeenCalled();
    const patch = onChange.mock.calls[0]![0] as FilterRuleDraft;
    expect(patch.tier).toBe("decline");
  });

  it("can author the preferred tier — the verdict the 3-way editor could not express", () => {
    const onChange = vi.fn();
    render(
      <FilterRuleEditor
        draft={{ ...VALID_DRAFT, tier: "standard" }}
        availableFields={FIELDS}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByTestId("rater-filter-rule-editor-tier-preferred"),
    );
    const patch = onChange.mock.calls[0]![0] as FilterRuleDraft;
    expect(patch.tier).toBe("preferred");
  });

  it("offers NO add-condition affordance (capped at one; Brief 69 §3.1)", () => {
    // The substrate's EligibilityRule is a single comparison and the
    // engine is first-match-wins — an AND-join cannot persist (and N
    // same-tier rules would mean OR). The 3-condition quick-form used
    // to save as its FIRST condition only, silently broadening decline
    // rules. The affordance returns with compound-predicate substrate.
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("rater-filter-rule-editor-add-condition"),
    ).toBeNull();
  });

  it("hides the add button at the 3-condition cap", () => {
    const draft: FilterRuleDraft = {
      ...VALID_DRAFT,
      conditions: [
        { id: "c0", variable: "tiv", op: "gt", value: "1" },
        { id: "c1", variable: "limit", op: "gt", value: "1" },
        { id: "c2", variable: "deductible", op: "lt", value: "1" },
      ],
    };
    render(
      <FilterRuleEditor
        draft={draft}
        availableFields={FIELDS}
        onChange={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("rater-filter-rule-editor-add-condition"),
    ).toBeNull();
  });

  it("disables save when draft is invalid AND surfaces the reason (E04)", () => {
    render(
      <FilterRuleEditor
        draft={{ ...VALID_DRAFT, display_name: "" }}
        availableFields={FIELDS}
        onSave={() => {}}
        onChange={() => {}}
      />,
    );
    const save = screen.getByTestId(
      "rater-filter-rule-editor-save",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // The reason is shown inline, not just on hover.
    const hint = screen.getByTestId("rater-filter-rule-editor-save-hint");
    expect(hint.textContent).toMatch(/name this filter/i);
    expect(save.getAttribute("title")).toMatch(/name this filter/i);
  });

  it("marks the Display name field as required (E04)", () => {
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        onSave={() => {}}
        onChange={() => {}}
      />,
    );
    const name = screen.getByTestId("rater-filter-rule-editor-name");
    expect(name.getAttribute("aria-required")).toBe("true");
  });

  it("hides the save-hint once the draft is ready (E04)", () => {
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        onSave={() => {}}
        onChange={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("rater-filter-rule-editor-save-hint"),
    ).toBeNull();
  });

  it("disables save when there are unmapped references AND surfaces the reason", () => {
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        unmappedReferences={["distance_to_coast"]}
        onSave={() => {}}
        onChange={() => {}}
      />,
    );
    const save = screen.getByTestId(
      "rater-filter-rule-editor-save",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const hint = screen.getByTestId("rater-filter-rule-editor-save-hint");
    expect(hint.textContent).toMatch(/unmapped input references/i);
  });

  it("fires onSave when save is clicked and draft is valid", () => {
    const onSave = vi.fn();
    render(
      <FilterRuleEditor
        draft={VALID_DRAFT}
        availableFields={FIELDS}
        onSave={onSave}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-filter-rule-editor-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
