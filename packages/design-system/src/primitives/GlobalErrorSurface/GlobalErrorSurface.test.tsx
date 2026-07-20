import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalErrorSurface } from "./GlobalErrorSurface";
import { apiErrorBus } from "./apiErrorBus";

describe("GlobalErrorSurface", () => {
  beforeEach(() => {
    apiErrorBus.clear();
  });

  it("renders nothing when there are no errors", () => {
    const { container } = render(<GlobalErrorSurface />);
    expect(container.firstChild).toBeNull();
  });

  // The core "save fails → error shown" regression assertion.
  it("renders an alert card when a save failure is pushed", () => {
    render(<GlobalErrorSurface />);
    act(() => {
      apiErrorBus.push({
        id: "network_error:0",
        title: "Couldn't save your changes",
        message: "Couldn't reach API Lab — your changes weren't saved.",
        detail: "0 network_error — Failed to fetch",
        retry: () => {},
      });
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't save your changes");
    expect(alert).toHaveTextContent("Couldn't reach API Lab");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("invokes retry and dismisses the card on Retry click", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<GlobalErrorSurface />);
    act(() => {
      apiErrorBus.push({
        id: "network_error:0",
        title: "Couldn't save your changes",
        message: "msg",
        retry,
      });
    });
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides Retry when failures coalesce (count > 1) — ambiguous which to retry", () => {
    render(<GlobalErrorSurface />);
    act(() => {
      apiErrorBus.push({ id: "network_error:0", title: "T", message: "m", retry: () => {} });
      apiErrorBus.push({ id: "network_error:0", title: "T", message: "m", retry: () => {} });
    });
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("dismisses on the dismiss button", async () => {
    const user = userEvent.setup();
    render(<GlobalErrorSurface />);
    act(() => {
      apiErrorBus.push({ id: "a", title: "T", message: "m" });
    });
    await user.click(screen.getByRole("button", { name: /dismiss error/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reveals technical detail behind the Details expander", async () => {
    const user = userEvent.setup();
    render(<GlobalErrorSurface />);
    act(() => {
      apiErrorBus.push({
        id: "a",
        title: "T",
        message: "m",
        detail: "500 server_error — boom",
      });
    });
    expect(screen.queryByText(/server_error — boom/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.getByText(/server_error — boom/)).toBeInTheDocument();
  });
});
