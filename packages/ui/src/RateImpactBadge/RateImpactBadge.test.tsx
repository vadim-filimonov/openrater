/**
 * <RateImpactBadge> tests.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  RateImpactBadge,
  formatSignedDollars,
  formatSignedPct,
} from "./RateImpactBadge";

describe("formatSignedDollars", () => {
  it("formats positive deltas with + and thousands separator", () => {
    expect(formatSignedDollars(235)).toBe("+$235");
    expect(formatSignedDollars(1500)).toBe("+$1,500");
    expect(formatSignedDollars(1_000_000)).toBe("+$1,000,000");
  });

  it("formats negative deltas with U+2212 minus", () => {
    expect(formatSignedDollars(-235)).toBe("−$235");
    expect(formatSignedDollars(-1500)).toBe("−$1,500");
  });

  it("returns '$0' for zero", () => {
    expect(formatSignedDollars(0)).toBe("$0");
  });

  it("formats sub-dollar with 2 decimals", () => {
    expect(formatSignedDollars(0.5)).toBe("+$0.50");
    expect(formatSignedDollars(-0.05)).toBe("−$0.05");
  });
});

describe("formatSignedPct", () => {
  it("formats positive with + and 1 decimal", () => {
    expect(formatSignedPct(4.5)).toBe("+4.5%");
    expect(formatSignedPct(10)).toBe("+10.0%");
  });

  it("formats negative with minus and 1 decimal", () => {
    expect(formatSignedPct(-0.8)).toBe("−0.8%");
  });

  it("returns '0.0%' for zero", () => {
    expect(formatSignedPct(0)).toBe("0.0%");
  });
});

describe("<RateImpactBadge>", () => {
  it("renders increase variant for positive dollars", () => {
    const { container } = render(
      <RateImpactBadge impact={{ dollars: 235, pct: 4.5 }} />,
    );
    expect(container.firstChild).toHaveClass("rater-rate-impact-badge--increase");
  });

  it("renders decrease variant for negative dollars", () => {
    const { container } = render(
      <RateImpactBadge impact={{ dollars: -45, pct: -0.8 }} />,
    );
    expect(container.firstChild).toHaveClass("rater-rate-impact-badge--decrease");
  });

  it("renders zero variant for $0", () => {
    const { container } = render(
      <RateImpactBadge impact={{ dollars: 0, pct: 0 }} />,
    );
    expect(container.firstChild).toHaveClass("rater-rate-impact-badge--zero");
  });

  it("renders dollars + percentage by default", () => {
    render(<RateImpactBadge impact={{ dollars: 235, pct: 4.5 }} />);
    expect(screen.getByText("+$235")).toBeInTheDocument();
    expect(screen.getByText("+4.5%")).toBeInTheDocument();
  });

  it("hides percentage in compact mode", () => {
    render(
      <RateImpactBadge impact={{ dollars: 235, pct: 4.5 }} compact />,
    );
    expect(screen.queryByText("+4.5%")).toBeNull();
  });

  it("hides percentage when pct is 0 (even when not compact)", () => {
    render(<RateImpactBadge impact={{ dollars: 235, pct: 0 }} />);
    expect(screen.queryByText("0.0%")).toBeNull();
  });

  it("aria-label includes the formatted impact", () => {
    const { container } = render(
      <RateImpactBadge impact={{ dollars: -45, pct: -0.8 }} />,
    );
    expect((container.firstChild as HTMLElement).getAttribute("aria-label")).toMatch(
      /−\$45.*−0\.8%/,
    );
  });
});
