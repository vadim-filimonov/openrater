import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Label } from "./Label";

describe("Label", () => {
  it("renders the label text", () => {
    render(<Label>Class code</Label>);
    expect(screen.getByText("Class code")).toBeInTheDocument();
  });

  it("renders as <label>", () => {
    const { container } = render(<Label>X</Label>);
    expect(container.querySelector("label")).toBeInTheDocument();
  });

  it("binds via htmlFor", () => {
    render(<Label htmlFor="class-code">Class</Label>);
    expect(screen.getByText("Class").closest("label")).toHaveAttribute(
      "for",
      "class-code",
    );
  });

  it("shows required asterisk", () => {
    render(<Label required>Class</Label>);
    expect(screen.getByText("*")).toHaveClass("rater-label__required");
  });

  it("shows optional tag", () => {
    render(<Label optional>Class</Label>);
    expect(screen.getByText("(optional)")).toHaveClass("rater-label__optional");
  });

  it("renders description below the text", () => {
    render(
      <Label description="The ISO 5-digit BOP class code">Class</Label>,
    );
    expect(
      screen.getByText("The ISO 5-digit BOP class code"),
    ).toHaveClass("rater-label__description");
  });
});
