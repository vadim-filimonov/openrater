/**
 * mutationErrorReporter — the bridge from a failed mutation to the
 * global save-failure surface (Brief 58, Pillar A / P-DW3).
 *
 * The shared QueryClient's `MutationCache.onError` calls this for EVERY
 * mutation failure. It is the safe-by-default floor: a contributor who
 * forgets `onError` gets a visible failure for free. Call sites that
 * render their own better-placed banner opt out via
 * `meta: { localErrorSurface: true }`.
 *
 * Extracted from the QueryClient wiring so the policy (opt-out, message,
 * coalescing) is unit-testable without standing up a real mutation.
 */

import { apiErrorBus } from "@openrater/design-system/error-bus";
import { describeApiError } from "./describeApiError";

export interface ReportMutationErrorOptions {
  /** When true, the call site handles the error itself — skip the surface. */
  readonly localErrorSurface?: boolean;
  /** Replay the failed mutation (wired to `mutation.continue()`). */
  readonly retry?: () => void;
}

export function reportMutationError(
  error: unknown,
  opts: ReportMutationErrorOptions = {},
): void {
  if (opts.localErrorSurface) return;

  const desc = describeApiError(error);
  apiErrorBus.push({
    id: desc.id,
    title: desc.title,
    message: desc.message,
    detail: desc.detail,
    ...(opts.retry ? { retry: opts.retry } : {}),
  });
}

/**
 * I6 — the success side of the floor. The global stack holds transient
 * save/transport failures (Brief 58); once ANY save succeeds, lingering
 * "Couldn't save your changes" cards are stale. Previously they survived a
 * successful retry AND navigation until the user manually dismissed them
 * (a failed import → fix → retry-success left the scary card on screen).
 * Clearing on success is the "your changes were saved supersedes couldn't
 * save" pattern. Call sites that own a local surface opt out (symmetry with
 * `reportMutationError`) so we don't clear cards they manage.
 *
 * Trade-off: this clears the whole (≤ MAX_NOTICES) stack, so a still-broken
 * *unrelated* save's card is also cleared by a different successful save —
 * acceptable for transient save failures (re-triggering re-surfaces it) and
 * strictly better than errors that never clear.
 */
export function reportMutationSuccess(
  opts: ReportMutationErrorOptions = {},
): void {
  if (opts.localErrorSurface) return;
  apiErrorBus.clear();
}
