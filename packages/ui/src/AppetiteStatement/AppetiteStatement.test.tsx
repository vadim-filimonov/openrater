/**
 * <AppetiteStatement> — Brief 81 (finding E8): compound conditions.
 *
 * Pins the clause grammar end-to-end at the component seam:
 *   · a compound rule reads as ONE sentence, clauses joined by "and"
 *   · "+ and" appends a clause; per-clause remove; commit is gated on
 *     every clause being complete
 *   · a compound commit carries conditions[] (first clause mirrored);
 *     a single-clause commit still carries a one-element conditions
 *     list (the sync layer decides the persisted shape)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AppetiteStatement,
  type AppetiteRuleView,
  type AppetiteStatementProps,
} from "./AppetiteStatement";

const CONSTRUCTION_LEVELS = [
  { id: "Fire Resistive", label: "Fire Resistive" },
  { id: "Frame", label: "Frame" },
  { id: "Joisted Masonry", label: "Joisted Masonry" },
];

const ROW_FIELDS = [
  { id: "contractor_receipts", label: "Contractor receipts", dtype: "money", group: "Inputs" as const },
  { id: "liab_exposure_base", label: "Liability exposure base", dtype: "string", group: "Inputs" as const },
  { id: "class_code", label: "Class code", dtype: "class_code", group: "Inputs" as const },
  // FCA S2 — a boolean input gets the yes/no picker, never free text.
  { id: "sprinklered", label: "Sprinklered", dtype: "bool", group: "Inputs" as const },
  // Brief 89.3 follow-up — a dimension-backed field carries its
  // authored levels; the value seat must offer THEM, not free text.
  {
    id: "construction_class",
    label: "Construction class",
    group: "Dimensions" as const,
    levels: CONSTRUCTION_LEVELS,
  },
];

const COMPOUND_RULE: AppetiteRuleView = {
  id: "contractor_receipts_payroll",
  tier: "decline",
  variable: "contractor_receipts",
  op: "gt",
  value: "300000",
  conditions: [
    { variable: "contractor_receipts", op: "gt", value: "300000" },
    { variable: "liab_exposure_base", op: "eq", value: "payroll" },
  ],
  reasoning: "Filed contractor gate.",
  citation: "",
};

function renderStatement(overrides: Partial<AppetiteStatementProps> = {}) {
  const props: AppetiteStatementProps = {
    rowRules: [],
    policyRules: [],
    defaultTier: "standard",
    rowFields: ROW_FIELDS,
    policyFields: [],
    consolidated: true,
    onAddRule: vi.fn(),
    onUpdateRule: vi.fn(),
    onDeleteRule: vi.fn(),
    onReorder: vi.fn(),
    onDefaultTierChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<AppetiteStatement {...props} />) };
}

describe("<AppetiteStatement> — compound sentence (Brief 81 D-D)", () => {
  it("reads a compound rule as one sentence with 'and'-joined clauses", () => {
    renderStatement({ rowRules: [COMPOUND_RULE] });
    const sheet = screen.getByLabelText("Location rules");
    expect(sheet).toHaveTextContent(
      /Contractor receipts is more than 300,000 and Liability exposure base is exactly payroll/,
    );
  });
});

describe("<AppetiteStatement> — the clause composer (Brief 81 D-D)", () => {
  function openComposer() {
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  }
  function commitClause(i: number, field: string, op: string, value: string) {
    // Field picker.
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-slot-field_${i}`),
    );
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-opt-field_${i}-${field}`),
    );
    // Operator picker.
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-slot-op_${i}`),
    );
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-opt-op_${i}-${op}`),
    );
    // Value input (commit on Enter).
    const input = screen.getByTestId(
      `rater-appetite-composer-slots-slot-value_${i}`,
    );
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  }

  it("'+ and' appends a clause and the commit carries conditions[]", () => {
    const onAddRule = vi.fn();
    renderStatement({ onAddRule });
    openComposer();

    commitClause(0, "contractor_receipts", "gt", "300000");
    fireEvent.click(screen.getByTestId("rater-appetite-add-clause"));
    commitClause(1, "liab_exposure_base", "eq", "payroll");

    fireEvent.click(screen.getByTestId("rater-appetite-composer-commit"));
    expect(onAddRule).toHaveBeenCalledWith(
      "row",
      expect.objectContaining({
        tier: "decline",
        variable: "contractor_receipts",
        op: "gt",
        value: "300000",
        conditions: [
          { variable: "contractor_receipts", op: "gt", value: "300000" },
          { variable: "liab_exposure_base", op: "eq", value: "payroll" },
        ],
      }),
    );
  });

  it("commit stays disabled while ANY clause is incomplete", () => {
    renderStatement();
    openComposer();
    commitClause(0, "contractor_receipts", "gt", "300000");
    fireEvent.click(screen.getByTestId("rater-appetite-add-clause"));
    // Second clause empty → the doctrine: nothing half-authored saves.
    expect(screen.getByTestId("rater-appetite-composer-commit")).toBeDisabled();
  });

  it("a clause beyond the first removes individually", () => {
    const onAddRule = vi.fn();
    renderStatement({ onAddRule });
    openComposer();
    commitClause(0, "contractor_receipts", "gt", "300000");
    fireEvent.click(screen.getByTestId("rater-appetite-add-clause"));
    fireEvent.click(screen.getByTestId("rater-appetite-remove-clause-1"));

    fireEvent.click(screen.getByTestId("rater-appetite-composer-commit"));
    const payload = onAddRule.mock.calls[0]![1] as AppetiteRuleView;
    expect(payload.conditions).toHaveLength(1);
  });

  it("editing a compound rule opens ALL its clauses", () => {
    renderStatement({ rowRules: [COMPOUND_RULE] });
    // Row click opens the composer on that rule (the <b> field label
    // is the stable click target — the sentence text spans elements).
    fireEvent.click(screen.getByText("Contractor receipts"));
    expect(
      screen.getByTestId("rater-appetite-composer-slots-slot-field_1"),
    ).toHaveTextContent("Liability exposure base");
    expect(
      screen.getByTestId("rater-appetite-remove-clause-1"),
    ).toBeInTheDocument();
  });
});

// Brief 89.3 follow-up — the level-picker value seat. During the 89.3
// live walk, typing `fr` against a Construction-class dim whose level
// ids are verbatim labels ("Fire Resistive") authored a decline rule
// that never fired, with zero feedback. The seat now offers the
// authored levels; an off-vocabulary value draws the warning.
describe("<AppetiteStatement> — dimension level picker (Brief 89.3 follow-up)", () => {
  function openComposer() {
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  }
  function pickField(i: number, field: string) {
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-slot-field_${i}`),
    );
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-opt-field_${i}-${field}`),
    );
  }
  function pickLevel(i: number, levelId: string) {
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-slot-value_${i}`),
    );
    fireEvent.click(
      screen.getByTestId(
        `rater-appetite-composer-slots-opt-value_${i}-${levelId}`,
      ),
    );
  }

  it("a dim-backed field turns the value seat into a level picker; the pick commits the level id", () => {
    const onAddRule = vi.fn();
    renderStatement({ onAddRule });
    openComposer();
    pickField(0, "construction_class");
    // The seat is a picker button now, not a free-text input.
    const seat = screen.getByTestId(
      "rater-appetite-composer-slots-slot-value_0",
    );
    expect(seat.tagName).toBe("BUTTON");
    pickLevel(0, "Fire Resistive");
    fireEvent.click(screen.getByTestId("rater-appetite-composer-commit"));
    expect(onAddRule).toHaveBeenCalledWith(
      "row",
      expect.objectContaining({
        conditions: [
          {
            variable: "construction_class",
            op: "eq",
            value: "Fire Resistive",
          },
        ],
      }),
    );
  });

  it("a non-dim field keeps the free-text value input", () => {
    renderStatement();
    openComposer();
    pickField(0, "contractor_receipts");
    expect(
      screen.getByTestId("rater-appetite-composer-slots-slot-value_0").tagName,
    ).toBe("INPUT");
  });

  it("'is one of' picks TOGGLE membership in the comma list", () => {
    const onAddRule = vi.fn();
    renderStatement({ onAddRule });
    openComposer();
    pickField(0, "construction_class");
    fireEvent.click(
      screen.getByTestId("rater-appetite-composer-slots-slot-op_0"),
    );
    fireEvent.click(
      screen.getByTestId("rater-appetite-composer-slots-opt-op_0-in"),
    );
    pickLevel(0, "Frame");
    pickLevel(0, "Joisted Masonry");
    expect(
      screen.getByTestId("rater-appetite-composer-slots-slot-value_0"),
    ).toHaveTextContent("Frame, Joisted Masonry");
    // Re-picking an included level removes it.
    pickLevel(0, "Frame");
    expect(
      screen.getByTestId("rater-appetite-composer-slots-slot-value_0"),
    ).toHaveTextContent(/^Joisted Masonry$/);
    fireEvent.click(screen.getByTestId("rater-appetite-composer-commit"));
    expect(onAddRule).toHaveBeenCalledWith(
      "row",
      expect.objectContaining({ value: "Joisted Masonry", op: "in" }),
    );
  });

  it("an off-vocabulary value (a legacy rule opened for edit) draws the never-matches warning; a real pick clears it", () => {
    const deadRule: AppetiteRuleView = {
      id: "dead",
      tier: "decline",
      variable: "construction_class",
      op: "eq",
      value: "fr",
      conditions: [{ variable: "construction_class", op: "eq", value: "fr" }],
      reasoning: "",
      citation: "",
    };
    renderStatement({ rowRules: [deadRule] });
    fireEvent.click(screen.getByText("Construction class"));
    const warn = screen.getByTestId("rater-appetite-level-warn");
    expect(warn).toHaveTextContent("“fr” isn't an authored level");
    expect(warn).toHaveTextContent("Construction class");
    expect(warn).toHaveTextContent("would never match");
    pickLevel(0, "Frame");
    expect(
      screen.queryByTestId("rater-appetite-level-warn"),
    ).not.toBeInTheDocument();
  });

  it("the escape row commits typed text verbatim AND the warning names it", () => {
    renderStatement();
    openComposer();
    pickField(0, "construction_class");
    fireEvent.click(
      screen.getByTestId("rater-appetite-composer-slots-slot-value_0"),
    );
    // NB: "stucco" substring-matches no level; a prefixy typo like
    // "fr" now surfaces the real "Frame" / "Fire Resistive" rows
    // instead of the escape hatch — the trap dies by being seen.
    fireEvent.change(screen.getByLabelText("choose a value…"), {
      target: { value: "stucco" },
    });
    fireEvent.click(
      screen.getByTestId("rater-appetite-composer-slots-freetext-value_0"),
    );
    expect(
      screen.getByTestId("rater-appetite-composer-slots-slot-value_0"),
    ).toHaveTextContent("stucco");
    expect(
      screen.getByTestId("rater-appetite-level-warn"),
    ).toHaveTextContent("“stucco”");
  });
});

// FCA S2 — "the affordance that invites the type mismatch": a boolean
// variable rendered a free-text value box, and a typed 'banana'
// authored a rule the runtime comparator could never match (the
// audit's stress probe silently disarmed the knock-out). The value
// seat is now a strict yes/no picker.
describe("<AppetiteStatement> — boolean yes/no picker (FCA S2)", () => {
  function openComposer() {
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  }
  function pickField(i: number, field: string) {
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-slot-field_${i}`),
    );
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-opt-field_${i}-${field}`),
    );
  }
  function pickValue(i: number, literal: string) {
    fireEvent.click(
      screen.getByTestId(`rater-appetite-composer-slots-slot-value_${i}`),
    );
    fireEvent.click(
      screen.getByTestId(
        `rater-appetite-composer-slots-opt-value_${i}-${literal}`,
      ),
    );
  }

  it("a bool field turns the value seat into a Yes/No picker; the pick commits 'true'", () => {
    const onAddRule = vi.fn();
    renderStatement({ onAddRule });
    openComposer();
    pickField(0, "sprinklered");
    const seat = screen.getByTestId(
      "rater-appetite-composer-slots-slot-value_0",
    );
    expect(seat.tagName).toBe("BUTTON"); // a picker, not free text
    pickValue(0, "true");
    expect(seat).toHaveTextContent("Yes"); // the seat echoes the label
    fireEvent.click(screen.getByTestId("rater-appetite-composer-commit"));
    expect(onAddRule).toHaveBeenCalledWith(
      "row",
      expect.objectContaining({
        conditions: [{ variable: "sprinklered", op: "eq", value: "true" }],
      }),
    );
  });

  it("free text has no escape row — an off-vocabulary entry cannot commit", () => {
    renderStatement();
    openComposer();
    pickField(0, "sprinklered");
    fireEvent.click(
      screen.getByTestId("rater-appetite-composer-slots-slot-value_0"),
    );
    fireEvent.change(screen.getByLabelText("choose a value…"), {
      target: { value: "banana" },
    });
    expect(
      screen.queryByTestId("rater-appetite-composer-slots-freetext-value_0"),
    ).not.toBeInTheDocument();
  });

  it("the op seat offers only is / is not", () => {
    renderStatement();
    openComposer();
    pickField(0, "sprinklered");
    fireEvent.click(
      screen.getByTestId("rater-appetite-composer-slots-slot-op_0"),
    );
    expect(
      screen.getByTestId("rater-appetite-composer-slots-opt-op_0-eq"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("rater-appetite-composer-slots-opt-op_0-ne"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-appetite-composer-slots-opt-op_0-in"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("rater-appetite-composer-slots-opt-op_0-ge"),
    ).not.toBeInTheDocument();
  });

  it("a stored boolean rule reads as Yes/No in the sentence", () => {
    renderStatement({
      rowRules: [
        {
          id: "no_sprinkler",
          tier: "decline",
          variable: "sprinklered",
          op: "eq",
          value: "false",
          conditions: [{ variable: "sprinklered", op: "eq", value: "false" }],
          reasoning: "",
          citation: "",
        },
      ],
    });
    expect(screen.getByLabelText("Location rules")).toHaveTextContent(
      /Sprinklered is No/,
    );
  });

  it("a legacy off-vocabulary value draws the never-matches warning; a real pick clears it", () => {
    const deadRule: AppetiteRuleView = {
      id: "dead",
      tier: "decline",
      variable: "sprinklered",
      op: "eq",
      value: "banana",
      conditions: [{ variable: "sprinklered", op: "eq", value: "banana" }],
      reasoning: "",
      citation: "",
    };
    renderStatement({ rowRules: [deadRule] });
    fireEvent.click(screen.getByText("Sprinklered"));
    const warn = screen.getByTestId("rater-appetite-level-warn");
    expect(warn).toHaveTextContent("“banana” isn't a yes/no answer");
    expect(warn).toHaveTextContent("Sprinklered");
    expect(warn).toHaveTextContent("would never match");
    pickValue(0, "false");
    expect(
      screen.queryByTestId("rater-appetite-level-warn"),
    ).not.toBeInTheDocument();
  });
});
