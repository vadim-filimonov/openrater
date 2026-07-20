/**
 * useHoverDelay — Brief 34 PR 34.5.
 *
 * Tiny hook that wraps an `onChange(key | null)` callback with the
 * 100ms delay called out in Brief 34 §5.1 ("100ms hover delay
 * before triggering (no jitter)"). The hook returns three handles
 * the caller wires up to its hover events.
 *
 * Pattern:
 *
 *   ```tsx
 *   const { onEnter, onLeave } = useHoverDelay({
 *     onChange: (k) => parent.onHoverChange?.(k),
 *   });
 *   <div onMouseEnter={() => onEnter(myKey)} onMouseLeave={onLeave} />
 *   ```
 *
 * Behavior:
 *   • onEnter(key) → schedules a fire 100ms later
 *   • onLeave()    → cancels any pending fire AND fires `null`
 *     immediately (no need to delay the "I'm no longer hovered"
 *     signal — only the "I'm hovered" signal jitters)
 *   • The hook cleans up its timer on unmount
 *
 * Used by <FactorTableViz> for outgoing hover-to-parent emissions,
 * so the receiving pane's cross-highlight doesn't twitch when the
 * mouse passes through. The chart primitive's own local hover
 * state (which marker grows) stays instant — that's a local
 * affordance, not a cross-pane signal.
 */

import { useCallback, useEffect, useRef } from "react";

/** Default delay in milliseconds per Brief 34 §5.1. */
export const DEFAULT_HOVER_DELAY_MS = 100;

export interface UseHoverDelayOptions<K> {
  /** Fires after the delay (on enter) or immediately (on leave). */
  readonly onChange?: (key: K | null) => void;
  /**
   * Milliseconds to wait before firing on enter. Leave-fire is
   * always immediate. Defaults to 100ms (Brief 34 §5.1).
   */
  readonly delayMs?: number;
}

export interface UseHoverDelayReturn<K> {
  /** Call from the element's onMouseEnter handler. */
  readonly onEnter: (key: K) => void;
  /** Call from the element's onMouseLeave handler. */
  readonly onLeave: () => void;
  /** Cancel any pending fire without emitting. Use sparingly. */
  readonly cancel: () => void;
}

export function useHoverDelay<K>(
  opts: UseHoverDelayOptions<K> = {},
): UseHoverDelayReturn<K> {
  const { onChange, delayMs = DEFAULT_HOVER_DELAY_MS } = opts;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef<UseHoverDelayOptions<K>["onChange"]>(onChange);

  // Keep the callback ref fresh without re-creating handlers (so
  // consumers can pass inline arrow functions without retriggering
  // effect cleanup).
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onEnter = useCallback(
    (key: K) => {
      cancel();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onChangeRef.current?.(key);
      }, delayMs);
    },
    [cancel, delayMs],
  );

  const onLeave = useCallback(() => {
    cancel();
    onChangeRef.current?.(null);
  }, [cancel]);

  // Cleanup on unmount.
  useEffect(() => () => cancel(), [cancel]);

  return { onEnter, onLeave, cancel };
}
