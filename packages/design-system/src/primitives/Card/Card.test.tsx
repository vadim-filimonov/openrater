import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders children inside a div by default", () => {
    render(<Card data-testid="card">contents</Card>);
    const card = screen.getByTestId("card");
    expect(card.tagName).toBe("DIV");
    expect(card).toHaveTextContent("contents");
  });

  it("applies default variant class", () => {
    render(<Card data-testid="card">x</Card>);
    expect(screen.getByTestId("card")).toHaveClass("rater-card--default");
  });

  it("applies padded + lifted variant classes", () => {
    const { rerender } = render(
      <Card variant="padded" data-testid="card">
        p
      </Card>,
    );
    expect(screen.getByTestId("card")).toHaveClass("rater-card--padded");
    rerender(
      <Card variant="lifted" data-testid="card">
        l
      </Card>,
    );
    expect(screen.getByTestId("card")).toHaveClass("rater-card--lifted");
  });

  it("renders as a custom element via `as` prop", () => {
    render(
      <Card as="section" data-testid="card">
        y
      </Card>,
    );
    expect(screen.getByTestId("card").tagName).toBe("SECTION");
  });

  it("forwards arbitrary props", () => {
    render(
      <Card data-testid="root" aria-label="card-x">
        z
      </Card>,
    );
    expect(screen.getByTestId("root")).toHaveAttribute("aria-label", "card-x");
  });
});
