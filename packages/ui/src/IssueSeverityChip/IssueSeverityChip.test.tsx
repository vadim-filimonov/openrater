/**
 * <IssueSeverityChip> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AllClearChip, IssueSeverityChip } from "./IssueSeverityChip";

describe("<IssueSeverityChip>", () => {
  it("renders severity + count + label by default", () => {
    render(<IssueSeverityChip severity="error" count={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("errors")).toBeInTheDocument();
  });

  it("uses plural labels per severity", () => {
    const { rerender } = render(<IssueSeverityChip severity="error" count={1} />);
    expect(screen.getByText("errors")).toBeInTheDocument();
    rerender(<IssueSeverityChip severity="warning" count={1} />);
    expect(screen.getByText("warnings")).toBeInTheDocument();
    rerender(<IssueSeverityChip severity="info" count={1} />);
    expect(screen.getByText("info")).toBeInTheDocument();
  });

  it("hides when count is 0 and hideWhenZero is true", () => {
    const { container } = render(
      <IssueSeverityChip severity="error" count={0} hideWhenZero />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders zero count when hideWhenZero is unset", () => {
    render(<IssueSeverityChip severity="error" count={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders as button when onClick is provided", () => {
    const onClick = vi.fn();
    render(
      <IssueSeverityChip severity="error" count={3} onClick={onClick} />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders as span (not button) without onClick", () => {
    render(<IssueSeverityChip severity="error" count={3} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sets aria-pressed when active + clickable", () => {
    render(
      <IssueSeverityChip severity="error" count={3} onClick={() => {}} active />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("applies severity class for each tone", () => {
    const { rerender, container } = render(
      <IssueSeverityChip severity="error" count={1} />,
    );
    expect(container.firstChild).toHaveClass("rater-issue-severity-chip--error");
    rerender(<IssueSeverityChip severity="warning" count={1} />);
    expect(container.firstChild).toHaveClass(
      "rater-issue-severity-chip--warning",
    );
  });
});

describe("<AllClearChip>", () => {
  it("renders the all-clear text", () => {
    render(<AllClearChip />);
    expect(screen.getByText("All clear")).toBeInTheDocument();
  });

  it("has accessible label", () => {
    render(<AllClearChip />);
    expect(screen.getByLabelText("No issues")).toBeInTheDocument();
  });
});
