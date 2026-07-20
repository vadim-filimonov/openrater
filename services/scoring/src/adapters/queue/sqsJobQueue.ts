/**
 * SqsJobQueue — AWS adapter STUB ("Switch to AWS", ADR-0045).
 *
 * NOT wired in the interim local build. To go to production: implement
 * these methods against the same JobQueue interface and set
 * `QUEUE_DRIVER=sqs` + `SQS_QUEUE_URL`. Mapping notes:
 *   • enqueue → SendMessage (body = jobId; the spec + rows already live
 *     in the ResultStore/S3, so the message stays under SQS's 256 KB cap)
 *   • claim   → ReceiveMessage (WaitTimeSeconds = timeoutMs/1000) — the
 *     visibility timeout gives at-least-once redelivery on worker crash
 *     (an improvement over the remove-on-claim local adapters)
 *   • ack     → DeleteMessage (add an `ack(receiptHandle)` when wiring)
 *   • get/update → a small status store (DynamoDB or Redis); SQS itself
 *     holds no job state
 * The constructor throws so a misconfigured `QUEUE_DRIVER=sqs` fails
 * fast + loud rather than silently dropping jobs.
 */

import type {
  JobQueue,
  JobRecord,
  JobUpdate,
} from "../../ports/jobQueue";

const NOT_CONFIGURED =
  "SqsJobQueue is a stub — implement it for AWS (ADR-0045 'Switch to AWS') before setting QUEUE_DRIVER=sqs.";

export class SqsJobQueue implements JobQueue {
  constructor(config: { readonly queueUrl: string }) {
    void config;
    throw new Error(NOT_CONFIGURED);
  }

  async enqueue(record: JobRecord): Promise<void> {
    void record;
    throw new Error(NOT_CONFIGURED);
  }

  async claim(timeoutMs: number): Promise<string | null> {
    void timeoutMs;
    throw new Error(NOT_CONFIGURED);
  }

  async update(jobId: string, patch: JobUpdate): Promise<void> {
    void jobId;
    void patch;
    throw new Error(NOT_CONFIGURED);
  }

  async get(jobId: string): Promise<JobRecord | null> {
    void jobId;
    throw new Error(NOT_CONFIGURED);
  }

  async ping(): Promise<boolean> {
    return false;
  }

  async close(): Promise<void> {
    /* nothing */
  }
}
