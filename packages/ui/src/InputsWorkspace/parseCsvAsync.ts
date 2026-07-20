/**
 * parseCsvAsync — Brief 45 K11 off-main-thread CSV parsing wrapper.
 *
 * `parseCsvForInputsAsync` is a thin async front for the pure
 * `parseCsvForInputs`. It hands the work to a Web Worker so a large
 * CSV (the cold-test loads 2k rows) parses off the main thread and the
 * UI stays responsive, with a bulletproof synchronous fallback when
 * workers can't run (SSR, jsdom/vitest, older runtimes, or any worker
 * construction/runtime failure).
 *
 * DESIGN — one-shot worker per call:
 *   We spin up a fresh `Worker`, post one message, await one reply,
 *   then `terminate()`. CSV loads are infrequent, user-initiated, and
 *   one-at-a-time (the dropzone disables itself while parsing), so a
 *   persistent pooled worker would add lifecycle complexity (idle
 *   teardown, races between overlapping loads) for no real throughput
 *   win. A one-shot worker is the simplest correct design and leaves
 *   no lingering thread between loads.
 *
 * FALLBACK RATIONALE — never reject:
 *   The promise ALWAYS resolves with a result; it never rejects. The
 *   sync `parseCsvForInputs` already returns a discriminated
 *   `{ ok: true } | { ok: false }`, so error states ride that channel,
 *   not promise rejection — callers handle exactly one shape. We fall
 *   back to the synchronous parse when:
 *     - `Worker` is undefined (SSR / non-browser), OR
 *     - constructing the worker throws, OR
 *     - the worker emits `onerror` (e.g. jsdom doesn't execute module
 *       workers, so the script load fails).
 *   This makes the function safe to call unconditionally from anywhere,
 *   including unit tests under jsdom.
 */

import {
  parseCsvForInputs,
  type ParseCsvForInputsOptions,
} from "./parseCsv";
import type {
  ParseCsvWorkerRequest,
  ParseCsvWorkerResponse,
} from "./parseCsv.worker";

/**
 * Parse a CSV for the Inputs workspace off the main thread.
 *
 * Resolves with the exact same result shape as the synchronous
 * {@link parseCsvForInputs} — `{ ok: true; snapshot }` on success or
 * `{ ok: false; error }` on a parse failure. Never rejects (see the
 * fallback rationale in the module docstring).
 *
 * @param text The raw CSV file contents.
 * @param options Optional parse knobs (forwarded verbatim).
 */
export function parseCsvForInputsAsync(
  text: string,
  options: ParseCsvForInputsOptions = {},
): Promise<ReturnType<typeof parseCsvForInputs>> {
  // No worker runtime (SSR / non-browser): parse synchronously.
  if (typeof Worker === "undefined") {
    return Promise.resolve(parseCsvForInputs(text, options));
  }

  return new Promise<ReturnType<typeof parseCsvForInputs>>((resolve) => {
    let worker: Worker | null = null;
    let settled = false;

    // Resolve once, via the worker or the sync fallback — whichever
    // fires first. Guards against a late onerror after a message (or
    // vice versa) double-settling the promise.
    const settle = (result: ReturnType<typeof parseCsvForInputs>) => {
      if (settled) return;
      settled = true;
      worker?.terminate();
      resolve(result);
    };

    const fallbackToSync = () => {
      settle(parseCsvForInputs(text, options));
    };

    try {
      worker = new Worker(
        new URL("./parseCsv.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event: MessageEvent<ParseCsvWorkerResponse>) => {
        settle(event.data);
      };
      // Module workers that fail to load (jsdom) surface here — fall
      // back to the synchronous parse so the caller still gets a result.
      worker.onerror = () => {
        fallbackToSync();
      };
      const request: ParseCsvWorkerRequest = { text, options };
      worker.postMessage(request);
    } catch {
      // Construction or postMessage threw — fall back synchronously.
      fallbackToSync();
    }
  });
}
