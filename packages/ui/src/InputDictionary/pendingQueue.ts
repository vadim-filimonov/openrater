/**
 * Durable input-dictionary bulk-add queue (Brief 58, Pillar C).
 *
 * "Quick-add Sample BOP (28)" / Seed-from-CSV / Paste-JSON declare many
 * inputs at once. Each is a separate `addStage` POST, run sequentially.
 * Before this brief that loop lived in the Inputs workspace component,
 * which unmounts on a tab switch — so navigating away mid-loop dropped
 * every not-yet-saved declaration with no feedback and no recovery.
 *
 * The fix: enqueue the intended declarations HERE (localStorage) BEFORE
 * the saves run, then drain them one at a time, removing each only after
 * it commits. An interrupted bulk-add (tab switch, reload, even a crash)
 * resumes from the queue on the next mount — nothing is silently lost.
 *
 * Pure + localStorage-backed; the rate-lab `useDurableInputDeclarations`
 * hook drives the drain from a stable host that does NOT unmount on tab
 * switch. One key per plan: `openrater:input-dict-pending:v1:{planId}`,
 * holding the not-yet-committed `InputDictEntry[]` in FIFO order.
 */

import type { InputDictEntry } from "./types";

const PENDING_PREFIX = "openrater:input-dict-pending:v1:";

function keyFor(planId: string): string {
  return `${PENDING_PREFIX}${planId}`;
}

function read(planId: string): InputDictEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(planId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as InputDictEntry[]) : [];
  } catch {
    return [];
  }
}

function write(planId: string, entries: readonly InputDictEntry[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(keyFor(planId));
    else localStorage.setItem(keyFor(planId), JSON.stringify(entries));
  } catch {
    // Quota / private-mode — durability degrades to in-memory; swallow.
  }
}

/** Current pending (not-yet-committed) declarations, FIFO. */
export function peekPendingDeclarations(
  planId: string,
): readonly InputDictEntry[] {
  return read(planId);
}

/**
 * Append declarations to the queue, skipping any already queued (by id
 * or fieldName, so a double-click doesn't double-enqueue). Returns the
 * entries actually added. Callers should pre-filter against the plan's
 * already-declared inputs; this only dedupes within the queue.
 */
export function enqueuePendingDeclarations(
  planId: string,
  entries: readonly InputDictEntry[],
): readonly InputDictEntry[] {
  const existing = read(planId);
  const seenIds = new Set(existing.map((e) => e.id));
  const seenFields = new Set(existing.map((e) => e.fieldName));
  const added: InputDictEntry[] = [];
  for (const e of entries) {
    // New entries carry id "" (the backend assigns the stage_id on add).
    // Dedup those by fieldName ONLY — otherwise a bulk declare of several
    // fresh fields collapses to one by their shared empty id.
    if ((e.id !== "" && seenIds.has(e.id)) || seenFields.has(e.fieldName)) {
      continue;
    }
    if (e.id !== "") seenIds.add(e.id);
    seenFields.add(e.fieldName);
    added.push(e);
  }
  if (added.length > 0) write(planId, [...existing, ...added]);
  return added;
}

/** Remove one committed declaration from the queue (by id). */
export function dequeuePendingDeclaration(planId: string, id: string): void {
  const existing = read(planId);
  // Remove only the FIRST match (the head the drain just committed). New
  // entries all share id "" — filtering by id would wipe the whole batch
  // after the first declare.
  const idx = existing.findIndex((e) => e.id === id);
  if (idx === -1) return;
  write(planId, [...existing.slice(0, idx), ...existing.slice(idx + 1)]);
}

/** Drop the whole queue (plan delete + tests). */
export function clearPendingDeclarations(planId: string): void {
  write(planId, []);
}

export interface DrainResult {
  /** How many declarations committed this pass. */
  readonly committed: number;
  /** True if a save failed and the drain stopped (remainder stays queued). */
  readonly failed: boolean;
}

/**
 * Drain the queue: commit declarations one at a time via `addOne`,
 * removing each only AFTER it succeeds. On a failure, STOP and leave the
 * remainder queued (the global error surface shows the failure; the next
 * mount / retry resumes). FIFO + idempotent — a re-drain after an
 * interruption commits exactly the not-yet-committed remainder, each
 * declaration exactly once.
 */
export async function drainPendingDeclarations(
  planId: string,
  addOne: (entry: InputDictEntry) => Promise<void>,
  onProgress?: (remaining: number) => void,
): Promise<DrainResult> {
  let committed = 0;
  // Re-read the head each iteration so a concurrent enqueue is picked up
  // and a successful dequeue is reflected.
  let queue = read(planId);
  while (queue.length > 0) {
    const next = queue[0];
    if (!next) break;
    try {
      await addOne(next);
    } catch {
      // Leave `next` (and the rest) queued for the next drain.
      return { committed, failed: true };
    }
    dequeuePendingDeclaration(planId, next.id);
    committed += 1;
    queue = read(planId);
    onProgress?.(queue.length);
  }
  return { committed, failed: false };
}
