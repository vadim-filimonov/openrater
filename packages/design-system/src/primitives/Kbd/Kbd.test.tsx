import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Kbd } from "./Kbd";

describe("Kbd", () => {
  it("renders each key as a keycap", () => {
    render(<Kbd keys={["Cmd", "K"]} />);
    expect(screen.getByText("Cmd")).toHaveClass("rater-kbd__key");
    expect(screen.getByText("K")).toHaveClass("rater-kbd__key");
  });

  it("uses a semantic <kbd> wrapper", () => {
    const { container } = render(<Kbd keys={["Esc"]} />);
    expect(container.querySelector("kbd")).toBeInTheDocument();
  });

  it("renders a single key", () => {
    render(<Kbd keys={["Enter"]} />);
    expect(screen.getByText("Enter")).toBeInTheDocument();
  });

  it("renders empty when keys=[]", () => {
    const { container } = render(<Kbd keys={[]} />);
    expect(container.querySelector(".rater-kbd")).toBeInTheDocument();
    expect(container.querySelectorAll(".rater-kbd__key")).toHaveLength(0);
  });
});
