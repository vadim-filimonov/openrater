/**
 * <Tooltip> tests.
 *
 * Covers:
 *   - shows on focus immediately (keyboard-first)
 *   - shows on hover after delay
 *   - hides on blur / mouse-leave / Escape
 *   - aria-describedby is wired correctly
 *   - enabled=false renders the child unchanged
 *   - role="tooltip" + portal rendering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

describe("<Tooltip>", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows on focus immediately (no delay)", () => {
    render(
      <Tooltip content="Hello world">
        <button>Anchor</button>
      </Tooltip>,
    );
    const anchor = screen.getByText("Anchor");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(anchor);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Hello world");
  });

  it("shows on pointer-enter after the configured delay", () => {
    render(
      <Tooltip content="Hello" delayMs={300}>
        <button>Anchor</button>
      </Tooltip>,
    );
    const anchor = screen.getByText("Anchor");
    fireEvent.pointerEnter(anchor);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("hides on blur", () => {
    render(
      <Tooltip content="Hello">
        <button>Anchor</button>
      </Tooltip>,
    );
    const anchor = screen.getByText("Anchor");
    fireEvent.focus(anchor);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(anchor);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on pointer-leave", () => {
    render(
      <Tooltip content="Hello" delayMs={0}>
        <button>Anchor</button>
      </Tooltip>,
    );
    const anchor = screen.getByText("Anchor");
    fireEvent.pointerEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(anchor);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on Escape key", () => {
    render(
      <Tooltip content="Hello">
        <button>Anchor</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText("Anchor"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on click (action supersedes the hover hint)", () => {
    render(
      <Tooltip content="Hello">
        <button>Anchor</button>
      </Tooltip>,
    );
    const anchor = screen.getByText("Anchor");
    fireEvent.focus(anchor);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(anchor);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("sets aria-describedby on the anchor when open", () => {
    render(
      <Tooltip content="Hello">
        <button>Anchor</button>
      </Tooltip>,
    );
    const anchor = screen.getByText("Anchor");
    // The anchor wrapper carries the aria-describedby (the inner
    // button stays untouched so consumer props are not overridden).
    const wrapper = anchor.parentElement;
    expect(wrapper).not.toHaveAttribute("aria-describedby");
    fireEvent.focus(anchor);
    expect(wrapper).toHaveAttribute("aria-describedby");
    const id = wrapper?.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(screen.getByRole("tooltip").id).toBe(id);
  });

  it("renders the child unchanged when enabled=false", () => {
    render(
      <Tooltip content="Hello" enabled={false}>
        <button>Anchor</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText("Anchor"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("supports each placement", () => {
    for (const placement of ["top", "right", "bottom", "left"] as const) {
      const { unmount } = render(
        <Tooltip content="Hi" placement={placement}>
          <button>{placement}</button>
        </Tooltip>,
      );
      fireEvent.focus(screen.getByText(placement));
      const tt = screen.getByRole("tooltip");
      expect(tt.className).toContain(`rater-tooltip--${placement}`);
      unmount();
    }
  });

  it("portal-renders to document.body", () => {
    const { container } = render(
      <Tooltip content="Hello">
        <button>Anchor</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText("Anchor"));
    const tooltip = screen.getByRole("tooltip");
    // Tooltip should NOT be inside the container — it's portaled to body
    expect(container.contains(tooltip)).toBe(false);
  });
});
