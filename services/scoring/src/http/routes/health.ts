/**
 * GET /health — liveness + readiness.
 *
 * When a queue/store are wired (batch enabled), readiness PROBES them so
 * a 200 never lies about a down Redis/S3 (silent job loss otherwise).
 * Returns 503 if a configured dependency is unreachable.
 */

import type { FastifyPluginAsync } from "fastify";

import type { JobQueue } from "../../ports/jobQueue";
import type { ResultStore } from "../../ports/resultStore";

export interface HealthDeps {
  readonly queue?: JobQueue;
  readonly store?: ResultStore;
}

export function healthRoutes(deps: HealthDeps): FastifyPluginAsync {
  return async (app) => {
    app.get("/health", async (_request, reply) => {
      const queueReady = deps.queue ? await deps.queue.ping() : null;
      const storeReady = deps.store ? await deps.store.ping() : null;
      const ok = queueReady !== false && storeReady !== false;
      void reply.status(ok ? 200 : 503).send({
        status: ok ? "ok" : "degraded",
        service: "scoring",
        engine: "ready",
        queue: queueReady,
        store: storeReady,
      });
    });
  };
}
