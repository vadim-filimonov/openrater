import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

function Trigger({ label, message }: { label: string; message: string }) {
  const { notify } = useToast();
  return <button onClick={() => notify(message)}>{label}</button>;
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the viewport even before any notify (for stable aria-live region)", () => {
    render(
      <ToastProvider>
        <span>app</span>
      </ToastProvider>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows the message after notify()", () => {
    render(
      <ToastProvider>
        <Trigger label="show" message="Plan saved" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("show"));
    expect(screen.getByText("Plan saved")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("rater-toast--visible");
  });

  it("auto-dismisses after the default duration", () => {
    render(
      <ToastProvider>
        <Trigger label="show" message="Brief note" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("show"));
    expect(screen.getByText("Brief note")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText("Brief note")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveClass("rater-toast--visible");
  });

  it("replaces an existing toast when notify() is called again", () => {
    render(
      <ToastProvider>
        <Trigger label="first" message="First message" />
        <Trigger label="second" message="Second message" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("first"));
    expect(screen.getByText("First message")).toBeInTheDocument();
    fireEvent.click(screen.getByText("second"));
    expect(screen.queryByText("First message")).not.toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("manually dismisses on close-button click", () => {
    render(
      <ToastProvider>
        <Trigger label="show" message="Hello" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("show"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });

  it("useToast throws outside <ToastProvider>", () => {
    // Suppress React's expected error log
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger label="x" message="y" />)).toThrow(
      /useToast must be called inside <ToastProvider>/,
    );
    spy.mockRestore();
  });
});
