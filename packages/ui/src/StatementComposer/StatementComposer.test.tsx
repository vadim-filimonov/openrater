/**
 * <StatementComposer> tests — Brief 70 Phase 1.
 *
 * Pins the mad-libs contract: template words + slots render as a
 * sentence, picker slots search + commit, value slots coerce on
 * Enter/blur, committing advances focus to the next EMPTY slot, and
 * the composer renders ONLY the options it's given (the withholding
 * doctrine lives upstream).
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatementComposer, type ComposerSlot } from "./StatementComposer";

const SLOTS: ComposerSlot[] = [
  {
    id: "tier",
    kind: "tier",
    value: "decline",
    placeholder: "verdict",
    options: [
      { value: "decline", label: "Decline" },
      { value: "refer", label: "Refer" },
    ],
  },
  {
    id: "field",
    kind: "field",
    value: "",
    placeholder: "choose a field…",
    options: [
      { value: "tiv", label: "TIV", hint: "tiv · number" },
      { value: "protection_class", label: "Protection class" },
    ],
  },
  {
    id: "op",
    kind: "operator",
    value: "ge",
    placeholder: "comparison",
    options: [{ value: "ge", label: "is at least" }],
  },
  {
    id: "value",
    kind: "value",
    value: "",
    placeholder: "value",
    dtype: "number",
  },
];

const TEMPLATE = ["$tier", "when", "$field", "$op", "$value"];

function setup() {
  const onSlotCommit = vi.fn();
  render(
    <StatementComposer
      template={TEMPLATE}
      slots={SLOTS}
      onSlotCommit={onSlotCommit}
    />,
  );
  return { onSlotCommit };
}

describe("<StatementComposer> (Brief 70.1)", () => {
  it("renders the sentence: words as prose, committed slots as labels, empty as placeholders", () => {
    setup();
    expect(screen.getByText("when")).toBeInTheDocument();
    expect(screen.getByTestId("rater-composer-slot-tier")).toHaveTextContent(
      "Decline",
    );
    expect(screen.getByTestId("rater-composer-slot-field")).toHaveTextContent(
      "choose a field…",
    );
    expect(screen.getByTestId("rater-composer-slot-op")).toHaveTextContent(
      "is at least",
    );
  });

  it("a picker slot searches and commits an option", () => {
    const { onSlotCommit } = setup();
    fireEvent.click(screen.getByTestId("rater-composer-slot-field"));
    const search = screen.getByLabelText("choose a field…");
    fireEvent.change(search, { target: { value: "tiv" } });
    // "Protection class" filtered out; TIV remains.
    expect(
      screen.queryByTestId("rater-composer-opt-field-protection_class"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rater-composer-opt-field-tiv"));
    expect(onSlotCommit).toHaveBeenCalledWith("field", "tiv");
  });

  it("keyboard: ↓ + Enter commits the highlighted option", () => {
    const { onSlotCommit } = setup();
    fireEvent.click(screen.getByTestId("rater-composer-slot-field"));
    const picker = screen.getByTestId("rater-composer-picker-field");
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(picker, { key: "Enter" });
    expect(onSlotCommit).toHaveBeenCalledWith(
      "field",
      "protection_class",
    );
  });

  it("a value slot commits on Enter", () => {
    const { onSlotCommit } = setup();
    const input = screen.getByTestId("rater-composer-slot-value");
    fireEvent.change(input, { target: { value: "1000000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSlotCommit).toHaveBeenCalledWith("value", "1000000");
  });

  it("renders ONLY the given options — no invented affordances", () => {
    setup();
    fireEvent.click(screen.getByTestId("rater-composer-slot-op"));
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent("is at least");
  });
});

// Brief 89.3 follow-up — a VALUE slot given options (a dimension's
// authored levels) renders as a picker: free text that can never
// match stops being the default, and the only path to a verbatim
// value is the captioned "Use …" escape row.
describe("<StatementComposer> — value slot with options (Brief 89.3)", () => {
  const LEVEL_SLOT: ComposerSlot = {
    id: "value",
    kind: "value",
    value: "",
    placeholder: "choose a value…",
    options: [
      { value: "Fire Resistive", label: "Fire Resistive" },
      { value: "Frame", label: "Frame" },
    ],
    freeTextHint: "matches no authored level",
  };

  function setupLevels(slotOverrides: Partial<ComposerSlot> = {}) {
    const onSlotCommit = vi.fn();
    render(
      <StatementComposer
        template={["$value"]}
        slots={[{ ...LEVEL_SLOT, ...slotOverrides } as ComposerSlot]}
        onSlotCommit={onSlotCommit}
      />,
    );
    return { onSlotCommit };
  }

  it("renders a picker seat (a button, not an input)", () => {
    setupLevels();
    const seat = screen.getByTestId("rater-composer-slot-value");
    expect(seat.tagName).toBe("BUTTON");
    expect(seat).toHaveTextContent("choose a value…");
  });

  it("offers the given levels and commits the picked option's id", () => {
    const { onSlotCommit } = setupLevels();
    fireEvent.click(screen.getByTestId("rater-composer-slot-value"));
    fireEvent.click(
      screen.getByTestId("rater-composer-opt-value-Fire Resistive"),
    );
    expect(onSlotCommit).toHaveBeenCalledWith("value", "Fire Resistive");
  });

  it("the seat echoes the committed option's label", () => {
    setupLevels({ value: "Frame" });
    expect(screen.getByTestId("rater-composer-slot-value")).toHaveTextContent(
      "Frame",
    );
  });

  it("a no-match query offers the captioned 'Use …' escape row; clicking commits the raw text", () => {
    const { onSlotCommit } = setupLevels();
    fireEvent.click(screen.getByTestId("rater-composer-slot-value"));
    fireEvent.change(screen.getByLabelText("choose a value…"), {
      target: { value: "stucco" },
    });
    const escape = screen.getByTestId("rater-composer-freetext-value");
    expect(escape).toHaveTextContent("Use “stucco”");
    expect(escape).toHaveTextContent("matches no authored level");
    fireEvent.click(escape);
    expect(onSlotCommit).toHaveBeenCalledWith("value", "stucco");
  });

  it("Enter in the no-match state commits the typed text", () => {
    const { onSlotCommit } = setupLevels();
    fireEvent.click(screen.getByTestId("rater-composer-slot-value"));
    fireEvent.change(screen.getByLabelText("choose a value…"), {
      target: { value: "stucco" },
    });
    fireEvent.keyDown(screen.getByTestId("rater-composer-picker-value"), {
      key: "Enter",
    });
    expect(onSlotCommit).toHaveBeenCalledWith("value", "stucco");
  });

  it("without freeTextHint the picker stays strict — 'No match.' and Enter commits nothing", () => {
    // exactOptionalPropertyTypes: drop the key rather than pass undefined.
    const { freeTextHint: _hint, ...strictSlot } = LEVEL_SLOT;
    const onSlotCommit = vi.fn();
    render(
      <StatementComposer
        template={["$value"]}
        slots={[strictSlot]}
        onSlotCommit={onSlotCommit}
      />,
    );
    fireEvent.click(screen.getByTestId("rater-composer-slot-value"));
    fireEvent.change(screen.getByLabelText("choose a value…"), {
      target: { value: "stucco" },
    });
    expect(
      screen.queryByTestId("rater-composer-freetext-value"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No match.")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("rater-composer-picker-value"), {
      key: "Enter",
    });
    expect(onSlotCommit).not.toHaveBeenCalled();
  });

  it("a value slot WITHOUT options still renders the inline free-text input", () => {
    const onSlotCommit = vi.fn();
    render(
      <StatementComposer
        template={["$value"]}
        slots={[
          { id: "value", kind: "value", value: "", placeholder: "value" },
        ]}
        onSlotCommit={onSlotCommit}
      />,
    );
    expect(screen.getByTestId("rater-composer-slot-value").tagName).toBe(
      "INPUT",
    );
  });
});
