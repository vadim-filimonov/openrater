/**
 * runBatchChunked — book-scale scoring over the reused engine.
 *
 * Same semantics as @openrater/contracts `executePlanBatch` (compile ONCE,
 * then `runPlan` per row) but chunked + streaming: after each chunk it
 * hands the chunk's results to `onChunk` (the worker appends them to the
 * ResultStore + updates job progress) and yields the event loop, so a
 * 2,000-row book never blocks the process and results stream out instead
 * of accumulating in memory. Pure over @openrater/contracts — NO labs-ui, NO
 * I/O; the caller owns persistence + progress.
 *
 * `as_of` is resolved ONCE by the caller (pinned at enqueue, passed via
 * `run`), so a multi-chunk job that spans midnight stays reproducible.
 */

import {
  compilePlan,
  runPlan,
  type KindRegistry,
  type Plan,
  type RunOptions,
  type RunResult,
} from "@openrater/contracts";

export interface ChunkedBatchOptions {
  readonly chunkSize: number;
  readonly registry: KindRegistry;
  readonly run?: RunOptions;
  readonly signal?: AbortSignal;
  /** Called after each chunk with its results + cumulative progress. */
  readonly onChunk: (
    chunk: readonly RunResult[],
    done: number,
    total: number,
  ) => Promise<void> | void;
}

export async function runBatchChunked(
  plan: Plan,
  rows: readonly Record<string, unknown>[],
  options: ChunkedBatchOptions,
): Promise<void> {
  // Compile once against the EXPLICIT registry — never the global, so a
  // fresh worker process can't run against an unpopulated registry.
  const compiled = compilePlan(plan, options.registry);
  const total = rows.length;

  for (let start = 0; start < total; start += options.chunkSize) {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error("batch aborted");
    }
    const end = Math.min(start + options.chunkSize, total);
    const chunk: RunResult[] = [];
    for (let i = start; i < end; i += 1) {
      chunk.push(runPlan(compiled, rows[i]!, options.run));
    }
    await options.onChunk(chunk, end, total);
    // Yield between chunks so the worker process stays responsive
    // (health checks, signals) during a large book.
    if (end < total) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
