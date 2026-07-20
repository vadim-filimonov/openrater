import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Divider } from "./Divider";

describe("Divider", () => {
  it("defaults to horizontal <hr>", () => {
    const { container } = render(<Divider />);
    const el = container.querySelector(".rater-divider");
    expect(el?.tagName).toBe("HR");
    expect(el).toHaveClass("rater-divider--horizontal");
  });

  it("renders vertical as span with separator role", () => {
    render(<Divider orientation="vertical" />);
    const el = screen.getByRole("separator");
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("aria-orientation", "vertical");
    expect(el).toHaveClass("rater-divider--vertical");
  });

  it("applies inset class when inset=true", () => {
    const { container } = render(<Divider inset />);
    expect(container.querySelector(".rater-divider")).toHaveClass(
      "rater-divider--inset",
    );
  });
});
