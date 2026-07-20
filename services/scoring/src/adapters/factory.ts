/**
 * Adapter factory — select the JobQueue + ResultStore implementation by
 * CONFIG (ADR-0045 §4). This is the single place the "local → AWS" swap
 * happens: change the env (`QUEUE_DRIVER`, `STORE_DRIVER`), not code.
 */

import type { ServiceConfig } from "../core/config";
import type { JobQueue } from "../ports/jobQueue";
import type { ResultStore } from "../ports/resultStore";

import { InMemoryJobQueue } from "./queue/inMemoryJobQueue";
import { RedisJobQueue } from "./queue/redisJobQueue";
import { SqsJobQueue } from "./queue/sqsJobQueue";
import { FilesystemResultStore } from "./store/filesystemResultStore";
import { S3ResultStore } from "./store/s3ResultStore";

export function createJobQueue(config: ServiceConfig): JobQueue {
  switch (config.QUEUE_DRIVER) {
    case "memory":
      return new InMemoryJobQueue();
    case "redis":
      return new RedisJobQueue(config.REDIS_URL);
    case "sqs":
      return new SqsJobQueue({ queueUrl: config.SQS_QUEUE_URL ?? "" });
    default:
      throw new Error(`Unknown QUEUE_DRIVER: ${String(config.QUEUE_DRIVER)}`);
  }
}

export function createResultStore(config: ServiceConfig): ResultStore {
  switch (config.STORE_DRIVER) {
    case "fs":
      return new FilesystemResultStore(config.STORE_DIR);
    case "s3":
      return new S3ResultStore({ bucket: config.S3_BUCKET ?? "" });
    default:
      throw new Error(`Unknown STORE_DRIVER: ${String(config.STORE_DRIVER)}`);
  }
}
