import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IconButton } from "./IconButton";

const TestIcon = () => <span data-testid="icon">★</span>;

describe("IconButton", () => {
  it("renders with required aria-label as accessible name", () => {
    render(<IconButton aria-label="Close" icon={<TestIcon />} />);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("renders the icon", () => {
    render(<IconButton aria-label="Star" icon={<TestIcon />} />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("defaults to ghost + md", () => {
    render(<IconButton aria-label="x" icon={<TestIcon />} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("rater-icon-button--ghost");
    expect(btn).toHaveClass("rater-icon-button--md");
  });

  it("applies variant + size classes", () => {
    render(
      <IconButton aria-label="x" icon={<TestIcon />} variant="danger" size="sm" />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("rater-icon-button--danger");
    expect(btn).toHaveClass("rater-icon-button--sm");
  });

  it("supports lg size (40px box for hero / splash actions)", () => {
    render(<IconButton aria-label="x" icon={<TestIcon />} size="lg" />);
    expect(screen.getByRole("button")).toHaveClass("rater-icon-button--lg");
  });

  it("marks busy + disabled when loading; hides icon", () => {
    render(<IconButton aria-label="x" icon={<TestIcon />} loading />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton aria-label="x" icon={<TestIcon />} onClick={onClick} />);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onClick when disabled or loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton aria-label="x" icon={<TestIcon />} onClick={onClick} disabled />,
    );
    await user.click(screen.getByRole("button"));
    rerender(
      <IconButton aria-label="x" icon={<TestIcon />} onClick={onClick} loading />,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults type to 'button'", () => {
    render(<IconButton aria-label="x" icon={<TestIcon />} />);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("forwards refs", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<IconButton aria-label="x" icon={<TestIcon />} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
