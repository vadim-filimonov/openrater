/**
 * parseCsv.worker — Brief 45 K11 off-main-thread CSV parsing.
 *
 * A tiny module worker that runs `parseCsvForInputs` off the main
 * thread so loading a large CSV (e.g. the 2k-row IRS 990 walkthrough)
 * doesn't freeze the UI. On each `{ text, options }` message it parses
 * and posts the (plain, serializable) result back.
 *
 * The heavy lifting lives in `parseCsv.ts` — this file is purely the
 * worker transport shell. It must stay self-contained: it imports ONLY
 * the pure parser (no React, no DOM-bound modules) so the bundler can
 * emit it as a standalone worker chunk.
 *
 * Resolution: the consumer (rate-lab) compiles `@openrater/ui` as
 * source, so Vite's `new Worker(new URL("./parseCsv.worker.ts",
 * import.meta.url), { type: "module" })` pattern in `parseCsvAsync.ts`
 * resolves THIS file relative to the labs-ui source tree. See the
 * docstring in `parseCsvAsync.ts` for the one-shot + fallback design.
 */

import {
  parseCsvForInputs,
  type ParseCsvForInputsOptions,
} from "./parseCsv";

/** Message posted INTO the worker by `parseCsvForInputsAsync`. */
export interface ParseCsvWorkerRequest {
  readonly text: string;
  readonly options: ParseCsvForInputsOptions;
}

/** Message posted OUT of the worker — the parse result, verbatim. */
export type ParseCsvWorkerResponse = ReturnType<typeof parseCsvForInputs>;

// Worker globals aren't in the labs-ui tsconfig `lib` (no "WebWorker"),
// so `self`/`postMessage` aren't typed here. We address the worker
// scope through a narrowly-typed local handle rather than widening the
// whole package's lib — keeps the transport explicit and contained.
const ctx = self as unknown as {
  onmessage:
    | ((event: MessageEvent<ParseCsvWorkerRequest>) => void)
    | null;
  postMessage: (message: ParseCsvWorkerResponse) => void;
};

ctx.onmessage = (event: MessageEvent<ParseCsvWorkerRequest>) => {
  const { text, options } = event.data;
  const result = parseCsvForInputs(text, options);
  ctx.postMessage(result);
};
