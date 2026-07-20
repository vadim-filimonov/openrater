/**
 * G-5 — Chunked batch scoring with progress + yield.
 *
 * `executePlanBatch(plan, inputs)` runs synchronously: it compiles
 * the plan once (cheap, ~5ms) then iterates `inputs.map(row =>
 * runPlan(compiled, row))`. For a 2,000-row IRS-990 dataset the map
 * loop blocks the main thread for several hundred ms — the user
 * sees a frozen UI + spinner that never updates.
 *
 * This module wraps the batch in an async iterator:
 *
 *   1. Compile the plan once (still sync — the cost is in the map)
 *   2. Walk `inputs` in chunks of N (default 200)
 *   3. Inside each chunk, `runPlan(compiled, row)` for every row
 *   4. Between chunks, `await yield_()` — `setTimeout(0)` releases
 *      the event loop so the browser can paint progress + handle
 *      input
 *   5. Optionally fire `onProgress({completed, total, elapsedMs})`
 *      after each chunk so the consumer can update its UI
 *   6. AbortSignal honored — caller can cancel the batch and the
 *      Promise rejects with the abort reason
 *
 * Returns a Promise<readonly RunResult[]> with the same shape +
 * order guarantees as `executePlanBatch`.
 *
 * Pure module: no React, no DOM. The consumer (PlanDetailRoute /
 * ScoringPreviewPane) wires the progress callback to its own
 * state.
 */

import {
  compilePlan,
  runPlan,
  type Plan,
  type RunOptions,
  type RunResult,
  type KindRegistry,
} from "@openrater/contracts";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** Progress payload fired after each chunk completes. */
export interface BatchProgress {
  /** Rows completed so far (0..total). */
  readonly completed: number;
  /** Total row count for the batch. */
  readonly total: number;
  /** Wall-clock ms since the batch started (via performance.now()). */
  readonly elapsedMs: number;
  /** Best-effort rows-per-second estimate based on elapsed time. */
  readonly rowsPerSec: number;
}

export interface ExecutePlanBatchChunkedOptions {
  /**
   * Rows per chunk before yielding. Default 200 — balances "fewer
   * yields = faster total" against "yield often enough that the
   * browser paints smoothly." Trade-offs:
   *   • 50: silky-smooth UI but ~10ms overhead per yield → adds
   *     several hundred ms to a 2k-row batch on a slow box.
   *   • 200: ~12-25 yields for a 2k-row batch, 1-frame jank max
   *     per chunk, total overhead < 50ms.
   *   • 500+: noticeable UI freeze between yields on slow CPUs.
   */
  readonly chunkSize?: number;
  /**
   * Fires after each chunk. The caller's handler is responsible
   * for its own debouncing — every chunk fires once, no
   * coalescing.
   */
  readonly onProgress?: (progress: BatchProgress) => void;
  /**
   * Cancellation. When the signal aborts mid-batch, the Promise
   * rejects with `signal.reason` (an `AbortError` by default).
   * Already-completed rows are discarded.
   */
  readonly signal?: AbortSignal;
  /** Forwarded to compilePlan + runPlan (same shape as RunOptions). */
  readonly run?: RunOptions;
  /** Plan-kinds registry. Defaults to `globalRegistry` per compilePlan. */
  readonly registry?: KindRegistry;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_SIZE = 200;

function yieldToEventLoop(): Promise<void> {
  // setTimeout(0) is the canonical yield. requestIdleCallback would
  // be nicer for low-priority work but it doesn't ship in Safari
  // < 15 and the cold-test target IS interactive (the user clicked
  // Score-all and is waiting). MessageChannel could shave a few ms
  // but the complexity isn't worth it for our row counts.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Score a batch of rows against a plan, chunked + yielding between
 * chunks so the browser stays responsive. Returns a Promise that
 * resolves with the full result array in the same order as
 * `externalInputsArr`.
 *
 * For batches smaller than `chunkSize`, fires onProgress once at
 * the end + skips the yield (no event-loop overhead on tiny
 * batches).
 *
 * For batches larger than `chunkSize`, fires onProgress after each
 * chunk + yields between them. The Promise resolves only after
 * the final chunk completes.
 *
 * Throws (rejects) the same errors `executePlanBatch` does — a
 * malformed plan or unknown block kind surfaces synchronously from
 * the compile step before the first chunk runs.
 */
export async function executePlanBatchChunked(
  plan: Plan,
  externalInputsArr: readonly Record<string, unknown>[],
  options: ExecutePlanBatchChunkedOptions = {},
): Promise<readonly RunResult[]> {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    onProgress,
    signal,
    run,
    registry,
  } = options;

  const total = externalInputsArr.length;
  const startMs = now();

  // Compile once — same as executePlanBatch's eager step. Errors
  // surface here (synchronously). For an empty batch we still
  // compile so callers see compile errors regardless of input size.
  const compiled = compilePlan(plan, registry);

  if (total === 0) {
    onProgress?.({ completed: 0, total: 0, elapsedMs: 0, rowsPerSec: 0 });
    return [];
  }

  const results: RunResult[] = new Array(total);

  // Tight loop per chunk, await yield between.
  for (let start = 0; start < total; start += chunkSize) {
    // Cancellation check — both before each chunk and at end of
    // each chunk's yield window.
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("aborted", "AbortError");
    }

    const end = Math.min(start + chunkSize, total);
    for (let i = start; i < end; i += 1) {
      const record = externalInputsArr[i]!;
      results[i] = runPlan(compiled, record, run);
    }

    const completed = end;
    const elapsedMs = now() - startMs;
    const rowsPerSec = elapsedMs > 0 ? (completed / elapsedMs) * 1000 : 0;
    onProgress?.({ completed, total, elapsedMs, rowsPerSec });

    // Yield only if there's more work — last chunk doesn't need
    // to wait a frame before resolving.
    if (end < total) {
      await yieldToEventLoop();
    }
  }

  return results;
}

/**
 * Heuristic: when does Score-all benefit from chunking?
 *
 * For tiny batches (≤ DEFAULT_CHUNK_SIZE rows) the sync path is
 * fine — the chunked path's setup overhead (Promise + yield
 * dance) is wasted. Callers can use this helper to choose between
 * the sync `executePlanBatch` and the chunked variant.
 */
export function shouldUseChunkedScoring(rowCount: number): boolean {
  return rowCount > DEFAULT_CHUNK_SIZE;
}

// Re-export for callers that want to tune chunk sizes.
export { DEFAULT_CHUNK_SIZE };
