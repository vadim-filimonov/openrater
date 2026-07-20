/**
 * Container / ECS-Fargate entrypoint — boot the HTTP server + in-process
 * workers.
 *
 * `buildApp()` is deployment-agnostic; this file is the ONE place that
 * opens a socket and (for the single-container local setup) runs worker
 * loops. For prod you'd run the HTTP service and the worker as separate
 * ECS services / Lambdas; set WORKER_CONCURRENCY=0 on the HTTP service.
 * dev runs this via `tsx watch src/main.ts`; the container runs the
 * esbuild bundle (dist/server.mjs).
 */

import { createJobQueue, createResultStore } from "./adapters/factory";
import {
  fetchSnapshotBody,
  fetchSnapshotRuntimePlan,
} from "./core/apiLabPlans";
import { loadConfig } from "./core/config";
import { buildApp } from "./http/server";
import { runWorkerLoop } from "./worker/worker";

async function main(): Promise<void> {
  const config = loadConfig();
  const queue = createJobQueue(config);
  const store = createResultStore(config);
  const app = buildApp({
    logger: true,
    queue,
    store,
    maxRows: config.MAX_BATCH_ROWS,
    defaultChunkSize: config.CHUNK_SIZE,
    apiLabBase: config.API_LAB_BASE,
  });

  const abort = new AbortController();
  const planSource = {
    fetchPlanById: (planId: string, snapshotId: string) =>
      fetchSnapshotRuntimePlan(config.API_LAB_BASE, planId, snapshotId),
    // Brief 75 — the worker's book path resolves the BUNDLE (stages +
    // frozen tail) from the snapshot body.
    fetchSnapshotBody: (planId: string, snapshotId: string) =>
      fetchSnapshotBody(config.API_LAB_BASE, planId, snapshotId),
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < config.WORKER_CONCURRENCY; i += 1) {
    workers.push(runWorkerLoop(queue, store, abort.signal, planSource));
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    abort.abort();
    await Promise.allSettled(workers);
    await app.close();
    await queue.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  const address = await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    `scoring service on ${address} · workers=${config.WORKER_CONCURRENCY} · ` +
      `queue=${config.QUEUE_DRIVER} · store=${config.STORE_DRIVER}`,
  );
}

main().catch((err) => {
  console.error("scoring service failed to start:", err);
  process.exit(1);
});
