/**
 * <CitationLink> tests.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CitationLink } from "./CitationLink";
import type { PlanCitation } from "@openrater/contracts";

describe("<CitationLink>", () => {
  it("renders a bare string citation", () => {
    render(<CitationLink citation="ISO BP §3.4" />);
    expect(screen.getByText("ISO BP §3.4")).toBeInTheDocument();
  });

  it("uses the text override when provided", () => {
    render(<CitationLink citation="ISO BP §3.4" text="Source: ISO" />);
    expect(screen.getByText("Source: ISO")).toBeInTheDocument();
  });

  it("renders a PlanCitation without URL as a muted span", () => {
    const c: PlanCitation = { id: "iso-bp", ref: "ISO BP-2024 §3.4" };
    render(<CitationLink citation={c} />);
    expect(screen.getByText("ISO BP-2024 §3.4")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a PlanCitation WITH URL as an external link", () => {
    const c: PlanCitation = {
      id: "iso-bp",
      ref: "ISO BP-2024 §3.4",
      url: "https://example.com/iso-bp",
    };
    render(<CitationLink citation={c} />);
    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://example.com/iso-bp");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("aria-label flags external links for screen readers", () => {
    const c: PlanCitation = {
      id: "iso-bp",
      ref: "ISO BP-2024 §3.4",
      url: "https://example.com",
    };
    render(<CitationLink citation={c} />);
    expect(screen.getByRole("link").getAttribute("aria-label")).toMatch(
      /opens in new tab/,
    );
  });
});
