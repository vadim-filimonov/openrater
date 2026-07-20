/**
 * apiErrorBus — a global error-notification channel (Brief 58, Pillar A).
 *
 * The data layer (`@openrater/hooks` `MutationCache.onError`) pushes transport
 * failures here; `<GlobalErrorSurface>` renders them. This module is the
 * load-bearing "no silent failure" floor: any save that fails without a
 * call-site banner lands here and becomes visible.
 *
 * Pure — no React, no DOM. A module-level singleton (one channel per app
 * instance). Testable in isolation. Exposed via the design-system index
 * AND the `@openrater/design-system/error-bus` subpath so the data layer can
 * push without importing the component tree.
 *
 * Coalescing: identical errors (same `id`, e.g. `network_error:0`) merge
 * into one card with an incremented count rather than flooding the stack
 * — but a second *distinct* failure is never dropped (it gets its own
 * card, up to MAX_NOTICES).
 */

export interface ApiErrorNotice {
  /** Dedupe key — identical errors coalesce under this id. */
  readonly id: string;
  /** Bold lead line, e.g. "Couldn't save your changes". */
  readonly title: string;
  /** Actuary-language explanation (rendered verbatim). */
  readonly message: string;
  /** Technical detail (status + code + raw message) for the expander. */
  readonly detail?: string;
  /** Coalesced occurrence count (≥ 1). */
  readonly count: number;
  /** Replay the failed action. Present only when the action is retryable. */
  readonly retry?: () => void;
}

/** What a producer pushes — `count` is managed by the bus. */
export type ApiErrorInput = Omit<ApiErrorNotice, "count">;

type Listener = () => void;

/** Cap the visible stack so a backend-down storm can't bury the app. */
export const MAX_NOTICES = 3;

let notices: readonly ApiErrorNotice[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export const apiErrorBus = {
  /** Subscribe to changes; returns an unsubscribe fn (useSyncExternalStore). */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Current notices, newest first. Stable reference between changes. */
  getSnapshot(): readonly ApiErrorNotice[] {
    return notices;
  },

  /**
   * Push an error notice. Same-id errors coalesce (count++ , newest
   * title/message/retry win); distinct errors prepend, capped at
   * MAX_NOTICES so the newest failures stay visible.
   */
  push(input: ApiErrorInput): void {
    const existing = notices.find((n) => n.id === input.id);
    if (existing) {
      notices = [
        { ...existing, ...input, count: existing.count + 1 },
        ...notices.filter((n) => n.id !== input.id),
      ];
    } else {
      notices = [{ ...input, count: 1 }, ...notices].slice(0, MAX_NOTICES);
    }
    emit();
  },

  /** Remove a notice (dismiss / successful retry). */
  dismiss(id: string): void {
    notices = notices.filter((n) => n.id !== id);
    emit();
  },

  /** Clear all (used by tests + a future "dismiss all"). */
  clear(): void {
    if (notices.length === 0) return;
    notices = [];
    emit();
  },
};
