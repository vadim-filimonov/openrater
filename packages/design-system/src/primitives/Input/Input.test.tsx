import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./Input";

describe("Input", () => {
  it("renders an input element of type text by default", () => {
    render(<Input placeholder="Class code" />);
    const el = screen.getByPlaceholderText("Class code");
    expect(el.tagName).toBe("INPUT");
    expect(el).toHaveAttribute("type", "text");
  });

  it("respects the type prop", () => {
    render(<Input type="email" placeholder="email" />);
    expect(screen.getByPlaceholderText("email")).toHaveAttribute("type", "email");
  });

  it("applies size class", () => {
    const { container } = render(<Input inputSize="sm" />);
    expect(container.querySelector(".rater-input")).toHaveClass("rater-input--sm");
  });

  it("applies error class + aria-invalid", () => {
    render(<Input hasError placeholder="x" />);
    const input = screen.getByPlaceholderText("x");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.parentElement).toHaveClass("rater-input--error");
  });

  it("renders leading + trailing slots", () => {
    render(
      <Input
        leading={<span data-testid="lead">$</span>}
        trailing={<span data-testid="trail">.00</span>}
      />,
    );
    expect(screen.getByTestId("lead")).toBeInTheDocument();
    expect(screen.getByTestId("trail")).toBeInTheDocument();
  });

  it("calls onChange when typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input onChange={onChange} placeholder="x" />);
    await user.type(screen.getByPlaceholderText("x"), "hi");
    expect(onChange).toHaveBeenCalled();
  });

  it("forwards refs", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input ref={ref} placeholder="x" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("respects disabled", () => {
    render(<Input disabled placeholder="x" />);
    expect(screen.getByPlaceholderText("x")).toBeDisabled();
  });
});
