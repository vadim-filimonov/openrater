/**
 * <TraceStep> tests.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TraceStep, pickHeadlineOutput, formatValue } from "./TraceStep";
import type { TraceEntry } from "@openrater/contracts";

const SIMPLE_ENTRY: TraceEntry = {
  kindId: "lookup.classification",
  inputs: { class_code: "c101" },
  outputs: { value: 1.32 },
  explanation: "Classified c101 (Meridian Recreation) → 1.32",
  citation: "ISO BP-2024 §3.4",
};

const MULTI_OUTPUT_ENTRY: TraceEntry = {
  kindId: "modifier.schedule",
  inputs: {},
  outputs: {
    factor: 0.98,
    applied_pct: -2,
    cap_hit: false,
    applied_categories: [
      { category_id: "mgmt", name: "Mgmt", value_pct: -5 },
    ],
  },
  explanation: "Property schedule mod: 2 of 3 categories applied → factor 0.98",
};

const ERROR_ENTRY: TraceEntry = {
  kindId: "input.class_exposure",
  inputs: {},
  outputs: {},
  error: {
    message: "Class 99999 not found in the bound class library.",
    at: "execute",
  },
};

describe("pickHeadlineOutput", () => {
  it("prefers 'value' over other keys", () => {
    expect(pickHeadlineOutput({ value: 5, other: 99 })).toEqual({
      key: "value",
      value: 5,
    });
  });

  it("prefers 'result' when 'value' absent", () => {
    expect(pickHeadlineOutput({ result: 7, x: "a" })).toEqual({
      key: "result",
      value: 7,
    });
  });

  it("prefers 'factor', 'tier', 'premium' in order", () => {
    expect(pickHeadlineOutput({ factor: 1.2 })).toEqual({
      key: "factor",
      value: 1.2,
    });
    expect(pickHeadlineOutput({ tier: "preferred" })).toEqual({
      key: "tier",
      value: "preferred",
    });
  });

  it("prefers 'premium_out' over 'attached' for endorsement traces (H.3.3)", () => {
    // endorsement.factor outputs {attached: bool, premium_out: number}.
    // Without the override, the scalar fallback could pick `attached`
    // (boolean) — but the load-bearing signal is the modified premium.
    expect(
      pickHeadlineOutput({ attached: true, premium_out: 1069.2 }),
    ).toEqual({ key: "premium_out", value: 1069.2 });
  });

  it("falls back to first scalar key when no preferred key present", () => {
    expect(pickHeadlineOutput({ tag: "ok", child: { x: 1 } })).toEqual({
      key: "tag",
      value: "ok",
    });
  });

  it("returns null for empty outputs", () => {
    expect(pickHeadlineOutput({})).toBeNull();
  });
});

describe("formatValue", () => {
  it("formats integers with thousands separators", () => {
    expect(formatValue(1000)).toBe("1,000");
    expect(formatValue(1_500_000)).toBe("1,500,000");
  });

  it("formats small floats with 4 decimal places", () => {
    expect(formatValue(0.98)).toBe("0.9800");
    expect(formatValue(1.32)).toBe("1.3200");
  });

  it("formats big floats with thousands separators", () => {
    expect(formatValue(5200.5)).toBe("5,200.5");
  });

  it("formats strings + booleans verbatim", () => {
    expect(formatValue("WI")).toBe("WI");
    expect(formatValue(true)).toBe("true");
    expect(formatValue(false)).toBe("false");
  });

  it("formats null + undefined with sentinel", () => {
    expect(formatValue(null)).toBe("null");
    expect(formatValue(undefined)).toBe("—");
  });

  it("formats short objects as JSON", () => {
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });

  it("truncates long JSON", () => {
    const long = { x: "a".repeat(200) };
    expect(formatValue(long)).toMatch(/…$/);
  });
});

describe("<TraceStep>", () => {
  it("renders node label + kind id + headline value", () => {
    render(<TraceStep nodeId="cls" entry={SIMPLE_ENTRY} />);
    expect(screen.getByText("cls")).toBeInTheDocument();
    expect(screen.getByText("lookup.classification")).toBeInTheDocument();
    expect(screen.getByText("1.3200")).toBeInTheDocument();
  });

  it("uses label override when provided", () => {
    render(
      <TraceStep
        nodeId="cls"
        entry={SIMPLE_ENTRY}
        label="Construction class factor"
      />,
    );
    expect(screen.getByText("Construction class factor")).toBeInTheDocument();
    expect(screen.queryByText("cls")).toBeNull();
  });

  it("renders explanation line", () => {
    render(<TraceStep nodeId="cls" entry={SIMPLE_ENTRY} />);
    expect(
      screen.getByText("Classified c101 (Meridian Recreation) → 1.32"),
    ).toBeInTheDocument();
  });

  it("renders citation when present", () => {
    render(<TraceStep nodeId="cls" entry={SIMPLE_ENTRY} />);
    expect(screen.getByText("ISO BP-2024 §3.4")).toBeInTheDocument();
  });

  it("renders error banner when entry.error set", () => {
    render(<TraceStep nodeId="exp" entry={ERROR_ENTRY} />);
    const errBanner = screen.getByRole("alert");
    expect(errBanner).toBeInTheDocument();
    expect(errBanner.textContent).toMatch(/Class 99999 not found/);
  });

  it("applies error class when error present", () => {
    const { container } = render(<TraceStep nodeId="exp" entry={ERROR_ENTRY} />);
    expect(container.firstChild).toHaveClass("rater-trace-step--errored");
  });

  it("applies highlighted class when highlighted=true", () => {
    const { container } = render(
      <TraceStep nodeId="cls" entry={SIMPLE_ENTRY} highlighted />,
    );
    expect(container.firstChild).toHaveClass("rater-trace-step--highlighted");
  });

  it("does NOT show headline for error entries", () => {
    render(<TraceStep nodeId="exp" entry={ERROR_ENTRY} />);
    // No headline value since outputs is empty + error is present
    const headers = screen.queryAllByText("—");
    expect(headers).toHaveLength(0);
  });

  it("inputs disclosure is collapsed by default", () => {
    render(<TraceStep nodeId="cls" entry={SIMPLE_ENTRY} />);
    expect(screen.getByText(/1 input/)).toBeInTheDocument();
    // Disclosure summary visible; the inputs themselves only in DOM
    // because <details> renders all children but only shows when open
    const details = screen.getByText(/1 input/).closest("details");
    expect(details?.open).toBeFalsy();
  });

  it("inputs disclosure opens on toggle", () => {
    render(<TraceStep nodeId="cls" entry={SIMPLE_ENTRY} />);
    const details = screen.getByText(/1 input/).closest("details") as HTMLDetailsElement;
    fireEvent.click(screen.getByText(/1 input/));
    expect(details.open).toBe(true);
  });

  it("renders the outputs table when multiple outputs exist", () => {
    render(<TraceStep nodeId="mod" entry={MULTI_OUTPUT_ENTRY} />);
    expect(screen.getByText(/0 inputs, 4 outputs/)).toBeInTheDocument();
  });

  it("starts expanded when defaultExpanded=true", () => {
    render(
      <TraceStep nodeId="cls" entry={SIMPLE_ENTRY} defaultExpanded />,
    );
    const details = screen.getByText(/1 input/).closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
  });
});
