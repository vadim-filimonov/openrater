/**
 * RaterQueryProvider — TanStack Query setup for any openrater frontend.
 *
 * Defaults tuned for the Rate Lab actuary workflow:
 *   - 5min staleTime: the actuary stays on a plan for long stretches.
 *     Aggressive refetch would burn bandwidth + flicker the UI.
 *   - retry: 1 — single retry on failure (catches transient hiccups,
 *     avoids the cascade-retry storm that makes errors slower to surface).
 *   - refetchOnWindowFocus: false — long deep-focus sessions; window
 *     focus is not a meaningful signal for stale data here.
 *   - refetchOnReconnect: true — DO refetch when the network comes back
 *     (typical laptop scenarios).
 *
 * Exports the QueryClient instance separately so non-component code
 * (route loaders, imperative actions) can call queryClient.invalidateQueries()
 * directly.
 */

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RaterApiError } from "@openrater/api-client";
import { reportMutationError, reportMutationSuccess } from "./mutationErrorReporter";

export const queryClient = new QueryClient({
  // Brief 58 Pillar A — the "no silent save failure" floor. Every
  // mutation error flows through here; `reportMutationError` surfaces it
  // on the global <GlobalErrorSurface> UNLESS the call site set
  // `meta: { localErrorSurface: true }` (it renders its own banner).
  // Retry replays the failed mutation via `execute(variables)`:
  // `continue()` only resumes a *paused* mutation, so it silently no-ops
  // on a settled-errored one (verified live). `execute` re-runs the full
  // lifecycle, so the hook's onSuccess invalidation fires on success.
  mutationCache: new MutationCache({
    onError: (error, variables, _context, mutation) => {
      reportMutationError(error, {
        localErrorSurface: Boolean(mutation.options.meta?.["localErrorSurface"]),
        retry: () => {
          void mutation.execute(variables).catch(() => {
            /* a re-failure re-pushes via this same onError — no-op here */
          });
        },
      });
    },
    // I6 — clear stale "Couldn't save" cards once a save actually succeeds
    // (a successful retry or any later successful save), so a resolved
    // failure can't linger across navigation until manually dismissed.
    onSuccess: (_data, _variables, _context, mutation) => {
      reportMutationSuccess({
        localErrorSurface: Boolean(mutation.options.meta?.["localErrorSurface"]),
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // Single retry on transient failures — but skip retries for
      // 4xx client errors (404 Not Found, 422 Validation, etc.).
      // Those are permanent: retrying just delays the UI's error state
      // for no benefit. 5xx and network errors retry once.
      retry: (failureCount, error) => {
        if (
          error instanceof RaterApiError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          return false;
        }
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

export function RaterQueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
