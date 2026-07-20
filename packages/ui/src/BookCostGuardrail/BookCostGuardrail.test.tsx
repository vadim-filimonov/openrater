/**
 * <BookCostGuardrail> + estimateBookCost tests (Brief 62.6 §5).
 * The cost preview is unmissable; the confirm-above-threshold gate fires no
 * paid call until the user confirms; the rollup shows the actual spend.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BookCostGuardrail } from "./BookCostGuardrail";
import { estimateBookCost, formatUsd } from "./bookCost";
import type { ConnectorCostLine } from "./bookCost";

const LOSSNAV: ConnectorCostLine = {
  connectorId: "lossnav",
  displayName: "LossNav IRPM",
  version: "v2",
  costPerCallUsd: 0.012,
};

describe("estimateBookCost", () => {
  it("prices rows × Σ cost_per_call (worst case)", () => {
    expect(estimateBookCost(2000, [LOSSNAV])).toEqual({ calls: 2000, estCostUsd: 24 });
  });
  it("sums across multiple connectors", () => {
    const est = estimateBookCost(10, [LOSSNAV, { ...LOSSNAV, connectorId: "x", costPerCallUsd: 0.008 }]);
    expect(est.calls).toBe(20);
    expect(est.estCostUsd).toBeCloseTo(0.2, 6);
  });
  it("is 0 for no connectors or no rows (never negative)", () => {
    expect(estimateBookCost(0, [LOSSNAV])).toEqual({ calls: 0, estCostUsd: 0 });
    expect(estimateBookCost(100, [])).toEqual({ calls: 0, estCostUsd: 0 });
  });
});

describe("formatUsd", () => {
  it("uses 4dp under $1 (honest sub-cent per-call), 2dp above", () => {
    expect(formatUsd(0.012)).toBe("$0.0120");
    expect(formatUsd(24)).toBe("$24.00");
  });
});

describe("BookCostGuardrail", () => {
  it("shows the call count + estimate + connector name up front (no hidden cost)", () => {
    const { container } = render(
      <BookCostGuardrail rowCount={2000} connectors={[LOSSNAV]} onRun={vi.fn()} />,
    );
    // "2,000 rows × 1 connector = 2,000 live calls · ~$24.00" — the whole
    // estimate line is legible up front (rows + calls + cost), no hidden cost.
    const est = container.querySelector(".rater-book-cost__est")?.textContent ?? "";
    expect(est).toContain("2,000 rows × 1 connector");
    expect(est).toContain("2,000 live calls");
    expect(est).toContain("~$24.00");
    expect(screen.getByText(/LossNav IRPM · v2/)).toBeInTheDocument();
  });

  it("runs DIRECTLY when the estimate is below the threshold (no confirm)", () => {
    const onRun = vi.fn();
    // 10 rows × $0.012 = $0.12, below the $1 default threshold.
    render(<BookCostGuardrail rowCount={10} connectors={[LOSSNAV]} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /run book/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/paid live calls/i)).toBeNull(); // no confirm step
  });

  it("requires an explicit confirm ABOVE the threshold before firing a paid call", () => {
    const onRun = vi.fn();
    render(<BookCostGuardrail rowCount={2000} connectors={[LOSSNAV]} onRun={onRun} />);
    // First click → confirm prompt, NOT a run.
    fireEvent.click(screen.getByRole("button", { name: /run book/i }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByText(/paid live calls/i)).toBeInTheDocument();
    // Second click (now labelled "Confirm ~$24.00") → the run.
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("can cancel the confirm without running", () => {
    const onRun = vi.fn();
    render(<BookCostGuardrail rowCount={2000} connectors={[LOSSNAV]} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /run book/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /run book/i })).toBeInTheDocument();
  });

  it("shows the actual spend + fallback count in the rollup after the run", () => {
    render(
      <BookCostGuardrail
        rowCount={2000}
        connectors={[LOSSNAV]}
        rollup={{ costUsd: 23.4, fallbackCount: 5, callCount: 1950 }}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByText("$23.40 spent")).toBeInTheDocument();
    expect(screen.getByText(/1,950 calls · 5 fell back/)).toBeInTheDocument();
  });

  it("disables Run while the batch is in flight + shows progress", () => {
    render(
      <BookCostGuardrail
        rowCount={2000}
        connectors={[LOSSNAV]}
        isRunning
        progress={{ done: 800, total: 2000 }}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByText(/Running… 800\/2000/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run book/i })).toBeNull();
  });
});
