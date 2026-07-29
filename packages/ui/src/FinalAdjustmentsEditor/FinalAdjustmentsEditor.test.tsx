/**
 * <FinalAdjustmentsEditor> tests (Brief 62.4 PR3a). Controlled component:
 * each interaction calls onChange with the next adjustments[].
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FinalAdjustmentsEditor } from "./FinalAdjustmentsEditor";
import type { PolicyAdjustment } from "@openrater/contracts";

const TAIL: PolicyAdjustment[] = [
  { kind: "schedule_rating", id: "irpm", display_name: "Schedule rating", cap_pct: 25, source: { from: "column", column: "irpm_total_pct" } },
  { kind: "package_factor", id: "pioneer", display_name: "Pioneer program", factor: 0.9, when: { field: "is_first_term", op: "eq", value: true } },
  { kind: "minimum_premium", id: "min", floor: 500 },
];

describe("FinalAdjustmentsEditor", () => {
  it("renders an empty state when there are no adjustments", () => {
    render(<FinalAdjustmentsEditor adjustments={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/no after-rating adjustments yet/i)).toBeInTheDocument();
  });

  it("renders each row with its kind chip, name, when-note, and effect", () => {
    render(<FinalAdjustmentsEditor adjustments={TAIL} onChange={vi.fn()} />);
    expect(screen.getByText("Schedule rating")).toBeInTheDocument();
    expect(screen.getByText("Pioneer program")).toBeInTheDocument();
    expect(screen.getByText("Minimum premium")).toBeInTheDocument();
    expect(screen.getByText("when is_first_term")).toBeInTheDocument();
    expect(screen.getByText("cap ±25%")).toBeInTheDocument();
    expect(screen.getByText("× 0.9")).toBeInTheDocument();
    expect(screen.getByText("floor $500")).toBeInTheDocument();
  });

  it("appends a new adjustment from the add menu", () => {
    const onChange = vi.fn();
    render(<FinalAdjustmentsEditor adjustments={TAIL} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^endorsement$/i }));
    const next = onChange.mock.calls[0]![0] as PolicyAdjustment[];
    expect(next).toHaveLength(4);
    expect(next[3]!.kind).toBe("endorsement");
  });

  it("removes a row", () => {
    const onChange = vi.fn();
    render(<FinalAdjustmentsEditor adjustments={TAIL} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Remove pioneer"));
    const next = onChange.mock.calls[0]![0] as PolicyAdjustment[];
    expect(next.map((a) => a.id)).toEqual(["irpm", "min"]);
  });

  it("reorders rows with the up/down controls", () => {
    const onChange = vi.fn();
    render(<FinalAdjustmentsEditor adjustments={TAIL} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Move pioneer up")); // swap irpm/pioneer
    expect((onChange.mock.calls[0]![0] as PolicyAdjustment[]).map((a) => a.id)).toEqual([
      "pioneer",
      "irpm",
      "min",
    ]);
  });

  it("warns when the minimum-premium floor is not last", () => {
    const floorFirst: PolicyAdjustment[] = [
      { kind: "minimum_premium", id: "min", floor: 500 },
      { kind: "package_factor", id: "p", display_name: "P", factor: 0.9 },
    ];
    render(<FinalAdjustmentsEditor adjustments={floorFirst} onChange={vi.fn()} />);
    expect(screen.getByText(/floor almost always applies last/i)).toBeInTheDocument();
  });

  it("edits a package factor inline", () => {
    const onChange = vi.fn();
    render(<FinalAdjustmentsEditor adjustments={TAIL} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pioneer program" })); // expand
    fireEvent.change(screen.getByDisplayValue("0.9"), { target: { value: "0.85" } });
    const next = onChange.mock.calls.at(-1)![0] as PolicyAdjustment[];
    const pioneer = next.find((a) => a.id === "pioneer");
    expect(pioneer?.kind === "package_factor" && pioneer.factor).toBe(0.85);
  });

  it("switches the IRPM source from column to literal via the picker", () => {
    const onChange = vi.fn();
    render(<FinalAdjustmentsEditor adjustments={TAIL} onChange={onChange} inputFields={["irpm_total_pct"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule rating" })); // expand
    fireEvent.click(screen.getByRole("button", { name: /Literal/ }));
    const next = onChange.mock.calls.at(-1)![0] as PolicyAdjustment[];
    const sr = next.find((a) => a.id === "irpm");
    expect(sr?.kind === "schedule_rating" && sr.source.from).toBe("literal");
  });

  it("the Connector segment is disabled with none supplied (62.6)", () => {
    render(<FinalAdjustmentsEditor adjustments={TAIL} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule rating" }));
    expect(screen.getByRole("button", { name: /Author a connector in API Lab first/i })).toBeDisabled();
  });

  it("offers NO Model segment — the source is retired (Detachment Brief 1 S1)", () => {
    const onChange = vi.fn();
    const tail: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "irpm", display_name: "Schedule rating", cap_pct: 25, source: { from: "literal", total: 0 } },
    ];
    render(<FinalAdjustmentsEditor adjustments={tail} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule rating" }));
    // Literal / Column / Connector only — a score arrives as a declared
    // input and binds through the Column segment.
    expect(screen.queryByRole("button", { name: /Model Lab model/i })).toBeNull();
    expect(screen.getByRole("button", { name: /declared input/i })).toBeInTheDocument();
  });

  it("enables the Connector segment when connectors are supplied + binds the source (62.6)", () => {
    const onChange = vi.fn();
    const tail: PolicyAdjustment[] = [
      { kind: "schedule_rating", id: "irpm", display_name: "Schedule rating", cap_pct: 25, source: { from: "literal", total: 0 } },
    ];
    render(
      <FinalAdjustmentsEditor
        adjustments={tail}
        onChange={onChange}
        connectors={[{ connectorId: "lossnav_irpm", version: "v2", displayName: "LossNav IRPM" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Schedule rating" }));
    const connSeg = screen.getByRole("button", { name: /A live API Lab connector/i });
    expect(connSeg).not.toBeDisabled();
    fireEvent.click(connSeg);
    const next = onChange.mock.calls.at(-1)![0] as PolicyAdjustment[];
    expect(next[0]!.kind === "schedule_rating" && next[0]!.source).toEqual({
      from: "connector",
      connector_id: "lossnav_irpm",
      version: "v2",
    });
  });

  // ADR-0055 — a non-DRAFT plan's tail is immutable (the API 409s the PUT):
  // the read view keeps every row + effect summary but strips every edit
  // affordance (add / move / delete / expand).
  it("readOnly renders the rows with no edit affordances", () => {
    const onChange = vi.fn();
    render(
      <FinalAdjustmentsEditor adjustments={TAIL} onChange={onChange} readOnly />,
    );
    // The read view still tells the whole story…
    expect(screen.getByText("Schedule rating")).toBeInTheDocument();
    expect(screen.getByText("floor $500")).toBeInTheDocument();
    // …but nothing is clickable: no add menu, no row actions, and the
    // name is a span (no expand).
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("readOnly empty state states the fact without inviting an add", () => {
    render(
      <FinalAdjustmentsEditor adjustments={[]} onChange={vi.fn()} readOnly />,
    );
    expect(
      screen.getByText(/no after-rating adjustments on this version/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
