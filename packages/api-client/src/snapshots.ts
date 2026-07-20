/**
 * Plan snapshots client (Brief 43 §4 / PR 43.1).
 *
 * Three functions:
 *
 *   - freezeSnapshot(planId, body)         POST  /plans/{planId}/snapshots
 *   - listSnapshots(planId)                 GET   /plans/{planId}/snapshots
 *   - getSnapshot(planId, snapshotId)       GET   /plans/{planId}/snapshots/{id}
 *
 * The Analytics workspace uses `listSnapshots` for the picker, `getSnapshot`
 * to fetch a body for re-rating, and `freezeSnapshot` for the "Freeze version"
 * dialog on the plan header. Snapshots are append-only — no update / no delete.
 */

import { request } from "./fetcher";
import {
  type FreezeSnapshotRequest,
  freezeSnapshotRequestSchema,
  type ListSnapshotsResponse,
  listSnapshotsResponseSchema,
  type PlanSnapshot,
  planSnapshotSchema,
  type PlanSnapshotSummary,
  planSnapshotSummarySchema,
} from "./schemas/snapshots";

/**
 * Freeze the current draft state of a plan into a named, immutable
 * snapshot. The display_name must be unique within the plan — collision
 * raises a 409. Returns the fully-composed snapshot (identity + body).
 */
export async function freezeSnapshot(
  planId: string,
  body: FreezeSnapshotRequest,
): Promise<PlanSnapshot> {
  // Validate the request shape client-side so we fail fast before
  // a network round-trip. The backend re-validates identically.
  freezeSnapshotRequestSchema.parse(body);
  return request({
    method: "POST",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/snapshots`,
    body,
    schema: planSnapshotSchema,
  });
}

/**
 * List every snapshot for a plan, newest first. Returns an empty list
 * when the plan exists but has no snapshots — the picker treats
 * "no snapshots" as a first-class empty state, not an error.
 */
export async function listSnapshots(
  planId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ListSnapshotsResponse> {
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/snapshots`,
    schema: listSnapshotsResponseSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

/**
 * Fetch one snapshot including the self-contained body the runtime
 * needs to re-rate against it. Returns the full snapshot or throws a
 * RaterApiError(404) if the snapshot doesn't exist OR belongs to a
 * different plan (the backend scopes the lookup by plan_id).
 */
export async function getSnapshot(
  planId: string,
  snapshotId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PlanSnapshot> {
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/snapshots/${encodeURIComponent(snapshotId)}`,
    schema: planSnapshotSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

/**
 * Publish a frozen version as the plan's Current version of record
 * (Brief 64 §4 — the Versions + Publish / "Finalize" model). Clears the
 * prior current so exactly one version is Current per plan. The plan stays
 * editable — publishing only points at a version. Throws RaterApiError(404)
 * if the snapshot doesn't exist on the plan. Returns the updated summary.
 */
export async function publishSnapshot(
  planId: string,
  snapshotId: string,
): Promise<PlanSnapshotSummary> {
  return request({
    method: "PATCH",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/snapshots/${encodeURIComponent(snapshotId)}/publish`,
    schema: planSnapshotSummarySchema,
  });
}

// ── Brief 76 P4.4 — publish + divergence state ─────────────────────

import { z } from "zod";

export const publishStatusSchema = z.object({
  published: z.boolean(),
  published_snapshot_id: z.string().nullable().default(null),
  published_at: z.string().nullable().default(null),
  published_by: z.string().nullable().default(null),
  published_content_hash: z.string().nullable().default(null),
  draft_content_hash: z.string().nullable().default(null),
  diverged: z.boolean().default(false),
});
export type PublishStatus = z.infer<typeof publishStatusSchema>;

/**
 * The plan's publish + divergence state: is a version live, and has the
 * working draft drifted from it (content-hash compare)? Drives the Ship
 * tab's divergence chip + the API panel's "publish first" empty state.
 */
export async function getPublishStatus(
  planId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PublishStatus> {
  return request({
    method: "GET",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/publish-status`,
    schema: publishStatusSchema,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

// ── Brief 84 D-B — the ONE deploy verb ─────────────────────────────

export const goLiveRequestSchema = z.object({
  version_name: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type GoLiveRequest = z.infer<typeof goLiveRequestSchema>;

export const goLiveResponseSchema = z.object({
  snapshot: planSnapshotSummarySchema,
  publish_status: publishStatusSchema,
});
export type GoLiveResponse = z.infer<typeof goLiveResponseSchema>;

/**
 * Go live (Brief 84 D-B): freeze the current draft AND publish it as
 * the version callers get — one call behind the Go live / Publish
 * update dialog. `version_name` defaults server-side to the first free
 * `v{N}`; an explicit collision throws RaterApiError(409,
 * snapshot_name_collision). The draft stays editable throughout.
 */
export async function goLive(
  planId: string,
  body: GoLiveRequest = {},
): Promise<GoLiveResponse> {
  goLiveRequestSchema.parse(body);
  return request({
    method: "POST",
    path: `/api/v1/plans/${encodeURIComponent(planId)}/publish`,
    body,
    schema: goLiveResponseSchema,
  });
}
