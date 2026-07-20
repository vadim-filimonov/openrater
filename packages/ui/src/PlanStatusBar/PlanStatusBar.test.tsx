/**
 * <PlanStatusBar> + formatRelativeTime tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanStatusBar, formatRelativeTime } from "./PlanStatusBar";
import type { Issue } from "@openrater/contracts";

const ISSUES: readonly Issue[] = [
  {
    id: "i1",
    severity: "error",
    source: "compile",
    message: "x.",
    location: { section: "rating-chains" },
    filing_blocking: true,
  },
  {
    id: "i2",
    severity: "error",
    source: "runtime",
    message: "y.",
    location: { section: "risk-inputs" },
    filing_blocking: true,
  },
  {
    id: "i3",
    severity: "warning",
    source: "reference",
    message: "z.",
    location: { section: "curves" },
    filing_blocking: false,
  },
];

describe("<PlanStatusBar>", () => {
  it("renders all-clear when no issues", () => {
    render(<PlanStatusBar issues={[]} />);
    expect(screen.getByText("All clear")).toBeInTheDocument();
  });

  it("renders severity counts when issues exist", () => {
    render(<PlanStatusBar issues={ISSUES} />);
    expect(screen.getByText("2")).toBeInTheDocument(); // 2 errors
    expect(screen.getByText("errors")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // 1 warning
    expect(screen.getByText("warnings")).toBeInTheDocument();
  });

  it("hides zero-count severities", () => {
    // No info in the list — info chip should not render
    render(<PlanStatusBar issues={ISSUES} />);
    expect(screen.queryByText("info")).toBeNull();
  });

  it("fires onOpenIssues when a severity chip is clicked", () => {
    const onOpen = vi.fn();
    render(<PlanStatusBar issues={ISSUES} onOpenIssues={onOpen} />);
    const errorChip = screen.getByRole("button", {
      name: /Filter to.*errors/i,
    });
    fireEvent.click(errorChip);
    expect(onOpen).toHaveBeenCalledWith("error");
  });

  it("fires onOpenIssues() with no arg when all-clear is clicked", () => {
    const onOpen = vi.fn();
    render(<PlanStatusBar issues={[]} onOpenIssues={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Open issues panel" }));
    expect(onOpen).toHaveBeenCalledWith();
  });

  it("does NOT make all-clear a button when no onOpenIssues provided", () => {
    render(<PlanStatusBar issues={[]} />);
    expect(
      screen.queryByRole("button", { name: "Open issues panel" }),
    ).toBeNull();
  });

  it("renders last-saved text when timestamp provided", () => {
    const now = Date.now();
    render(
      <PlanStatusBar issues={[]} lastSavedAt={now - 5 * 60_000} />,
    );
    expect(screen.getByText(/Last saved/)).toBeInTheDocument();
  });

  it("renders meta slot when provided", () => {
    render(
      <PlanStatusBar
        issues={[]}
        metaSlot={<span>Custom meta</span>}
      />,
    );
    expect(screen.getByText("Custom meta")).toBeInTheDocument();
  });

  it("has aria-live=polite for screen-reader-friendly count updates", () => {
    render(<PlanStatusBar issues={[]} />);
    const bar = screen.getByRole("status");
    expect(bar).toHaveAttribute("aria-live", "polite");
  });
});

describe("formatRelativeTime", () => {
  const NOW = 1_700_000_000_000;
  it("returns 'just now' for sub-30s deltas", () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 29_999, NOW)).toBe("just now");
  });

  it("returns 'X min ago' for under-an-hour", () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe("1 min ago");
    expect(formatRelativeTime(NOW - 15 * 60_000, NOW)).toBe("15 min ago");
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe("59 min ago");
  });

  it("returns 'Xh ago' for under-a-day", () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe("1h ago");
    expect(formatRelativeTime(NOW - 23 * 3600_000, NOW)).toBe("23h ago");
  });

  it("returns ISO date for older intervals", () => {
    // 100 days back, normalized to ISO date string
    expect(formatRelativeTime(NOW - 100 * 86400_000, NOW)).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
