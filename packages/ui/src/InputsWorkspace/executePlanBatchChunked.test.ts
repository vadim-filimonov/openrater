/**
 * G-5 — executePlanBatchChunked unit tests.
 */
import { describe, expect, it, vi } from "vitest";
import { registerBuiltinKinds, type Plan } from "@openrater/contracts";
import {
  DEFAULT_CHUNK_SIZE,
  executePlanBatchChunked,
  shouldUseChunkedScoring,
} from "./executePlanBatchChunked";

// One-time registry init for the test file.
registerBuiltinKinds();

/**
 * A trivial plan that echoes a single external input back as an
 * output. The runtime contract: each row gets a RunResult with
 * `outputs.value === record.value`. Enough surface to verify the
 * chunked iterator preserves order + count.
 */
const ECHO_PLAN: Plan = {
  id: "echo.test",
  version: "0.1.0",
  name: "echo",
  nodes: [
    { id: "in", kind: "input", params: { fieldName: "value" } },
    { id: "out", kind: "output", params: { fieldName: "value" } },
  ],
  edges: [
    { from: { node: "in", port: "value" }, to: { node: "out", port: "value" } },
  ],
};

function batch(n: number): readonly Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({ value: i }));
}

describe("executePlanBatchChunked", () => {
  it("resolves with the same row count + order as executePlanBatch", async () => {
    const rows = batch(20);
    const results = await executePlanBatchChunked(ECHO_PLAN, rows);
    expect(results).toHaveLength(20);
    for (let i = 0; i < 20; i += 1) {
      expect(results[i]?.outputs.value).toBe(i);
    }
  });

  it("returns an empty array for an empty batch", async () => {
    const results = await executePlanBatchChunked(ECHO_PLAN, []);
    expect(results).toEqual([]);
  });

  it("fires onProgress once after each chunk", async () => {
    const onProgress = vi.fn();
    await executePlanBatchChunked(ECHO_PLAN, batch(500), {
      chunkSize: 100,
      onProgress,
    });
    // 500 rows / 100 chunk = 5 chunks → 5 progress fires
    expect(onProgress).toHaveBeenCalledTimes(5);
    // Final fire reports completion of all 500 rows
    const last = onProgress.mock.calls[onProgress.mock.calls.length - 1]?.[0];
    expect(last.completed).toBe(500);
    expect(last.total).toBe(500);
  });

  it("progress payload carries elapsedMs and rowsPerSec", async () => {
    const onProgress = vi.fn();
    await executePlanBatchChunked(ECHO_PLAN, batch(100), {
      chunkSize: 50,
      onProgress,
    });
    const payload = onProgress.mock.calls[0]?.[0];
    expect(payload.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(payload.rowsPerSec).toBeGreaterThanOrEqual(0);
  });

  it("fires onProgress once for empty batches (with zero counts)", async () => {
    const onProgress = vi.fn();
    await executePlanBatchChunked(ECHO_PLAN, [], { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0]?.[0]).toEqual({
      completed: 0,
      total: 0,
      elapsedMs: 0,
      rowsPerSec: 0,
    });
  });

  it("uses DEFAULT_CHUNK_SIZE when no chunkSize is supplied", async () => {
    const onProgress = vi.fn();
    await executePlanBatchChunked(ECHO_PLAN, batch(DEFAULT_CHUNK_SIZE * 3), {
      onProgress,
    });
    // 3x the default → 3 chunks.
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("handles a single small chunk without yielding between (no extra delay)", async () => {
    // For batches ≤ chunkSize, the runtime calls onProgress once
    // after the single chunk completes — no yield, no event-loop
    // round-trip.
    const onProgress = vi.fn();
    const before = Date.now();
    await executePlanBatchChunked(ECHO_PLAN, batch(50), {
      chunkSize: 100,
      onProgress,
    });
    const elapsed = Date.now() - before;
    expect(onProgress).toHaveBeenCalledTimes(1);
    // No yield → should resolve in under ~10ms even on a slow box.
    expect(elapsed).toBeLessThan(50);
  });

  it("aborts immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      executePlanBatchChunked(ECHO_PLAN, batch(100), {
        chunkSize: 10,
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
  });

  it("aborts mid-batch via onProgress hook firing controller.abort()", async () => {
    // Trigger the abort from inside the progress callback — this
    // is a deterministic way to test mid-batch cancellation
    // without depending on event-loop timing.
    const controller = new AbortController();
    let progressFires = 0;
    let caught: unknown = null;
    try {
      await executePlanBatchChunked(ECHO_PLAN, batch(1000), {
        chunkSize: 50,
        signal: controller.signal,
        onProgress: () => {
          progressFires += 1;
          if (progressFires === 2) controller.abort();
        },
      });
    } catch (e) {
      caught = e;
    }
    // Should have aborted after the 2nd chunk (100 rows), not run all 20.
    expect(caught).not.toBeNull();
    expect(progressFires).toBeLessThan(20);
    expect(progressFires).toBeGreaterThanOrEqual(2);
  });

  it("propagates compile errors synchronously (before any chunk runs)", async () => {
    const badPlan = {
      ...ECHO_PLAN,
      nodes: [{ id: "bad", kind: "nonexistent.kind", params: {} }],
    } as unknown as Plan;
    await expect(
      executePlanBatchChunked(badPlan, batch(10)),
    ).rejects.toThrow();
  });
});

describe("shouldUseChunkedScoring", () => {
  it("returns false for batches ≤ DEFAULT_CHUNK_SIZE", () => {
    expect(shouldUseChunkedScoring(0)).toBe(false);
    expect(shouldUseChunkedScoring(50)).toBe(false);
    expect(shouldUseChunkedScoring(DEFAULT_CHUNK_SIZE)).toBe(false);
  });

  it("returns true for batches > DEFAULT_CHUNK_SIZE", () => {
    expect(shouldUseChunkedScoring(DEFAULT_CHUNK_SIZE + 1)).toBe(true);
    expect(shouldUseChunkedScoring(2000)).toBe(true);
  });
});
