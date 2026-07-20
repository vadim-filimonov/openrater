import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Num } from "./Num";

describe("Num", () => {
  it("formats default with thousand separators", () => {
    render(<Num value={1234567.89} locale="en-US" />);
    expect(screen.getByText("1,234,567.89")).toBeInTheDocument();
  });

  it("formats currency (USD, 2 decimals)", () => {
    render(<Num value={250000} format="currency" locale="en-US" />);
    expect(screen.getByText("$250,000.00")).toBeInTheDocument();
  });

  it("formats percent (Intl multiplies by 100)", () => {
    render(<Num value={0.123} format="percent" locale="en-US" />);
    expect(screen.getByText("12.3%")).toBeInTheDocument();
  });

  it("formats integer (no decimals)", () => {
    render(<Num value={1234.999} format="integer" locale="en-US" />);
    expect(screen.getByText("1,235")).toBeInTheDocument();
  });

  it("respects maximumFractionDigits", () => {
    render(<Num value={0.123456} maximumFractionDigits={3} locale="en-US" />);
    expect(screen.getByText("0.123")).toBeInTheDocument();
  });

  it("renders delta-up arrow", () => {
    render(<Num value={100} delta="up" />);
    expect(screen.getByText("▲")).toBeInTheDocument();
  });

  it("renders delta-down arrow", () => {
    render(<Num value={100} delta="down" />);
    expect(screen.getByText("▼")).toBeInTheDocument();
  });

  it("renders delta-flat dash", () => {
    render(<Num value={100} delta="flat" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("applies delta class on the root", () => {
    const { container } = render(<Num value={1} delta="up" />);
    expect(container.querySelector(".rater-num")).toHaveClass(
      "rater-num--delta-up",
    );
  });

  it("supports non-USD currency", () => {
    render(
      <Num value={1000} format="currency" currency="EUR" locale="en-US" />,
    );
    expect(screen.getByText("€1,000.00")).toBeInTheDocument();
  });
});
