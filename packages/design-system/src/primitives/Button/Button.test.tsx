import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders the label", () => {
    render(<Button>Save plan</Button>);
    expect(screen.getByRole("button", { name: "Save plan" })).toBeInTheDocument();
  });

  it("defaults to ghost variant + md size", () => {
    render(<Button>Default</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("rater-button--ghost");
    expect(btn).toHaveClass("rater-button--md");
  });

  it("applies variant + size classes", () => {
    render(
      <Button variant="primary" size="sm">
        Promote
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("rater-button--primary");
    expect(btn).toHaveClass("rater-button--sm");
  });

  it("supports lg size (44px height for hero / splash CTAs)", () => {
    render(<Button size="lg">Get started</Button>);
    expect(screen.getByRole("button")).toHaveClass("rater-button--lg");
  });

  it("renders all four variants", () => {
    const variants = ["primary", "ghost", "danger", "danger-text"] as const;
    for (const v of variants) {
      const { unmount } = render(<Button variant={v}>{v}</Button>);
      expect(screen.getByRole("button")).toHaveClass(`rater-button--${v}`);
      unmount();
    }
  });

  it("renders leading + trailing icons in their slots", () => {
    render(
      <Button
        icon={<span data-testid="lead">L</span>}
        iconAfter={<span data-testid="trail">T</span>}
      >
        With icons
      </Button>,
    );
    expect(screen.getByTestId("lead")).toBeInTheDocument();
    expect(screen.getByTestId("trail")).toBeInTheDocument();
  });

  it("marks the button busy + disabled when loading=true; suppresses the icon", () => {
    render(
      <Button loading icon={<span data-testid="lead">L</span>}>
        Saving
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
    // Leading icon is hidden behind the spinner while loading
    expect(screen.queryByTestId("lead")).not.toBeInTheDocument();
  });

  it("respects the disabled prop without the loading state", () => {
    render(<Button disabled>Can't click</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Tap me</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Tap me
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does NOT call onClick when loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Saving
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults type to 'button' (avoids accidental form submit)", () => {
    render(<Button>Not a submit</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("forwards arbitrary props to the underlying <button>", () => {
    render(
      <Button data-testid="x" aria-describedby="hint">
        Forwarded
      </Button>,
    );
    const btn = screen.getByTestId("x");
    expect(btn).toHaveAttribute("aria-describedby", "hint");
  });

  it("forwards refs to the underlying <button>", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Reffed</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("applies the full-width class when fullWidth=true", () => {
    render(<Button fullWidth>Wide</Button>);
    expect(screen.getByRole("button")).toHaveClass("rater-button--full-width");
  });
});
