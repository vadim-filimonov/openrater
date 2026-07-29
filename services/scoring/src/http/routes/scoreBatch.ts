/**
 * /score-batch — async book scoring.
 *
 *   POST /score-batch            → enqueue a job, return { jobId, status }
 *   GET  /score-batch/:id        → job status + progress
 *   GET  /score-batch/:id/result → paginated results (?offset&limit) +
 *                                  a durable `location` (file:// now,
 *                                  s3:// on AWS) for the full artifact
 *
 * The route persists the spec + input rows to the ResultStore and pushes
 * only the jobId onto the JobQueue (small payload). A worker scores the
 * book asynchronously. A SCHEDULED portfolio re-rate (Brief 62) is just
 * a POST here — same path, no special-casing.
 */

import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";

import { badRequest, notFound } from "../../core/errors";
import { toJobSpec } from "../../core/jobSpec";
import { parseScoreBatchRequest } from "../../core/schema";
import type { JobQueue, JobRecord } from "../../ports/jobQueue";
import type { ResultStore } from "../../ports/resultStore";

export interface BatchDeps {
  readonly queue: JobQueue;
  readonly store: ResultStore;
  readonly maxRows: number;
  readonly defaultChunkSize: number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadSummaryOf(
  store: ResultStore,
  jobId: string,
): Promise<unknown | null> {
  if (!("loadSummary" in store)) return null;
  return (
    store as { loadSummary(id: string): Promise<unknown | null> }
  ).loadSummary(jobId);
}

/**
 * FCA fca-2026-07-25 #22 — the queue record is process memory; the
 * artifacts are durable. A sidecar restart used to orphan every
 * finished job ("the rows aren't available anymore" the same day the
 * run was made) because these routes 404'd on the queue miss without
 * ever consulting the store. Rebuild the lifecycle record from what's
 * on disk: a summary (written once, post-composition) or a complete
 * results file proves the job finished; artifacts without either mean
 * the restart interrupted it — say so, never a phantom 404.
 */
async function recordOrReconstruct(
  deps: BatchDeps,
  jobId: string,
): Promise<JobRecord | null> {
  const live = await deps.queue.get(jobId);
  if (live) return live;
  const spec = await deps.store.loadSpec(jobId);
  if (spec === null) return null;

  const results = await deps.store.readResults(jobId, 0, 1);
  const summary = await loadSummaryOf(deps.store, jobId);
  if (summary !== null) {
    return {
      jobId,
      status: "succeeded",
      progress: { done: results.total, total: results.total },
      // The queue held the timestamps; they died with it. Blank is
      // honest — never invent a time.
      createdAt: "",
    };
  }
  const input = await deps.store.loadInput(jobId);
  if (input.length > 0 && results.total >= input.length) {
    return {
      jobId,
      status: "succeeded",
      progress: { done: results.total, total: input.length },
      createdAt: "",
    };
  }
  return {
    jobId,
    status: "failed",
    progress: { done: results.total, total: input.length },
    createdAt: "",
    error:
      `a scoring-service restart interrupted this job after ` +
      `${results.total} of ${input.length} rows — re-run it to ` +
      `regenerate the results`,
  };
}

export function scoreBatchRoutes(deps: BatchDeps): FastifyPluginAsync {
  return async (app) => {
    app.post("/score-batch", async (request, reply) => {
      const req = parseScoreBatchRequest(request.body);
      if (req.rows.length === 0) {
        throw badRequest("score-batch requires at least one row");
      }
      if (req.rows.length > deps.maxRows) {
        throw badRequest(
          `row count ${req.rows.length} exceeds MAX_BATCH_ROWS (${deps.maxRows})`,
        );
      }

      const jobId = randomUUID();
      // Pin as_of ONCE at enqueue so every chunk shares the anchor.
      const asOf = req.options?.as_of ?? todayUtc();
      const chunkSize = req.chunkSize ?? deps.defaultChunkSize;
      const spec = toJobSpec(req, asOf, chunkSize);

      await deps.store.saveSpec(jobId, spec);
      await deps.store.saveInput(jobId, req.rows);
      await deps.queue.enqueue({
        jobId,
        status: "queued",
        progress: { done: 0, total: req.rows.length },
        createdAt: new Date().toISOString(),
      });

      void reply
        .status(202)
        .send({ jobId, status: "queued", total: req.rows.length });
    });

    app.get<{ Params: { id: string } }>(
      "/score-batch/:id",
      async (request, reply) => {
        const record = await recordOrReconstruct(deps, request.params.id);
        if (!record) throw notFound(`job ${request.params.id} not found`);
        void reply.send(record);
      },
    );

    app.get<{
      Params: { id: string };
      Querystring: { offset?: string; limit?: string };
    }>("/score-batch/:id/result", async (request, reply) => {
      const record = await recordOrReconstruct(deps, request.params.id);
      if (!record) throw notFound(`job ${request.params.id} not found`);

      const offset = Math.max(0, Number(request.query.offset ?? "0") || 0);
      const limit = Math.max(1, Number(request.query.limit ?? "1000") || 1000);
      const page = await deps.store.readResults(request.params.id, offset, limit);
      // Brief 75 — a BOOK job carries a summary artifact (facet totals
      // + compact ledger + composed policies), written once by the
      // worker after composition. Null for plain batch jobs / while
      // running.
      const summary =
        "loadSummary" in deps.store
          ? await (
              deps.store as {
                loadSummary(id: string): Promise<unknown | null>;
              }
            ).loadSummary(request.params.id)
          : null;

      void reply.send({
        jobId: request.params.id,
        status: record.status,
        progress: record.progress,
        location: deps.store.resultLocation(request.params.id),
        ...(record.error ? { error: record.error } : {}),
        ...(summary !== null ? { summary } : {}),
        ...page,
      });
    });
  };
}
