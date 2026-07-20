/**
 * <UnifiedErrorPanel> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnifiedErrorPanel } from "./UnifiedErrorPanel";
import type { Issue } from "@openrater/contracts";

const MIXED: readonly Issue[] = [
  {
    id: "i1",
    severity: "error",
    source: "compile",
    message: "Missing class declaration.",
    location: { section: "rating-chains", entity: "class_factor" },
    filing_blocking: true,
  },
  {
    id: "i2",
    severity: "warning",
    source: "authoring",
    message: "Output 'total_premium' has no citation.",
    location: { section: "outputs" },
    filing_blocking: false,
  },
  {
    id: "i3",
    severity: "info",
    source: "conformance",
    message: "V7 passes within tolerance.",
    location: { section: "rate-against-sample" },
    filing_blocking: false,
  },
];

describe("<UnifiedErrorPanel>", () => {
  it("renders 'no issues' empty state when issues is empty", () => {
    render(<UnifiedErrorPanel open onClose={() => {}} issues={[]} />);
    expect(screen.getByText("All clear")).toBeInTheDocument();
    expect(screen.getByText(/no issues/i)).toBeInTheDocument();
  });

  it("groups issues by severity in the drawer body", () => {
    render(<UnifiedErrorPanel open onClose={() => {}} issues={MIXED} />);
    // Group headers
    expect(screen.getByText("Errors")).toBeInTheDocument();
    expect(screen.getByText("Warnings")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("renders the right count in the title", () => {
    render(<UnifiedErrorPanel open onClose={() => {}} issues={MIXED} />);
    // Drawer title includes the total ("Issues (3)")
    expect(screen.getByText(/Issues \(3\)/)).toBeInTheDocument();
  });

  it("shows filing-readiness label", () => {
    render(<UnifiedErrorPanel open onClose={() => {}} issues={MIXED} />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("filing-readiness reads 'Filing-ready' when no errors and no warnings", () => {
    const onlyInfo: readonly Issue[] = [
      {
        id: "i1",
        severity: "info",
        source: "conformance",
        message: "tight.",
        location: { section: "rate-against-sample" },
        filing_blocking: false,
      },
    ];
    render(<UnifiedErrorPanel open onClose={() => {}} issues={onlyInfo} />);
    expect(screen.getByText("Filing-ready")).toBeInTheDocument();
  });

  it("filing-readiness reads 'Filing-ready with warnings' when warnings present and no errors", () => {
    const withWarn: readonly Issue[] = [
      {
        id: "i1",
        severity: "warning",
        source: "reference",
        message: "stale ref.",
        location: { section: "curves" },
        filing_blocking: false,
      },
    ];
    render(<UnifiedErrorPanel open onClose={() => {}} issues={withWarn} />);
    expect(
      screen.getByText("Filing-ready with warnings"),
    ).toBeInTheDocument();
  });

  it("fires onDeepLink with the issue's location when row's deep-link icon is clicked", () => {
    const onDeepLink = vi.fn();
    render(
      <UnifiedErrorPanel
        open
        onClose={() => {}}
        issues={MIXED}
        onDeepLink={onDeepLink}
      />,
    );
    const link = screen.getByRole("button", {
      name: /Go to source of "Missing class declaration/i,
    });
    fireEvent.click(link);
    expect(onDeepLink).toHaveBeenCalledWith(MIXED[0]!.location);
  });

  it("does not render when open=false", () => {
    render(<UnifiedErrorPanel open={false} onClose={() => {}} issues={MIXED} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filter reduces visible groups", () => {
    render(<UnifiedErrorPanel open onClose={() => {}} issues={MIXED} />);
    // click the "compile" filter chip → only errors group has compile;
    // warnings + info groups disappear
    const compileChip = screen.getByRole("button", { name: /compile/i });
    fireEvent.click(compileChip);
    expect(screen.getByText("Errors")).toBeInTheDocument();
    expect(screen.queryByText("Warnings")).toBeNull();
    expect(screen.queryByText("Info")).toBeNull();
  });

  it("filter shows clear-filter affordance when nothing matches", () => {
    render(<UnifiedErrorPanel open onClose={() => {}} issues={MIXED} />);
    // Click a source that isn't represented in the issues
    const refChip = screen.getByRole("button", { name: /reference/i });
    fireEvent.click(refChip);
    expect(
      screen.getByText("No issues match the current filter."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear filter"));
    // All groups visible again
    expect(screen.getByText("Errors")).toBeInTheDocument();
  });

  it("ESC closes the drawer", () => {
    const onClose = vi.fn();
    render(<UnifiedErrorPanel open onClose={onClose} issues={MIXED} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
