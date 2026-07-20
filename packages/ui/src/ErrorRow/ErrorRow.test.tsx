/**
 * <ErrorRow> tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorRow } from "./ErrorRow";
import type { Issue } from "@openrater/contracts";

const COMPILE_ERROR: Issue = {
  id: "iss_001",
  severity: "error",
  source: "compile",
  message: "Chain factor 'class_factor' expects a class exposure.",
  location: { section: "rating-chains", entity: "class_factor", field: "ref" },
  filing_blocking: true,
};

const RUNTIME_WARNING: Issue = {
  id: "iss_002",
  severity: "warning",
  source: "reference",
  message: "Curve 'wc_curve_v1' was renamed to 'wc_curve_v2'.",
  location: { section: "curves" },
  filing_blocking: false,
  citation: "Meridian BOP §3.4",
  fix_hint: {
    label: "Update reference",
    target: { section: "rating-chains", entity: "ref_chain" },
  },
};

describe("<ErrorRow>", () => {
  it("renders severity class + source + message", () => {
    render(<ErrorRow issue={COMPILE_ERROR} />);
    expect(
      screen.getByText("Chain factor 'class_factor' expects a class exposure."),
    ).toBeInTheDocument();
    expect(screen.getByText("compile")).toBeInTheDocument();
  });

  it("applies severity-specific class for visual accent", () => {
    const { container } = render(<ErrorRow issue={COMPILE_ERROR} />);
    expect(container.firstChild).toHaveClass("rater-error-row--error");
  });

  it("renders citation when present", () => {
    render(<ErrorRow issue={RUNTIME_WARNING} />);
    expect(screen.getByText("Meridian BOP §3.4")).toBeInTheDocument();
  });

  it("does NOT render citation when absent", () => {
    render(<ErrorRow issue={COMPILE_ERROR} />);
    expect(screen.queryByText(/ISO/i)).toBeNull();
  });

  it("renders fix-hint CTA when present + handler given", () => {
    const onFixHint = vi.fn();
    render(<ErrorRow issue={RUNTIME_WARNING} onFixHint={onFixHint} />);
    const btn = screen.getByText("Update reference");
    fireEvent.click(btn);
    expect(onFixHint).toHaveBeenCalledWith(RUNTIME_WARNING.fix_hint!.target);
  });

  it("does NOT render fix-hint CTA when handler not provided", () => {
    render(<ErrorRow issue={RUNTIME_WARNING} />);
    expect(screen.queryByText("Update reference")).toBeNull();
  });

  it("renders deep-link icon button when onDeepLink provided", () => {
    const onDeepLink = vi.fn();
    render(<ErrorRow issue={COMPILE_ERROR} onDeepLink={onDeepLink} />);
    // The icon-only button has an explicit aria-label
    const link = screen.getByRole("button", {
      name: /Go to source/i,
    });
    fireEvent.click(link);
    expect(onDeepLink).toHaveBeenCalledWith(COMPILE_ERROR.location);
  });

  it("renders location breadcrumb with section name + entity + field", () => {
    const { container } = render(<ErrorRow issue={COMPILE_ERROR} />);
    // The breadcrumb format includes section name + entity + field
    // (e.g., "Rating Chains · class_factor · ref"). Other elements in
    // the row may also mention class_factor (aria-label for the
    // deep-link). We target the breadcrumb specifically.
    const breadcrumb = container.querySelector(".rater-error-row__location");
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb?.textContent).toMatch(/class_factor/);
    expect(breadcrumb?.textContent).toMatch(/ref/);
  });
});
