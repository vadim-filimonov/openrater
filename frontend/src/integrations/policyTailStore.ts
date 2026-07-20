/**
 * The plan's Final-adjustments tail — API-backed store (ADR-0055 Option A,
 * owner label "Final adjustments").
 *
 * The tail is plan substrate: `GET/PUT/DELETE /api/v1/plans/{id}/policy-tail`
 * is the record (draft-gated server-side via `assert_plan_writable`), and
 * snapshots capture it, so the filed premium reproduces via API, snapshots,
 * and other browsers — Law 3 ("one artifact"). localStorage remains ONLY as
 * a write-through cache for instant hydration, mirroring the input-mapping
 * pattern; ADR-0055's P9 cutover removes the read fallback entirely.
 *
 * `usePolicyTailSynced` is the one consumer surface:
 *   · hydrates instantly from the cache, then reconciles against the API —
 *     a server tail is authoritative (validated per item, cache refreshed);
 *   · when the server has NO tail but the legacy cache does and the plan is
 *     writable, runs the ONE-SHOT localStorage→API migration (idempotent
 *     PUT; pre-ADR plans graduate on first open);
 *   · `setTail` writes state + cache, and PUTs when the plan is writable —
 *     read-only plans keep a local view but never mutate the record.
 *
 * Stored values are validated with the contract guard on every read, so a
 * corrupt / stale blob degrades to an empty tail rather than crashing the
 * runtime plan.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isPolicyAdjustment } from "@openrater/contracts";
import type { PolicyAdjustment } from "@openrater/contracts";
import { RaterApiError } from "@openrater/api-client";
import { usePolicyTailEnvelope, useUpsertPolicyTail } from "@openrater/hooks";
import { createFlushableDebounce } from "./flushableDebounce";

const PREFIX = "openrater:policy-tail:v1:";

function keyFor(planId: string): string {
  return `${PREFIX}${planId}`;
}

/** Read the plan's cached tail (validated). Empty array when unset /
 *  corrupt / storage unavailable. Cache only — the API is the record. */
export function readPolicyTail(planId: string): PolicyAdjustment[] {
  if (!planId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(planId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPolicyAdjustment);
  } catch {
    return [];
  }
}

/** Refresh the write-through cache. No-op when storage is unavailable. */
export function writePolicyTail(
  planId: string,
  tail: readonly PolicyAdjustment[],
): void {
  if (!planId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(planId), JSON.stringify(tail));
  } catch {
    // private mode / quota — non-fatal; the cache just won't survive.
  }
}

/** One-shot per-plan migration latch (per session). The PUT itself is
 *  idempotent — this just avoids re-firing on remounts. */
const migratedPlans = new Set<string>();

/** Test-only: reset the migration latch between cases. */
export function _resetPolicyTailMigrationForTests(): void {
  migratedPlans.clear();
}

/** The reconcile decision, pure (node-testable — the hook just applies it):
 *  a server envelope is authoritative (adopt, validated per item); a plan
 *  the server has NEVER seen a tail for migrates the legacy local cache —
 *  but only when the plan is writable and the cache is non-empty. */
export type TailReconcile =
  | {
      readonly action: "adopt";
      readonly tail: PolicyAdjustment[];
      /** Adopt-once marker — the envelope's content hash (or its JSON). */
      readonly marker: string;
    }
  | { readonly action: "migrate"; readonly tail: PolicyAdjustment[] }
  | { readonly action: "none" };

export function reconcilePolicyTail(
  envelope: {
    readonly tail: readonly unknown[];
    readonly content_hash?: string | null | undefined;
  } | null,
  localTail: readonly PolicyAdjustment[],
  writable: boolean,
): TailReconcile {
  if (envelope) {
    return {
      action: "adopt",
      tail: envelope.tail.filter(isPolicyAdjustment),
      marker: envelope.content_hash ?? JSON.stringify(envelope.tail),
    };
  }
  if (!writable || localTail.length === 0) return { action: "none" };
  return { action: "migrate", tail: [...localTail] };
}

/** A 16-hex content hash (what the backend's envelopes carry). The
 *  adopt marker may instead be a JSON fallback for hash-less envelopes —
 *  never send THAT as If-Match. */
const CONTENT_HASH_RE = /^[0-9a-f]{16}$/;

/**
 * The plan's tail, synced against the API record.
 *
 * `writable` gates every mutation (PUT) — pass the plan's DRAFT state, the
 * same signal the dims/FT/mapping syncs gate on (a non-draft plan's tail is
 * immutable; the backend 409s as defense in depth).
 *
 * v4 G14 — every PUT is preconditioned on the last-seen `content_hash`
 * (If-Match): a second writer's tail can no longer be silently
 * clobbered. Edits coalesce behind the same flushable 400ms debounce
 * the dims/FT/mapping syncs use, so same-tab keystroke bursts ride one
 * PUT (and the hash from each response keeps the next write fresh). On
 * a 412 the record is refetched and ADOPTED — the editor snaps to the
 * server's truth, which IS the honest signal that someone else wrote.
 * `registerFlush` (optional — pass from the editor mount) joins the
 * G15 freeze barrier so a freeze lands a pending tail write first.
 */
export function usePolicyTailSynced(
  planId: string,
  opts: {
    readonly writable: boolean;
    readonly registerFlush?: (
      key: string,
      flush: (() => Promise<void>) | null,
    ) => void;
  },
): readonly [
  readonly PolicyAdjustment[],
  (next: readonly PolicyAdjustment[]) => void,
] {
  const { writable, registerFlush } = opts;
  const [tail, setTailState] = useState<readonly PolicyAdjustment[]>(() =>
    readPolicyTail(planId),
  );

  // Re-hydrate from the cache when the consumer switches plans.
  const planRef = useRef(planId);
  useEffect(() => {
    if (planRef.current === planId) return;
    planRef.current = planId;
    setTailState(readPolicyTail(planId));
  }, [planId]);

  const envelopeQuery = usePolicyTailEnvelope(planId);
  const upsert = useUpsertPolicyTail(planId);
  const { mutate: upsertMutate, mutateAsync: upsertMutateAsync } = upsert;
  const refetchRef = useRef(envelopeQuery.refetch);
  refetchRef.current = envelopeQuery.refetch;

  // Reconcile against the record:
  //   · envelope present → the API is authoritative: adopt (validated per
  //     item) + refresh the cache. Guarded by content hash so our own PUT's
  //     invalidation round-trip is a no-op adopt.
  //   · envelope null (never authored) + non-empty legacy cache + writable →
  //     the one-shot migration PUT. Read-only plans keep the local view
  //     (a frozen pre-ADR plan can't be written; its display is unchanged
  //     until an owner migrates it from a draft).
  const adoptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!envelopeQuery.isSuccess) return;
    const decision = reconcilePolicyTail(
      envelopeQuery.data,
      readPolicyTail(planId),
      writable,
    );
    if (decision.action === "adopt") {
      if (adoptedRef.current === decision.marker) return;
      adoptedRef.current = decision.marker;
      setTailState(decision.tail);
      writePolicyTail(planId, decision.tail);
    } else if (decision.action === "migrate" && !migratedPlans.has(planId)) {
      migratedPlans.add(planId);
      upsertMutate({
        tail: decision.tail as unknown as Record<string, unknown>[],
      });
    }
  }, [
    envelopeQuery.isSuccess,
    envelopeQuery.data,
    planId,
    writable,
    upsertMutate,
  ]);

  // The debounced, preconditioned PUT (G14/G15/G24 — same trio the
  // dims/FT/mapping syncs use).
  const debounce = useRef(createFlushableDebounce(400)).current;
  const tailRef = useRef(tail);
  tailRef.current = tail;
  const writeNow = useCallback(async () => {
    const marker = adoptedRef.current;
    const body = {
      tail: tailRef.current as unknown as Record<string, unknown>[],
      ...(marker !== null && CONTENT_HASH_RE.test(marker)
        ? { ifMatch: marker }
        : {}),
    };
    try {
      const envelope = await upsertMutateAsync(body);
      // Freshen the marker from the RESPONSE so the next write is
      // preconditioned correctly even before the invalidation refetch
      // lands (and that refetch's adopt becomes a no-op).
      if (envelope.content_hash) adoptedRef.current = envelope.content_hash;
    } catch (err) {
      if (err instanceof RaterApiError && err.code === "stale_write") {
        // Someone else wrote — refetch + adopt the record (the editor
        // snaps to the server's truth rather than clobbering it).
        void refetchRef.current();
        return;
      }
      throw err;
    }
  }, [upsertMutateAsync]);
  const writeNowRef = useRef(writeNow);
  writeNowRef.current = writeNow;

  const setTail = useCallback(
    (next: readonly PolicyAdjustment[]) => {
      setTailState(next);
      writePolicyTail(planId, next);
      if (writable) {
        debounce.arm(() => void writeNowRef.current());
      }
    },
    [planId, writable, debounce],
  );

  // G15 — join the freeze barrier when the mount provides it (the
  // Final-adjustments editor). G24 — land a pending write on unmount.
  useEffect(() => {
    if (!registerFlush) return;
    registerFlush("policy-tail", () =>
      debounce.flush(() => writeNowRef.current()),
    );
    return () => registerFlush("policy-tail", null);
  }, [registerFlush, debounce]);
  useEffect(
    () => () => {
      void debounce.flush(() => writeNowRef.current());
    },
    [debounce],
  );

  return [tail, setTail] as const;
}
