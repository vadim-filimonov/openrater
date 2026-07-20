/**
 * useHoverDelay tests — Brief 34 PR 34.5.
 */

import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHoverDelay, DEFAULT_HOVER_DELAY_MS } from "./useHoverDelay";

describe("useHoverDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers onEnter by 100ms by default", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useHoverDelay({ onChange }));

    act(() => result.current.onEnter("a"));
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS - 1);
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("respects custom delay", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useHoverDelay({ onChange, delayMs: 200 }),
    );
    act(() => result.current.onEnter("x"));
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("onLeave cancels pending enter and fires null immediately", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useHoverDelay({ onChange }));
    act(() => result.current.onEnter("a"));
    act(() => result.current.onLeave());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    // Make sure the pending enter doesn't still fire.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("rapid onEnter calls debounce — only the latest key fires", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useHoverDelay({ onChange }));
    act(() => result.current.onEnter("a"));
    act(() => result.current.onEnter("b"));
    act(() => result.current.onEnter("c"));
    act(() => {
      vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("cancel suppresses pending fire without emitting null", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useHoverDelay({ onChange }));
    act(() => result.current.onEnter("a"));
    act(() => result.current.cancel());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("unmount clears the pending timer", () => {
    const onChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useHoverDelay({ onChange }),
    );
    act(() => result.current.onEnter("a"));
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the latest onChange callback (ref refresh)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      (cb: (k: string | null) => void) => useHoverDelay({ onChange: cb }),
      { initialProps: first as (k: string | null) => void },
    );
    act(() => result.current.onEnter("a"));
    rerender(second);
    act(() => {
      vi.advanceTimersByTime(DEFAULT_HOVER_DELAY_MS);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("a");
  });
});
