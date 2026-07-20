/**
 * AWS Lambda entrypoint — wraps the SAME buildApp() via
 * @fastify/aws-lambda, no handler rewrite (ADR-0045 §6).
 *
 * One buildApp per cold start. This HTTP Lambda ENQUEUES batch jobs; a
 * separate worker Lambda (consuming SQS) runs them, so there is no
 * in-process worker loop here. A real deployment sets QUEUE_DRIVER=sqs +
 * STORE_DRIVER=s3 (until those adapters are implemented this handler is
 * usable for /score with the local drivers).
 */

import awsLambdaFastify from "@fastify/aws-lambda";

import { createJobQueue, createResultStore } from "../adapters/factory";
import { loadConfig } from "../core/config";
import { buildApp } from "../http/server";

const config = loadConfig();
const app = buildApp({
  queue: createJobQueue(config),
  store: createResultStore(config),
  maxRows: config.MAX_BATCH_ROWS,
  defaultChunkSize: config.CHUNK_SIZE,
  apiLabBase: config.API_LAB_BASE,
});

export const handler = awsLambdaFastify(app);
