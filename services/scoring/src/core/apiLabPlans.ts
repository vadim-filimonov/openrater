/**
 * apiLabPlans — resolve `source:"plan_id"` against API Lab (ADR-0049 A8).
 *
 * The mechanism the 501 used to point at: fetch the plan's FROZEN
 * snapshot bundle over HTTP and project it with the same pure
 * `snapshotBodyToRuntimePlan` the Analytics baseline uses (which itself
 * wraps the ONE projector, `stagesToRuntimePlan`). Resolution is by
 * `snapshot_id`, never by live stages — snapshots are immutable and
 * self-contained (plan + stages + dimensions + factor tables with cells
 * inlined), which is exactly what makes the cache below safe:
 *
 *   · cache key = snapshotId, cache policy = forever (an immutable
 *     artifact cannot drift; the LRU bound only caps memory).
 *   · a cache hit costs a Map lookup; a miss costs one GET + one
 *     projection — then every row of every future book on that
 *     snapshot reuses the compiled-input Plan.
 *
 * Failure semantics (PORTFOLIO_PLAN §3.1): API Lab unreachable → 503
 * `openrater_unavailable` (the caller's retry re-scores safely — scoring
 * is pure); unknown snapshot → 404; a snapshot with no runnable rating
 * chain → 400 (scoring it would echo inputs, a wrong answer).
 */

import type { Plan } from "@openrater/contracts";
import { snapshotBodyToRuntimePlan } from "@openrater/ui/AnalyticsWorkspace/snapshot-plan";

import { ServiceError, badRequest, notFound } from "./errors";

/** 503 — API Lab could not be reached (transient; retry-safe). */
export function apiLabUnavailable(message: string): ServiceError {
  return new ServiceError(503, "openrater_unavailable", message);
}

/** 502 — API Lab answered, but not usefully. */
export function apiLabError(message: string, details?: unknown): ServiceError {
  return new ServiceError(502, "openrater_error", message, details);
}

const MAX_CACHED_PLANS = 64;

/** snapshotId → snapshot BODY. Insertion-ordered Map as a tiny LRU.
 *  P2 G4 — the cache moved from the projected Plan to the BODY: the
 *  bundle path needs the body's stages/tail/mapping too, and a body is
 *  immutable per snapshotId just like its projection. */
const bodyCache = new Map<string, Record<string, unknown>>();

/** Test seam: drop every cached body. */
export function clearSnapshotPlanCache(): void {
  bodyCache.clear();
}

/** Fetch (+LRU-cache) a snapshot's immutable substrate body. */
export async function fetchSnapshotBody(
  apiLabBase: string,
  planId: string,
  snapshotId: string,
): Promise<Record<string, unknown>> {
  const cached = bodyCache.get(snapshotId);
  if (cached) {
    // Refresh recency (Map iteration order is insertion order).
    bodyCache.delete(snapshotId);
    bodyCache.set(snapshotId, cached);
    return cached;
  }

  const url =
    `${apiLabBase.replace(/\/$/, "")}/api/v1/plans/` +
    `${encodeURIComponent(planId)}/snapshots/${encodeURIComponent(snapshotId)}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw apiLabUnavailable(
      `API Lab is unreachable at ${apiLabBase} — cannot resolve ` +
        `snapshot ${snapshotId} for plan ${planId}. ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (response.status === 404) {
    throw notFound(
      `Snapshot ${snapshotId} for plan ${planId} does not exist in API Lab.`,
    );
  }
  if (!response.ok) {
    throw apiLabError(
      `API Lab returned ${response.status} resolving snapshot ${snapshotId}.`,
    );
  }

  const payload = (await response.json()) as { body?: unknown };
  const body = payload.body;
  if (!body || typeof body !== "object") {
    throw apiLabError(
      `Snapshot ${snapshotId} response carried no body — got keys ` +
        `[${Object.keys(payload ?? {}).join(", ")}].`,
    );
  }

  const record = body as Record<string, unknown>;
  bodyCache.set(snapshotId, record);
  if (bodyCache.size > MAX_CACHED_PLANS) {
    const oldest = bodyCache.keys().next().value;
    if (oldest !== undefined) bodyCache.delete(oldest);
  }
  return record;
}


export async function fetchSnapshotRuntimePlan(
  apiLabBase: string,
  planId: string,
  snapshotId: string,
): Promise<Plan> {
  const body = await fetchSnapshotBody(apiLabBase, planId, snapshotId);
  const plan = snapshotBodyToRuntimePlan(body, { planId });
  if (plan === null) {
    throw badRequest(
      `Snapshot ${snapshotId} has no runnable rating chain — scoring it ` +
        `would echo inputs. Author a multiplicative chain and re-freeze.`,
    );
  }
  return plan;
}
