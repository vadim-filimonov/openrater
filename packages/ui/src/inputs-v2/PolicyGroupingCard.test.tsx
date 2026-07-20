/**
 * <PolicyGroupingCard> — Brief 80 D-A/D-B/D-C (finding E7).
 *
 * The policy-composition contract's one authoring home. Pins:
 *   · the collapsed offer (both copy flavors), NOT gated on a score
 *   · enable / disable
 *   · live column pickers (policy + optional location)
 *   · the derived total: always rolled, no reducer edit, no remove
 *   · extra roll-ups: reducer edit, add, remove
 *   · the missing-policy-id honesty line
 *   · read-only + no-book render rules
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PolicyGroupingCard,
  type PolicyGroupingCardProps,
} from "./PolicyGroupingCard";

const COLUMNS = ["policy_id", "location_id", "tiv", "class_code"];

function renderCard(overrides: Partial<PolicyGroupingCardProps> = {}) {
  const props: PolicyGroupingCardProps = {
    editable: true,
    bookColumns: COLUMNS,
    grouping: undefined,
    rollupFields: [],
    totalField: "total_premium",
    detected: { policy_id_column: "policy_id" },
    onEnable: vi.fn(),
    onDisable: vi.fn(),
    onGroupingChange: vi.fn(),
    onRollupsChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<PolicyGroupingCard {...props} />) };
}

describe("<PolicyGroupingCard> — collapsed offer", () => {
  it("offers grouping with the detected column named", () => {
    const { props } = renderCard();
    expect(screen.getByTestId("rater-polgroup")).toHaveTextContent(
      /Group rows into policies by/,
    );
    expect(screen.getByTestId("rater-polgroup")).toHaveTextContent(
      "policy_id",
    );
    fireEvent.click(screen.getByTestId("rater-polgroup-enable"));
    expect(props.onEnable).toHaveBeenCalledOnce();
  });

  it("still offers (manual-pick copy) when nothing is detected", () => {
    renderCard({ detected: {} });
    expect(screen.getByTestId("rater-polgroup")).toHaveTextContent(
      /Multi-location book\?/,
    );
    expect(screen.getByTestId("rater-polgroup-enable")).toBeInTheDocument();
  });

  it("renders nothing without a book, or read-only while off", () => {
    const a = renderCard({ bookColumns: [] });
    expect(a.container.firstChild).toBeNull();
    a.unmount();
    const b = renderCard({ editable: false });
    expect(b.container.firstChild).toBeNull();
  });
});

describe("<PolicyGroupingCard> — enabled", () => {
  const ACTIVE: Partial<PolicyGroupingCardProps> = {
    grouping: {
      policy_id_column: "policy_id",
      location_id_column: "location_id",
    },
    rollupFields: [
      { fieldName: "total_premium", reducer: "sum" },
      { fieldName: "tiv", reducer: "sum" },
    ],
  };

  it("re-picking the policy column fires onGroupingChange", () => {
    const { props } = renderCard(ACTIVE);
    fireEvent.change(screen.getByTestId("rater-polgroup-policy-col"), {
      target: { value: "class_code" },
    });
    expect(props.onGroupingChange).toHaveBeenCalledWith(
      expect.objectContaining({ policy_id_column: "class_code" }),
    );
  });

  it("clearing the location column drops it from the config (row order)", () => {
    const { props } = renderCard(ACTIVE);
    fireEvent.change(screen.getByTestId("rater-polgroup-location-col"), {
      target: { value: "__none__" },
    });
    expect(props.onGroupingChange).toHaveBeenCalledWith({
      policy_id_column: "policy_id",
    });
  });

  it("the derived total is always rolled — no reducer edit, no remove (D-C)", () => {
    renderCard(ACTIVE);
    expect(screen.getByTestId("rater-polgroup-rollup-total")).toHaveTextContent(
      "total_premium",
    );
    expect(
      screen.queryByLabelText("Reducer for total_premium"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Stop rolling up total_premium"),
    ).not.toBeInTheDocument();
  });

  it("extras edit their reducer + remove; new fields add as sum", () => {
    const { props } = renderCard(ACTIVE);
    fireEvent.change(screen.getByLabelText("Reducer for tiv"), {
      target: { value: "max" },
    });
    expect(props.onRollupsChange).toHaveBeenCalledWith([
      { fieldName: "total_premium", reducer: "sum" },
      { fieldName: "tiv", reducer: "max" },
    ]);

    fireEvent.click(screen.getByLabelText("Stop rolling up tiv"));
    expect(props.onRollupsChange).toHaveBeenCalledWith([
      { fieldName: "total_premium", reducer: "sum" },
    ]);

    fireEvent.click(screen.getByTestId("rater-polgroup-add-rollup-open"));
    fireEvent.change(screen.getByTestId("rater-polgroup-add-rollup"), {
      target: { value: "class_code" },
    });
    expect(props.onRollupsChange).toHaveBeenCalledWith([
      { fieldName: "total_premium", reducer: "sum" },
      { fieldName: "tiv", reducer: "sum" },
      { fieldName: "class_code", reducer: "sum" },
    ]);
  });

  it("the honesty line counts rows with a blank policy id", () => {
    renderCard({ ...ACTIVE, rowsMissingPolicyId: 2 });
    expect(screen.getByTestId("rater-polgroup-missing-ids")).toHaveTextContent(
      /2 book rows have no/,
    );
  });

  it("Stop grouping fires onDisable", () => {
    const { props } = renderCard(ACTIVE);
    fireEvent.click(screen.getByTestId("rater-polgroup-disable"));
    expect(props.onDisable).toHaveBeenCalledOnce();
  });

  it("read-only while ACTIVE still states the facts, without edit affordances", () => {
    renderCard({ ...ACTIVE, editable: false });
    expect(screen.getByTestId("rater-polgroup")).toHaveTextContent(
      /Rows group into policies by/,
    );
    expect(screen.getByTestId("rater-polgroup-policy-col")).toBeDisabled();
    expect(
      screen.queryByTestId("rater-polgroup-disable"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Stop rolling up tiv"),
    ).not.toBeInTheDocument();
  });
});
