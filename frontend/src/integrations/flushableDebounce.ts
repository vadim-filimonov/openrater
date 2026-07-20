/**
 * flushableDebounce — a debounced write whose pending state SURVIVES the
 * timer being cleared, so it can be landed on demand (v4 G15/G24).
 *
 * The plan's replace-all syncs (dimensions / factor tables / input
 * mapping) coalesce keystrokes behind a ~400ms `setTimeout` inside a
 * React effect. Two races follow from a plain timer:
 *
 *   · G15 — "Freeze version" fires immediately; the server composes the
 *     snapshot body from the DB, so an edit still sitting in a debounce
 *     window is silently missing from the frozen version.
 *   · G24 — the effect's cleanup clears the timer on unmount (SPA route
 *     leave), so an edit within the window is simply dropped.
 *
 * The trio here keeps ONE extra bit — `pending` — that the effect's
 * cleanup does NOT clear:
 *
 *   arm(fire)   — (re)start the timer; marks pending. The timer firing
 *                 clears pending and runs `fire` (the steady-state write).
 *   disarm()    — clear the timer ONLY (effect cleanup: either a re-arm
 *                 follows, or the component is unmounting and a flush
 *                 still owes the write).
 *   flush(now)  — land the pending write immediately via `now` (the
 *                 awaitable variant of the write) and clear pending.
 *                 No-op when nothing is pending. Rejections propagate —
 *                 the freeze path ABORTS on a failed flush rather than
 *                 freezing stale state.
 *
 * Pure timer bookkeeping — no React, no I/O — so the race rules are
 * node-testable with fake timers.
 */

export interface FlushableDebounce {
  /** (Re)start the debounce. `fire` runs after `delayMs` unless a
   *  re-arm, disarm+flush, or flush lands first. */
  arm(fire: () => void): void;
  /** Clear the timer WITHOUT clearing pending (effect-cleanup shape). */
  disarm(): void;
  /** An armed write hasn't landed yet (via timer or flush). */
  isPending(): boolean;
  /** Land the pending write now (or no-op). Rejections propagate. */
  flush(writeNow: () => Promise<unknown>): Promise<void>;
}

export function createFlushableDebounce(delayMs: number): FlushableDebounce {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const clearTimer = (): void => {
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
  };

  return {
    arm(fire: () => void): void {
      clearTimer();
      pending = true;
      handle = setTimeout(() => {
        handle = null;
        pending = false;
        fire();
      }, delayMs);
    },
    disarm(): void {
      clearTimer();
    },
    isPending(): boolean {
      return pending;
    },
    async flush(writeNow: () => Promise<unknown>): Promise<void> {
      if (!pending) return;
      clearTimer();
      pending = false;
      await writeNow();
    },
  };
}
