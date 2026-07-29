/**
 * Zod schemas for the plan snapshots endpoint group (Brief 43 §4).
 *
 * Mirrors the Pydantic models in api-lab/backend's
 * `rates/snapshots/models.py`. The `body` field is opaque to the
 * client layer — the Analytics workspace re-rates against it via
 * the existing runtime engine, never inspects it field-by-field.
 * Typing it strictly here would force a coordinated bump whenever
 * a substrate evolves; loose typing keeps snapshots an orchestration
 * concern (mirrors templates' `recipe` shape).
 */

import { z } from "zod";

export const planSnapshotSummarySchema = z.object({
  snapshot_id: z.string().min(1).max(80),
  plan_id: z.string().min(1).max(80),
  display_name: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  created_at: z.string().min(1),
  created_by: z.string().min(1).max(120),
  // Brief 64 §4 — version publish status. Non-null `published_at` marks
  // the plan's Current version of record (at most one per plan).
  published_at: z.string().nullable().optional(),
  published_by: z.string().max(120).nullable().optional(),
});
export type PlanSnapshotSummary = z.infer<typeof planSnapshotSummarySchema>;

export const planSnapshotSchema = planSnapshotSummarySchema.extend({
  body: z.record(z.unknown()),
});
export type PlanSnapshot = z.infer<typeof planSnapshotSchema>;

export const freezeSnapshotRequestSchema = z.object({
  display_name: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
});
export type FreezeSnapshotRequest = z.infer<typeof freezeSnapshotRequestSchema>;

export const listSnapshotsResponseSchema = z.object({
  snapshots: z.array(planSnapshotSummarySchema),
});
export type ListSnapshotsResponse = z.infer<typeof listSnapshotsResponseSchema>;
