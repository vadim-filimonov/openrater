/**
 * buildApp() — the thin HTTP layer over the deployment-agnostic core.
 *
 * Returns a configured Fastify instance WITHOUT calling `.listen()`, so
 * the SAME app boots three ways with no rewrite (ADR-0045 §6):
 *   • src/main.ts        → buildApp().listen()           (container/ECS)
 *   • src/lambda/handler → awsLambdaFastify(buildApp())  (Lambda)
 *   • tests              → app.inject({ ... })           (no socket)
 *
 * This layer contains ZERO engine logic — it parses, calls the core,
 * serializes. Batch routes register only when a JobQueue + ResultStore
 * are supplied; /score + /health work with neither (the parity test
 * boots a queue-less app).
 */

import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import {
  fetchSnapshotBody,
  fetchSnapshotRuntimePlan,
} from "../core/apiLabPlans";
import { ensureEngineReady } from "../core/engine";
import { ServiceError } from "../core/errors";
import type { JobQueue } from "../ports/jobQueue";
import type { ResultStore } from "../ports/resultStore";
import { healthRoutes } from "./routes/health";
import { registerScoreRoutes } from "./routes/score";
import { scoreBatchRoutes } from "./routes/scoreBatch";

export interface BuildAppOptions {
  /** Enable Fastify's request logger (off in tests, on in the server). */
  readonly logger?: boolean;
  /** When both are set, /score-batch is enabled. */
  readonly queue?: JobQueue;
  readonly store?: ResultStore;
  readonly maxRows?: number;
  readonly defaultChunkSize?: number;
  /** API Lab base URL — wires `source:"plan_id"` snapshot resolution
   *  (ADR-0049 A8). Absent → plan_id requests fail with the honest 501. */
  readonly apiLabBase?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  // Register the 18 builtin kinds at construction so a Lambda cold start
  // (one buildApp per container) is ready before the first request.
  ensureEngineReady();

  const app = Fastify({
    logger: options.logger ?? false,
    // Book-scale /score-batch input rows arrive here (results stream from
    // the ResultStore, never inline).
    bodyLimit: 64 * 1024 * 1024,
  });

  app.setErrorHandler((err: FastifyError, _request, reply) => {
    if (err instanceof ServiceError) {
      void reply.status(err.statusCode).send({
        error: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      });
      return;
    }
    const status = typeof err.statusCode === "number" ? err.statusCode : 500;
    void reply.status(status).send({
      error: status >= 500 ? "internal_error" : "request_error",
      message: err.message,
    });
  });

  const healthDeps = {
    ...(options.queue ? { queue: options.queue } : {}),
    ...(options.store ? { store: options.store } : {}),
  };
  const planSourceDeps = options.apiLabBase
    ? {
        fetchPlanById: (planId: string, snapshotId: string) =>
          fetchSnapshotRuntimePlan(options.apiLabBase!, planId, snapshotId),
        // P2 G4 — the bundle path reads the BODY (stages + frozen tail)
        // so /score composes the FILED premium.
        fetchSnapshotBody: (planId: string, snapshotId: string) =>
          fetchSnapshotBody(options.apiLabBase!, planId, snapshotId),
      }
    : {};
  void app.register(healthRoutes(healthDeps));
  void app.register(registerScoreRoutes(planSourceDeps));

  if (options.queue && options.store) {
    void app.register(
      scoreBatchRoutes({
        queue: options.queue,
        store: options.store,
        maxRows: options.maxRows ?? 50_000,
        defaultChunkSize: options.defaultChunkSize ?? 200,
      }),
    );
  }

  return app;
}
