/**
 * JobSpec — the persisted batch-job definition.
 *
 * It is the /score-batch request MINUS the input rows (rows are stored
 * separately so the queue payload stays small — SQS 256 KB-friendly),
 * PLUS:
 *   • `options.as_of` PINNED once at enqueue (so a multi-chunk job that
 *     spans midnight stays reproducible),
 *   • `chunkSize` resolved from the request or the service default,
 *   • `total` row count.
 *
 * It extends `PlanResolution`, so the worker resolves its Plan through
 * the SAME `resolvePlan` path /score uses.
 */

import type { ViewConfig } from "./derive";
import type { PlanResolution } from "./planSource";
import type { ScoreOptionsInput } from "./score";
import type { BookBag, ScoreBatchRequest, ScoreTraceMode } from "./schema";

export type JobSpec = PlanResolution & {
  readonly options?: ScoreOptionsInput;
  readonly views?: ViewConfig;
  readonly trace: ScoreTraceMode;
  readonly chunkSize: number;
  readonly total: number;
  /** Brief 75 (P3) — when present, the stored input rows are RAW book
   *  rows: the worker projects them (one labs-ui path), rates, then
   *  composes policies per this bag + the plan substrate. */
  readonly book?: BookBag;
};

/**
 * Build a JobSpec from a parsed /score-batch request. `asOf` is the
 * resolved temporal anchor (caller's value or today, decided once at
 * enqueue); `chunkSize` is the request's value or the service default.
 */
export function toJobSpec(
  req: ScoreBatchRequest,
  asOf: string,
  chunkSize: number,
): JobSpec {
  const common = {
    options: {
      as_of: asOf,
      ...(req.options?.classLibraryEntries
        ? { classLibraryEntries: req.options.classLibraryEntries }
        : {}),
    },
    ...(req.views ? { views: req.views } : {}),
    trace: req.trace,
    chunkSize,
    total: req.rows.length,
    ...(req.book ? { book: req.book } : {}),
  };

  if (req.source === "plan") {
    return { source: "plan", plan: req.plan, ...common };
  }
  if (req.source === "plan_stages") {
    return {
      source: "plan_stages",
      stages: req.stages,
      dimensions: req.dimensions,
      factorTables: req.factorTables,
      factorTableCells: req.factorTableCells,
      ...(req.projectorOptions ? { projectorOptions: req.projectorOptions } : {}),
      ...(req.policyTail ? { policyTail: req.policyTail } : {}),
      ...common,
    };
  }
  return {
    source: "plan_id",
    planId: req.planId,
    snapshotId: req.snapshotId,
    ...common,
  };
}
