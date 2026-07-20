/**
 * flushableDebounce tests (v4 G15/G24) — the race rules the plan's
 * replace-all syncs rely on: pending SURVIVES disarm (effect cleanup),
 * flush lands exactly once, the timer path stays the steady state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFlushableDebounce } from "./flushableDebounce";

describe("createFlushableDebounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the debounced write after the delay (steady state)", () => {
    const d = createFlushableDebounce(400);
    const fire = vi.fn();
    d.arm(fire);
    expect(d.isPending()).toBe(true);
    vi.advanceTimersByTime(399);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(d.isPending()).toBe(false);
  });

  it("re-arm resets the timer and coalesces to one fire", () => {
    const d = createFlushableDebounce(400);
    const fire = vi.fn();
    d.arm(fire);
    vi.advanceTimersByTime(300);
    d.arm(fire); // keystroke burst
    vi.advanceTimersByTime(300);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("G15 — flush lands the pending write immediately and the timer never double-fires", async () => {
    const d = createFlushableDebounce(400);
    const fire = vi.fn();
    const writeNow = vi.fn().mockResolvedValue(undefined);
    d.arm(fire);
    await d.flush(writeNow);
    expect(writeNow).toHaveBeenCalledTimes(1);
    expect(d.isPending()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled(); // timer was cleared by the flush
  });

  it("flush is a no-op when nothing is pending", async () => {
    const d = createFlushableDebounce(400);
    const writeNow = vi.fn().mockResolvedValue(undefined);
    await d.flush(writeNow);
    expect(writeNow).not.toHaveBeenCalled();
  });

  it("G24 — pending SURVIVES disarm, so an unmount flush still owes the write", async () => {
    const d = createFlushableDebounce(400);
    const fire = vi.fn();
    const writeNow = vi.fn().mockResolvedValue(undefined);
    d.arm(fire);
    d.disarm(); // effect cleanup on unmount: timer cleared, pending kept
    expect(d.isPending()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled(); // timer really was cleared
    await d.flush(writeNow); // the unmount flush lands it
    expect(writeNow).toHaveBeenCalledTimes(1);
    expect(d.isPending()).toBe(false);
  });

  it("a flush rejection propagates (the freeze aborts) and pending stays cleared", async () => {
    const d = createFlushableDebounce(400);
    d.arm(vi.fn());
    await expect(
      d.flush(() => Promise.reject(new Error("422"))),
    ).rejects.toThrow("422");
    // The write was ATTEMPTED — the error surface owns the retry story
    // (same contract as the steady-state mutation's error pill).
    expect(d.isPending()).toBe(false);
  });

  it("disarm→re-arm (dep-change cleanup cycle) keeps exactly one live timer", () => {
    const d = createFlushableDebounce(400);
    const first = vi.fn();
    const second = vi.fn();
    d.arm(first);
    d.disarm();
    d.arm(second);
    vi.advanceTimersByTime(400);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
